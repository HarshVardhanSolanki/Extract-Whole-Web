const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";
let isPro = false;
let isSearching = false;
let currentResults = [];
let seenKeys = new Set();

function initializeExtension() {
    loadSettings();
    document.getElementById('search-btn').addEventListener('click', startSearch);
    document.getElementById('stop-btn').addEventListener('click', stopSearch);
    document.getElementById('key-icon-btn').addEventListener('click', () => document.getElementById('key-modal').style.display = 'flex');
    document.getElementById('footer-upgrade-btn').addEventListener('click', () => document.getElementById('upgrade-modal').style.display = 'flex');
    document.getElementById('cancel-key-btn').addEventListener('click', () => document.getElementById('key-modal').style.display = 'none');
    document.getElementById('activate-key-btn').addEventListener('click', activateKey);
    document.getElementById('pay-sub-btn').addEventListener('click', () => initiatePayment('sub'));
    document.getElementById('pay-once-btn').addEventListener('click', () => initiatePayment('once'));
    document.getElementById('maybe-later-btn').addEventListener('click', () => document.getElementById('upgrade-modal').style.display = 'none');
    document.getElementById('clear-btn').addEventListener('click', () => { currentResults = []; seenKeys.clear(); renderTable(); document.getElementById('empty-state').style.display = 'block'; });
}

async function startSearch() {
    const keyword = document.getElementById('keyword-input').value.trim();
    if (!keyword) return alert("Enter keyword.");

    isSearching = true;
    currentResults = [];
    seenKeys.clear();
    updateButtonStates(true);

    const isSpecific = keyword.toLowerCase().includes("contact") || keyword.split(" ").length < 3;
    const targetCount = isSpecific ? 10 : 100;
    let page = 0;

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('status-bar').style.display = 'block';

    while (isSearching && currentResults.length < targetCount && page < 25) {
        try {
            // Human Speed Delay: Wait 1.5 - 3 seconds between requests
            const delay = Math.floor(Math.random() * 1500) + 1500;
            await new Promise(r => setTimeout(r, delay));

            const res = await fetch(`${RENDER_BACKEND_URL}/api/scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword, page })
            });
            const result = await res.json();
            
            if (result.success && result.data.length > 0) {
                result.data.forEach(lead => {
                    const key = `${lead.email}-${lead.mobile}`;
                    if (!seenKeys.has(key) && (lead.email !== "NA" || lead.mobile !== "NA")) {
                        seenKeys.add(key);
                        currentResults.push(lead);
                    }
                });
                renderTable();
            }
            page++;
        } catch (e) { break; }
    }
    stopSearch();
}

function stopSearch() {
    isSearching = false;
    updateButtonStates(false);
    document.getElementById('status-bar').style.display = 'none';
}

function updateButtonStates(searching) {
    document.getElementById('search-btn').style.display = searching ? 'none' : 'block';
    document.getElementById('stop-btn').style.display = searching ? 'block' : 'none';
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

async function loadSettings() {
    const data = await chrome.storage.local.get(['isPro', 'deviceId']);
    isPro = data.isPro || false;
    document.getElementById('plan-badge').textContent = isPro ? 'PRO' : 'FREE';
    if (isPro) document.getElementById('footer-upgrade-btn').style.display = 'none';
}

async function activateKey() {
    const key = document.getElementById('key-input').value.trim();
    const data = await chrome.storage.local.get(['deviceId']);
    const res = await fetch(`${RENDER_BACKEND_URL}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, deviceId: data.deviceId }) });
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
