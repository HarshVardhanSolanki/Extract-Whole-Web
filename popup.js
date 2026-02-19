// --- PRODUCTION CONFIGURATION ---
const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";
const RAZORPAY_PAYMENT_LINK = "https://rzp.io/rzp/Qvf5EOnY"; // Your actual link!

let isPro = false;
let dailyCount = 0;
let currentResults = [];

// 1. Initialize immediately (No need to wait for DOMContentLoaded)
loadSettings();

// 2. Attach Event Listeners to buttons directly
document.getElementById('key-icon-btn').addEventListener('click', showKeyModal);
document.getElementById('search-btn').addEventListener('click', startSearch);
document.getElementById('clear-btn').addEventListener('click', clearResults);
document.getElementById('footer-upgrade-btn').addEventListener('click', showUpgradeModal);
document.getElementById('cancel-key-btn').addEventListener('click', hideKeyModal);
document.getElementById('activate-key-btn').addEventListener('click', activateKey);
document.getElementById('pay-razorpay-btn').addEventListener('click', initiatePayment);
document.getElementById('maybe-later-btn').addEventListener('click', hideUpgradeModal);

// 3. Event listener for dynamically created "Unlock Pro" teaser buttons
document.body.addEventListener('click', (e) => {
    if (e.target.classList.contains('upgrade-teaser-btn')) {
        showUpgradeModal();
    }
});

console.log("%c✅ Extract Whole Web connected securely!", "color:#10b981;font-weight:700");

// --- CORE FUNCTIONS ---
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
        alert("❌ Could not connect to the server. Please check your internet or try again.");
    }
}

function initiatePayment() {
    hideUpgradeModal();
    window.open(RAZORPAY_PAYMENT_LINK, '_blank');
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
            
            if (!isPro) {
                dailyCount++;
                chrome.storage.local.set({dailyCount});
            }
        } else {
            alert("Scraping failed: " + result.error);
        }

    } catch (err) {
        console.error(err);
        alert("❌ Server error. Please try again.");
    }

    document.getElementById('status-bar').style.display = 'none';
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
            
            td.innerHTML = `
                <div class="teaser" style="display:flex; width: 100%; height: 100%;">
                    <div class="upgrade-teaser-btn" style="background:white;color:#10b981;padding:8px 24px;border-radius:9999px;font-weight:700;cursor:pointer;">
                        UNLOCK PRO ₹499/mo
                    </div>
                </div>
            `;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });

    if(currentResults.length > 0) {
        document.getElementById('table-wrapper').style.display = 'block';
    } else {
        alert("No emails or numbers found for this keyword.");
    }
}

function clearResults() { 
    currentResults = [];
    document.getElementById('table-wrapper').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('keyword-input').value = '';
}
