chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isPro: false, deviceId: crypto.randomUUID() });
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    if (msg.action === "activatePro") {
        chrome.storage.local.set({ isPro: true, currentKey: msg.key });
        sendResponse({ success: true });
    }
});
