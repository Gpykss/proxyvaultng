require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { User, Transaction, ProxyLease, SmsActivation, TelegramTicketMapping, TelegramSupportSession, dbReady, connectDB } = require('./db');
const proxyService = require('./services/proxyService');
const smsService = require('./services/smsService');
const balanceNotifier = require('./services/balanceNotifier');

const SMS_PRICES_KOBO = {
  telegram: 120000, // ₦1,200
  whatsapp: 150000, // ₦1,500
  google: 120000,   // ₦1,200
  chatgpt: 100000,  // ₦1,000
  tiktok: 100000    // ₦1,000
};

function getFlagEmoji(countryCode) {
  if (!countryCode) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  try {
    return String.fromCodePoint(...codePoints);
  } catch (e) {
    return '🌐';
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parser Middleware
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// CORS Middleware enabling credentials
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://proxyvaultng.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  if (process.env.CLIENT_URL) {
    allowedOrigins.push(process.env.CLIENT_URL);
  }
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || 'https://proxyvaultng.vercel.app');
  }
  
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Custom stateless signed cookie-session middleware for Serverless
app.use((req, res, next) => {
  req.session = {};
  
  // Simple cookie parser
  const rawCookie = req.headers.cookie || '';
  const cookies = {};
  rawCookie.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts[0] && parts[1]) {
      cookies[parts[0].trim()] = parts[1].trim();
    }
  });

  const sessionToken = cookies['proxyvault_session'];
  if (sessionToken) {
    try {
      const [userId, email, signature] = sessionToken.split('|');
      const expectedSignature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'proxyvault_super_secret_session_key_12345')
                                      .update(`${userId}|${email}`)
                                      .digest('hex');
      if (signature === expectedSignature) {
        req.session.userId = userId;
        req.session.email = email;
      }
    } catch (e) {
      console.error('Session signature verification error:', e);
    }
  }

  // Session helper methods
  res.saveSession = (userId, email) => {
    const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'proxyvault_super_secret_session_key_12345')
                            .update(`${userId}|${email}`)
                            .digest('hex');
    const token = `${userId}|${email}|${signature}`;
    
    // Cookie options supporting cross-site (Secure; SameSite=None)
    const isProd = process.env.NODE_ENV === 'production';
    const secureFlag = isProd ? 'Secure;' : '';
    const sameSiteFlag = isProd ? 'SameSite=None;' : 'SameSite=Lax;';
    
    res.setHeader('Set-Cookie', `proxyvault_session=${token}; Path=/; HttpOnly; ${secureFlag} ${sameSiteFlag} Max-Age=86400`);
  };

  res.destroySession = () => {
    const isProd = process.env.NODE_ENV === 'production';
    const secureFlag = isProd ? 'Secure;' : '';
    const sameSiteFlag = isProd ? 'SameSite=None;' : 'SameSite=Lax;';
    res.setHeader('Set-Cookie', `proxyvault_session=; Path=/; HttpOnly; ${secureFlag} ${sameSiteFlag} Max-Age=0`);
  };

  next();
});

// Database Connection Middleware for Serverless Environments
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection middleware error:', err);
    res.status(500).json({ error: 'Database connection failed. Please try again later.' });
  }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Fast Warm-up & Ping Endpoints
app.get('/api/v1/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbState: mongoose.connection.readyState
  });
});

// Authentication check middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

// ----------------------------------------------------
// 1. AUTHENTICATION ROUTE ENDPOINTS
// ----------------------------------------------------

// Register a new user
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email.toLowerCase(),
      password_hash: hash,
      balance: 0
    });

    res.saveSession(user._id.toString(), user.email);

    res.status(201).json({ message: 'Registration successful', userId: user._id.toString() });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    res.saveSession(user._id.toString(), user.email);

    res.json({ message: 'Login successful', userId: user._id.toString() });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// Logout user
app.post('/api/auth/logout', (req, res) => {
  res.destroySession();
  res.json({ message: 'Logged out successfully' });
});

// Helper to query Korapay and reconcile any pending deposits (throttled to protect rate limits)
let lastReconcileTime = 0;
async function verifyUserPendingTransactions(userId) {
  try {
    // Enforce rate limiting lock of at most once every 60 seconds
    if (Date.now() - lastReconcileTime < 60000) {
      return;
    }
    lastReconcileTime = Date.now();

    // Reconcile pending deposits created strictly within the last 2 hours to avoid checking dead payments
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const pendingTxList = await Transaction.find({
      user_id: userId,
      type: 'deposit',
      status: 'pending',
      created_at: { $gte: twoHoursAgo }
    });

    const isSimulation = process.env.SIMULATION_MODE === 'true';
    const korapaySecret = process.env.KORAPAY_SECRET_KEY;

    if (pendingTxList.length === 0 || isSimulation || !korapaySecret || korapaySecret.startsWith('sk_test_mock')) {
      return;
    }

    for (const tx of pendingTxList) {
      if (tx.reference.startsWith('pv_kora_')) {
        try {
          const response = await axios.get(`https://api.korapay.com/merchant/api/v1/charges/${tx.reference}`, {
            headers: {
              Authorization: `Bearer ${korapaySecret}`
            },
            timeout: 5000
          });

          if (response.data && response.data.status && response.data.data) {
            const remoteStatus = response.data.data.status; // 'success', 'failed', 'pending'
            if (remoteStatus === 'success') {
              const amountNgn = response.data.data.amount;
              const amountKobo = Math.round(amountNgn * 100);
              await processDeposit(tx.reference, amountKobo);
              console.log(`Automatic Poll Reconciler: Credited transaction ${tx.reference} successfully.`);
            } else if (remoteStatus === 'failed') {
              await Transaction.updateOne({ _id: tx._id }, { $set: { status: 'failed' } });
              console.log(`Automatic Poll Reconciler: Marked transaction ${tx.reference} as failed.`);
            }
          }
        } catch (err) {
          console.error(`Error auto-verifying pending transaction ${tx.reference}:`, err.response ? err.response.data : err.message);
        }
      }
    }
  } catch (err) {
    console.error('Error in verifyUserPendingTransactions:', err);
  }
}

// Get logged-in user profile
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    // Reconcile pending deposits before returning profile
    await verifyUserPendingTransactions(req.session.userId);

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        balance: user.balance
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching profile.' });
  }
});


// ----------------------------------------------------
// 2. WALLET & PAYMENTS (KORAPAY INTEGRATION)
// ----------------------------------------------------

