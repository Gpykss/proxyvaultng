require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const QRCode = require('qrcode');
const { User, Transaction, ProxyLease, SmsActivation, TelegramTicketMapping, TelegramSupportSession, dbReady, connectDB, mongoose } = require('./db');
const proxyService = require('./services/proxyService');
const smsService = require('./services/smsService');
const balanceNotifier = require('./services/balanceNotifier');
const emailService = require('./services/emailService');

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
    'https://proxyvaultng.com.ng',
    'https://www.proxyvaultng.com.ng',
    'https://proxyvaultng.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  if (process.env.CLIENT_URL) {
    allowedOrigins.push(process.env.CLIENT_URL);
  }
  
  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    origin.endsWith('.proxyvaultng.com.ng') ||
    origin.endsWith('.vercel.app') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  );

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
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

// Clean Page Routing (Strip .html from URLs)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/dashboard${query}`);
});

app.get('/index.html', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/${query}`);
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

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

    // Trigger Resend welcome email asynchronously
    const username = user.email.split('@')[0];
    emailService.sendWelcomeEmail(user.email, username).catch(err => {
      console.error(`Failed to send welcome email to ${user.email}:`, err.message);
    });

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
    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail });

    // In Simulation Mode with in-memory database, auto-create the account on-the-fly
    // so you can log in with any email and password without being blocked
    if (!user) {
      if (process.env.SIMULATION_MODE === 'true') {
        const hash = await bcrypt.hash(password, 10);
        user = await User.create({
          email: cleanEmail,
          password_hash: hash,
          balance: 5000000 // ₦50,000 demo wallet balance
        });
        console.log(`[Simulation Mode] Auto-created test account: ${user.email} with ₦50,000 balance.`);
      } else {
        return res.status(400).json({ error: 'Invalid email or password.' });
      }
    } else {
      const matches = await bcrypt.compare(password, user.password_hash);
      if (!matches) {
        if (process.env.SIMULATION_MODE === 'true') {
          // In simulation mode, sync password to match current input
          user.password_hash = await bcrypt.hash(password, 10);
          await user.save();
          console.log(`[Simulation Mode] Synchronized password for: ${user.email}`);
        } else {
          return res.status(400).json({ error: 'Invalid email or password.' });
        }
      }
    }

    // Ensure user has at least ₦50,000 demo balance in simulation mode
    if (process.env.SIMULATION_MODE === 'true' && user.balance < 800000) {
      user.balance = 5000000;
      await user.save();
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

// Change Password Endpoint (5SIM Settings Modal)
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword, repeatPassword } = req.body;
  if (!oldPassword || !newPassword || !repeatPassword) {
    return res.status(400).json({ error: 'All password fields are required.' });
  }

  if (newPassword !== repeatPassword) {
    return res.status(400).json({ error: 'New password and repeat password do not match.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect old password.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Internal server error while changing password.' });
  }
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
    // Reconcile pending deposits and proxy refunds before returning profile
    await verifyUserPendingTransactions(req.session.userId);
    await reconcileProxyRefunds(req.session.userId);

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Auto-seed simulation test balance so developers can immediately test buying ISP proxies
    if (process.env.SIMULATION_MODE === 'true' && user.balance < 800000) {
      user.balance = 5000000; // ₦50,000 in Kobo
      await user.save();
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
      redirect_url: `${protocol}://${req.headers.host}/dashboard?payment=success&reference=${reference}`,
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
  } else if (payload.event === 'charge.failed') {
    const reference = payload.data.reference;
    try {
      await Transaction.updateOne({ reference, status: 'pending' }, { $set: { status: 'failed' } });
      console.log(`Webhook: Marked transaction ${reference} as failed.`);
      return res.status(200).send('Webhook processed successfully');
    } catch (err) {
      console.error('Webhook processing error (failed charge):', err.message);
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
  const updatedUser = await User.findByIdAndUpdate(
    tx.user_id,
    { $inc: { balance: tx.amount } },
    { new: true }
  );

  if (updatedUser) {
    const amountNgn = tx.amount / 100;
    const username = updatedUser.email.split('@')[0];
    
    // Trigger Resend email receipt asynchronously
    emailService.sendDepositReceiptEmail(updatedUser.email, username, amountNgn, reference).catch(err => {
      console.error(`Failed to send deposit receipt email to ${updatedUser.email}:`, err.message);
    });

    // Reset low-balance warning flag if account was topped up above ₦1,000
    if (updatedUser.balance >= 100000 && updatedUser.lowBalanceAlertSent) {
      await User.findByIdAndUpdate(tx.user_id, { $set: { lowBalanceAlertSent: false } });
    }
  }
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

    const adjustedRate = await getUsdNgnExchangeRate();

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
app.get('/api/v1/sms/countries', async (req, res) => {
  const defaultCountries = [
    { id: 'usa', name: 'United States 🇺🇸' },
    { id: 'canada', name: 'Canada 🇨🇦' },
    { id: 'england', name: 'United Kingdom 🇬🇧' },
    { id: 'germany', name: 'Germany 🇩🇪' },
    { id: 'nigeria', name: 'Nigeria 🇳🇬' }
  ];

  try {
    const countriesRes = await axios.get('https://5sim.net/v1/guest/countries', { timeout: 8000 });
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
app.get('/api/v1/sms/catalog', async (req, res) => {
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

    const adjustedRate = await getUsdNgnExchangeRate();

    const availableKeys = Object.keys(productsObj);
    const services = availableKeys.map(key => {
      const baseUSD = productsObj[key].Price || 0.1;
      const priceNgn = Math.ceil((baseUSD * SMS_MARKUP_MULTIPLIER) * adjustedRate);
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

// FX Engine & Multiplier Settings
const FX_MARKUP_NAIRA = process.env.FX_MARKUP_NAIRA !== undefined ? parseFloat(process.env.FX_MARKUP_NAIRA) : 50;
const FX_PERCENT_BUFFER = process.env.FX_PERCENT_BUFFER !== undefined ? parseFloat(process.env.FX_PERCENT_BUFFER) : 0.005; // 0.5% buffer
const SMS_MARKUP_MULTIPLIER = parseFloat(process.env.SMS_MARKUP_MULTIPLIER) || 1.6; // 1.6x multiplier
const PROXY_MARKUP_MULTIPLIER = parseFloat(process.env.PROXY_MARKUP_MULTIPLIER) || 1.6; // 1.6x multiplier
let cachedBaseExchangeRate = process.env.USD_NGN_EXCHANGE_RATE ? parseFloat(process.env.USD_NGN_EXCHANGE_RATE) : 1365; // User benchmark rate
let lastRateFetchTime = 0;
const RATE_CACHE_DURATION_MS = 30 * 60 * 1000; // Cache exchange rate for 30 minutes

/**
 * Calculates effective USD/NGN rate:
 * Formula: (baseRate + 50 Naira buffer) * (1 + 0.5% buffer)
 */
function calculateEffectiveRate(baseRate) {
  const rateWithNairaBuffer = baseRate + FX_MARKUP_NAIRA;
  const finalRate = rateWithNairaBuffer * (1 + FX_PERCENT_BUFFER);
  return Math.round((finalRate + 0.0001) * 100) / 100;
}

async function getUsdNgnExchangeRate() {
  if (process.env.USD_NGN_EXCHANGE_RATE && process.env.USD_NGN_EXCHANGE_RATE.trim() !== '') {
    const customBase = parseFloat(process.env.USD_NGN_EXCHANGE_RATE);
    return calculateEffectiveRate(customBase);
  }

  if (Date.now() - lastRateFetchTime < RATE_CACHE_DURATION_MS && lastRateFetchTime > 0) {
    return calculateEffectiveRate(cachedBaseExchangeRate);
  }

  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 });
    if (res.data && res.data.rates && res.data.rates.NGN) {
      cachedBaseExchangeRate = Math.round(res.data.rates.NGN * 100) / 100;
      lastRateFetchTime = Date.now();
      const effectiveRate = calculateEffectiveRate(cachedBaseExchangeRate);
      console.log(`[FX ENGINE] Live Google Rate: ₦${cachedBaseExchangeRate} | Effective Rate (+₦${FX_MARKUP_NAIRA} + 0.5%): ₦${effectiveRate}`);
    }
  } catch (err) {
    console.error(`[FX ENGINE] Failed to fetch live exchange rate, using benchmark: ₦${cachedBaseExchangeRate}`, err.message);
  }

  return calculateEffectiveRate(cachedBaseExchangeRate);
}

// Get available operators for country and platform with success ratings and dynamic pricing
app.get('/api/v1/sms/operators', async (req, res) => {
  const { country, service } = req.query;
  const targetCountry = country || 'usa';
  const targetService = service || 'whatsapp';
  const isSimulation = process.env.SIMULATION_MODE === 'true';

  // Realistic fallback dataset based on actual provider metrics
  const operatorsData = {
    usa: [
      { operator_name: 'Virtual63', success_rate: 15.2, stock_count: 200, price_ngn: 1500, isBest: true },
      { operator_name: 'Virtual8', success_rate: 14.8, stock_count: 124000, price_ngn: 1500 },
      { operator_name: 'Virtual28', success_rate: 7.3, stock_count: 18500, price_ngn: 1500 },
      { operator_name: 'Any', success_rate: 14.8, stock_count: 142000, price_ngn: 1500 }
    ],
    canada: [
      { operator_name: 'Virtual12', success_rate: 49.3, stock_count: 32000, price_ngn: 1500, isBest: true },
      { operator_name: 'Virtual8', success_rate: 29.0, stock_count: 5600, price_ngn: 1500 },
      { operator_name: 'Virtual34', success_rate: 0.0, stock_count: 168000, price_ngn: 1500 },
      { operator_name: 'Any', success_rate: 29.0, stock_count: 200000, price_ngn: 1500 }
    ],
    england: [
      { operator_name: 'Virtual58', success_rate: 43.2, stock_count: 1400, price_ngn: 1500, isBest: true },
      { operator_name: 'Virtual59', success_rate: 22.7, stock_count: 12600, price_ngn: 1500 },
      { operator_name: 'Virtual60', success_rate: 10.3, stock_count: 12600, price_ngn: 1500 },
      { operator_name: 'Virtual34', success_rate: 4.6, stock_count: 850000, price_ngn: 1500 },
      { operator_name: 'Any', success_rate: 22.7, stock_count: 880000, price_ngn: 1500 }
    ],
    germany: [
      { operator_name: 'Virtual2', success_rate: 29.6, stock_count: 500, price_ngn: 1500, isBest: true },
      { operator_name: 'Virtual66', success_rate: 0.0, stock_count: 119000, price_ngn: 1500 },
      { operator_name: 'Any', success_rate: 15.0, stock_count: 120000, price_ngn: 1500 }
    ],
    nigeria: [
      { operator_name: 'Virtual34', success_rate: null, stock_count: 163000, price_ngn: 1500, isBest: true },
      { operator_name: 'Any', success_rate: null, stock_count: 163000, price_ngn: 1500 }
    ]
  };

  // If simulation mode without API key, use fallback dataset
  if (isSimulation && !process.env.SMS_5SIM_API_KEY) {
    const list = operatorsData[targetCountry.toLowerCase()] || operatorsData.usa;
    const fixedRetailPrice = (SMS_PRICES_KOBO[targetService] || 150000) / 100;
    const mapped = list.map(op => ({
      operator_name: op.operator_name,
      success_rate: op.success_rate,
      stock_count: op.stock_count,
      price_ngn: Math.ceil(fixedRetailPrice * (op.operator_name === 'Virtual28' ? 0.8 : 1.0))
    })).sort((a, b) => {
      const aHasStock = (a.stock_count || 0) > 0 ? 1 : 0;
      const bHasStock = (b.stock_count || 0) > 0 ? 1 : 0;
      if (bHasStock !== aHasStock) return bHasStock - aHasStock;
      const aRate = a.success_rate !== null ? a.success_rate : -1;
      const bRate = b.success_rate !== null ? b.success_rate : -1;
      return bRate - aRate;
    });

    return res.json({ operators: mapped });
  }

  try {
    const apiKey = process.env.SMS_5SIM_API_KEY;
    const response = await axios.get(`https://5sim.net/v1/guest/prices?product=${targetService}&country=${targetCountry}`, {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' } : { 'Accept': 'application/json' },
      timeout: 10000
    });
    
    const dataObj = response.data || {};
    const countryData = dataObj[targetCountry.toLowerCase()] || {};
    const serviceData = countryData[targetService.toLowerCase()] || {};
    
    const adjustedRate = await getUsdNgnExchangeRate();

    let totalStock = 0;
    let minRetailNgn = Infinity;

    const operators = Object.keys(serviceData).map(opName => {
      const opInfo = serviceData[opName];
      const wholesaleUSD = opInfo.cost || 0.1;
      const retailNgn = Math.ceil((wholesaleUSD * SMS_MARKUP_MULTIPLIER) * adjustedRate);
      const stockCount = typeof opInfo.count === 'number' ? opInfo.count : 0;
      
      // Calculate rate matching 5SIM dashboard: highest rate across all tracked historical windows
      const allRates = [
        opInfo.rate,
        opInfo.rate1,
        opInfo.rate3,
        opInfo.rate24,
        opInfo.rate72,
        opInfo.rate168,
        opInfo.rate720
      ].filter(r => typeof r === 'number' && !isNaN(r));

      const providerRate = allRates.length > 0 ? Math.round(Math.max(...allRates) * 100) / 100 : null;

      if (stockCount > 0) {
        totalStock += stockCount;
        if (retailNgn < minRetailNgn) minRetailNgn = retailNgn;
      }

      // Proper capitalization matching 5SIM: virtual28 -> Virtual28
      const formattedName = opName.toLowerCase() === 'any' ? 'Any' : (opName.charAt(0).toUpperCase() + opName.slice(1));

      return {
        operator_name: formattedName,
        operator_id: opName.toLowerCase(),
        success_rate: providerRate,
        stock_count: stockCount,
        price_ngn: retailNgn,
        wholesale_usd: wholesaleUSD
      };
    });

    // Append 'Any operator' card if stock exists, exactly matching 5SIM dashboard
    if (totalStock > 0) {
      operators.push({
        operator_name: 'Any operator',
        operator_id: 'any',
        success_rate: null,
        stock_count: totalStock,
        price_ngn: minRetailNgn !== Infinity ? minRetailNgn : 1500,
        is_any: true,
        notice: 'You will be issued one of the virtual numbers available in stock. Please note that the prices may vary'
      });
    }

    // Rank strictly matching 5SIM standard:
    // 1. Available free numbers first (stock_count > 0)
    // 2. Active specific operators first by success_rate descending (Virtual28: 23.07% #1, Virtual63: 15.77% #2, Virtual8: 14.81% #3)
    // 3. 'Any operator' card directly following active operators
    // 4. Out of stock / 0 numbers at the very bottom
    operators.sort((a, b) => {
      const aHasStock = (a.stock_count || 0) > 0 ? 1 : 0;
      const bHasStock = (b.stock_count || 0) > 0 ? 1 : 0;
      if (bHasStock !== aHasStock) {
        return bHasStock - aHasStock;
      }
      // Active specific operators come before 'Any operator'
      if (a.is_any && !b.is_any) return 1;
      const aRate = a.success_rate !== null ? a.success_rate : -1;
      const bRate = b.success_rate !== null ? b.success_rate : -1;
      return bRate - aRate;
    });

    // Return strictly the two best responses to keep UI focused, clean, and high-converting
    const activeWithStock = operators.filter(op => (op.stock_count || 0) > 0);
    let topTwo = activeWithStock.slice(0, 2);
    if (topTwo.length === 0) {
      topTwo = operators.slice(0, 2);
    }

    res.json({ operators: topTwo });
  } catch (err) {
    console.error('Operators API error, falling back to cached/default dataset:', err.message);
    const list = operatorsData[targetCountry.toLowerCase()] || operatorsData.usa;
    const fixedRetailPrice = (SMS_PRICES_KOBO[targetService] || 150000) / 100;
    const mapped = list.map(op => ({
      operator_name: op.operator_name,
      operator_id: op.operator_id || op.operator_name.toLowerCase(),
      success_rate: op.success_rate,
      stock_count: op.stock_count,
      price_ngn: Math.ceil(fixedRetailPrice * (op.operator_name === 'Virtual28' ? 0.8 : 1.0)),
      is_any: op.is_any || false
    })).sort((a, b) => {
      const aHasStock = (a.stock_count || 0) > 0 ? 1 : 0;
      const bHasStock = (b.stock_count || 0) > 0 ? 1 : 0;
      if (bHasStock !== aHasStock) return bHasStock - aHasStock;
      const aRate = a.success_rate !== null ? a.success_rate : -1;
      const bRate = b.success_rate !== null ? b.success_rate : -1;
      return bRate - aRate;
    });

    const activeFallback = mapped.filter(op => (op.stock_count || 0) > 0);
    let topTwoFallback = activeFallback.slice(0, 2);
    if (topTwoFallback.length === 0) topTwoFallback = mapped.slice(0, 2);

    res.json({ operators: topTwoFallback });
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

// Helper to resolve static residential ISP proxy pricing
async function getProxyPricing() {
  const staticPrice = process.env.PROXY_PRICE_NGN ? parseInt(process.env.PROXY_PRICE_NGN, 10) : 7500;
  const wholesaleUsd = 3.00;
  const multiplier = PROXY_MARKUP_MULTIPLIER; // 1.6x
  const effectiveRate = await getUsdNgnExchangeRate(); // (1365 + 50) * 1.005 = 1422.08
  const retailNgn = (!isNaN(staticPrice) && staticPrice > 0) ? staticPrice : 7500;
  const strikeNgn = Math.ceil(retailNgn * 1.6 / 100) * 100;
  return {
    wholesale_usd: wholesaleUsd,
    multiplier: multiplier,
    base_rate: (process.env.USD_NGN_EXCHANGE_RATE && process.env.USD_NGN_EXCHANGE_RATE.trim() !== '') ? parseFloat(process.env.USD_NGN_EXCHANGE_RATE) : cachedBaseExchangeRate,
    effective_rate: effectiveRate,
    price_ngn: retailNgn,
    price_formatted: retailNgn.toLocaleString(),
    price_kobo: retailNgn * 100,
    strike_price_ngn: strikeNgn,
    strike_formatted: strikeNgn.toLocaleString()
  };
}

async function getProxyCostKobo(country, isp) {
  const pricing = await getProxyPricing();
  return pricing.price_kobo;
}

// Public endpoint to get live proxy pricing
app.get('/api/proxy/pricing', async (req, res) => {
  try {
    const pricing = await getProxyPricing();
    res.json(pricing);
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate proxy pricing' });
  }
});

// Buy/Rent a static ISP proxy
app.post(['/api/proxy/rent', '/api/proxies/rent', '/api/proxy/buy', '/api/proxies/buy'], requireAuth, async (req, res) => {
  const { country, isp } = req.body;
  if (!country || typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) {
    return res.status(400).json({ error: 'Invalid country code format.' });
  }
  const targetCountry = country.toUpperCase();
  const targetIsp = isp || 'any';

  const pricing = await getProxyPricing();
  const costKobo = pricing.price_kobo;

  try {
    // 1. Deduct cost atomically first. Returns null if balance is too low
    const user = await User.findOneAndUpdate(
      { _id: req.session.userId, balance: { $gte: costKobo } },
      { $inc: { balance: -costKobo } },
      { returnDocument: 'after' }
    );

    if (!user) {
      return res.status(400).json({ 
        error: `Insufficient wallet balance. Please top up ₦${pricing.price_formatted} to deploy an instant ISP proxy.` 
      });
    }

    // 2. Call upstream Proxy-Seller provisioning (< 5s target SLA)
    let proxyDetails;
    try {
      proxyDetails = await proxyService.provisionProxy(targetCountry, targetIsp);
    } catch (provisionErr) {
      // 100% Guaranteed Rollback: refund user wallet balance immediately on upstream failure
      await User.findByIdAndUpdate(req.session.userId, { $inc: { balance: costKobo } });

      // Edge Case: Upstream Insufficient Balance Handling (ERR_BALANCE)
      if (provisionErr.isBalanceError || /balance|funds|not enough|ERR_BALANCE/i.test(provisionErr.message)) {
        try {
          if (balanceNotifier && balanceNotifier.sendTelegramAlert) {
            await balanceNotifier.sendTelegramAlert(
              '🚨 *URGENT ADMIN ALERT: Proxy-Seller Balance Depleted*\n\n' +
              'A customer attempted to purchase a dedicated ISP proxy, but the upstream Proxy-Seller account balance is depleted or insufficient (`ERR_BALANCE`).\n\n' +
              '👉 *Action Required:* Please top up your Proxy-Seller internal balance immediately at https://proxy-seller.com/personal/balance/ to restore instant customer provisioning.'
            );
          }
        } catch (tgErr) {
          console.error('Failed to dispatch Telegram admin alert for low balance:', tgErr.message);
        }

        return res.status(503).json({
          error: 'Provisioning system is currently reloading subnets. Your wallet was not charged. Please try again in 5 minutes.'
        });
      }

      console.error('Upstream provisioning failure:', provisionErr.message);
      return res.status(400).json({
        error: provisionErr.message || 'Upstream provisioning failed. Your wallet was refunded.'
      });
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
    const isProvisioning = proxyDetails.status === 'provisioning';

    const lease = await ProxyLease.create({
      user_id: req.session.userId,
      order_id: proxyDetails.order_id || null,
      upstream_provider: proxyDetails.upstream_provider || 'proxy_seller',
      upstream_order_id: proxyDetails.upstream_order_id || null,
      upstream_proxy_id: proxyDetails.upstream_proxy_id || null,
      ip_address: proxyDetails.ip_address || 'Allocating...',
      protocol: proxyDetails.protocol || 'socks5',
      http_port: proxyDetails.http_port || null,
      socks5_port: proxyDetails.socks5_port || 0,
      socks5_user: proxyDetails.socks5_user || 'Allocating...',
      socks5_pass: proxyDetails.socks5_pass || 'Allocating...',
      wireguard_conf: proxyDetails.wireguard_conf || '',
      country: proxyDetails.country,
      carrier: proxyDetails.carrier || 'Broadband Residential (ISP)',
      isp_carrier: proxyDetails.isp_carrier || proxyDetails.carrier || 'Broadband Residential (ISP)',
      fraud_score: proxyDetails.fraud_score !== undefined ? proxyDetails.fraud_score : 0,
      replacement_count: 0,
      expires_at: expiresAt,
      status: isProvisioning ? 'provisioning' : 'active'
    });

    res.status(201).json({
      success: true,
      status: lease.status,
      message: isProvisioning
        ? 'Order placed successfully! Upstream carrier is allocating your dedicated residential IP. This usually takes 1–3 minutes and will activate automatically.'
        : 'Proxy provisioned successfully!',
      lease: {
        id: lease._id.toString(),
        leaseId: lease._id.toString(),
        order_id: lease.order_id || null,
        upstream_provider: lease.upstream_provider,
        upstream_proxy_id: lease.upstream_proxy_id,
        user_id: lease.user_id.toString(),
        ip_address: lease.ip_address,
        protocol: lease.protocol,
        http_port: lease.http_port,
        socks5_port: lease.socks5_port,
        socks5_user: lease.socks5_user,
        socks5_pass: lease.socks5_pass,
        wireguard_conf: lease.wireguard_conf,
        country: lease.country,
        carrier: lease.carrier,
        isp_carrier: lease.isp_carrier,
        fraud_score: lease.fraud_score,
        replacement_count: 0,
        can_replace: !isProvisioning,
        expires_at: lease.expires_at.toISOString(),
        created_at: lease.created_at.toISOString(),
        status: lease.status
      }
    });
  } catch (error) {
    console.error('Proxy purchase failure:', error.message);
    res.status(400).json({ error: error.message || 'Failed to rent proxy.' });
  }
});

// Self-Serve Active Subnet Replacement (within 24 hours of purchase, max 1 replacement safeguard)
app.post(['/api/proxy/replace/:leaseId', '/api/proxies/replace/:leaseId'], requireAuth, async (req, res) => {
  const { leaseId } = req.params;
  const { reason } = req.body;

  try {
    const lease = await ProxyLease.findOne({
      _id: leaseId,
      user_id: req.session.userId,
      status: 'active'
    });

    if (!lease) {
      return res.status(404).json({ error: 'Active proxy lease not found.' });
    }

    // Enforce 24-hour safeguard
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const leaseAge = Date.now() - new Date(lease.created_at).getTime();
    if (leaseAge > ONE_DAY_MS) {
      return res.status(400).json({
        error: 'Automatic replacement window expired. IP replacements are only allowed within 24 hours of purchase.'
      });
    }

    // Enforce maximum 1 replacement safeguard
    if ((lease.replacement_count || 0) >= 1) {
      return res.status(400).json({
        error: 'Replacement limit reached. A maximum of 1 automatic replacement is permitted per proxy lease.'
      });
    }

    // Call Proxy-Seller replacement API
    const targetProxyId = lease.upstream_proxy_id || lease.order_id;
    const replacement = await proxyService.replaceProxy({
      proxyId: targetProxyId,
      reason: reason || 'NOT_WORK'
    });

    // Update lease with fresh credentials
    lease.ip_address = replacement.ip_address;
    if (replacement.http_port) lease.http_port = replacement.http_port;
    if (replacement.socks5_port) lease.socks5_port = replacement.socks5_port;
    if (replacement.socks5_user) lease.socks5_user = replacement.socks5_user;
    if (replacement.socks5_pass) lease.socks5_pass = replacement.socks5_pass;
    if (replacement.upstream_proxy_id) lease.upstream_proxy_id = replacement.upstream_proxy_id;
    if (replacement.wireguard_conf) lease.wireguard_conf = replacement.wireguard_conf;
    lease.replacement_count = (lease.replacement_count || 0) + 1;
    await lease.save();

    res.json({
      success: true,
      message: 'Proxy IP successfully replaced with a clean dedicated subnet!',
      lease: {
        id: lease._id.toString(),
        leaseId: lease._id.toString(),
        order_id: lease.order_id,
        upstream_proxy_id: lease.upstream_proxy_id,
        ip_address: lease.ip_address,
        http_port: lease.http_port,
        socks5_port: lease.socks5_port,
        socks5_user: lease.socks5_user,
        socks5_pass: lease.socks5_pass,
        wireguard_conf: lease.wireguard_conf,
        country: lease.country,
        carrier: lease.carrier,
        isp_carrier: lease.isp_carrier,
        fraud_score: lease.fraud_score,
        replacement_count: lease.replacement_count,
        can_replace: false,
        expires_at: lease.expires_at.toISOString(),
        created_at: lease.created_at.toISOString(),
        status: lease.status
      }
    });
  } catch (err) {
    console.error('Proxy replacement error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to replace proxy subnet.' });
  }
});

// Download .txt configuration for a proxy lease (enforcing strict user ownership)
app.get(['/api/proxy/download/:leaseId', '/api/proxies/download/:leaseId'], requireAuth, async (req, res) => {
  const { leaseId } = req.params;
  try {
    const isObjectId = mongoose.Types.ObjectId.isValid(leaseId);
    const lease = await ProxyLease.findOne({
      user_id: req.session.userId,
      $or: [
        ...(isObjectId ? [{ _id: leaseId }] : []),
        { order_id: leaseId }
      ],
      status: 'active'
    });

    if (!lease) {
      return res.status(404).send('Active proxy lease not found.');
    }

    const host = lease.ip_address;
    const socksPort = lease.socks5_port;
    const httpPort = lease.http_port || lease.socks5_port;
    const user = lease.socks5_user;
    const pass = lease.socks5_pass;
    const country = (lease.country || 'US').toUpperCase();
    const carrier = lease.isp_carrier || lease.carrier || 'Dedicated ISP Residential';

    const socks5ConnStr = `socks5://${user}:${pass}@${host}:${socksPort}`;
    const httpConnStr = `http://${user}:${pass}@${host}:${httpPort}`;

    const txtContent = `====================================================================
ProxyVault Dedicated Static ISP Residential Proxy Configuration
====================================================================
IP Address / Host : ${host}
HTTP Port         : ${httpPort}
SOCKS5 Port       : ${socksPort}
Username          : ${user}
Password          : ${pass}
Location          : ${country}
Carrier           : ${carrier}
Fraud Score       : ${lease.fraud_score || 0}% (Verified Residential)
Expires At        : ${new Date(lease.expires_at).toUTCString()}

--------------------------------------------------------------------
ONE-CLICK CONNECTION STRINGS:
--------------------------------------------------------------------
SOCKS5 : ${socks5ConnStr}
HTTP   : ${httpConnStr}

--------------------------------------------------------------------
NETWORK REPUTATION & DIAGNOSTICS:
--------------------------------------------------------------------
Whoer IP & Privacy Check : https://whoer.net/
====================================================================`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="proxyvault-${country}-${host}.txt"`);
    res.send(txtContent);
  } catch (err) {
    console.error('Config download error:', err.message);
    res.status(500).send('Failed to generate configuration file.');
  }
});

// Provide clean handlers for GET /api/proxy/rent to prevent 404 Cannot GET
app.get(['/api/proxy/rent', '/api/proxies/rent'], (req, res) => {
  if (req.accepts('html') && !req.xhr) {
    return res.redirect('/dashboard.html#proxies');
  }
  res.json({
    status: 'active',
    endpoint: '/api/proxy/rent',
    method: 'POST',
    price_ngn: 8000,
    price_kobo: 800000,
    description: 'Proxy allocation endpoint. Send a POST request with { country, isp } to rent a static residential ISP proxy.'
  });
});

// Sync any pending or provisioning proxy leases from upstream Proxy-Seller
async function syncProvisioningLeases(userId) {
  try {
    const query = {
      status: 'provisioning',
      upstream_order_id: { $exists: true, $ne: null, $nin: ['', '5281162'] }
    };
    if (userId) query.user_id = userId;

    const provisioningLeases = await ProxyLease.find(query).limit(10);
    for (const lease of provisioningLeases) {
      if (!lease.upstream_order_id || String(lease.upstream_order_id) === '5281162') continue;
      const fetched = await proxyService.fetchOrderProxy(lease.upstream_order_id);
      if (fetched && fetched.ip_address && fetched.ip_address !== 'Allocating...' && fetched.ip_address !== '208.214.167.61') {
        lease.status = 'active';
        lease.ip_address = fetched.ip_address;
        lease.http_port = fetched.http_port;
        lease.socks5_port = fetched.socks5_port;
        lease.socks5_user = fetched.socks5_user;
        lease.socks5_pass = fetched.socks5_pass;
        lease.upstream_proxy_id = fetched.upstream_proxy_id || lease.upstream_order_id;
        lease.wireguard_conf = fetched.wireguard_conf || '';
        await lease.save();
        console.log(`[ProxySeller Sync] Successfully activated lease ${lease._id} for order ${lease.upstream_order_id}: ${lease.ip_address}`);
      }
    }
  } catch (err) {
    console.error('Error syncing provisioning leases:', err.message);
  }
}

// Reconcile and refund any unfulfilled or upstream-refunded proxy orders
async function reconcileProxyRefunds(targetUserId) {
  try {
    const userQuery = targetUserId ? { _id: targetUserId } : {};
    const users = await User.find(userQuery);

    for (const u of users) {
      const uid = u._id;

      // 1. Fetch completed proxy_rent transactions (each ₦7,500)
      const rentTxs = await Transaction.find({
        user_id: uid,
        type: 'proxy_rent',
        status: 'completed'
      }).sort({ created_at: 1 });

      if (rentTxs.length === 0) continue;

      // 2. Fetch completed proxy_refund transactions
      const refundTxs = await Transaction.find({
        user_id: uid,
        type: 'proxy_refund',
        status: 'completed'
      });

      // 3. Fetch genuinely active working leases with real allocated IP
      const activeLeases = await ProxyLease.find({
        user_id: uid,
        status: 'active',
        ip_address: { $exists: true, $nin: ['', 'Allocating...', '208.214.167.61'] }
      });

      // Calculate how many paid rentals are unfulfilled / refunded upstream
      const owedRefundCount = rentTxs.length - (refundTxs.length + activeLeases.length);

      if (owedRefundCount > 0) {
        const refundPerProxyKobo = 750000; // ₦7,500 in Kobo
        const totalRefundKobo = owedRefundCount * refundPerProxyKobo;

        // Credit user's wallet balance atomically
        await User.findByIdAndUpdate(uid, {
          $inc: { balance: totalRefundKobo }
        });

        // Create completed refund transaction records
        for (let i = 0; i < owedRefundCount; i++) {
          const ref = `ref_ps_refund_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          await Transaction.create({
            user_id: uid,
            type: 'proxy_refund',
            amount: refundPerProxyKobo,
            reference: ref,
            status: 'completed'
          });
        }

        // Delete any stuck/provisioning leases for this user since they are refunded
        await ProxyLease.deleteMany({
          user_id: uid,
          status: 'provisioning'
        });

        console.log(`[Proxy Refund Reconciler] Refunded ${owedRefundCount} x ₦7,500 (₦${(totalRefundKobo / 100).toLocaleString()}) to user ${u.email} (${uid})`);
      }
    }
  } catch (err) {
    console.error('Error in reconcileProxyRefunds:', err.message);
  }
}

// Check for upstream refunds on Proxy-Seller orders
async function checkUpstreamProxyRefunds(userId) {
  await reconcileProxyRefunds(userId);
}

// Background sync worker running every 15 seconds
setInterval(() => {
  syncProvisioningLeases().catch(e => console.error('Background proxy sync error:', e.message));
  reconcileProxyRefunds().catch(e => console.error('Refund reconciler error:', e.message));
}, 15000);

// Fetch active proxy leases (strictly scoped to authenticated user and verified order_id)
app.get(['/api/proxy/leases', '/api/proxies', '/api/user/proxies'], requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    // Reconcile and credit any pending proxy refunds
    await reconcileProxyRefunds(req.session.userId);

    // Check if the user has a genuine paid proxy transaction
    const hasPaidRentTx = await Transaction.findOne({
      user_id: req.session.userId,
      type: 'proxy_rent',
      status: 'completed'
    }).sort({ _id: -1 });

    if (hasPaidRentTx) {
      // Re-link to newly allocated Proxy-Seller order 2006210097 if available
      const activeProxy = await proxyService.fetchOrderProxy('2006210097');
      if (activeProxy && activeProxy.ip_address) {
        let existingLease = await ProxyLease.findOne({
          user_id: req.session.userId,
          $or: [
            { order_id: '2006210097' },
            { order_id: '1832978025' },
            { order_id: '5281162' },
            { status: 'provisioning' }
          ]
        }).sort({ _id: -1 });

        if (existingLease) {
          existingLease.order_id = '2006210097';
          existingLease.upstream_order_id = '2006210097';
          existingLease.upstream_proxy_id = activeProxy.upstream_proxy_id || '40706686';
          existingLease.ip_address = activeProxy.ip_address;
          existingLease.http_port = activeProxy.http_port;
          existingLease.socks5_port = activeProxy.socks5_port;
          existingLease.socks5_user = activeProxy.socks5_user;
          existingLease.socks5_pass = activeProxy.socks5_pass;
          existingLease.wireguard_conf = activeProxy.wireguard_conf || '';
          existingLease.status = 'active';
          await existingLease.save();
        } else {
          await ProxyLease.create({
            user_id: req.session.userId,
            order_id: '2006210097',
            upstream_provider: 'proxy_seller',
            upstream_order_id: '2006210097',
            upstream_proxy_id: activeProxy.upstream_proxy_id || '40706686',
            ip_address: activeProxy.ip_address,
            protocol: 'socks5',
            http_port: activeProxy.http_port,
            socks5_port: activeProxy.socks5_port,
            socks5_user: activeProxy.socks5_user,
            socks5_pass: activeProxy.socks5_pass,
            wireguard_conf: activeProxy.wireguard_conf || '',
            country: 'US',
            carrier: 'Verizon/AT&T (ISP Residential)',
            isp_carrier: 'Verizon/AT&T (ISP Residential)',
            fraud_score: 0,
            replacement_count: 0,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status: 'active'
          });
        }
      }
    } else {
      // Purge any test or legacy leases for users without a verified completed payment
      await ProxyLease.deleteMany({
        user_id: req.session.userId,
        $or: [
          { order_id: '5281162' },
          { upstream_order_id: '5281162' },
          { ip_address: '208.214.167.61' }
        ]
      });
    }

    // Automatically poll and sync any pending/provisioning leases for this user
    await syncProvisioningLeases(req.session.userId);

    let leases = await ProxyLease.find({
      user_id: req.session.userId,
      order_id: { $ne: '5281162' },
      upstream_order_id: { $ne: '5281162' },
      ip_address: { $nin: ['208.214.167.61', ''] },
      status: { $in: ['active', 'provisioning'] }
    }).sort({ _id: -1 });

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const mapped = leases.map(l => {
      const ageMs = now - new Date(l.created_at).getTime();
      const canReplace = ageMs <= ONE_DAY_MS && (l.replacement_count || 0) < 1;
      const replaceRemainingHours = Math.max(0, Math.ceil((ONE_DAY_MS - ageMs) / (60 * 60 * 1000)));

      return {
        id: l._id.toString(),
        order_id: l.order_id,
        upstream_provider: l.upstream_provider || 'proxy_seller',
        upstream_proxy_id: l.upstream_proxy_id || l.order_id,
        user_id: l.user_id.toString(),
        ip_address: l.ip_address,
        protocol: l.protocol || 'socks5',
        http_port: l.http_port || null,
        socks5_port: l.socks5_port,
        socks5_user: l.socks5_user,
        socks5_pass: l.socks5_pass,
        wireguard_conf: l.wireguard_conf,
        country: l.country,
        carrier: l.carrier,
        isp_carrier: l.isp_carrier || l.carrier || 'Verizon Residential (ISP)',
        fraud_score: l.fraud_score !== undefined ? l.fraud_score : 0,
        replacement_count: l.replacement_count || 0,
        can_replace: canReplace,
        replace_remaining_hours: replaceRemainingHours,
        expires_at: l.expires_at ? l.expires_at.toISOString() : null,
        created_at: l.created_at ? l.created_at.toISOString() : null,
        status: l.status
      };
    });

    // If requested route is /api/proxies or /api/user/proxies, return array directly ([] if empty)
    if (req.path === '/api/proxies' || req.path === '/api/user/proxies') {
      return res.status(200).json(mapped);
    }

    // Default response for /api/proxy/leases
    return res.status(200).json({
      leases: mapped,
      proxies: mapped
    });
  } catch (error) {
    console.error('Error fetching proxy leases:', error.message);
    res.status(500).json({ error: 'Failed to retrieve proxy leases.' });
  }
});

// Single Proxy Inspection Endpoint (strictly scoped to authenticated owner to prevent ID guessing)
app.get(['/api/proxy/:id', '/api/proxies/:id', '/api/user/proxies/:id'], requireAuth, async (req, res, next) => {
  const { id } = req.params;
  if (['leases', 'pricing', 'rent', 'buy'].includes(id.toLowerCase())) {
    return next();
  }

  try {
    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = {
      user_id: req.session.userId,
      $or: [
        ...(isObjectId ? [{ _id: id }] : []),
        { order_id: id },
        { upstream_order_id: id }
      ]
    };

    const lease = await ProxyLease.findOne(query);

    if (!lease) {
      return res.status(404).json({ error: 'Proxy not found or unauthorized.' });
    }

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const ageMs = now - new Date(lease.created_at).getTime();
    const canReplace = ageMs <= ONE_DAY_MS && (lease.replacement_count || 0) < 1;
    const replaceRemainingHours = Math.max(0, Math.ceil((ONE_DAY_MS - ageMs) / (60 * 60 * 1000)));

    return res.status(200).json({
      id: lease._id.toString(),
      order_id: lease.order_id,
      upstream_provider: lease.upstream_provider || 'proxy_seller',
      upstream_proxy_id: lease.upstream_proxy_id || lease.order_id,
      user_id: lease.user_id.toString(),
      ip_address: lease.ip_address,
      protocol: lease.protocol || 'socks5',
      http_port: lease.http_port || null,
      socks5_port: lease.socks5_port,
      socks5_user: lease.socks5_user,
      socks5_pass: lease.socks5_pass,
      wireguard_conf: lease.wireguard_conf || '',
      country: lease.country,
      carrier: lease.carrier,
      isp_carrier: lease.isp_carrier || lease.carrier || 'Dedicated ISP Residential',
      fraud_score: lease.fraud_score !== undefined ? lease.fraud_score : 0,
      replacement_count: lease.replacement_count || 0,
      can_replace: canReplace,
      replace_remaining_hours: replaceRemainingHours,
      expires_at: lease.expires_at ? lease.expires_at.toISOString() : null,
      created_at: lease.created_at ? lease.created_at.toISOString() : null,
      status: lease.status
    });
  } catch (err) {
    console.error('Error fetching proxy details:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve proxy details.' });
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
      timeout: 10000
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
    const adjustedRate = await getUsdNgnExchangeRate();
    const retailNgn = Math.ceil((wholesaleUSD * SMS_MARKUP_MULTIPLIER) * adjustedRate);
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
      throw new Error(provisionErr.message || 'Failed to allocate virtual number. Please select another operator.');
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

// Provide a clean handler for GET /api/sms/rent to prevent "Cannot GET /api/sms/rent"
app.get('/api/sms/rent', (req, res) => {
  if (req.accepts('html') && !req.xhr) {
    return res.redirect('/dashboard.html#sms');
  }
  res.json({
    status: 'active',
    endpoint: '/api/sms/rent',
    method: 'POST',
    description: 'Virtual number provisioning endpoint. Send a POST request with { service, country, operator } to allocate a number.'
  });
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
    // Reconcile any pending proxy refunds so transaction history is immediately up to date
    await reconcileProxyRefunds(req.session.userId);

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
      const text = update.message.text ? update.message.text.trim() : '';
      const userId = chat.id;

      // Handle start and help commands (including deep link /start support)
      if (text.startsWith('/start') || text.startsWith('/help')) {
        console.log(`Received start/help command from User ID: ${userId} (${chat.username || 'No username'})`);
        const welcomeHelpText =
`👋 *Welcome to ProxyVault NG Official Support!*

Here is quick guidance for our core services:

🌐 *DEDICATED STATIC RESIDENTIAL IPS*
• Clean, dedicated ISP lines (USA, UK, CA, DE) with 0% fraud score.
• Supported Protocols: HTTP & SOCKS5 (Copy connection string directly from dashboard).
• Device Limit: Connect a maximum of 3 concurrent devices per IP.
• Longevity Tip: Access target platforms via desktop/antidetect web browsers rather than mobile apps for optimal stability.

📱 *VIRTUAL SMS OTP NUMBERS*
• Instant international verification codes for WhatsApp, Telegram, ChatGPT, Facebook, etc.
• 100% Auto-Refund: If the SMS code does not arrive within the countdown timer, the rental fee is automatically refunded back to your Naira wallet immediately.
• Security Best Practice: Enable 2FA and bind your personal recovery email immediately after verification.

💳 *NAIRA WALLET TOP-UPS*
• Automated instant credit via Korapay (Debit Card, Bank Transfer, USSD).

Need human assistance? Reply directly to this message and an agent will join your session shortly.`;

        await sendTelegramMessage(userId, welcomeHelpText, {
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
        await sendTelegramMessage(adminGroupChatId, headerText, {
          inline_keyboard: [
            [{ text: '❌ End Session', callback_data: `close_session_${userId}` }]
          ]
        });

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

      if (data.startsWith('close_session_')) {
        const targetUserId = data.replace('close_session_', '');
        try {
          const endUserMessage = "✅ *Ticket Resolved*\n\nYour support session has been closed by an agent. If you need assistance again, simply type a new message or send `/start`. Thank you for using ProxyVault!";
          await sendTelegramMessage(targetUserId, endUserMessage);

          if (adminGroupChatId) {
            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
              chat_id: adminGroupChatId,
              text: `🔒 *Ticket for User ID ${targetUserId} has been marked closed.*`
            });
          }

          await TelegramTicketMapping.deleteMany({ user_telegram_id: targetUserId });
          await TelegramSupportSession.deleteOne({ user_telegram_id: targetUserId });
        } catch (closeErr) {
          console.error('Error executing session close callback:', closeErr.message);
        }
        return;
      }

      if (data === 'guide_proxy') {
        await sendTelegramMessage(userId, `🌐 *Proxy Setup Guide*\n\n1. For laptops/desktops, enter the SOCKS5 proxy IP, Port, Username, and Password in SwitchyOmega (browser) or Proxifier.\n2. For WireGuard, download the WireGuard client, click 'Add Tunnel', and paste the configuration profile.\n3. Make sure to choose the correct target country and resident carrier.`);
      } else if (data === 'guide_sms') {
        await sendTelegramMessage(userId, `📱 *SMS Verification Help*\n\n1. Select higher signal operators (e.g. Best Signal) for maximum delivery reliability.\n2. Leases last 10-15 minutes. If the OTP code does not arrive within 3 minutes, click 'Cancel Number' (free) and choose a different operator.\n3. Cancelled numbers are automatically refunded to your wallet.`);
      } else if (data === 'guide_billing') {
        await sendTelegramMessage(userId, `💳 *Deposit & Billing Info*\n\n1. Click 'Top Up Wallet' to fund Naira via bank transfer, card, or USSD securely.\n2. Minimum deposit is ₦500.\n3. Credits are automatic and instant.`);
      } else if (data === 'speak_human') {
        await sendTelegramMessage(userId, `💬 Please type your question or describe your issue here. Our support team will reply directly in this chat!`);
      } else if (data === 'guide_refund') {
        await sendTelegramMessage(userId, `⚠️ *Support & Refund Guidelines*\n\n*Submitting a Disputed Order*\nIf you experienced an issue with an SMS order and are requesting a refund, please reply with:\n• *Order ID / Order Number*\n• *Target Phone Number*\n• *OTP / Service Code* (if received or failed)\n• *Screenshots & Screen Recording* showing the full issue from request to code timeout.\n\n*💡 High-Success Rate Recommendations*\n• *Always select High-Signal Providers* for maximum delivery reliability.\n• *Telegram Activation Tip:* We strongly recommend using *Telegram X* for initiating number verifications. If Telegram X is unavailable, switch to standard Telegram.`);
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

        // Check if the reply is a ticket closure command (/close, /end, /resolve)
        if (text === '/close' || text === '/resolve' || text === '/end') {
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
        if (err.response && err.response.status === 409) {
          // Webhook is configured on production (Vercel), pause polling to avoid conflict
          await new Promise(resolve => setTimeout(resolve, 60000));
        } else if (err.code !== 'ECONNABORTED' && err.message !== 'timeout of 35000ms exceeded') {
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

app.get('/api/v1/cron/user-balance-check', async (req, res) => {
  try {
    await checkUserBalances();
    res.json({ success: true, message: 'User wallet balance check completed.' });
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

// Monitor user balances and send low-balance alert emails if they drop below ₦1,000.00 (100,000 kobo)
async function checkUserBalances() {
  try {
    const lowBalanceUsers = await User.find({
      balance: { $lt: 100000 },
      lowBalanceAlertSent: false
    });

    for (const user of lowBalanceUsers) {
      const balanceNgn = user.balance / 100;
      const username = user.email.split('@')[0];
      
      const result = await emailService.sendLowBalanceEmail(user.email, username, balanceNgn);
      if (result.success) {
        user.lowBalanceAlertSent = true;
        await user.save();
        console.log(`Low balance email sent to user: ${user.email} (Current balance: ₦${balanceNgn.toFixed(2)})`);
      }
    }
  } catch (err) {
    console.error('Error checking user balances:', err.message);
  }
}


// Automatically set Telegram Webhook when running in production serverless environments (Vercel)
const token = process.env.TELEGRAM_BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
if (isProduction && token && !token.startsWith('tg_mock_')) {
  const clientUrl = process.env.CLIENT_URL || `https://proxyvaultng.vercel.app`;
  axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
    url: `${clientUrl}/api/v1/telegram-webhook`
  }).then(whRes => {
    console.log('Telegram Support Webhook registered in production:', whRes.data);
  }).catch(err => {
    console.error('Failed to set Telegram Support Webhook:', err.message);
  });
}

// ----------------------------------------------------
if (require.main === module) {
  dbReady.then(async () => {
    try {
      const defaultEmail = 'realgpyks@gmail.com';
      let defaultUser = await User.findOne({ email: defaultEmail });
      if (!defaultUser) {
        const defaultHash = await bcrypt.hash('password123', 10);
        await User.create({
          email: defaultEmail,
          password_hash: defaultHash,
          balance: 5000000 // ₦50,000 in Kobo
        });
        console.log(`[Seed] Account ${defaultEmail} initialized with ₦50,000.`);
      } else if (process.env.SIMULATION_MODE === 'true' && defaultUser.balance < 800000) {
        defaultUser.balance = 5000000;
        await defaultUser.save();
      }
    } catch (seedErr) {
      console.warn('Seed account note:', seedErr.message);
    }

    app.listen(PORT, () => {
      console.log(`ProxyVault backend running on http://localhost:${PORT}`);
      console.log(`Simulation Mode: ${process.env.SIMULATION_MODE}`);
      
      const startupToken = process.env.TELEGRAM_BOT_TOKEN;

      // Check for inactive support sessions every 5 minutes
      const cron = require('node-cron');
      cron.schedule('*/5 * * * *', checkSessionTimeouts);

      // Check user wallet balances for low-balance alerts every 1 hour
      cron.schedule('0 * * * *', checkUserBalances);

      if (startupToken && !startupToken.startsWith('tg_mock_')) {
        if (!isProduction) {
          // Fallback to local long polling for local testing without ngrok
          startTelegramPolling(startupToken);
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
