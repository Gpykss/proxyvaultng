const cron = require('node-cron');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Clean admin chat ID by replacing double dashes (e.g. '--100...') with a single dash ('-100...')
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
  ? process.env.TELEGRAM_ADMIN_CHAT_ID.replace(/^--/, '-')
  : null;

// Allow using PROVIDER_API_KEY, falling back to SMS_5SIM_API_KEY already present in .env
const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY || process.env.SMS_5SIM_API_KEY;

// 1. Helper to post notifications straight to Telegram Admin Group
async function sendTelegramAlert(message) {
  if (!TELEGRAM_TOKEN || !ADMIN_CHAT_ID) {
    console.warn('Telegram bot token or admin chat ID is not configured. Alert suppressed:', message);
    return;
  }
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: ADMIN_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Telegram notification error:', error?.response?.data || error.message);
  }
}

// 2. LIVE FETCH: Queries the real 5SIM profile API to check user balance
async function fetchLiveBalance() {
  if (!PROVIDER_API_KEY) {
    throw new Error('5SIM API Key (PROVIDER_API_KEY/SMS_5SIM_API_KEY) is not configured.');
  }

  // Avoid trying to reach external 5sim endpoints if mock/simulation credentials are dummy keys
  if (PROVIDER_API_KEY.startsWith('5sim_api_key_')) {
    console.log('Simulation Mode: Returning mock balance $10.00');
    return 10.00;
  }

  try {
    const response = await axios.get('https://5sim.net/v1/user/profile', {
      headers: {
        'Authorization': `Bearer ${PROVIDER_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 8000
    });

    // 5SIM profile endpoint response format: { email: "...", balance: 12.53, rating: ... }
    const rawBalance = response.data && response.data.balance !== undefined ? response.data.balance : 0;
    return parseFloat(rawBalance);
  } catch (error) {
    console.error('Failed to query provider live balance:', error?.response?.data || error.message);
    throw error;
  }
}

/**
 * NOTE ON CYBERYOZH BALANCE:
 * We probed all candidate user/balance endpoints (e.g. /api/v1/users/balance/, /api/v1/profile/, etc.)
 * using your live CYBERYOZH_API_KEY. The server returns `401 Unauthorized` or `404 Not Found`.
 * In their Django Rest backend, the API Key is restricted to order/proxy endpoints (/shop/ and /history/)
 * and cannot be used to fetch billing/user profiles (which require JWT tokens).
 * 
 * If their support team provides a dedicated balance endpoint for API keys in the future,
 * you can fetch it using the function structure below:
 */
async function fetchCyberYozhBalance() {
  const apiKey = process.env.CYBERYOZH_API_KEY;
  if (!apiKey || apiKey.startsWith('cy_mock_')) return null;

  try {
    // Replace URL if CyberYozh support provides a custom endpoint
    const response = await axios.get('https://app.cyberyozh.com/api/v1/users/balance/', {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 8000
    });
    return parseFloat(response.data.balance || 0);
  } catch (error) {
    // Log silently or return null to avoid crashing the status updates
    console.warn('Failed to fetch CyberYozh balance:', error.message);
    return null;
  }
}


// 3. Low Balance Guard (< $1.00 Alert)
async function checkLowBalanceAlert() {
  try {
    const balance = await fetchLiveBalance();
    if (balance < 1.00) {
      const warningMsg = `🚨 *CRITICAL LOW BALANCE ALERT*\n\nYour 5SIM SMS provider balance has dropped to *$${balance.toFixed(2)}* (Below $1.00 threshold).\n\nPlease top up your provider account immediately to avoid customer service disruption!`;
      await sendTelegramAlert(warningMsg);
    }
  } catch (err) {
    console.error('checkLowBalanceAlert failure:', err.message);
  }
}

// 4. Periodic 2-Hour Status Report
async function sendPeriodicBalanceUpdate() {
  try {
    const balance = await fetchLiveBalance();
    const updateMsg = `📊 *ProxyVault Provider Balance Update*\n\nLive 5SIM Balance: *$${balance.toFixed(2)}*\nStatus: ${balance < 1.00 ? '⚠️ LOW BALANCE WARNING' : '✅ Operational'}`;
    await sendTelegramAlert(updateMsg);
  } catch (err) {
    await sendTelegramAlert(`⚠️ *Balance Check Failed*: Could not reach provider API: ${err.message}`);
  }
}

if (process.env.NODE_ENV !== 'production' || process.env.RUN_CRON_BACKGROUND === 'true') {
  // - Check balance every 1 hour for emergency drop below $1.00
  cron.schedule('0 * * * *', checkLowBalanceAlert);

  // - Send routine balance digest every 12 hours
  cron.schedule('0 */12 * * *', sendPeriodicBalanceUpdate);
  console.log('Balance Notifier cron schedules initialized.');
}

module.exports = { fetchLiveBalance, checkLowBalanceAlert, sendPeriodicBalanceUpdate };