// Initialize Korapay payment (or return a simulation link)
app.post('/api/v1/payments/initialize', requireAuth, async (req, res) => {
  const { amount } = req.body; // Amount in Naira (e.g. 15000)
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Valid deposit amount is required.' });
  }

  const amountKobo = Math.round(amount * 100);
  const reference = `pv_kora_${Date.now()}_${req.session.userId}`;

  try {
    // Record pending transaction with the base amount (what will be credited to user wallet)
    await Transaction.create({
      user_id: req.session.userId,
      type: 'deposit',
      amount: amountKobo,
      reference,
      status: 'pending'
    });

    const korapaySecret = process.env.KORAPAY_SECRET_KEY;
    if (!korapaySecret) {
      throw new Error('Korapay secret key is not configured.');
    }

    // Production Mode: call Korapay API, adding ₦60 merchant charge fee to the user bill
    const totalCharged = amount + 60;

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const response = await axios.post('https://api.korapay.com/merchant/api/v1/charges/initialize', {
      amount: totalCharged,
      currency: 'NGN',
      reference,
      notification_url: `${protocol}://${req.headers.host}/api/v1/payments/korapay-webhook`,
      redirect_url: `${protocol}://${req.headers.host}/dashboard.html?payment=success&reference=${reference}`,
      customer: {
        email: req.session.email
      },
      merchant_bears_cost: true
    }, {
      headers: {
        Authorization: `Bearer ${korapaySecret}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status && response.data.data && response.data.data.checkout_url) {
      return res.json({
        simulation: false,
        checkout_url: response.data.data.checkout_url,
        reference
      });
    } else {
      throw new Error(response.data ? response.data.message : 'Invalid response from Korapay');
    }
  } catch (error) {
    console.error('Korapay initialization error:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to initialize payment with Korapay.' });
  }
});

// Korapay Real Webhook Receiver
app.post('/api/v1/payments/korapay-webhook', async (req, res) => {
  const korapaySignature = req.headers['x-korapay-signature'];
  if (!korapaySignature) {
    return res.status(401).send('Signature missing');
  }

  const secret = process.env.KORAPAY_SECRET_KEY || '';
  
  // 1. Calculate signature on the exact raw request body buffer (Official Korapay production behavior)
  let isValid = false;
  if (req.rawBody) {
    const rawHash = crypto.createHmac('sha256', secret)
                          .update(req.rawBody)
                          .digest('hex');
    if (rawHash === korapaySignature) {
      isValid = true;
    }
  }

  // 2. Fallback check: calculate signature on JSON.stringify(req.body.data) (User instructions and simulation test compatibility)
  if (!isValid) {
    const fallbackHash = crypto.createHmac('sha256', secret)
                               .update(JSON.stringify(req.body.data))
                               .digest('hex');
    if (fallbackHash === korapaySignature) {
      isValid = true;
    }
  }

  // Reject unauthorized payloads
  if (!isValid) {
    return res.status(400).send('Invalid signature');
  }

  const payload = req.body;
  if (payload.event === 'charge.success') {
    const reference = payload.data.reference;
    const amountNgn = payload.data.amount;
    const amountKobo = Math.round(amountNgn * 100);

    try {
      await processDeposit(reference, amountKobo);
      return res.status(200).send('Webhook processed successfully');
    } catch (err) {
      console.error('Webhook processing error:', err.message);
      return res.status(500).send('Internal transaction failure');
    }
  }

  res.status(200).send('Unhandled event type');
});



// Common processor function for deposits with atomic row updates
async function processDeposit(reference, amountKobo) {
  // Find pending transaction and update status atomically to prevent race condition double spends
  const tx = await Transaction.findOneAndUpdate(
    { reference, status: 'pending' },
    { $set: { status: 'completed' } },
    { returnDocument: 'after' }
  );

  if (!tx) {
    const existing = await Transaction.findOne({ reference });
    if (existing && existing.status === 'completed') {
      return; // Already completed successfully
    }
    throw new Error('Transaction reference not found or already processed.');
  }

  // Atomically increment user balance using the base amount from transaction record (excluding gateway fees)
  await User.findByIdAndUpdate(tx.user_id, { $inc: { balance: tx.amount } });
}


// ----------------------------------------------------
// 3. STATIC RESIDENTIAL PROXY ROUTE ENDPOINTS
// ----------------------------------------------------

// Get supported proxy target locations dynamically (CyberYozh aggregation)
// Get supported proxy target locations dynamically (CyberYozh aggregation)
app.get('/api/v1/proxies/countries', requireAuth, async (req, res) => {
  res.json({
    countries: [
      { code: 'US', name: 'United States 🇺🇸', price: 15000 },
      { code: 'GB', name: 'United Kingdom 🇬🇧', price: 15000 },
      { code: 'DE', name: 'Germany 🇩🇪', price: 15000 },
      { code: 'CA', name: 'Canada 🇨🇦', price: 15000 }
    ]
  });
});

let proxyCatalogCache = null;
let proxyCatalogCacheTime = 0;
const CACHE_DURATION_MS = 10 * 60 * 1000; // Cache for 10 minutes

// Load disk cache synchronously on startup
try {
  const cachePath = path.join(__dirname, 'cyberyozh_catalog_cache.json');
  if (fs.existsSync(cachePath)) {
    proxyCatalogCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    proxyCatalogCacheTime = Date.now();
    console.log('Loaded CyberYozh catalog cache from disk.');
  }
} catch (e) {
  console.error('Failed to load proxy catalog cache from disk:', e.message);
}

async function fetchCompleteProxyCatalog(apiKey) {
  try {
    console.log('Priming CyberYozh static residential catalog cache...');
    let allItems = [];
    let nextUrl = 'https://app.cyberyozh.com/api/v1/proxies/shop/?proxy_category=residential_static&stock_status=in_stock';
    let pageCount = 0;

    // Paginate through all next page links (max 50 pages safety count)
    while (nextUrl && pageCount < 50) {
      pageCount++;
      const res = await axios.get(nextUrl, {
        headers: {
          'X-Api-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      const items = res.data.results || [];
      allItems = allItems.concat(items);
      nextUrl = res.data.next;
      
      // Prevent rate limits and allow connection reuse
      if (nextUrl) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`Fetched ${allItems.length} total items from shop catalog across ${pageCount} pages.`);
    
    // Filter strictly for residential_static category
    const staticRes = allItems.filter(item => item.proxy_category === 'residential_static');
    
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const countriesMap = {};

    const liveRate = await getUsdNgnExchangeRate();
    const adjustedRate = liveRate + 40;

    staticRes.forEach(item => {
      let code = (item.location_country_code || '').toUpperCase();
      if (!code) return;
      if (code === 'UK') code = 'GB'; // Normalise United Kingdom

      const providerName = item.title;
      if (!providerName) return;

      if (!countriesMap[code]) {
        let countryName = code;
        try {
          countryName = regionNames.of(code);
        } catch (e) {
          countryName = item.country_name || item.country || code;
        }

        countriesMap[code] = {
          country_name: countryName,
          country_code: code,
          flag: getFlagEmoji(code),
          providers: new Map()
        };
      }

      // Slugify provider name to generate the ID
      const providerId = providerName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

      const wholesaleUSD = (item.proxy_products && item.proxy_products[0]) ? parseFloat(item.proxy_products[0].price_usd) : 5.39;
      const priceNgn = Math.ceil((wholesaleUSD * 2) * adjustedRate);

      countriesMap[code].providers.set(providerId, {
        id: providerId,
        name: providerName,
        speed: '150 Mbps',
        price_ngn: priceNgn
      });
    });

    const countries = Object.values(countriesMap).map(c => ({
      country_name: c.country_name,
      country_code: c.country_code,
      flag: c.flag,
      providers: Array.from(c.providers.values())
    }));

    // Sort countries alphabetically
    countries.sort((a, b) => a.country_name.localeCompare(b.country_name));

    // Save to disk cache
    try {
      fs.writeFileSync(path.join(__dirname, 'cyberyozh_catalog_cache.json'), JSON.stringify(countries, null, 2));
    } catch (fsErr) {
      console.error('Failed to write proxy catalog disk cache:', fsErr.message);
    }

    return countries;
  } catch (err) {
    console.error('Error fetching complete proxy catalog:', err.message);
    throw err;
  }
}

// Expose strict CyberYozh static residential proxy catalog lookup
app.get(['/api/v1/proxies/static-list', '/api/v1/proxies/catalog'], requireAuth, async (req, res) => {
  const apiKey = process.env.CYBERYOZH_API_KEY;

  // Serve from cache if valid (10 minutes TTL)
  const isCacheValid = proxyCatalogCache && (Date.now() - proxyCatalogCacheTime < CACHE_DURATION_MS);
  if (isCacheValid) {
    return res.json({
      success: true,
      countries: proxyCatalogCache
    });
  }

  try {
    const countries = await fetchCompleteProxyCatalog(apiKey);
    proxyCatalogCache = countries;
    proxyCatalogCacheTime = Date.now();

    res.json({
      success: true,
      countries: countries
    });
  } catch (err) {
    console.error('CyberYozh catalog API error:', err.message);
    if (proxyCatalogCache) {
      console.log('Serving stale/disk cached catalog as fallback.');
      return res.json({
        success: true,
        countries: proxyCatalogCache
      });
    }
    res.status(503).json({ error: 'Proxy catalog is temporarily unavailable. Please try again in a few moments.' });
  }
});

// Get supported SMS virtual platforms dynamically (5SIM integration)
app.get('/api/v1/sms/services', requireAuth, async (req, res) => {
  const serviceNames = {
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    google: 'Google Account',
    chatgpt: 'ChatGPT / OpenAI',
    tiktok: 'TikTok'
  };
  
  const list = Object.keys(SMS_PRICES_KOBO).map(id => ({
    id,
    name: serviceNames[id] || id,
    priceKobo: SMS_PRICES_KOBO[id]
  }));
  
  res.json({ services: list });
});

// Get supported virtual number countries (5SIM integration)
app.get('/api/v1/sms/countries', requireAuth, async (req, res) => {
  const isSimulation = process.env.SIMULATION_MODE === 'true';
  const defaultCountries = [
    { id: 'usa', name: 'United States 🇺🇸' },
    { id: 'canada', name: 'Canada 🇨🇦' },
    { id: 'england', name: 'United Kingdom 🇬🇧' },
    { id: 'germany', name: 'Germany 🇩🇪' },
    { id: 'nigeria', name: 'Nigeria 🇳🇬' }
  ];

  if (isSimulation) {
    return res.json({ countries: defaultCountries });
  }

  try {
    const countriesRes = await axios.get('https://5sim.net/v1/guest/countries', { timeout: 5000 });
    const countriesObj = countriesRes.data || {};
    const countriesList = Object.entries(countriesObj).map(([id, val]) => {
      const iso = Object.keys(val.iso || {})[0] || '';
      const flag = getFlagEmoji(iso);
      return {
        id,
        name: `${val.text_en} ${flag}`
      };
    });
    countriesList.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ countries: countriesList });
  } catch (err) {
    res.json({ countries: defaultCountries });
  }
});

// Dynamic SMS catalog endpoint cache state variables
let smsCatalogCache = null;
let smsCatalogCacheTime = 0;
const SMS_CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Dynamic SMS catalog endpoint retrieving dynamic services and countries
app.get('/api/v1/sms/catalog', requireAuth, async (req, res) => {
  const isSimulation = process.env.SIMULATION_MODE === 'true';

  const defaultServices = [
    { id: 'telegram', name: 'Telegram' },
    { id: 'whatsapp', name: 'WhatsApp' },
    { id: 'google', name: 'Google Account' },
    { id: 'chatgpt', name: 'ChatGPT / OpenAI' },
    { id: 'tiktok', name: 'TikTok' }
  ];

  const defaultCountries = [
    { id: 'usa', name: 'United States 🇺🇸' },
    { id: 'canada', name: 'Canada 🇨🇦' },
    { id: 'england', name: 'United Kingdom 🇬🇧' },
    { id: 'germany', name: 'Germany 🇩🇪' },
    { id: 'nigeria', name: 'Nigeria 🇳🇬' }
  ];

  if (isSimulation) {
    return res.json({ services: defaultServices, countries: defaultCountries });
  }

  // Serve from cache if valid
  if (smsCatalogCache && (Date.now() - smsCatalogCacheTime < SMS_CACHE_DURATION_MS)) {
    return res.json(smsCatalogCache);
  }

  try {
    const apiKey = process.env.SMS_5SIM_API_KEY;
    const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' } : { 'Accept': 'application/json' };
    const [productsRes, countriesRes] = await Promise.all([
      axios.get('https://5sim.net/v1/guest/products/any/any', { headers, timeout: 5000 }),
      axios.get('https://5sim.net/v1/guest/countries', { headers, timeout: 5000 })
    ]);

    const productsObj = productsRes.data || {};
    const countriesObj = countriesRes.data || {};
    
    const serviceNames = {
      telegram: 'Telegram',
      whatsapp: 'WhatsApp',
      google: 'Google Account',
      chatgpt: 'ChatGPT / OpenAI',
      tiktok: 'TikTok'
    };

    const liveRate = await getUsdNgnExchangeRate();
    const adjustedRate = liveRate + 40;

    const availableKeys = Object.keys(productsObj);
    const services = availableKeys.map(key => {
      const baseUSD = productsObj[key].Price || 0.1;
      const priceNgn = Math.ceil((baseUSD * 2) * adjustedRate);
      return {
        id: key,
        name: serviceNames[key] || key.charAt(0).toUpperCase() + key.slice(1),
        price_ngn: priceNgn
      };
    });
    services.sort((a, b) => a.name.localeCompare(b.name));

    const countriesList = Object.entries(countriesObj).map(([id, val]) => {
      const iso = Object.keys(val.iso || {})[0] || '';
      const flag = getFlagEmoji(iso);
      return {
        id,
        name: `${val.text_en} ${flag}`
      };
    });
    countriesList.sort((a, b) => a.name.localeCompare(b.name));

    const result = {
      services: services.length > 0 ? services : defaultServices,
      countries: countriesList.length > 0 ? countriesList : defaultCountries
    };

    smsCatalogCache = result;
    smsCatalogCacheTime = Date.now();

    res.json(result);
  } catch (err) {
    console.error('5SIM catalog API error:', err.message);
    if (smsCatalogCache) {
      console.log('Serving stale 5SIM catalog cache as fallback.');
      return res.json(smsCatalogCache);
    }
    res.json({ services: defaultServices, countries: defaultCountries });
  }
});

let cachedExchangeRate = 1600; // Safe NGN fallback
let lastRateFetchTime = 0;
const RATE_CACHE_DURATION_MS = 60 * 60 * 1000; // Cache exchange rate for 1 hour

async function getUsdNgnExchangeRate() {
  if (Date.now() - lastRateFetchTime < RATE_CACHE_DURATION_MS) {
    return cachedExchangeRate;
  }
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 });
    if (res.data && res.data.rates && res.data.rates.NGN) {
      cachedExchangeRate = res.data.rates.NGN;
      lastRateFetchTime = Date.now();
      console.log(`Fetched live USD-NGN exchange rate: ${cachedExchangeRate}`);
    }
  } catch (err) {
    console.error('Failed to fetch live exchange rate, using fallback cached rate:', err.message);
  }
  return cachedExchangeRate;
}

// Get available operators for country and platform with success ratings and dynamic pricing
app.get('/api/v1/sms/operators', requireAuth, async (req, res) => {
  const { country, service } = req.query;
  const targetCountry = country || 'usa';
  const targetService = service || 'whatsapp';
  const isSimulation = process.env.SIMULATION_MODE === 'true';

  const operatorsData = {
    usa: [
      { operator_name: 'T-Mobile', success_rate: 98.0, stock_count: 12543, price_ngn: 1500, isBest: true },
      { operator_name: 'AT&T', success_rate: 94.0, stock_count: 5432, price_ngn: 1500 },
      { operator_name: 'Verizon', success_rate: 88.0, stock_count: 2123, price_ngn: 1500 },
      { operator_name: 'Virtual28', success_rate: 43.9, stock_count: 25453, price_ngn: 1200 }
    ],
    canada: [
      { operator_name: 'Rogers', success_rate: 97.0, stock_count: 8743, price_ngn: 1500, isBest: true },
      { operator_name: 'Bell', success_rate: 91.0, stock_count: 3122, price_ngn: 1500 },
      { operator_name: 'Telus', success_rate: 89.0, stock_count: 1943, price_ngn: 1500 }
    ],
    england: [
      { operator_name: 'EE Mobile', success_rate: 99.0, stock_count: 15432, price_ngn: 1500, isBest: true },
      { operator_name: 'Vodafone', success_rate: 93.0, stock_count: 6732, price_ngn: 1500 },
      { operator_name: 'O2 Mobile', success_rate: 87.0, stock_count: 4213, price_ngn: 1500 }
    ],
    germany: [
      { operator_name: 'Deutsche Telekom', success_rate: 96.0, stock_count: 11432, price_ngn: 1500, isBest: true },
      { operator_name: 'Vodafone DE', success_rate: 92.0, stock_count: 5421, price_ngn: 1500 },
      { operator_name: 'O2 Germany', success_rate: 85.0, stock_count: 2843, price_ngn: 1500 }
    ],
    nigeria: [
      { operator_name: 'MTN', success_rate: 95.0, stock_count: 24512, price_ngn: 1500, isBest: true },
      { operator_name: 'Airtel', success_rate: 91.0, stock_count: 12431, price_ngn: 1500 },
      { operator_name: 'Globacom', success_rate: 78.0, stock_count: 5312, price_ngn: 1000 }
    ]
  };

  if (isSimulation) {
    const list = operatorsData[targetCountry.toLowerCase()] || operatorsData.usa;
    const fixedRetailPrice = (SMS_PRICES_KOBO[targetService] || 150000) / 100;
    const mapped = list.map(op => ({
      operator_name: op.operator_name,
      success_rate: op.success_rate,
      stock_count: op.stock_count,
      price_ngn: Math.ceil(fixedRetailPrice * (op.operator_name === 'Virtual28' ? 0.8 : 1.0))
    })).sort((a, b) => b.success_rate - a.success_rate);

    return res.json({ operators: mapped });
  }

  try {
    const apiKey = process.env.SMS_5SIM_API_KEY;
    const response = await axios.get(`https://5sim.net/v1/guest/prices?product=${targetService}&country=${targetCountry}`, {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' } : { 'Accept': 'application/json' },
      timeout: 5000
    });
    
    const dataObj = response.data || {};
    const countryData = dataObj[targetCountry.toLowerCase()] || {};
    const serviceData = countryData[targetService.toLowerCase()] || {};
    
    const liveRate = await getUsdNgnExchangeRate();
    const adjustedRate = liveRate + 40;

    const operators = Object.keys(serviceData).map(opName => {
      const opInfo = serviceData[opName];
      const wholesaleUSD = opInfo.cost || 0.1;
      const retailNgn = Math.ceil((wholesaleUSD * 2) * adjustedRate);

      return {
        operator_name: opName,
        success_rate: opInfo.rate || 50.0,
        stock_count: opInfo.count || 0,
        price_ngn: retailNgn
      };
    });

    operators.sort((a, b) => b.success_rate - a.success_rate);

    if (operators.length === 0) {
      const list = operatorsData[targetCountry.toLowerCase()] || operatorsData.usa;
      const fixedRetailPrice = (SMS_PRICES_KOBO[targetService] || 150000) / 100;
      const mapped = list.map(op => ({
        operator_name: op.operator_name,
        success_rate: op.success_rate,
        stock_count: op.stock_count,
        price_ngn: Math.ceil(fixedRetailPrice * (op.operator_name === 'Virtual28' ? 0.8 : 1.0))
      })).sort((a, b) => b.success_rate - a.success_rate);
      return res.json({ operators: mapped });
    }

    res.json({ operators });
  } catch (err) {
    console.error('5SIM operators API error, falling back to Simulation:', err.message);
    const list = operatorsData[targetCountry.toLowerCase()] || operatorsData.usa;
    const fixedRetailPrice = (SMS_PRICES_KOBO[targetService] || 150000) / 100;
    const mapped = list.map(op => ({
      operator_name: op.operator_name,
      success_rate: op.success_rate,
      stock_count: op.stock_count,
      price_ngn: Math.ceil(fixedRetailPrice * (op.operator_name === 'Virtual28' ? 0.8 : 1.0))
    })).sort((a, b) => b.success_rate - a.success_rate);
    res.json({ operators: mapped });
  }
});

