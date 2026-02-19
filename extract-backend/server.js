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

// --- UTILS ---
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRegex = /(?:\+91[\-\s]?)?[6789]\d{9}/g;

async function fetchWithRetry(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] },
            timeout: 8000
        });
        return data;
    } catch (e) { return null; }
}

// --- SCRAPING ROUTE ---
app.post('/api/scrape', async (req, res) => {
    const { keyword, isPro } = req.body;
    let finalLeads = [];
    let seenLeads = new Set(); // For de-duplication

    // Search Engine Configurations
    const engines = [
        { name: "Google", url: (k, p) => `https://www.google.com/search?q=${encodeURIComponent(k)}&start=${p * 10}`, container: "#search .g", link: "a" },
        { name: "Bing", url: (k, p) => `https://www.bing.com/search?q=${encodeURIComponent(k)}&first=${p * 10 + 1}`, container: ".b_algo", link: "a" },
        { name: "Yahoo", url: (k, p) => `https://search.yahoo.com/search?p=${encodeURIComponent(k)}&b=${p * 10 + 1}`, container: ".algo", link: "a" },
        { name: "DuckDuckGo", url: (k, p) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(k)}`, container: ".result", link: ".result__a" }
    ];

    // Pro users get 5 pages per engine (approx 150-200 links checked)
    const maxPages = isPro ? 5 : 1; 

    for (const engine of engines) {
        if (finalLeads.length >= (isPro ? 100 : 2)) break;

        for (let page = 0; page < maxPages; page++) {
            const html = await fetchWithRetry(engine.url(keyword, page));
            if (!html) break;

            const $ = cheerio.load(html);
            $(engine.container).each((i, el) => {
                const text = $(el).text();
                const link = $(el).find(engine.link).attr('href') || "N/A";
                
                const foundEmails = text.match(emailRegex) || [];
                const foundPhones = text.match(phoneRegex) || [];

                const max = Math.max(foundEmails.length, foundPhones.length);
                for (let j = 0; j < max; j++) {
                    const email = foundEmails[j] || "NA";
                    const phone = foundPhones[j] || "NA";
                    const uniqueKey = `${email}-${phone}`;

                    if (!seenLeads.has(uniqueKey) && (email !== "NA" || phone !== "NA")) {
                        seenLeads.add(uniqueKey);
                        finalLeads.push({
                            source: link,
                            number: phone,
                            email: email
                        });
                    }
                }
            });
            if (engine.name === "DuckDuckGo") break; // DDG HTML doesn't paginate easily
        }
    }

    if (finalLeads.length === 0) {
        return res.json({ success: true, data: [], message: "No more extraction found." });
    }

    res.json({ 
        success: true, 
        data: finalLeads.slice(0, isPro ? 150 : 2) 
    });
});

// --- CORE ROUTES (VERIFY, CHECKOUT, WEBHOOK) ---
app.post('/api/verify', async (req, res) => {
    try {
        const response = await axios.post(GOOGLE_SHEET_MACRO_URL, {
            action: "verifyKey", key: req.body.key, deviceId: req.body.deviceId
        });
        res.json(response.data);
    } catch (error) { res.status(500).json({ valid: false }); }
});

app.get('/checkout', (req, res) => {
    const { deviceId, type } = req.query;
    let config = type === 'sub' ? 
        { script: "https://cdn.razorpay.com/static/widget/subscription-button.js", attr: "data-subscription_button_id", id: "pl_SI7a1dghQQ6lSR" } :
        { script: "https://checkout.razorpay.com/v1/payment-button.js", attr: "data-payment_button_id", id: "pl_SI8NJDt9G2ztRL" };

    res.send(`<html><body style="background:#18181b;color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0;">
        <h2>Opening Secure Checkout...</h2>
        <form id="razorpay-form"><script src="${config.script}" ${config.attr}="${config.id}" data-notes.device_id="${deviceId || ""}" data-button_theme="brand-color" async></script></form>
        <script>const checkBtn = setInterval(() => { const btn = document.querySelector('.razorpay-payment-button'); if(btn) { btn.click(); clearInterval(checkBtn); }}, 500);</script>
    </body></html>`);
});

app.post('/webhook/razorpay', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
    if (expectedSignature !== signature) return res.status(400).send("Invalid");
    const { event, payload } = req.body;
    if (event === 'payment.captured' || event === 'subscription.authenticated') {
        const paymentData = payload.payment ? payload.payment.entity : payload.subscription.entity;
        const deviceId = (paymentData.notes && paymentData.notes.device_id) ? paymentData.notes.device_id : "";
        const newKey = crypto.randomBytes(8).toString('hex').toUpperCase();
        try {
            await axios.post(GOOGLE_SHEET_MACRO_URL, {
                action: "saveKey", key: newKey, deviceId: deviceId, expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), email: paymentData.email || "customer@example.com"
            });
        } catch (err) { console.error("Sheet Error"); }
    }
    res.status(200).send("OK");
});

app.get('/payment-success', (req, res) => {
    const key = req.query.key || "Activating..."; 
    res.send(`<html><body style="background:#18181b;color:white;text-align:center;padding-top:50px;font-family:sans-serif;">
        <h2 style="color:#10b981;">✅ Payment Successful!</h2>
        <script>if (window.chrome && chrome.runtime) { chrome.runtime.sendMessage("${EXT_ID}", { action: "activatePro", key: "${key}" }); } setTimeout(() => window.close(), 4000);</script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
