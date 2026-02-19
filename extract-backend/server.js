const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const Razorpay = require('razorpay');

const app = express();
app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const razorpay = new Razorpay({
    key_id: "rzp_live_SI7hveZUyaZdoi",
    key_secret: "WvywmG4zTf76d8mWWAOSCg17"
});

const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbyJN4LC8kA2_D5vK2dm7QFdZ-66zUXyf4et30BYDwDARB4gA-NCBhQHoafuPGZP3iC0/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";
const EXT_ID = "ndjmdakdfolbhianpjfcdhbjiabamdco";

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRegex = /(?:\+91[\-\s]?)?[6789]\d{9}/g;

async function fetchPage(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36" },
            timeout: 8000
        });
        return data;
    } catch (e) { return null; }
}

app.post('/api/scrape', async (req, res) => {
    const { keyword, page = 0 } = req.body;
    
    const engines = [
        { name: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}&start=${page * 10}`, container: ".g", link: "a" },
        { name: "Bing", url: `https://www.bing.com/search?q=${encodeURIComponent(keyword)}&first=${page * 10 + 1}`, container: ".b_algo", link: "a" },
        { name: "Yahoo", url: `https://search.yahoo.com/search?p=${encodeURIComponent(keyword)}&b=${page * 10 + 1}`, container: ".algo", link: "a" },
        { name: "DuckDuckGo", url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, container: ".result", link: ".result__a" }
    ];

    const results = await Promise.all(engines.map(async (engine) => {
        const html = await fetchPage(engine.url);
        if (!html) return [];
        const $ = cheerio.load(html);
        let local = [];
        $(engine.container).each((i, el) => {
            const text = $(el).text();
            const link = $(el).find(engine.link).attr('href') || "NA";
            const emails = text.match(emailRegex) || [];
            const phones = text.match(phoneRegex) || [];
            const count = Math.max(emails.length, phones.length);
            for (let j = 0; j < count; j++) {
                local.push({ website: link, mobile: phones[j] || "NA", email: emails[j] || "NA" });
            }
        });
        return local;
    }));

    res.json({ success: true, data: results.flat() });
});

// Verification and Webhook routes remain unchanged for stability
app.post('/api/verify', async (req, res) => {
    try {
        const response = await axios.post(GOOGLE_SHEET_MACRO_URL, { action: "verifyKey", key: req.body.key, deviceId: req.body.deviceId });
        res.json(response.data);
    } catch (error) { res.status(500).json({ valid: false }); }
});

app.get('/checkout', (req, res) => {
    const { deviceId, type } = req.query;
    const config = type === 'sub' ? 
        { script: "https://cdn.razorpay.com/static/widget/subscription-button.js", attr: "data-subscription_button_id", id: "pl_SI7a1dghQQ6lSR" } :
        { script: "https://checkout.razorpay.com/v1/payment-button.js", attr: "data-payment_button_id", id: "pl_SI8NJDt9G2ztRL" };
    res.send(`<html><body style="background:#18181b;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
        <form id="rzp-form"><script src="${config.script}" ${config.attr}="${config.id}" data-notes.device_id="${deviceId || ""}" data-button_theme="brand-color" async></script></form>
        <script>const i = setInterval(() => { const b = document.querySelector('.razorpay-payment-button'); if(b) { b.click(); clearInterval(i); }}, 500);</script>
    </body></html>`);
});

app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
    if (expected !== signature) return res.status(400).send("Invalid");
    const { event, payload } = req.body;
    if (event === 'payment.captured' || event === 'subscription.authenticated') {
        const data = payload.payment ? payload.payment.entity : payload.subscription.entity;
        const key = crypto.randomBytes(8).toString('hex').toUpperCase();
        try { await axios.post(GOOGLE_SHEET_MACRO_URL, { action: "saveKey", key, deviceId: data.notes.device_id || "", expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), email: data.email || "customer@example.com" }); } catch (e) {}
    }
    res.status(200).send("OK");
});

app.get('/payment-success', (req, res) => {
    res.send(`<html><body style="background:#18181b;color:white;text-align:center;padding-top:50px;"><h2>✅ Success!</h2><script>chrome.runtime.sendMessage("${EXT_ID}", { action: "activatePro", key: "${req.query.key}" }); setTimeout(()=>window.close(), 3000);</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Live on ${PORT}`));
