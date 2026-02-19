const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// CRITICAL FIX: Capture raw body for Razorpay signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Your Google Apps Script Web App URL
const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbxl5ctgc0Uyddbg7NBuddfByzUInNwODchzMNLnMaOgExV1IQSID21Ivpl9iDzGjyQM/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";

// 1. VERIFY LICENSE (Called by the Extension)
app.post('/api/verify', async (req, res) => {
    try {
        const response = await axios.post(GOOGLE_SHEET_MACRO_URL, {
            action: "verifyKey",
            key: req.body.key,
            deviceId: req.body.deviceId
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ valid: false, message: "Database error." });
    }
});

// 2. RAZORPAY WEBHOOK (Captures Payment and Saves Key + Device ID)
app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    
    // Verify signature using the raw body buffer
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
                                    .update(req.rawBody)
                                    .digest('hex');

    if (expectedSignature !== signature) {
        console.error("❌ Invalid Webhook Signature");
        return res.status(400).send("Invalid signature");
    }

    if (req.body.event === 'payment.captured') {
        const payment = req.body.payload.payment.entity;
        const email = payment.email;
        
        // Extract Device ID from notes if it exists
        const deviceId = (payment.notes && payment.notes.device_id) ? payment.notes.device_id : "";
        
        const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

        try {
            // Save to Google Sheet including the Device ID captured from checkout notes
            await axios.post(GOOGLE_SHEET_MACRO_URL, {
                action: "saveKey",
                key: newKey,
                deviceId: deviceId, // This fixes the blank Device ID issue
                expiresAt: expiresAt,
                email: email
            });
            console.log(`✅ Key ${newKey} generated for ${email} (Device: ${deviceId})`);
        } catch (err) {
            console.error("❌ Error saving to Google Sheets:", err.message);
        }
    }
    res.status(200).send("OK");
});

// 2.5 RAZORPAY HOSTED CHECKOUT PAGE (Fixes "No Device ID captured")

app.get('/payment-success', (req, res) => {
    const key = req.query.key;
    res.send(`
        <html>
        <body style="background:#18181b;color:white;text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2 style="color:#10b981;">✅ Payment Successful!</h2>
            <p>Your Key: <strong>${key}</strong></p>
            <p>You can close this window now. The extension has been activated.</p>
            <script>
                // Send the key back to the extension automatically
                chrome.runtime.sendMessage("YOUR_EXTENSION_ID", { action: "activatePro", key: "${key}" });
                // Auto-close after 5 seconds
                setTimeout(() => window.close(), 5000);
            </script>
        </body>
        </html>
    `);
});

// 3. THE SCRAPING ROUTE
app.post('/api/scrape', async (req, res) => {
    const { keyword, isPro } = req.body;
    
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;
        const { data } = await axios.get(url, { 
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
            timeout: 10000 
        });
        
        const $ = cheerio.load(data);
        const textContent = $('body').text();

        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const phoneRegex = /(?:\+91[\-\s]?)?[6789]\d{9}/g;

        const emails = [...new Set(textContent.match(emailRegex) || [])];
        const phones = [...new Set(textContent.match(phoneRegex) || [])];

        let results = [];
        const maxLength = Math.max(emails.length, phones.length);
        for(let i = 0; i < maxLength; i++) {
            results.push({
                source: "Web Search",
                email: emails[i] || null,
                number: phones[i] || null
            });
        }

        const limit = isPro ? 50 : 2;
        res.json({ success: true, data: results.slice(0, limit) });

    } catch (error) {
        console.error("Scraping error:", error.message);
        res.status(500).json({ success: false, error: "Web search failed. Try again later." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));