// Dynamic WireGuard profile and QR generator endpoint
app.post('/api/v1/proxies/wireguard-generate', requireAuth, async (req, res) => {
  const { ip, port, username, password, download, conf } = req.body;
  const targetIp = ip || '185.230.124.175';
  const targetPort = port || '1080';

  const configText = conf || `[Interface]
PrivateKey = ${crypto.randomBytes(32).toString('base64')}
Address = 10.0.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${crypto.randomBytes(32).toString('base64')}
Endpoint = ${targetIp}:${targetPort}
AllowedIPs = 0.0.0.0/0`;

  if (download === 'true' || req.query.download === 'true' || download === true) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="proxyvault-wireguard.conf"');
    return res.send(configText);
  }

  try {
    const qrCodeBase64 = await QRCode.toDataURL(configText);
    res.json({
      qr_code_base64: qrCodeBase64,
      conf_file_stream: configText
    });
  } catch (err) {
    console.error('QR code generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate WireGuard QR code: ' + err.message });
  }
});

// Helper to resolve real-time static residential proxy cost in Kobo dynamically
async function getProxyCostKobo(country, isp) {
  const isSimulation = process.env.SIMULATION_MODE === 'true';
  const defaultPrice = 1500000; // ₦15,000 default in kobo

  if (isSimulation) {
    return defaultPrice;
  }

  // If we have cache, find the country and the ISP provider
  if (proxyCatalogCache) {
    const code = country.toUpperCase();
    const targetCountryObj = proxyCatalogCache.find(c => c.country_code === code);
    if (targetCountryObj) {
      const providerId = (isp || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const provider = targetCountryObj.providers.find(p => p.id === providerId || p.name.toLowerCase() === (isp || '').toLowerCase());
      if (provider && provider.price_ngn) {
        return provider.price_ngn * 100; // NGN to Kobo
      }
    }
  }

  try {
    const apiKey = process.env.CYBERYOZH_API_KEY;
    const response = await axios.get(`https://app.cyberyozh.com/api/v1/proxies/shop/?proxy_category=residential_static&stock_status=in_stock&country=${country.toLowerCase()}`, {
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' },
      timeout: 8000
    });
    const items = response.data.results || [];
    const code = country.toUpperCase();
    const matchedItem = items.find(item => 
      item.proxy_category === 'residential_static' &&
      (item.location_country_code || '').toUpperCase() === code &&
      (item.title.toLowerCase().includes((isp || '').toLowerCase()) || (isp || '').toLowerCase().includes(item.title.toLowerCase()))
    );

    if (matchedItem && matchedItem.proxy_products && matchedItem.proxy_products[0]) {
      const wholesaleUSD = parseFloat(matchedItem.proxy_products[0].price_usd) || 5.0;
      const liveRate = await getUsdNgnExchangeRate();
      const adjustedRate = liveRate + 40;
      const priceNgn = Math.ceil((wholesaleUSD * 2) * adjustedRate);
      return priceNgn * 100; // NGN to Kobo
    }
  } catch (err) {
    console.error('Failed to resolve dynamic proxy cost on-demand:', err.message);
  }

  return defaultPrice;
}

// Buy/Rent a static proxy
app.post('/api/proxy/rent', requireAuth, async (req, res) => {
  const { country, isp } = req.body;
  if (!country || typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) {
    return res.status(400).json({ error: 'Invalid country code format.' });
  }
  const targetCountry = country.toUpperCase();
  const targetIsp = isp || 'any';

  let costKobo;
  try {
    costKobo = await getProxyCostKobo(targetCountry, targetIsp);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to calculate dynamic cost: ' + err.message });
  }

  try {
    // 1. Deduct cost atomically first. Returns null if balance is too low
    const user = await User.findOneAndUpdate(
      { _id: req.session.userId, balance: { $gte: costKobo } },
      { $inc: { balance: -costKobo } },
      { returnDocument: 'after' }
    );

    if (!user) {
      throw new Error('Insufficient wallet balance. Please top up.');
    }

    // 2. Call upstream provisioning
    let proxyDetails;
    try {
      proxyDetails = await proxyService.provisionProxy(targetCountry, targetIsp);
    } catch (provisionErr) {
      // Refund user on upstream failure
      await User.findByIdAndUpdate(req.session.userId, { $inc: { balance: costKobo } });
      throw new Error(`Upstream provisioning failed: ${provisionErr.message}`);
    }

    // 3. Log transaction
    const reference = `px_ref_${crypto.randomBytes(8).toString('hex')}`;
    await Transaction.create({
      user_id: req.session.userId,
      type: 'proxy_rent',
      amount: -costKobo,
      reference,
      status: 'completed'
    });

    // 4. Save proxy lease record
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days lease

    const lease = await ProxyLease.create({
      user_id: req.session.userId,
      ip_address: proxyDetails.ip_address,
      socks5_port: proxyDetails.socks5_port,
      socks5_user: proxyDetails.socks5_user,
      socks5_pass: proxyDetails.socks5_pass,
      wireguard_conf: proxyDetails.wireguard_conf,
      country: proxyDetails.country,
      carrier: proxyDetails.carrier,
      expires_at: expiresAt,
      status: 'active'
    });

    res.status(201).json({
      message: 'Proxy provisioned successfully!',
      lease: {
        id: lease._id.toString(),
        leaseId: lease._id.toString(),
        user_id: lease.user_id.toString(),
        ip_address: lease.ip_address,
        socks5_port: lease.socks5_port,
        socks5_user: lease.socks5_user,
        socks5_pass: lease.socks5_pass,
        wireguard_conf: lease.wireguard_conf,
        country: lease.country,
        carrier: lease.carrier,
        expires_at: lease.expires_at.toISOString(),
        status: lease.status
      }
    });
  } catch (error) {
    console.error('Proxy purchase failure:', error.message);
    res.status(400).json({ error: error.message || 'Failed to rent proxy.' });
  }
});

// Fetch active proxy leases
app.get('/api/proxy/leases', requireAuth, async (req, res) => {
  try {
    const leases = await ProxyLease.find({
      user_id: req.session.userId,
      status: 'active'
    }).sort({ _id: -1 });

    res.json({
      leases: leases.map(l => ({
        id: l._id.toString(),
        user_id: l.user_id.toString(),
        ip_address: l.ip_address,
        socks5_port: l.socks5_port,
        socks5_user: l.socks5_user,
        socks5_pass: l.socks5_pass,
        wireguard_conf: l.wireguard_conf,
        country: l.country,
        carrier: l.carrier,
        expires_at: l.expires_at.toISOString(),
        status: l.status
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve proxy leases.' });
  }
});


// ----------------------------------------------------
// 4. VIRTUAL SMS ACTIVATIONS ROUTE ENDPOINTS
// ----------------------------------------------------

// Helper to resolve real-time SMS retail cost in Kobo dynamically
async function getSmsCostKobo(service, country, operator) {
  const isSimulation = process.env.SIMULATION_MODE === 'true';
  const fallbackPrice = SMS_PRICES_KOBO[service] || 150000; // ₦1,500 default in kobo

  if (isSimulation) {
    return fallbackPrice;
  }

  try {
    const targetCountry = country || 'usa';
    const targetOperator = operator || 'any';
    const response = await axios.get(`https://5sim.net/v1/guest/prices?product=${service}&country=${targetCountry}`, {
      timeout: 5000
    });

    const countryData = response.data[targetCountry.toLowerCase()] || {};
    const serviceData = countryData[service.toLowerCase()] || {};

    let selectedOpInfo = null;
    if (targetOperator === 'any') {
      let minCost = Infinity;
      Object.keys(serviceData).forEach(opName => {
        const op = serviceData[opName];
        if (op.cost < minCost && op.count > 0) {
          minCost = op.cost;
          selectedOpInfo = op;
        }
      });
      if (!selectedOpInfo) {
        Object.keys(serviceData).forEach(opName => {
          const op = serviceData[opName];
          if (op.cost < minCost) {
            minCost = op.cost;
            selectedOpInfo = op;
          }
        });
      }
    } else {
      selectedOpInfo = serviceData[targetOperator.toLowerCase()] || Object.values(serviceData)[0];
    }

    if (!selectedOpInfo) {
      return fallbackPrice;
    }

    const wholesaleUSD = selectedOpInfo.cost || 0.1;
    const liveRate = await getUsdNgnExchangeRate();
    const adjustedRate = liveRate + 40;
    const retailNgn = Math.ceil((wholesaleUSD * 2) * adjustedRate);
    return retailNgn * 100; // NGN to Kobo
  } catch (err) {
    console.error('Error calculating dynamic SMS cost:', err.message);
    return fallbackPrice;
  }
}

// Rent a virtual number
app.post('/api/sms/rent', requireAuth, async (req, res) => {
  const { service, country, operator } = req.body;
  if (!service || typeof service !== 'string') {
    return res.status(400).json({ error: 'Valid virtual number service is required.' });
  }

  const selectedCountry = country || 'usa';
  const selectedOperator = operator || 'any';

  let costKobo;
  try {
    costKobo = await getSmsCostKobo(service, selectedCountry, selectedOperator);
  } catch (err) {
    return res.status(400).json({ error: 'Failed to calculate dynamic cost: ' + err.message });
  }

  try {
    // 1. Deduct cost atomically first. Returns null if balance is too low
    const user = await User.findOneAndUpdate(
      { _id: req.session.userId, balance: { $gte: costKobo } },
      { $inc: { balance: -costKobo } },
      { returnDocument: 'after' }
    );

    if (!user) {
      throw new Error('Insufficient wallet balance. Please top up.');
    }

    // 2. Call upstream activation
    let smsDetails;
    try {
      smsDetails = await smsService.rentNumber(service, selectedCountry, selectedOperator);
    } catch (provisionErr) {
      // Refund user on upstream failure
      await User.findByIdAndUpdate(req.session.userId, { $inc: { balance: costKobo } });
      throw new Error(`Upstream SMS acquisition failed: ${provisionErr.message}`);
    }

    // 3. Log transaction
    const reference = `sms_ref_${crypto.randomBytes(8).toString('hex')}`;
    await Transaction.create({
      user_id: req.session.userId,
      type: 'sms_rent',
      amount: -costKobo,
      reference,
      status: 'completed'
    });

    // 4. Create SMS Activation document
    const activation = await SmsActivation.create({
      user_id: req.session.userId,
      phone_number: smsDetails.phone_number,
      service,
      country: selectedCountry,
      operator: selectedOperator,
      cost: costKobo,
      status: 'waiting',
      expires_at: smsDetails.expires_at,
      sms_api_id: smsDetails.id
    });

    res.status(201).json({
      message: 'Virtual number rented successfully. Polling for OTP.',
      activation: {
        id: activation._id.toString(),
        activationId: activation._id.toString(),
        user_id: activation.user_id.toString(),
        phone_number: activation.phone_number,
        service: activation.service,
        country: activation.country,
        operator: activation.operator,
        cost: activation.cost,
        status: activation.status,
        expires_at: activation.expires_at.toISOString(),
        sms_api_id: smsDetails.id
      }
    });
  } catch (error) {
    console.error('SMS activation error:', error.message);
    res.status(400).json({ error: error.message || 'Failed to rent virtual number.' });
  }
});

// Poll for OTP / Check SMS Status
app.get('/api/sms/poll/:id', requireAuth, async (req, res) => {
  const activationId = req.params.id;

  try {
    const activation = await SmsActivation.findOne({ _id: activationId, user_id: req.session.userId });
    if (!activation) {
      return res.status(404).json({ error: 'Activation record not found.' });
    }

    if (activation.status !== 'waiting') {
      return res.json({
        activation: {
          id: activation._id.toString(),
          user_id: activation.user_id.toString(),
          phone_number: activation.phone_number,
          service: activation.service,
          country: activation.country,
          cost: activation.cost,
          otp_code: activation.otp_code,
          sms_text: activation.sms_text,
          status: activation.status,
          expires_at: activation.expires_at.toISOString()
        }
      });
    }

    // Check expiry
    const isPastExpiry = new Date() > new Date(activation.expires_at);

    if (isPastExpiry) {
      const refundSuccess = await triggerRefund(activationId, req.session.userId, 'expired');
      if (refundSuccess) {
        const updated = await SmsActivation.findById(activationId);
        return res.json({
          message: 'Number expired and refunded.',
          activation: {
            id: updated._id.toString(),
            user_id: updated.user_id.toString(),
            phone_number: updated.phone_number,
            service: updated.service,
            country: updated.country,
            cost: updated.cost,
            otp_code: updated.otp_code,
            sms_text: updated.sms_text,
            status: updated.status,
            expires_at: updated.expires_at.toISOString()
          }
        });
      }
      return res.status(500).json({ error: 'Failed to process refund.' });
    }

    // Poll SMS Upstream
    const creationTime = new Date(activation.created_at).getTime();
    
    const isSimulation = process.env.SIMULATION_MODE === 'true';
    const pollId = isSimulation ? `sim_act_${activation._id.toString()}` : (activation.sms_api_id || activation._id.toString());

    const pollResult = await smsService.checkSMS(pollId, creationTime, activation.service);

    if (pollResult.status === 'received') {
      const updated = await SmsActivation.findOneAndUpdate(
        { _id: activationId },
        { $set: { status: 'received', otp_code: pollResult.otp_code, sms_text: pollResult.sms_text } },
        { returnDocument: 'after' }
      );

      return res.json({
        activation: {
          id: updated._id.toString(),
          user_id: updated.user_id.toString(),
          phone_number: updated.phone_number,
          service: updated.service,
          country: updated.country,
          cost: updated.cost,
          otp_code: updated.otp_code,
          sms_text: updated.sms_text,
          status: updated.status,
          expires_at: updated.expires_at.toISOString()
        }
      });
    } else if (pollResult.status === 'expired') {
      await triggerRefund(activationId, req.session.userId, 'expired');
      const updated = await SmsActivation.findById(activationId);
      return res.json({
        message: 'Order expired upstream and refunded.',
        activation: {
          id: updated._id.toString(),
          user_id: updated.user_id.toString(),
          phone_number: updated.phone_number,
          service: updated.service,
          country: updated.country,
          cost: updated.cost,
          otp_code: updated.otp_code,
          sms_text: updated.sms_text,
          status: updated.status,
          expires_at: updated.expires_at.toISOString()
        }
      });
    }

    res.json({
      activation: {
        id: activation._id.toString(),
        user_id: activation.user_id.toString(),
        phone_number: activation.phone_number,
        service: activation.service,
        country: activation.country,
        cost: activation.cost,
        otp_code: activation.otp_code,
        sms_text: activation.sms_text,
        status: activation.status,
        expires_at: activation.expires_at.toISOString()
      }
    });
  } catch (error) {
    console.error('Error polling SMS activation:', error.message);
    res.status(500).json({ error: 'Error polling activation status.' });
  }
});

// Cancel active virtual number and process instant wallet refund
app.post('/api/sms/cancel/:id', requireAuth, async (req, res) => {
  const activationId = req.params.id;

  try {
    const activation = await SmsActivation.findOne({ _id: activationId, user_id: req.session.userId });
    if (!activation) {
      return res.status(404).json({ error: 'Activation record not found.' });
    }

    if (activation.status !== 'waiting') {
      return res.status(400).json({ error: 'Cannot cancel a completed or already cancelled activation.' });
    }

    // Call upstream cancellation
    const isSimulation = process.env.SIMULATION_MODE === 'true';
    const cancelId = isSimulation ? `sim_act_${activation._id.toString()}` : (activation.sms_api_id || activation._id.toString());
    await smsService.cancelNumber(cancelId);

    // Process local refund in DB
    const success = await triggerRefund(activationId, req.session.userId, 'cancelled');
    if (success) {
      const updated = await SmsActivation.findById(activationId);
      return res.json({
        message: 'Activation cancelled and cost refunded.',
        activation: {
          id: updated._id.toString(),
          user_id: updated.user_id.toString(),
          phone_number: updated.phone_number,
          service: updated.service,
          country: updated.country,
          cost: updated.cost,
          otp_code: updated.otp_code,
          sms_text: updated.sms_text,
          status: updated.status,
          expires_at: updated.expires_at.toISOString()
        }
      });
    }

    res.status(500).json({ error: 'Refund failed to execute.' });
  } catch (error) {
    console.error('Cancellation error:', error.message);
    res.status(500).json({ error: 'Failed to cancel activation.' });
  }
});

// Common utility to process SMS cancellation/expiration refunds atomically
async function triggerRefund(activationId, userId, newStatus) {
  try {
    // Atomically find, assert status, and flip status to prevent double credits
    const act = await SmsActivation.findOneAndUpdate(
      { _id: activationId, user_id: userId, status: 'waiting' },
      { $set: { status: newStatus } },
      { returnDocument: 'after' }
    );

    if (!act) {
      return false; // already updated/processed by parallel call
    }

    // Refund wallet balance atomically
    await User.findByIdAndUpdate(userId, { $inc: { balance: act.cost } });

    // Log transaction
    const reference = `rf_ref_${crypto.randomBytes(8).toString('hex')}`;
    await Transaction.create({
      user_id: userId,
      type: 'sms_refund',
      amount: act.cost,
      reference,
      status: 'completed'
    });

    return true;
  } catch (err) {
    console.error('Refund transaction failure:', err.message);
    return false;
  }
}

// Fetch all activations (active & history) for logged-in user
app.get('/api/sms/activations', requireAuth, async (req, res) => {
  try {
    // Automatically trigger refunds for expired activations
    const activeWaitings = await SmsActivation.find({
      user_id: req.session.userId,
      status: 'waiting'
    });

    for (const act of activeWaitings) {
      if (new Date() > new Date(act.expires_at)) {
        await triggerRefund(act._id, req.session.userId, 'expired');
      }
    }

    const activations = await SmsActivation.find({
      user_id: req.session.userId
    }).sort({ _id: -1 });

    res.json({
      activations: activations.map(act => ({
        id: act._id.toString(),
        user_id: act.user_id.toString(),
        phone_number: act.phone_number,
        service: act.service,
        country: act.country,
        cost: act.cost,
        otp_code: act.otp_code,
        sms_text: act.sms_text,
        status: act.status,
        expires_at: act.expires_at.toISOString(),
        created_at: act.created_at.toISOString()
      }))
    });
  } catch (error) {
    console.error('Fetch activations failure:', error);
    res.status(500).json({ error: 'Failed to retrieve activations.' });
  }
});


// ----------------------------------------------------
// 5. TRANSACTION LOG DETAILS
// ----------------------------------------------------

// Retrieve account transaction log history
app.get('/api/wallet/transactions', requireAuth, async (req, res) => {
  try {
    const transactions = await Transaction.find({
      user_id: req.session.userId
    }).sort({ _id: -1 }).limit(50);

    res.json({
      transactions: transactions.map(tx => ({
        id: tx._id.toString(),
        user_id: tx.user_id.toString(),
        type: tx.type,
        amount: tx.amount,
        reference: tx.reference,
        status: tx.status,
        created_at: tx.created_at.toISOString()
      }))
    });
  } catch (error) {
    console.error('Fetch transactions failure:', error);
    res.status(500).json({ error: 'Failed to retrieve transaction history.' });
  }
});


// Helper to send messages
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
  } catch (err) {
    console.error('Failed to send Telegram message:', err.response ? err.response.data : err.message);
  }
}

// Shared Telegram update handler logic with middleware logging and command handlers
async function handleTelegramUpdate(update) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const adminGroupChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
    ? Number(process.env.TELEGRAM_ADMIN_CHAT_ID.replace(/^--/, '-'))
    : null;

  // Global event logger: prints all incoming Telegram traffic to the console
  console.log('Incoming Telegram update received:', JSON.stringify(update));

  try {
    // 1. Handle user private chat messages
    if (update.message && update.message.chat.type === 'private') {
      const chat = update.message.chat;
      const text = update.message.text;
      const userId = chat.id;

      // Handle start command
      if (text === '/start' || text === '/help') {
        console.log(`Received /start command from User ID: ${userId} (${chat.username || 'No username'})`);
        await sendTelegramMessage(userId, `🇳🇬 *Welcome to ProxyVault Support Desk!*\n\nHow can we help you today? Please tap one of the guides below or simply type your support question directly.`, {
          inline_keyboard: [
            [
              { text: '🌐 Proxy Setup Guide', callback_data: 'guide_proxy' },
              { text: '📱 SMS Verification Help', callback_data: 'guide_sms' }
            ],
            [
              { text: '💳 Deposit & Billing Info', callback_data: 'guide_billing' },
              { text: '💬 Speak to Human', callback_data: 'speak_human' }
            ]
          ]
        });
        return;
      }

      if (!adminGroupChatId) {
        console.error('Telegram admin chat ID is not configured.');
        return;
      }

      // Check if there is an active session
      let session = await TelegramSupportSession.findOne({ user_telegram_id: userId });
      const now = new Date();

      if (session) {
        // If session exists but has been inactive for more than 30 minutes, timeout and delete it
        const diffMinutes = (now - new Date(session.last_activity)) / (1000 * 60);
        if (diffMinutes > 30) {
          console.log(`Session for user ${userId} timed out. Initializing new support ticket.`);
          await TelegramSupportSession.deleteOne({ _id: session._id });
          await TelegramTicketMapping.deleteMany({ user_telegram_id: userId });
          session = null;
        }
      }

      const userName = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'User';
      const usernameHandle = chat.username ? `@${chat.username}` : 'No username';

      if (!session) {
        // 1. NEW SESSION: Send ticket headers & forward message directly
        console.log(`Relaying NEW support ticket from user ${userId} to admin group ${adminGroupChatId}`);
        const headerText = `🎫 *NEW SUPPORT TICKET*\n👤 *User:* ${userName}\n🏷️ *Handle:* ${usernameHandle}\n🆔 *Telegram ID:* \`${userId}\``;
        await sendTelegramMessage(adminGroupChatId, headerText);

        const copyRes = await axios.post(`https://api.telegram.org/bot${token}/copyMessage`, {
          chat_id: adminGroupChatId,
          from_chat_id: userId,
          message_id: update.message.message_id
        });

        if (copyRes.data && copyRes.data.result) {
          const adminMsgId = copyRes.data.result.message_id;

          // Initialize support session state
          await TelegramSupportSession.create({
            user_telegram_id: userId,
            last_admin_message_id: adminMsgId,
            last_activity: now
          });

          // Save message ID lookup mapping
          await TelegramTicketMapping.create({
            admin_message_id: adminMsgId,
            user_telegram_id: userId
          });
        }
      } else {
        // 2. ACTIVE SESSION: Forward follow-up message nested under the same thread!
        console.log(`Relaying active session follow-up message from user ${userId}`);
        const copyRes = await axios.post(`https://api.telegram.org/bot${token}/copyMessage`, {
          chat_id: adminGroupChatId,
          from_chat_id: userId,
          message_id: update.message.message_id,
          reply_to_message_id: session.last_admin_message_id
        });

        if (copyRes.data && copyRes.data.result) {
          const adminMsgId = copyRes.data.result.message_id;

          // Update active session metadata
          session.last_admin_message_id = adminMsgId;
          session.last_activity = now;
          await session.save();

          // Save mapping for this message ID
          await TelegramTicketMapping.create({
            admin_message_id: adminMsgId,
            user_telegram_id: userId
          });
        }
      }

      return;
    }

    // 2. Handle interactive menu callback queries
    if (update.callback_query) {
      const cb = update.callback_query;
      const userId = cb.message.chat.id;
      const data = cb.data;

      console.log(`Received callback query from User ID: ${userId}, option: ${data}`);

      // Acknowledge callback click to clear loading
      await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        callback_query_id: cb.id
      });

      if (data === 'guide_proxy') {
        await sendTelegramMessage(userId, `🌐 *Proxy Setup Guide*\n\n1. For laptops/desktops, enter the SOCKS5 proxy IP, Port, Username, and Password in SwitchyOmega (browser) or Proxifier.\n2. For WireGuard, download the WireGuard client, click 'Add Tunnel', and paste the configuration profile.\n3. Make sure to choose the correct target country and resident carrier.`);
      } else if (data === 'guide_sms') {
        await sendTelegramMessage(userId, `📱 *SMS Verification Help*\n\n1. Select higher signal operators (>80% success rate) for reliability.\n2. Leases last 10-15 minutes. If the OTP code does not arrive within 3 minutes, click 'Cancel Number' (free) and choose a different operator.\n3. Cancelled numbers are automatically refunded to your wallet.`);
      } else if (data === 'guide_billing') {
        await sendTelegramMessage(userId, `💳 *Deposit & Billing Info*\n\n1. Click 'Top Up Wallet' to fund Naira via bank transfer, card, or USSD securely.\n2. Minimum deposit is ₦500.\n3. Credits are automatic and instant.`);
      } else if (data === 'speak_human') {
        await sendTelegramMessage(userId, `💬 Please type your question or describe your issue here. Our support team will reply directly in this chat!`);
      }
      return;
    }

    // 3. Handle replies/commands in the admin group back to the user
    if (update.message && update.message.reply_to_message && update.message.chat.id === adminGroupChatId) {
      const adminMsgId = update.message.reply_to_message.message_id;
      const text = update.message.text ? update.message.text.trim() : '';
      const mapping = await TelegramTicketMapping.findOne({ admin_message_id: adminMsgId });

      if (mapping) {
        const userChatId = mapping.user_telegram_id;

        // Check if the reply is a ticket closure command
        if (text === '/close' || text === '/resolve') {
          console.log(`Admin requested closure for ticket associated with User ID: ${userChatId}`);
          try {
            // 1. Send closure message to customer
            const endUserMessage = "✅ *Ticket Resolved*\n\nYour support session has been closed by an agent. If you need assistance again, simply type a new message or send `/start`. Thank you for using ProxyVault!";
            await sendTelegramMessage(userChatId, endUserMessage);

            // 2. Notify Admin Group
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
              chat_id: adminGroupChatId,
              text: `🔒 *Ticket for User ID ${userChatId} has been marked closed.*`,
              reply_to_message_id: update.message.message_id
            });

            // 3. Seal the ticket by removing all database mappings and the active session state
            await TelegramTicketMapping.deleteMany({ user_telegram_id: userChatId });
            await TelegramSupportSession.deleteOne({ user_telegram_id: userChatId });
          } catch (closeErr) {
            console.error('Error executing ticket closure:', closeErr.message);
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
              chat_id: adminGroupChatId,
              text: `❌ Error closing session. The user might have blocked the bot.`,
              reply_to_message_id: update.message.message_id
            });
          }
          return;
        }

        // Standard message relay back to customer
        console.log(`Admin replied in group. Relaying message to customer User ID: ${userChatId}`);
        
        // Copy the admin's reply straight to the customer's private chat
        await axios.post(`https://api.telegram.org/bot${token}/copyMessage`, {
          chat_id: userChatId,
          from_chat_id: update.message.chat.id,
          message_id: update.message.message_id
        });

        // Update the active session details (last activity and reply message ID)
        await TelegramSupportSession.updateOne(
          { user_telegram_id: userChatId },
          { last_admin_message_id: update.message.message_id, last_activity: new Date() }
        );

        // Map the admin's reply message ID to the user ID to maintain conversation chain
        try {
          await TelegramTicketMapping.create({
            admin_message_id: update.message.message_id,
            user_telegram_id: userChatId
          });
        } catch (e) {
          // ignore duplicate key errors
        }

        // Send confirmation back to group
        const replyConfirm = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: update.message.chat.id,
          text: `✅ Reply sent to user.`,
          reply_to_message_id: update.message.message_id
        });

        // Map the confirmation message ID to the user ID as well
        if (replyConfirm.data && replyConfirm.data.result) {
          try {
            await TelegramTicketMapping.create({
              admin_message_id: replyConfirm.data.result.message_id,
              user_telegram_id: userChatId
            });
          } catch (e) {
            // ignore duplicate key errors
          }
        }
      }
      return;
    }
  } catch (err) {
    console.error('Telegram support bot handling error:', err.response ? err.response.data : err.message);
  }
}

