// background.js - Extract Whole Web
// Service Worker (Manifest V3)

console.log("Extract Whole Web - Background service worker started successfully");

// 1. AUTOMATIC ACTIVATION LISTENER
// This catches the message from your Render /payment-success page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.action === "activatePro") {
        // Automatically save the pro status and the key received from the server
        chrome.storage.local.set({ 
            isPro: true, 
            currentKey: message.key 
        }, () => {
            console.log("✅ Pro Status activated automatically via Payment Success Page");
            sendResponse({ success: true });
        });
        return true; // Keeps the message channel open
    }
});

// 2. INSTALLATION LOGIC
chrome.runtime.onInstalled.addListener((details) => {
    console.log("%c✅ Extract Whole Web installed successfully", "color:#10b981; font-weight:600");
    
    if (details.reason === "install") {
        // Initialize storage with default values
        chrome.storage.local.set({
            isPro: false,
            dailyCount: 0,
            lastSearchDate: new Date().toLocaleDateString()
        });

        // Generate and save Device ID immediately on install
        const newId = crypto.randomUUID();
        chrome.storage.local.set({ deviceId: newId });
        console.log("Generated Device ID:", newId);
    }
});

// 3. INTERNAL MESSAGE LISTENER (From Popup)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getDeviceId") {
        chrome.storage.local.get("deviceId", (data) => {
            sendResponse({ deviceId: data.deviceId || "NOT_FOUND" });
        });
        return true;
    }
});

console.log("🚀 All listeners registered - extension is ready");
