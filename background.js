// background.js - Extract Whole Web
// Service Worker (Manifest V3)

console.log("Extract Whole Web - Background service worker started successfully");

// =============================================
// Real scraping skeleton (uncomment when ready)
// =============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "search") {
        const keyword = request.keyword;
        
        // Example: DuckDuckGo HTML scraping (free & legal)
        fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`)
            .then(response => response.text())
            .then(html => {
                // Parse the HTML (you can use DOMParser in background too)
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                
                // Extract result links (example)
                const links = Array.from(doc.querySelectorAll('.result__a'))
                                  .map(a => a.href);
                
                // TODO: In real version - fetch each page + regex for email/phone
                // For now returning mock for testing
                sendResponse({ 
                    success: true, 
                    leads: [], 
                    message: "Scraping skeleton ready - add your regex logic here" 
                });
            })
            .catch(err => {
                console.error("Scraping error:", err);
                sendResponse({ success: false, error: err.message });
            });
        
        return true; // Important for async sendResponse
    }
});


chrome.runtime.onInstalled.addListener((details) => {
    console.log("%c✅ Extract Whole Web installed successfully", "color:#10b981; font-weight:600");
    console.log("Version:", chrome.runtime.getManifest().version);
    
    if (details.reason === "install") {
        chrome.storage.local.set({
            isPro: false,
            dailyCount: 0,
            lastSearchDate: ""
        });
    }
});

// Optional: Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getDeviceId") {
        chrome.storage.local.get("deviceId", (data) => {
            sendResponse({ deviceId: data.deviceId });
        });
        return true;
    }
});

console.log("🚀 All listeners registered - extension is ready");