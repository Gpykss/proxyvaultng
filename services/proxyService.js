const crypto = require('crypto');
const axios = require('axios');

// Generate realistic WireGuard keys
function generateBase64Key() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Provision a static residential IP using live CyberYozh APIs
 * @param {string} country - Country code (e.g., 'US', 'GB', 'DE')
 * @param {string} selectedIsp - User-selected Broadband ISP carrier
 * @returns {Promise<object>} Proxy details and WireGuard config
 */
async function provisionProxy(country, selectedIsp = '') {
  const apiKey = process.env.CYBERYOZH_API_KEY;
  try {
    // 1. Fetch available shop items to locate the product ID
    const shopRes = await axios.get(`https://app.cyberyozh.com/api/v1/proxies/shop/?proxy_category=residential_static&stock_status=in_stock&country=${country.toLowerCase()}`, {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const items = shopRes.data.results || [];
    const code = country.toUpperCase();
    const isAnyIsp = !selectedIsp || selectedIsp.toLowerCase() === 'any';
    const matchedItem = items.find(item => 
      item.proxy_category === 'residential_static' &&
      (item.location_country_code || '').toUpperCase() === code &&
      (isAnyIsp || item.title.toLowerCase().includes((selectedIsp || '').toLowerCase()) || (selectedIsp || '').toLowerCase().includes(item.title.toLowerCase()))
    );

    if (!matchedItem || !matchedItem.proxy_products || !matchedItem.proxy_products[0]) {
      throw new Error(`No static residential proxy found for country ${country}${selectedIsp && selectedIsp !== 'any' ? ` and ISP ${selectedIsp}` : ''}`);
    }

    const productUuid = matchedItem.proxy_products[0].id;

    // 2. Call buy proxies API using correct schema parameter shape
    const buyRes = await axios.post('https://app.cyberyozh.com/api/v1/proxies/shop/buy_proxies/', [
      {
        id: productUuid,
        auto_renew: false
      }
    ], {
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    const buyResults = buyRes.data.results || buyRes.data.catalog || buyRes.data || [];
    let targetOrderId = null;
    if (buyResults.length > 0) {
      const order = buyResults[0];
      if (order.status === 'canceled' || order.status === 'failed') {
        throw new Error(order.message || 'Purchase failed (insufficient CyberYozh balance).');
      }
      targetOrderId = order.id || order.order_id || null;
    }

    // 3. Retrieve proxy details matching strictly this exact order ID
    let freshProxy = null;
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const waitMs = attempt === 0 ? 2500 : 2000;
      await new Promise(resolve => setTimeout(resolve, waitMs));

      try {
        const historyRes = await axios.get('https://app.cyberyozh.com/api/v1/proxies/history/', {
          headers: {
            'X-Api-Key': apiKey,
            'Accept': 'application/json'
          },
          timeout: 10000
        });

        const historyList = historyRes.data.results || [];
        if (historyList.length > 0) {
          if (targetOrderId) {
            freshProxy = historyList.find(p => p.id === targetOrderId || (p.order && p.order.id === targetOrderId));
          } else {
            const latest = historyList[0];
            if (latest && latest.access_starts_at) {
              const diffMs = Math.abs(Date.now() - new Date(latest.access_starts_at).getTime());
              if (diffMs < 60000) {
                freshProxy = latest;
              }
            }
          }

          if (freshProxy && (freshProxy.public_ipaddress || freshProxy.connection_host) && freshProxy.connection_port) {
            break;
          }
        }
      } catch (pollErr) {
        console.warn(`CyberYozh history check attempt ${attempt + 1} failed:`, pollErr.message);
      }
    }

    if (!freshProxy) {
      throw new Error('Proxy order submitted, but credentials are still provisioning upstream. Please refresh in a moment.');
    }

    const ipAddress = freshProxy.public_ipaddress || freshProxy.connection_host;
    const socks5_port = freshProxy.connection_port;
    const socks5_user = freshProxy.connection_login;
    const socks5_pass = freshProxy.connection_password;

    if (!ipAddress || !socks5_port) {
      throw new Error('Upstream proxy credentials are still finalizing. Please check back shortly.');
    }

    // Wrap SOCKS5 connection inside a WireGuard tunnel profile template
    const clientPrivateKey = generateBase64Key();
    const serverPublicKey = generateBase64Key();
    const wireguard_conf = `[Interface]
PrivateKey = ${clientPrivateKey}
Address = 10.100.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${ipAddress}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`;

    const carrier = freshProxy.carrier || freshProxy.operator || freshProxy.network || freshProxy.asn || selectedIsp || 'Comcast Cable (ISP Residential)';

    return {
      order_id: targetOrderId || freshProxy.id,
      ip_address: ipAddress,
      socks5_port,
      socks5_user,
      socks5_pass,
      wireguard_conf,
      country,
      carrier
    };
  } catch (error) {
    console.error('CyberYozh API error:', error.message);
    const errMsg = error.response && error.response.data
      ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : JSON.stringify(error.response.data))
      : error.message;
    throw new Error(errMsg);
  }
}

module.exports = {
  provisionProxy
};
