const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";

let isPro = false;
let dailyCount = 0;
let currentResults = [];

// Fail-safe initialization
function initializeExtension() {
    loadSettings();
    
    // Connect buttons explicitly
    document.getElementById('key-icon-btn').addEventListener('click', showKeyModal);
    document.getElementById('search-btn').addEventListener('click', startSearch);
    document.getElementById('clear-btn').addEventListener('click', clearResults);
    document.getElementById('footer-upgrade-btn').addEventListener('click', showUpgradeModal);
    document.getElementById('cancel-key-btn').addEventListener('click', hideKeyModal);
    document.getElementById('activate-key-btn').addEventListener('click', activateKey);
    document.getElementById('pay-razorpay-btn').addEventListener('click', initiatePayment);
    document.getElementById('maybe-later-btn').addEventListener('click', hideUpgradeModal);

    // Global listener for dynamically created "Unlock" buttons in the table
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('upgrade-teaser-btn')) {
            showUpgradeModal();
        }
    });

    console.log("✅ Extract Whole Web buttons initialized.");
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

// --- CORE LOGIC ---

/**
 * Loads settings strictly from local storage (No sync)
 */
async function loadSettings() {
    const data = await chrome.storage.local.get(['isPro', 'dailyCount', 'currentKey']);
    isPro = data.isPro || false;
    dailyCount = data.dailyCount || 0;
    
    // Periodically verify if this device still "owns" the key (Single Device Rule)
    if (isPro && data.currentKey) {
        verifySession(data.currentKey);
    }
    updateUI();
}

/**
 * Heartbeat check: Detects if the key was hijacked by another device
 */
async function verifySession(key) {
    const deviceId = await getDeviceId();
    try {
        const res = await fetch(`${RENDER_BACKEND_URL}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, deviceId })
        });
        const result = await res.json();
        
        // If the ID was changed in the sheet, result.valid will be false for THIS deviceId
        if (!result.valid) {
            handleLogout();
        }
    } catch (e) { 
        console.error("Session check failed - staying in current state."); 
    }
}

/**
 * Clears local pro status and alerts the user
 */
function handleLogout() {
    chrome.storage.local.set({ isPro: false, currentKey: null });
    isPro = false;
    updateUI();
    alert("Logged Out: This key is being used on another device. Please setup again.");
}

function updateUI() {
    document.getElementById('plan-badge').textContent = isPro ? 'PRO' : 'FREE';
    document.getElementById('usage-info').textContent = isPro ? 'PRO • Unlimited' : `Free • ${2 - dailyCount} left today`;

    if (isPro) {
        document.getElementById('footer-upgrade-btn').style.display = 'none';
        document.getElementById('key-icon-btn').style.display = 'none';
        document.querySelector('.footer').style.justifyContent = 'center';
    } else {
        document.getElementById('footer-upgrade-btn').style.display = 'block';
        document.getElementById('key-icon-btn').style.display = 'block';
    }
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
            await chrome.storage.local.set({ isPro: true, currentKey: key });
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

async function initiatePayment() {
    hideUpgradeModal();
    const deviceId = await getDeviceId();
    
    const width = 450;
    const height = 650;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);
    
    window.open(
        `${RENDER_BACKEND_URL}/checkout?deviceId=${deviceId}`, 
        'RazorpayCheckout', 
        `width=${width},height=${height},top=${top},left=${left},status=no,menubar=no,resizable=yes`
    );
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
            if (currentResults.length > 0) {
                renderTable();
                if (!isPro) {
                    dailyCount++;
                    chrome.storage.local.set({dailyCount});
                }
            } else {
                alert("No leads found. Your daily limit was not decreased.");
                document.getElementById('empty-state').style.display = 'block';
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
            td.innerHTML = `
                <div class="teaser" style="display:flex; width: 100%; height: 100%;">
                    <div class="upgrade-teaser-btn" style="background:white;color:#10b981;padding:8px 24px;border-radius:9999px;font-weight:700;cursor:pointer;">
                        UNLOCK PRO ₹499/mo
                    </div>
                </div>`;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });

    if(currentResults.length > 0) {
        document.getElementById('table-wrapper').style.display = 'block';
    }
}

function clearResults() { 
    currentResults = [];
    document.getElementById('table-wrapper').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('keyword-input').value = '';
}
