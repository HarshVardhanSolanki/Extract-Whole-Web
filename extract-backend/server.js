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

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
];

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const phoneRegex = /(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}|(?:\+91[\-\s]?)?[6-9]\d{9}/g;

const TARGET_CONTACTS = 100;
const activeSearches = new Map();
const BLOCKED_HOSTS = ['google.', 'bing.com', 'search.yahoo.com', 'yahoo.com', 'duckduckgo.com', 'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com', 'linkedin.com', 'wikipedia.org'];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchPage(url, signal) {
    try {
        const { data } = await axios.get(url, {
            timeout: 12000,
            headers: {
                "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            },
            signal
        });
        return data;
    } catch (e) { return null; }
}

function normalizeUrl(url) {
    if (!url) return null;
    // Google redirect
    if (url.startsWith('/url?q=')) {
        const raw = url.split('/url?q=')[1] || '';
        return decodeURIComponent(raw.split('&')[0] || '').trim();
    }
    // Bing redirect
    if (url.startsWith('/search?') || url.startsWith('/?') ) return null;
    return url.trim();
}

function isValidSourceUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return !BLOCKED_HOSTS.some(blocked => host.includes(blocked));
    } catch (e) { return false; }
}

function extractContactsFromHtml(html, sourceUrl) {
    const text = cheerio.load(html).text();
    const emails = [...new Set(text.match(emailRegex) || [])];
    const phones = [...new Set(text.match(phoneRegex) || [])]
        .map(v => v.replace(/\s+/g, ' ').trim())
        .filter(v => v.replace(/\D/g, '').length >= 10);

    const count = Math.max(emails.length, phones.length);
    const results = [];
    for (let j = 0; j < count; j++) {
        results.push({ website: sourceUrl, mobile: phones[j] || "NA", email: emails[j] || "NA" });
    }
    return results;
}

// ─── Engine Link Collectors ──────────────────────────────────────────────────

function collectGoogleLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const urls = [];
    // Primary selector
    $('a[href]').each((i, el) => {
        const href = normalizeUrl($(el).attr('href'));
        if (!isValidSourceUrl(href) || seen.has(href)) return;
        seen.add(href);
        urls.push(href);
    });
    return urls;
}

function collectBingLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const urls = [];
    $('.b_algo h2 a, .b_algo a[href], li.b_algo a').each((i, el) => {
        const href = normalizeUrl($(el).attr('href'));
        if (!isValidSourceUrl(href) || seen.has(href)) return;
        seen.add(href);
        urls.push(href);
    });
    return urls;
}

function collectYahooLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const urls = [];
    $('.algo h3 a, .algo a[href], .compTitle a').each((i, el) => {
        const href = normalizeUrl($(el).attr('href'));
        if (!isValidSourceUrl(href) || seen.has(href)) return;
        seen.add(href);
        urls.push(href);
    });
    return urls;
}

function collectDuckDuckGoLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const urls = [];
    $('.result__a[href], .result__url, a.result__a').each((i, el) => {
        let href = $(el).attr('href') || '';
        // DDG uses //duckduckgo.com/l/?uddg=... redirects
        if (href.includes('duckduckgo.com/l/?')) {
            const match = href.match(/uddg=([^&]+)/);
            if (match) href = decodeURIComponent(match[1]);
        }
        href = normalizeUrl(href);
        if (!isValidSourceUrl(href) || seen.has(href)) return;
        seen.add(href);
        urls.push(href);
    });
    return urls;
}

// ─── Engine Definitions ──────────────────────────────────────────────────────

function getEngines(keyword, page) {
    const q = encodeURIComponent(keyword);
    return [
        {
            name: "Google",
            url: `https://www.google.com/search?q=${q}&start=${page * 10}&hl=en`,
            collectLinks: collectGoogleLinks
        },
        {
            name: "Bing",
            url: `https://www.bing.com/search?q=${q}&first=${page * 10 + 1}`,
            collectLinks: collectBingLinks
        },
        {
            name: "Yahoo",
            url: `https://search.yahoo.com/search?p=${q}&b=${page * 10 + 1}`,
            collectLinks: collectYahooLinks
        },
        {
            name: "DuckDuckGo",
            url: `https://html.duckduckgo.com/html/?q=${q}&s=${page * 30}`,
            collectLinks: collectDuckDuckGoLinks
        }
    ];
}

