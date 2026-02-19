const RENDER_BACKEND_URL = "https://extract-whole-web.onrender.com";
let isPro = false;
let dailyCount = 0;
let currentResults = [];

function safeAddListener(id, func) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', func);
}

function initializeExtension() {
    loadSettings();
    
    // Core Buttons
    safeAddListener('pay-sub-btn', () => initiatePayment('sub'));
    safeAddListener('pay-once-btn', () => initiatePayment('once'));
    safeAddListener('key-icon-btn', showKeyModal);
    safeAddListener('search-btn', startSearch);
    safeAddListener('clear-btn', clearResults);
    safeAddListener('footer-upgrade-btn', showUpgradeModal);
    safeAddListener('cancel-key-btn', hideKeyModal);
    safeAddListener('activate-key-btn', activateKey);
    safeAddListener('maybe-later-btn', hideUpgradeModal);

    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('upgrade-teaser-btn')) showUpgradeModal();
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeExtension);
else initializeExtension();

async function loadSettings() {
    const data = await chrome.storage.local.get(['isPro', 'dailyCount', 'currentKey']);
    isPro = data.isPro || false;
    dailyCount = data.dailyCount || 0;
    if (isPro && data.currentKey) verifySession(data.currentKey);
    updateUI();
}

async function verifySession(key) {
    const deviceId = await getDeviceId();
    try {
        const res = await fetch(`${RENDER_BACKEND_URL}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, deviceId })
        });
        const result = await res.json();
        if (!result.valid) handleLogout();
    } catch (e) { console.error("Session check failed."); }
}

function handleLogout() {
    chrome.storage.local.set({ isPro: false, currentKey: null });
    isPro = false;
    updateUI();
    alert("Logged Out: Key used on another device.");
}

function updateUI() {
    const badge = document.getElementById('plan-badge');
    const info = document.getElementById('usage-info');
    if (badge) badge.textContent = isPro ? 'PRO' : 'FREE';
    if (info) info.textContent = isPro ? 'PRO • Unlimited' : `Free • ${2 - dailyCount} left today`;
    
    const upgradeBtn = document.getElementById('footer-upgrade-btn');
    const keyBtn = document.getElementById('key-icon-btn');
    if (isPro) {
        if (upgradeBtn) upgradeBtn.style.display = 'none';
        if (keyBtn) keyBtn.style.display = 'none';
        document.querySelector('.footer').style.justifyContent = 'center';
    } else {
        if (upgradeBtn) upgradeBtn.style.display = 'block';
        if (keyBtn) keyBtn.style.display = 'block';
    }
}

function showKeyModal() { document.getElementById('key-modal').style.display = 'flex'; }
function hideKeyModal() { document.getElementById('key-modal').style.display = 'none'; }
function showUpgradeModal() { document.getElementById('upgrade-modal').style.display = 'flex'; }
function hideUpgradeModal() { document.getElementById('upgrade-modal').style.display = 'none'; }

async function getDeviceId() {
    return new Promise(resolve => {
        chrome.storage.local.get(['deviceId'], (data) => {
            if (data.deviceId) resolve(data.deviceId);
            else {
                const newId = crypto.randomUUID();
                chrome.storage.local.set({ deviceId: newId });
                resolve(newId);
            }
        });
    });
}

async function activateKey() {
    const key = document.getElementById('key-input').value.trim();
    if (!key) return alert("Enter key.");
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
            isPro = true;
            await chrome.storage.local.set({ isPro: true, currentKey: key });
            hideKeyModal();
            updateUI();
        } else alert("❌ " + result.message);
    } catch (err) { alert("❌ Server error."); }
    document.getElementById('activate-key-btn').innerText = "Activate";
}

async function initiatePayment(mode = 'once') {
    hideUpgradeModal();
    const deviceId = await getDeviceId();
    const width = 450;
    const height = 650;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);
    window.open(`${RENDER_BACKEND_URL}/checkout?deviceId=${deviceId}&type=${mode}`, 'RazorpayCheckout', `width=${width},height=${height},top=${top},left=${left},status=no,menubar=no,resizable=yes`);
}

async function startSearch() {
    const keyword = document.getElementById('keyword-input').value.trim();
    if (!keyword) return alert("Enter keyword.");
    if (!isPro && dailyCount >= 2) { showUpgradeModal(); return; }
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
                if (!isPro) { dailyCount++; chrome.storage.local.set({dailyCount}); }
            } else document.getElementById('empty-state').style.display = 'block';
        }
    } catch (err) { alert("❌ Server error."); }
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
        if (i >= displayLimit && !isPro) tr.className = 'locked-row';
        tr.innerHTML = `<td>${i + 1}</td><td><span style="color:#10b981;">${lead.source}</span></td><td>${lead.number || 'NA'}</td><td>${lead.email || 'NA'}</td>`;
        if (i >= displayLimit && !isPro) {
            const td = document.createElement('td');
            td.colSpan = 4;
            td.style.position = 'absolute'; td.style.inset = '0';
            td.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; width:100%; height:100%; background:rgba(24,24,27,0.8);"><div class="upgrade-teaser-btn" style="background:#10b981; color:white; padding:8px 16px; border-radius:9999px; font-weight:700; cursor:pointer;">UNLOCK PRO</div></div>`;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    document.getElementById('table-wrapper').style.display = 'block';
}

function clearResults() { 
    currentResults = [];
    document.getElementById('table-wrapper').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('keyword-input').value = '';
}
