const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL HERE
const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbxK7ewYtZoIMzyvbJT_B-mnvmxRHuzh1UYkb70gS_Ti8BtdYgfHPejy_CyzCkKSNsAW/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";

// 1. VERIFY LICENSE (Extension calls this -> This calls Google Sheets)
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

// 2. RAZORPAY WEBHOOK (Razorpay calls this -> Generates key -> Saves to Google Sheets)
app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const bodyString = JSON.stringify(req.body);
    
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
                                    .update(bodyString).digest('hex');

    if (expectedSignature === signature && req.body.event === 'payment.captured') {
        const email = req.body.payload.payment.entity.email;
        const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();
        const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

        // Save to Google Sheet
        await axios.post(GOOGLE_SHEET_MACRO_URL, {
            action: "saveKey",
            key: newKey,
            expiresAt: expiresAt,
            email: email
        });
        console.log(`Key ${newKey} saved for ${email}`);
    }
    res.status(200).send("OK");
});

// 3. THE SCRAPING ROUTE
app.post('/api/scrape', async (req, res) => {
    const { keyword, isPro } = req.body;
    
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;
        const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }});
        
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
                source: "Web",
                email: emails[i] || null,
                number: phones[i] || null
            });
        }

        const limit = isPro ? 50 : 2;
        res.json({ success: true, data: results.slice(0, limit) });

    } catch (error) {
        res.status(500).json({ success: false, error: "Scraping failed." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