// ─── Core Scraper: searches all 4 engines then deep-visits every link ────────

async function scrapePage(keyword, page, signal) {
    const engines = getEngines(keyword, page);
    const collected = [];

    for (const engine of engines) {
        if (signal?.aborted) break;

        const searchHtml = await fetchPage(engine.url, signal);
        if (!searchHtml) continue;

        const links = engine.collectLinks(searchHtml);

        for (const sourceUrl of links) {
            if (signal?.aborted) break;

            const sourceHtml = await fetchPage(sourceUrl, signal);
            if (!sourceHtml) continue;

            const contacts = extractContactsFromHtml(sourceHtml, sourceUrl);
            if (contacts.length > 0) collected.push(...contacts);
        }
    }

    return collected;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Main scrape endpoint – streams results back page-by-page via SSE so popup
// can render contacts as they arrive, OR falls back to single-page JSON when
// a `page` number is supplied.
app.post('/api/scrape', async (req, res) => {
    const { keyword, page, requesterId = 'default' } = req.body;
    if (!keyword || !keyword.trim()) {
        return res.status(400).json({ success: false, message: 'Keyword is required' });
    }

    const normalizedKeyword = keyword.trim();

    // If a different keyword was running for this requester, abort it first
    const existing = activeSearches.get(requesterId);
    if (existing && existing.keyword !== normalizedKeyword) {
        existing.controller.abort();
        activeSearches.delete(requesterId);
    }

    // ── Single-page mode (legacy / paged polling from popup) ─────────────────
    if (Number.isInteger(page)) {
        const data = await scrapePage(normalizedKeyword, page, undefined);
        return res.json({ success: true, data });
    }

    // ── Unlimited streaming mode ──────────────────────────────────────────────
    const controller = new AbortController();
    activeSearches.set(requesterId, { keyword: normalizedKeyword, controller });

    // Use Server-Sent Events so the popup receives incremental results
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (obj) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const seen = new Set();
    const contacts = [];
    let currentPage = 0;

    try {
        while (contacts.length < TARGET_CONTACTS && !controller.signal.aborted) {
            const pageResults = await scrapePage(normalizedKeyword, currentPage, controller.signal);

            pageResults.forEach(lead => {
                const key = `${lead.email}-${lead.mobile}`;
                if (!seen.has(key) && (lead.email !== 'NA' || lead.mobile !== 'NA')) {
                    seen.add(key);
                    contacts.push(lead);
                    // Push each new contact immediately
                    send({ type: 'lead', lead });
                }
            });

            send({ type: 'progress', found: contacts.length, page: currentPage });
            currentPage++;
        }

        send({ type: 'done', total: contacts.length, stopped: controller.signal.aborted });
    } catch (error) {
        send({ type: 'error', message: 'Search failed' });
    } finally {
        if (activeSearches.get(requesterId)?.controller === controller) {
            activeSearches.delete(requesterId);
        }
        if (!res.writableEnded) res.end();
    }
});

// Stop endpoint – abort an active search by requesterId
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

// ─── Auth / Payment Routes ───────────────────────────────────────────────────

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
    const config = type === 'sub'
        ? { script: "https://cdn.razorpay.com/static/widget/subscription-button.js", attr: "data-subscription_button_id", id: "pl_SI7a1dghQQ6lSR" }
        : { script: "https://checkout.razorpay.com/v1/payment-button.js", attr: "data-payment_button_id", id: "pl_SI8NJDt9G2ztRL" };
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
        try {
            await axios.post(GOOGLE_SHEET_MACRO_URL, {
                action: "saveKey", key,
                deviceId: data.notes.device_id || "",
                expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
                email: data.email || "customer@example.com"
            });
        } catch (e) {}
    }
    res.status(200).send("OK");
});

app.get('/payment-success', (req, res) => {
    res.send(`<html><body style="background:#18181b;color:white;text-align:center;padding-top:50px;"><h2>✅ Success!</h2><script>chrome.runtime.sendMessage("${EXT_ID}", { action: "activatePro", key: "${req.query.key}" }); setTimeout(()=>window.close(), 3000);</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Live on ${PORT}`));