// Support ticketing webhook endpoint
app.post('/api/v1/telegram-webhook', async (req, res) => {
  try {
    await handleTelegramUpdate(req.body);
  } catch (err) {
    console.error('Webhook endpoint execution error:', err.message);
  }
  res.sendStatus(200);
});

// Local long-polling fallback loop (used when running locally instead of webhooks)
let pollingOffset = 0;
let isPollingActive = false;

async function startTelegramPolling(token) {
  if (isPollingActive) return;
  isPollingActive = true;

  try {
    // Force delete webhook on startup so Telegram allows polling updates
    await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`);
    console.log('Telegram webhook cleared successfully. Commencing local long-polling updates loop...');
  } catch (err) {
    console.warn('Failed to delete Telegram webhook on boot:', err.message);
  }

  // Polling loop
  (async () => {
    while (isPollingActive) {
      try {
        const response = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
          params: {
            offset: pollingOffset,
            timeout: 30
          },
          timeout: 35000 // slightly longer than polling timeout
        });

        const updates = response.data.result || [];
        for (const update of updates) {
          pollingOffset = update.update_id + 1;
          await handleTelegramUpdate(update);
        }
      } catch (err) {
        if (err.code !== 'ECONNABORTED' && err.message !== 'timeout of 35000ms exceeded') {
          console.error('Telegram polling loop error:', err.message);
          // Wait 5 seconds before retrying to prevent connection loop-spamming
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
  })();
}

// Manual trigger endpoints (for Vercel Cron utility triggers)
app.get('/api/v1/cron/balance-check', async (req, res) => {
  try {
    await balanceNotifier.checkLowBalanceAlert();
    res.json({ success: true, message: 'Low balance check completed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/cron/balance-report', async (req, res) => {
  try {
    await balanceNotifier.sendPeriodicBalanceUpdate();
    res.json({ success: true, message: 'Balance status report sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Check and automatically close support sessions that have been inactive for more than 30 minutes
async function checkSessionTimeouts() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const adminGroupChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
    ? Number(process.env.TELEGRAM_ADMIN_CHAT_ID.replace(/^--/, '-'))
    : null;

  try {
    const timeoutLimit = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
    const inactiveSessions = await TelegramSupportSession.find({ last_activity: { $lt: timeoutLimit } });

    for (const session of inactiveSessions) {
      const userChatId = session.user_telegram_id;
      console.log(`Auto-closing inactive support session for User ID: ${userChatId}`);

      try {
        // 1. Notify the customer
        const timeoutMsg = "⚠️ *Support Session Timeout*\n\nYour support session has timed out due to 30 minutes of inactivity. If you still need help, simply send a new message to start a new ticket. Thank you!";
        await sendTelegramMessage(userChatId, timeoutMsg);

        // 2. Notify the Admin Group
        if (adminGroupChatId) {
          await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: adminGroupChatId,
            text: `🔒 *Ticket for User ID ${userChatId} closed automatically due to 30 minutes of inactivity.*`
          });
        }
      } catch (err) {
        console.error(`Timeout alert error for user ${userChatId}:`, err.message);
      }

      // 3. Clear mapping and session database records
      await TelegramTicketMapping.deleteMany({ user_telegram_id: userChatId });
      await TelegramSupportSession.deleteOne({ _id: session._id });
    }
  } catch (err) {
    console.error('Session timeout execution failure:', err.message);
  }
}


// ----------------------------------------------------
if (require.main === module) {
  dbReady.then(() => {
    app.listen(PORT, () => {
      console.log(`ProxyVault backend running on http://localhost:${PORT}`);
      console.log(`Simulation Mode: ${process.env.SIMULATION_MODE}`);
      
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

      // Check for inactive support sessions every 5 minutes
      const cron = require('node-cron');
      cron.schedule('*/5 * * * *', checkSessionTimeouts);

      if (token && !token.startsWith('tg_mock_')) {
        if (isProduction) {
          // Webhook setup for production serverless hosting (Vercel)
          const clientUrl = process.env.CLIENT_URL || `https://proxyvaultng.vercel.app`;
          axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
            url: `${clientUrl}/api/v1/telegram-webhook`
          }).then(whRes => {
            console.log('Telegram Support Webhook registered in production:', whRes.data);
          }).catch(err => {
            console.error('Failed to set Telegram Support Webhook:', err.message);
          });
        } else {
          // Fallback to local long polling for local testing without ngrok
          startTelegramPolling(token);
        }
      }

      // Prime proxy catalog cache in the background 3 seconds after startup
      setTimeout(async () => {
        const apiKey = process.env.CYBERYOZH_API_KEY;
        const isSimulation = process.env.SIMULATION_MODE === 'true';
        if (!isSimulation && apiKey && !apiKey.startsWith('cy_mock_')) {
          try {
            proxyCatalogCache = await fetchCompleteProxyCatalog(apiKey);
            proxyCatalogCacheTime = Date.now();
          } catch (e) {
            console.error('Initial catalog cache priming failed:', e.message);
          }
        }
      }, 3000);
    });
  });
}

module.exports = app;
