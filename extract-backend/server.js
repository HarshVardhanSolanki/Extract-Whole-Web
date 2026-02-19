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
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const GOOGLE_SHEET_MACRO_URL = "https://script.google.com/macros/s/AKfycbyJN4LC8kA2_D5vK2dm7QFdZ-66zUXyf4et30BYDwDARB4gA-NCBhQHoafuPGZP3iC0/exec";
const RAZORPAY_WEBHOOK_SECRET = "kugV3Aq5txeKYh/OsBaLezMPxSxJ0SUQGXgk+nKLpWLlBx2ahix7eya7QYa9quI1";
const EXT_ID = "ndjmdakdfolbhianpjfcdhbjiabamdco";

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
];

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Enhanced regex for better mobile number extraction
const phoneRegex = /(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}|(?:\+91[\-\s]?)?[6-9]\d{9}/g;
const TARGET_CONTACTS = 100;
const activeSearches = new Map();

async function fetchPage(url, signal) {
    try {
        const { data } = await axios.get(url, {
            headers: { "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] },
            signal
        });
        return data;
    } catch (e) { return null; }
}

function getEngines(keyword, page) {
    return [
        { name: "Google", url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}&start=${page * 10}`, container: ".g", link: "a" },
        { name: "Bing", url: `https://www.bing.com/search?q=${encodeURIComponent(keyword)}&first=${page * 10 + 1}`, container: ".b_algo", link: "a" },
        { name: "Yahoo", url: `https://search.yahoo.com/search?p=${encodeURIComponent(keyword)}&b=${page * 10 + 1}`, container: ".algo", link: "a" },
        { name: "DuckDuckGo", url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}&s=${page * 30}`, container: ".result", link: ".result__a" }
    ];
}

async function scrapePage(keyword, page, signal) {
    const engines = getEngines(keyword, page);
    const results = await Promise.all(engines.map(async (engine) => {
        const html = await fetchPage(engine.url, signal);
        if (!html) return [];
        const $ = cheerio.load(html);
        const local = [];
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

    return results.flat();
}

app.post('/api/scrape', async (req, res) => {
    const { keyword, page, requesterId = 'default' } = req.body;
    if (!keyword || !keyword.trim()) return res.status(400).json({ success: false, message: 'Keyword is required' });

    const normalizedKeyword = keyword.trim();
    const existing = activeSearches.get(requesterId);

    if (existing && existing.keyword !== normalizedKeyword) {
        existing.controller.abort();
        activeSearches.delete(requesterId);
    }

    if (Number.isInteger(page)) {
        const data = await scrapePage(normalizedKeyword, page, undefined);
        return res.json({ success: true, data });
    }

    const controller = new AbortController();
    activeSearches.set(requesterId, { keyword: normalizedKeyword, controller });

    try {
        const seen = new Set();
        const contacts = [];
        let currentPage = 0;

        while (contacts.length < TARGET_CONTACTS && !controller.signal.aborted) {
            const pageResults = await scrapePage(normalizedKeyword, currentPage, controller.signal);
            pageResults.forEach((lead) => {
                const key = `${lead.email}-${lead.mobile}`;
                if (!seen.has(key) && (lead.email !== 'NA' || lead.mobile !== 'NA')) {
                    seen.add(key);
                    contacts.push(lead);
                }
            });
            currentPage += 1;
        }

        res.json({ success: true, data: contacts.slice(0, TARGET_CONTACTS), stopped: controller.signal.aborted });
    } catch (error) {
        res.status(500).json({ success: false, data: [], message: 'Search failed' });
    } finally {
        if (activeSearches.get(requesterId)?.controller === controller) {
            activeSearches.delete(requesterId);
        }
    }
});

app.post('/api/scrape/stop', (req, res) => {
    const { requesterId = 'default' } = req.body || {};
    const running = activeSearches.get(requesterId);
    if (running) {
        running.controller.abort();
        activeSearches.delete(requesterId);
        return res.json({ success: true, stopped: true });
    }
    res.json({ success: true, stopped: false });
});

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
