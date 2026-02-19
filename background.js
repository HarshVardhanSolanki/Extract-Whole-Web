// background.js - Central Security Logic

// 1. INITIALIZATION: Generate Fingerprint on Install
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        const deviceId = crypto.randomUUID(); // Your unique machine ID
        chrome.storage.local.set({
            isPro: false,          // The "registered" flag
            deviceId: deviceId,    // Approved machine ID
            dailyCount: 0
        }, () => {
            console.log("✅ Unique Device Fingerprint assigned: " + deviceId);
        });
    }
});

// 2. EXTERNAL ACTIVATION: Auto-register from Render Success Page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.action === "activatePro") {
        // Flag the device as registered and store the key
        chrome.storage.local.set({ 
            isPro: true, 
            currentKey: message.key 
        }, () => {
            console.log("🚀 Pro status registered via external activation.");
            sendResponse({ success: true });
        });
        return true; 
    }
});

// 3. INTERNAL VALIDATION: Heartbeat for "Single Device" check
chrome.runtime.onStartup.addListener(async () => {
    const data = await chrome.storage.local.get(['isPro', 'currentKey', 'deviceId']);
    
    // If the user is supposed to be PRO, check if they still "own" the key
    if (data.isPro && data.currentKey) {
        try {
            const res = await fetch("https://extract-whole-web.onrender.com/api/verify", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: data.currentKey, deviceId: data.deviceId })
            });
            const result = await res.json();

            // If the Sheet shows a different device ID, log this one out
            if (!result.valid) {
                chrome.storage.local.set({ isPro: false, currentKey: null });
                console.log("❌ Device Mismatch: Flagged as unregistered.");
            }
        } catch (e) {
            console.log("⚠️ Offline: Preserving last known registration state.");
        }
    }
});
