const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://proxy-seller.com/personal/api/v1/';

function generateBase64Key() {
  return crypto.randomBytes(32).toString('base64');
}

function isSimulationMode() {
  const sim = process.env.SIMULATION_MODE === 'true';
  const apiKey = process.env.PROXY_SELLER_API_KEY;
  const isKeyInvalid = !apiKey || apiKey.startsWith('ps_mock_') || apiKey.includes('your_proxy_seller');
  return sim || isKeyInvalid;
}

/**
 * Custom error class to tag insufficient balance errors for admin notification
 */
class ProxySellerError extends Error {
  constructor(message, isBalanceError = false, statusCode = null, raw = null) {
    super(message);
    this.name = 'ProxySellerError';
    this.isBalanceError = isBalanceError;
    this.statusCode = statusCode;
    this.raw = raw;
  }
}

/**
 * Helper to build WireGuard configuration file
 */
function buildWireguardConf(ipAddress) {
  const clientPrivateKey = generateBase64Key();
  const serverPublicKey = generateBase64Key();
  return `[Interface]
PrivateKey = ${clientPrivateKey}
Address = 10.100.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${ipAddress}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;
}

/**
 * Simulated ISP proxy generator for test environments
 */
function generateSimulatedProxy(countryId = 'us') {
  const isUS = countryId.toLowerCase() === 'us';
  const subnets = isUS
    ? [
        { prefix: '69.181', carrier: 'Comcast Cable (ISP Residential)' },
        { prefix: '71.244', carrier: 'Verizon Fios (ISP Residential)' },
        { prefix: '108.204', carrier: 'AT&T Internet (ISP Residential)' }
      ]
    : [
        { prefix: '81.131', carrier: 'BT Broadband (ISP Residential)' },
        { prefix: '82.35', carrier: 'Virgin Media (ISP Residential)' }
      ];

  const selectedSubnet = subnets[Math.floor(Math.random() * subnets.length)];
  const octet3 = Math.floor(Math.random() * 254) + 1;
  const octet4 = Math.floor(Math.random() * 254) + 1;
  const ipAddress = `${selectedSubnet.prefix}.${octet3}.${octet4}`;

  const httpPort = Math.floor(Math.random() * 4000) + 10000;
  const socks5Port = httpPort + 1000;
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const user = `pv_isp_${randomSuffix}`;
  const pass = `sec_${crypto.randomBytes(6).toString('hex')}`;
  const orderId = `ps_ord_${Date.now()}`;
  const proxyId = `ps_px_${Date.now()}_${Math.floor(Math.random() * 9000) + 1000}`;

  return {
    order_id: orderId,
    upstream_order_id: orderId,
    upstream_proxy_id: proxyId,
    upstream_provider: 'proxy_seller',
    ip_address: ipAddress,
    http_port: httpPort,
    socks5_port: socks5Port,
    socks5_user: user,
    socks5_pass: pass,
    country: countryId.toUpperCase(),
    carrier: selectedSubnet.carrier,
    isp_carrier: selectedSubnet.carrier,
    fraud_score: 0,
    wireguard_conf: buildWireguardConf(ipAddress)
  };
}

// Proxy-Seller ISP Country Numeric ID Mapping (from /reference/list/isp)
const ISP_COUNTRY_MAP = {
  'us': 3758,
  'usa': 3758,
  'gb': 7738,
  'uk': 7738,
  'gbr': 7738,
  'ca': 6272,
  'can': 6272,
  'de': 9767,
  'deu': 9767,
  'fr': 6269,
  'fra': 6269,
  'nl': 4480,
  'nld': 4480,
  'at': 6963,
  'bra': 5236,
  'br': 5236,
  'cz': 33779,
  'cze': 33779,
  'hk': 11674,
  'hkg': 11674,
  'in': 15266,
  'ind': 15266,
  'il': 7954,
  'isr': 7954,
  'it': 15701,
  'ita': 15701,
  'jp': 7953,
  'jpn': 7953,
  'lv': 5389,
  'pl': 4479,
  'pol': 4479,
  'ro': 6271,
  'rou': 6271,
  'sg': 10257,
  'sgp': 10257,
  'kr': 8659,
  'kor': 8659,
  'es': 8702,
  'esp': 8702,
  'tw': 8658,
  'twn': 8658,
  'th': 12245,
  'tha': 12245,
  'tr': 7952,
  'tur': 7952,
  'ua': 7894,
  'ukr': 7894
};

function resolveCountryNumericId(country) {
  if (typeof country === 'number') return country;
  if (!country) return 3758; // default to USA
  const key = String(country).toLowerCase().trim();
  if (ISP_COUNTRY_MAP[key]) return ISP_COUNTRY_MAP[key];
  const num = parseInt(key);
  if (!isNaN(num)) return num;
  return 3758; // fallback to USA
}

/**
 * Helper to extract proxy credentials from Proxy-Seller items structure
 */
function extractProxyCredentials(data) {
  if (!data) return null;
  let proxyItem = null;
  if (Array.isArray(data.items) && data.items.length > 0) {
    proxyItem = data.items[0];
  } else if (Array.isArray(data) && data.length > 0) {
    proxyItem = data[0];
  } else if (data.items && typeof data.items === 'object') {
    const keys = Object.keys(data.items);
    if (keys.length > 0) proxyItem = data.items[keys[0]];
  } else if (data.ip) {
    proxyItem = data;
  }
  return (proxyItem && proxyItem.ip) ? proxyItem : null;
}

/**
 * Fetch active proxy details by orderId from Proxy-Seller /proxy/list/isp
 */
async function fetchOrderProxy(orderId) {
  if (isSimulationMode()) {
    return generateSimulatedProxy('us');
  }

  const apiKey = process.env.PROXY_SELLER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.get(`${BASE_URL}${apiKey}/proxy/list/isp`, {
      params: { orderId: String(orderId) },
      headers: { 'Accept': 'application/json' },
      timeout: 8000
    });

    const body = res.data;
    if (!body || body.status === 'error') return null;

    let items = body?.data?.items || body?.items || body?.data || [];
    if (!Array.isArray(items) && typeof items === 'object') {
      items = Object.values(items);
    }

    let matched = null;
    if (Array.isArray(items)) {
      matched = items.find(it => String(it.order_id) === String(orderId) || String(it.order_number).startsWith(String(orderId))) || items[0];
    } else {
      matched = items;
    }

    if (!matched || !matched.ip) return null;

    const ip = matched.ip || matched.host;
    const httpPort = matched.port_http || matched.http_port || matched.port;
    const socks5Port = matched.port_socks5 || matched.socks5_port || matched.port_socks || (httpPort ? httpPort + 1 : 1080);
    const login = matched.login || matched.user || matched.username;
    const password = matched.password || matched.pass;
    const proxyId = String(matched.id || matched.proxy_id || matched.proxyId || '');

    return {
      upstream_proxy_id: proxyId,
      ip_address: ip,
      http_port: Number(httpPort) || null,
      socks5_port: Number(socks5Port),
      socks5_user: login,
      socks5_pass: password,
      wireguard_conf: buildWireguardConf(ip)
    };
  } catch (err) {
    console.error(`[ProxySeller] Failed to fetch proxy for orderId ${orderId}:`, err.message);
    return null;
  }
}

/**
 * 1. Order Dedicated Static ISP Proxy
 * @param {Object} options
 * @param {string|number} options.countryId - e.g. 'us', 'gb', or 3758
 * @param {string} options.periodId - e.g. '1m' (1 month)
 * @param {number} options.quantity - default 1
 * @param {number} options.paymentId - default 1 (internal balance)
 */
async function orderDedicatedIsp({ countryId = 'us', periodId = '1m', quantity = 1, paymentId = 1 }) {
  if (isSimulationMode()) {
    console.log(`[ProxySeller Simulation] Provisioning dedicated ISP proxy for country: ${countryId}`);
    return generateSimulatedProxy(countryId);
  }

  const apiKey = process.env.PROXY_SELLER_API_KEY;
  const resolvedPaymentId = process.env.PROXY_SELLER_PAYMENT_ID
    ? parseInt(process.env.PROXY_SELLER_PAYMENT_ID)
    : (paymentId || 1);

  const numericCountryId = resolveCountryNumericId(countryId);
  const endpoint = `${BASE_URL}${apiKey}/order/make`;
  const payload = {
    proxyType: 'isp',
    countryId: numericCountryId,
    periodId: periodId,
    quantity: quantity,
    paymentId: resolvedPaymentId,
    customTargetName: 'ProxyVault Dedicated ISP'
  };

  try {
    const res = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 12000
    });

    const body = res.data;
    if (!body || body.status === 'error' || body.errors?.length > 0 || (body.data?.warning && /insufficient funds|not enough/i.test(body.data.warning))) {
      const errMsg = body?.errors?.[0]?.message || body?.data?.warning || body?.message || 'Proxy-Seller API reported an error.';
      const isBalanceErr = /balance|funds|not enough/i.test(errMsg) || body?.errors?.[0]?.code === 'ERR_BALANCE';
      throw new ProxySellerError(errMsg, isBalanceErr, res.status, body);
    }

    const data = body.data || body;
    let proxyItem = extractProxyCredentials(data);
    let orderId = String(data.order_id || data.orderId || data.id || '');

    const carrier = countryId.toLowerCase() === 'us'
      ? 'Verizon/AT&T (ISP Residential)'
      : 'BT/Virgin Media (ISP Residential)';

    // If order was created upstream but IP credentials are not yet ready:
    if (!proxyItem && orderId) {
      console.log(`[ProxySeller] Order ${orderId} placed successfully. Polling for allocation (up to 15s)...`);
      for (let attempt = 1; attempt <= 4; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        const fetched = await fetchOrderProxy(orderId);
        if (fetched && fetched.ip_address) {
          console.log(`[ProxySeller] Order ${orderId} allocated on attempt ${attempt}: ${fetched.ip_address}`);
          return {
            status: 'active',
            order_id: orderId,
            upstream_order_id: orderId,
            upstream_proxy_id: fetched.upstream_proxy_id,
            upstream_provider: 'proxy_seller',
            ip_address: fetched.ip_address,
            http_port: fetched.http_port,
            socks5_port: fetched.socks5_port,
            socks5_user: fetched.socks5_user,
            socks5_pass: fetched.socks5_pass,
            country: countryId.toUpperCase(),
            carrier: carrier,
            isp_carrier: carrier,
            fraud_score: 0,
            wireguard_conf: fetched.wireguard_conf
          };
        }
      }

      // If still provisioning after 15s, return provisioning state with confirmed orderId (DO NOT REFUND USER WALLET)
      console.log(`[ProxySeller] Order ${orderId} still provisioning. Returning provisioning state.`);
      return {
        status: 'provisioning',
        order_id: orderId,
        upstream_order_id: orderId,
        upstream_proxy_id: '',
        upstream_provider: 'proxy_seller',
        ip_address: 'Allocating...',
        socks5_port: 0,
        socks5_user: 'Allocating...',
        socks5_pass: 'Allocating...',
        country: countryId.toUpperCase(),
        carrier: carrier,
        isp_carrier: carrier,
        fraud_score: 0,
        wireguard_conf: '',
        message: 'Order confirmed! Upstream carrier is allocating your dedicated residential subnet (usually takes 1–3 minutes).'
      };
    }

    if (!proxyItem || !proxyItem.ip) {
      throw new ProxySellerError('Proxy credentials were not returned by Proxy-Seller upstream.');
    }

    const ip = proxyItem.ip || proxyItem.host;
    const httpPort = proxyItem.port_http || proxyItem.http_port || proxyItem.port;
    const socks5Port = proxyItem.port_socks5 || proxyItem.socks5_port || proxyItem.port_socks || (httpPort ? httpPort + 1 : 1080);
    const login = proxyItem.login || proxyItem.user || proxyItem.username;
    const password = proxyItem.password || proxyItem.pass;
    const proxyId = String(proxyItem.id || proxyItem.proxy_id || proxyItem.proxyId || '');

    return {
      status: 'active',
      order_id: String(orderId || proxyId),
      upstream_order_id: String(orderId || ''),
      upstream_proxy_id: proxyId,
      upstream_provider: 'proxy_seller',
      ip_address: ip,
      http_port: Number(httpPort) || null,
      socks5_port: Number(socks5Port),
      socks5_user: login,
      socks5_pass: password,
      country: countryId.toUpperCase(),
      carrier: carrier,
      isp_carrier: carrier,
      fraud_score: 0,
      wireguard_conf: buildWireguardConf(ip)
    };
  } catch (err) {
    if (err instanceof ProxySellerError) {
      throw err;
    }

    const errMsg = err?.response?.data?.errors?.[0]?.message ||
                   err?.response?.data?.message ||
                   err.message ||
                   'Unknown error';

    const isBalanceErr = /balance|funds|not enough/i.test(errMsg) ||
                         err?.response?.data?.errors?.[0]?.code === 'ERR_BALANCE';

    if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) {
      throw new ProxySellerError('Proxy-Seller API request timed out after 10 seconds.', false, 408);
    }

    throw new ProxySellerError(`Proxy-Seller error: ${errMsg}`, isBalanceErr, err?.response?.status || 500, err?.response?.data);
  }
}

/**
 * 2. Active Subnet Replacement
 * @param {Object} options
 * @param {string} options.proxyId - Internal Proxy-Seller ID
 * @param {string} options.reason - Reason code, default 'NOT_WORK'
 */
async function replaceProxy({ proxyId, reason = 'NOT_WORK' }) {
  if (isSimulationMode()) {
    console.log(`[ProxySeller Simulation] Replacing proxy ID: ${proxyId}`);
    const simulated = generateSimulatedProxy('us');
    return {
      success: true,
      ...simulated
    };
  }

  const apiKey = process.env.PROXY_SELLER_API_KEY;
  if (!apiKey) {
    throw new ProxySellerError('PROXY_SELLER_API_KEY is not configured.');
  }

  const endpoint = `${BASE_URL}${apiKey}/proxy/replace`;
  const payload = {
    proxyId: String(proxyId),
    reason: reason || 'NOT_WORK'
  };

  try {
    const res = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const body = res.data;
    if (!body || body.status === 'error' || body.errors) {
      const errMsg = body?.errors?.[0]?.message || body?.message || 'Subnet replacement request failed.';
      throw new ProxySellerError(errMsg, false, res.status, body);
    }

    const data = body.data || body;
    let proxyItem = data.item || data.proxy || data;
    if (Array.isArray(data) && data.length > 0) proxyItem = data[0];
    if (Array.isArray(data.items) && data.items.length > 0) proxyItem = data.items[0];

    const ip = proxyItem.ip || proxyItem.host;
    const httpPort = proxyItem.port_http || proxyItem.http_port || proxyItem.port;
    const socks5Port = proxyItem.port_socks5 || proxyItem.socks5_port || proxyItem.port_socks;
    const login = proxyItem.login || proxyItem.user || proxyItem.username;
    const password = proxyItem.password || proxyItem.pass;
    const newProxyId = String(proxyItem.id || proxyItem.proxy_id || proxyId);

    return {
      success: true,
      upstream_proxy_id: newProxyId,
      ip_address: ip,
      http_port: Number(httpPort) || null,
      socks5_port: Number(socks5Port),
      socks5_user: login,
      socks5_pass: password,
      wireguard_conf: buildWireguardConf(ip)
    };
  } catch (err) {
    if (err instanceof ProxySellerError) throw err;
    const errMsg = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.message || err.message;
    throw new ProxySellerError(`Proxy replacement error: ${errMsg}`, false, err?.response?.status || 500);
  }
}

/**
 * 3. Fetch Upstream Account Balance
 */
async function getBalance() {
  if (isSimulationMode()) {
    return 100.00;
  }

  const apiKey = process.env.PROXY_SELLER_API_KEY;
  if (!apiKey) throw new ProxySellerError('PROXY_SELLER_API_KEY is not configured.');

  try {
    const res = await axios.get(`${BASE_URL}${apiKey}/balance/get`, { timeout: 8000 });
    const body = res.data;
    if (body.status === 'success' && body.data) {
      return parseFloat(body.data.summ || body.data.balance || 0);
    }
    return parseFloat(body.summ || body.balance || 0);
  } catch (err) {
    console.error('Failed to fetch Proxy-Seller balance:', err.message);
    throw err;
  }
}

module.exports = {
  ProxySellerError,
  orderDedicatedIsp,
  replaceProxy,
  getBalance,
  fetchOrderProxy,
  isSimulationMode
};
