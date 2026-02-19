const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const Razorpay = require('razorpay');

const app = express();
app.use(cors());

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

const razorpay = new Razorpay({
    key_id: "rzp_live_SI7hveZUyaZdoi",
    key_secret: "WvywmG4zTf76d8mWWAOSCg17"
});

const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbyJN4LC8kA2_D5vK2dm7QFdZ-66zUXyf4et30BYDwDARB4gA-NCBhQHoafuPGZP3iC0/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";
const EXT_ID = "ndjmdakdfolbhianpjfcdhbjiabamdco"; 

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

app.get('/checkout', (req, res) => {
    const { deviceId, type } = req.query;
    
    // Configuration for different button types
    let scriptUrl, buttonAttr, buttonId;

    if (type === 'sub') {
        // Recurring Subscription Configuration
        scriptUrl = "https://cdn.razorpay.com/static/widget/subscription-button.js";
        buttonAttr = "data-subscription_button_id";
        buttonId = "pl_SI7a1dghQQ6lSR"; // Update this with your actual Subscription Button ID
    } else {
        // One-time Payment Configuration
        scriptUrl = "https://checkout.razorpay.com/v1/payment-button.js";
        buttonAttr = "data-payment_button_id";
        buttonId = "pl_SI8NJDt9G2ztRL"; // Your One-time Monthly Button ID
    }

    res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Secure Checkout</title></head>
    <body style="background:#18181b;color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
        <h2>Opening Secure ${type === 'sub' ? 'Subscription' : 'Checkout'}...</h2>
        <form id="razorpay-form">
            <script src="${scriptUrl}"
                ${buttonAttr}="${buttonId}" 
                data-notes.device_id="${deviceId || ""}"
                data-button_theme="brand-color"
                async></script>
        </form>
        <script>
            const checkBtn = setInterval(() => {
                const btn = document.querySelector('.razorpay-payment-button');
                if(btn) { btn.click(); clearInterval(checkBtn); }
            }, 500);
        </script>
    </body>
    </html>`);
});

app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
                                    .update(req.rawBody).digest('hex');

    if (expectedSignature !== signature) return res.status(400).send("Invalid signature");

    const { event, payload } = req.body;
    let paymentData = null;

    if (event === 'payment.captured' || event === 'subscription.authenticated') {
        paymentData = payload.payment ? payload.payment.entity : payload.subscription.entity;
        
        const email = paymentData.email || "customer@example.com";
        const deviceId = (paymentData.notes && paymentData.notes.device_id) ? paymentData.notes.device_id : "";
        const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); 

        try {
            await axios.post(GOOGLE_SHEET_MACRO_URL, {
                action: "saveKey",
                key: newKey,
                deviceId: deviceId,
                expiresAt: expiresAt,
                email: email
            });
            console.log("✅ New license generated and saved.");
        } catch (err) {
            console.error("❌ Sheet Save Error:", err.message);
        }
    }
    res.status(200).send("OK");
});

app.get('/payment-success', (req, res) => {
    const key = req.query.key || "Activating..."; 
    res.send(`
        <html>
        <body style="background:#18181b;color:white;text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2 style="color:#10b981;">✅ Payment Successful!</h2>
            <script>
                if (window.chrome && chrome.runtime) {
                    chrome.runtime.sendMessage("${EXT_ID}", { action: "activatePro", key: "${key}" });
                }
                setTimeout(() => window.close(), 4000);
            </script>
        </body>
        </html>`);
});

app.post('/api/scrape', async (req, res) => {
    const { keyword, isPro } = req.body;
    try {
        const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, { 
            headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000 
        });
        const $ = cheerio.load(data);
        const textContent = $('body').text();
        const emails = [...new Set(textContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];
        const phones = [...new Set(textContent.match(/(?:\+91[\-\s]?)?[6789]\d{9}/g) || [])];

        let results = emails.map((e, i) => ({ source: "Web Search", email: e, number: phones[i] || null }));
        res.json({ success: true, data: results.slice(0, isPro ? 50 : 2) });
    } catch (error) {
        res.status(500).json({ success: false, error: "Scraping failed." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));
