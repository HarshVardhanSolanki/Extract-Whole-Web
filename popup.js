const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";

let isPro = false;
let dailyCount = 0;
let currentResults = [];

function initializeExtension() {
    loadSettings();
    document.getElementById('key-icon-btn').addEventListener('click', showKeyModal);
    document.getElementById('search-btn').addEventListener('click', startSearch);
    document.getElementById('clear-btn').addEventListener('click', clearResults);
    document.getElementById('footer-upgrade-btn').addEventListener('click', showUpgradeModal);
    document.getElementById('cancel-key-btn').addEventListener('click', hideKeyModal);
    document.getElementById('activate-key-btn').addEventListener('click', activateKey);
    document.getElementById('pay-razorpay-btn').addEventListener('click', initiatePayment);
    document.getElementById('maybe-later-btn').addEventListener('click', hideUpgradeModal);

    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('upgrade-teaser-btn')) {
            showUpgradeModal();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

async function loadSettings() {
    const data = await chrome.storage.local.get(['isPro','dailyCount']);
    isPro = data.isPro || false;
    dailyCount = data.dailyCount || 0;
    updateUI();
}

function updateUI() {
    document.getElementById('plan-badge').textContent = isPro ? 'PRO' : 'FREE';
    document.getElementById('usage-info').textContent = isPro ? 'PRO • Unlimited' : `Free • ${2 - dailyCount} left today`;
}

function showKeyModal() { document.getElementById('key-modal').style.display = 'flex'; }
function hideKeyModal() { document.getElementById('key-modal').style.display = 'none'; }
function showUpgradeModal() { document.getElementById('upgrade-modal').style.display = 'flex'; }
function hideUpgradeModal() { document.getElementById('upgrade-modal').style.display = 'none'; }

async function getDeviceId() {
    return new Promise(resolve => {
        chrome.storage.local.get(['deviceId'], (data) => {
            if (data.deviceId) {
                resolve(data.deviceId);
            } else {
                const newId = crypto.randomUUID();
                chrome.storage.local.set({ deviceId: newId });
                resolve(newId);
            }
        });
    });
}

async function activateKey() {
    const key = document.getElementById('key-input').value.trim();
    if (!key) return alert("Please enter a key.");
    const deviceId = await getDeviceId();
    document.getElementById('activate-key-btn').innerText = "Verifying...";

    try {
        const response = await fetch(`${RENDER_BACKEND_URL}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, deviceId })
        });
        const result = await response.json();
        if (result.valid) {
            alert("✅ " + result.message);
            isPro = true;
            chrome.storage.local.set({ isPro: true, currentKey: key });
            hideKeyModal();
            updateUI();
        } else {
            alert("❌ " + result.message);
        }
    } catch (err) {
        alert("❌ Server connection error.");
    }
    document.getElementById('activate-key-btn').innerText = "Activate";
}

// Opens the Razorpay Checkout hosted on your Render server
async function initiatePayment() {
    hideUpgradeModal();
    const deviceId = await getDeviceId();
    window.open(`${RENDER_BACKEND_URL}/checkout?deviceId=${deviceId}`, '_blank');
}

async function startSearch() {
    const keyword = document.getElementById('keyword-input').value.trim();
    if (!keyword) return alert("Please enter a keyword.");

    if (!isPro && dailyCount >= 2) {
        alert("Daily limit reached. Upgrade to Pro.");
        showUpgradeModal();
        return;
    }

    document.getElementById('status-bar').style.display = 'block';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('table-wrapper').style.display = 'none';
    document.getElementById('search-btn').disabled = true;

    try {
        const response = await fetch(`${RENDER_BACKEND_URL}/api/scrape`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, isPro })
        });
        const result = await response.json();

        if (result.success) {
            currentResults = result.data;
            renderTable();
            
            // Only decrease limit if results were actually found
            if (!isPro && currentResults.length > 0) {
                dailyCount++;
                chrome.storage.local.set({dailyCount});
            }
        } else {
            alert("Scraping failed: " + result.error);
        }
    } catch (err) {
        alert("❌ Server error. Please try again.");
    }
    document.getElementById('status-bar').style.display = 'none';
    document.getElementById('search-btn').disabled = false;
    updateUI();
}

function renderTable() {
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = '';
    const displayLimit = isPro ? currentResults.length : 2;

    currentResults.forEach((lead, i) => {
        const tr = document.createElement('tr');
        tr.className = (i >= displayLimit && !isPro) ? 'locked-row' : '';
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><span style="color:#34d399;">${lead.source}</span></td>
            <td style="font-family:monospace;">${lead.number || 'NA'}</td>
            <td style="font-family:monospace;">${lead.email || 'NA'}</td>
        `;
        if (i >= displayLimit && !isPro) {
            const td = document.createElement('td');
            td.colSpan = 4;
            td.style.position = 'absolute';
            td.style.inset = '0';
            td.style.padding = '0';
            td.innerHTML = `<div class="teaser" style="display:flex; width: 100%; height: 100%;">
                <div class="upgrade-teaser-btn" style="background:white;color:#10b981;padding:8px 24px;border-radius:9999px;font-weight:700;cursor:pointer;">UNLOCK PRO ₹499/mo</div>
            </div>`;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    if(currentResults.length > 0) {
        document.getElementById('table-wrapper').style.display = 'block';
    } else {
        alert("No emails or numbers found for this keyword.");
        document.getElementById('empty-state').style.display = 'block';
    }
}

function clearResults() { 
    currentResults = [];
    document.getElementById('table-wrapper').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('keyword-input').value = '';
}
