const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";
let isPro = false;
let isSearching = false;
let currentResults = [];
let seenKeys = new Set();

// Unique stable ID for this browser session (used to let server abort our stream)
let requesterId = null;

function initializeExtension() {
    loadSettings();
    document.getElementById('search-btn').addEventListener('click', startSearch);
    document.getElementById('stop-btn').addEventListener('click', stopSearch);
    document.getElementById('keyword-input').addEventListener('keydown', e => { if (e.key === 'Enter') startSearch(); });
    document.getElementById('key-icon-btn').addEventListener('click', () => document.getElementById('key-modal').style.display = 'flex');
    document.getElementById('footer-upgrade-btn').addEventListener('click', () => document.getElementById('upgrade-modal').style.display = 'flex');
    document.getElementById('cancel-key-btn').addEventListener('click', () => document.getElementById('key-modal').style.display = 'none');
    document.getElementById('activate-key-btn').addEventListener('click', activateKey);
    document.getElementById('pay-sub-btn').addEventListener('click', () => initiatePayment('sub'));
    document.getElementById('pay-once-btn').addEventListener('click', () => initiatePayment('once'));
    document.getElementById('maybe-later-btn').addEventListener('click', () => document.getElementById('upgrade-modal').style.display = 'none');
    document.getElementById('clear-btn').addEventListener('click', () => {
        currentResults = [];
        seenKeys.clear();
        renderTable();
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('table-wrapper').style.display = 'none';
    });
}

// ─── Search ──────────────────────────────────────────────────────────────────

async function startSearch() {
    const keyword = document.getElementById('keyword-input').value.trim();
    if (!keyword) return alert("Enter keyword.");

    // If already searching, stop the old one on the server first
    if (isSearching) {
        await callStopEndpoint();
    }

    isSearching = true;
    currentResults = [];
    seenKeys.clear();
    requesterId = 'req-' + Date.now();

    updateButtonStates(true);
    updateStatusBar(0);

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('status-bar').style.display = 'block';

    try {
        // Use SSE streaming endpoint (no page number = unlimited stream mode)
        const response = await fetch(`${RENDER_BACKEND_URL}/api/scrape`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, requesterId })
        });

        if (!response.ok || !response.body) {
            throw new Error(`Server error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (isSearching) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let event;
                try { event = JSON.parse(line.slice(6)); } catch { continue; }

                if (event.type === 'lead') {
                    const lead = event.lead;
                    const key = `${lead.email}-${lead.mobile}`;
                    if (!seenKeys.has(key) && (lead.email !== 'NA' || lead.mobile !== 'NA')) {
                        seenKeys.add(key);
                        currentResults.push(lead);
                        renderTable();
                        updateStatusBar(currentResults.length);
                    }
                } else if (event.type === 'progress') {
                    updateStatusBar(event.found);
                } else if (event.type === 'done' || event.type === 'error') {
                    isSearching = false;
                    break;
                }
            }

            // Reached goal
            if (currentResults.length >= 100) {
                isSearching = false;
                break;
            }
        }

    } catch (e) {
        // Network errors are silently swallowed so UX stays clean
    }

    stopSearch();
}

async function stopSearch() {
    if (!isSearching && requesterId === null) return;
    isSearching = false;
    await callStopEndpoint();
    updateButtonStates(false);
    document.getElementById('status-bar').style.display = 'none';
}

async function callStopEndpoint() {
    if (!requesterId) return;
    try {
        await fetch(`${RENDER_BACKEND_URL}/api/scrape/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requesterId })
        });
    } catch (e) { /* ignore */ }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function updateButtonStates(searching) {
    document.getElementById('search-btn').style.display = searching ? 'none' : 'block';
    document.getElementById('stop-btn').style.display = searching ? 'block' : 'none';
}

function updateStatusBar(count) {
    const bar = document.getElementById('status-bar');
    bar.textContent = `🔍 Searching all 4 engines... ${count}/100 contacts found`;
}

function renderTable() {
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = '';
    const displayLimit = isPro ? currentResults.length : 2;

    currentResults.forEach((lead, i) => {
        const tr = document.createElement('tr');
        if (i >= displayLimit && !isPro) tr.className = 'locked-row';
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><a href="${lead.website}" target="_blank" style="color:#10b981;">${lead.website}</a></td>
            <td>${lead.mobile}</td>
            <td>${lead.email}</td>`;
        tbody.appendChild(tr);
    });
    document.getElementById('table-wrapper').style.display = currentResults.length > 0 ? 'block' : 'none';
}

// ─── Settings / Auth ─────────────────────────────────────────────────────────

async function loadSettings() {
    const data = await chrome.storage.local.get(['isPro', 'deviceId']);
    isPro = data.isPro || false;
    document.getElementById('plan-badge').textContent = isPro ? 'PRO' : 'FREE';
    if (isPro) document.getElementById('footer-upgrade-btn').style.display = 'none';
}

async function activateKey() {
    const key = document.getElementById('key-input').value.trim();
    const data = await chrome.storage.local.get(['deviceId']);
    const res = await fetch(`${RENDER_BACKEND_URL}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, deviceId: data.deviceId })
    });
    const result = await res.json();
    if (result.valid) {
        await chrome.storage.local.set({ isPro: true, currentKey: key });
        isPro = true;
        location.reload();
    } else { alert("❌ Invalid Key"); }
}

async function initiatePayment(type) {
    const data = await chrome.storage.local.get(['deviceId']);
    window.open(`${RENDER_BACKEND_URL}/checkout?deviceId=${data.deviceId}&type=${type}`, 'RZP', 'width=450,height=650');
}

initializeExtension();
