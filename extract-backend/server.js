const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// Capture raw body for Razorpay signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbyJN4LC8kA2_D5vK2dm7QFdZ-66zUXyf4et30BYDwDARB4gA-NCBhQHoafuPGZP3iC0/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";
const EXT_ID = "ndjmdakdfolbhianpjfcdhbjiabamdco"; 

// 1. VERIFY LICENSE
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

// 2. HOSTED CHECKOUT (Fixes "Cannot GET /checkout")
app.get('/checkout', (req, res) => {
    const deviceId = req.query.deviceId || "";
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Secure Checkout | Extract Whole Web</title>
        <style>
            body { background: #18181b; color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; margin: 0; }
            .loader { border: 4px solid #f3f3f3; border-top: 4px solid #10b981; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin-bottom: 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body>
        <div class="loader"></div>
        <h2>Opening Secure Checkout...</h2>
        <form id="razorpay-form">
            <script src="https://checkout.razorpay.com/v1/payment-button.js"
                data-payment_button_id="pl_SI5WenIOz8WnOS" 
                data-notes.device_id="${deviceId}"
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

// 3. RAZORPAY WEBHOOK (Captures Payment and Saves Key + Device ID)
app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
                                    .update(req.rawBody).digest('hex');

    if (expectedSignature !== signature) {
        return res.status(400).send("Invalid signature");
    }

    if (req.body.event === 'payment.captured') {
        const payment = req.body.payload.payment.entity;
        // Correctly capture device_id from notes
        const deviceId = (payment.notes && payment.notes.device_id) ? payment.notes.device_id : "";
        const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);

        try {
            await axios.post(GOOGLE_SHEET_MACRO_URL, {
                action: "saveKey",
                key: newKey,
                deviceId: deviceId,
                expiresAt: expiresAt,
                email: payment.email
            });
            console.log(`✅ Key ${newKey} saved for ${payment.email}`);
        } catch (err) {
            console.error("❌ Sheet Save Error:", err.message);
        }
    }
    res.status(200).send("OK");
});

// 4. PAYMENT SUCCESS REDIRECT (Automatic Activation)
app.get('/payment-success', (req, res) => {
    // IMPORTANT: In your Razorpay dashboard, set redirect to: 
    // https://extract-whole-web.onrender.com/payment-success
    const key = req.query.key || "Activating..."; 
    res.send(`
        <html>
        <body style="background:#18181b;color:white;text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2 style="color:#10b981;">✅ Payment Successful!</h2>
            <p>Your license is being activated automatically.</p>
            <script>
                const EXT_ID = "${EXT_ID}";
                if (window.chrome && chrome.runtime) {
                    chrome.runtime.sendMessage(EXT_ID, { action: "activatePro", key: "${key}" }, (response) => {
                        console.log("Success message sent to extension.");
                    });
                }
                setTimeout(() => window.close(), 4000);
            </script>
        </body>
        </html>`);
});

// 5. SCRAPING ROUTE
app.post('/api/scrape', async (req, res) => {
    const { keyword, isPro } = req.body;
    try {
        const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, { 
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 10000 
        });
        const $ = cheerio.load(data);
        const textContent = $('body').text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const phoneRegex = /(?:\+91[\-\s]?)?[6789]\d{9}/g;

        const emails = [...new Set(textContent.match(emailRegex) || [])];
        const phones = [...new Set(textContent.match(phoneRegex) || [])];

        let results = emails.map((e, i) => ({
            source: "Web Search",
            email: e,
            number: phones[i] || null
        }));

        res.json({ success: true, data: results.slice(0, isPro ? 50 : 2) });
    } catch (error) {
        res.status(500).json({ success: false, error: "Scraping failed." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`)); 

