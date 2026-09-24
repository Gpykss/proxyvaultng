const proxySellerService = require('./proxySellerService');

/**
 * Provision a static residential ISP proxy using Proxy-Seller
 * @param {string} country - Country code (e.g. 'US', 'GB')
 * @param {string} selectedIsp - Optional ISP Carrier hint
 * @returns {Promise<object>} Proxy details with HTTP & SOCKS5 credentials
 */
async function provisionProxy(country = 'US', selectedIsp = '') {
  try {
    const proxyData = await proxySellerService.orderDedicatedIsp({
      countryId: country.toLowerCase(),
      periodId: '1m',
      quantity: 1
    });

    if (selectedIsp && selectedIsp !== 'any') {
      proxyData.carrier = `${selectedIsp} (ISP Residential)`;
      proxyData.isp_carrier = `${selectedIsp} (ISP Residential)`;
    }

    return proxyData;
  } catch (err) {
    console.error('[proxyService] Provisioning error:', err.message);
    throw err;
  }
}

/**
 * Replace an active subnet proxy within the 24-hour guarantee
 * @param {Object} options
 * @param {string} options.proxyId - Upstream proxy ID
 * @param {string} options.reason - Reason for replacement
 */
async function replaceProxy({ proxyId, reason = 'NOT_WORK' }) {
  try {
    return await proxySellerService.replaceProxy({ proxyId, reason });
  } catch (err) {
    console.error('[proxyService] Replacement error:', err.message);
    throw err;
  }
}

module.exports = {
  provisionProxy,
  replaceProxy,
  fetchOrderProxy: proxySellerService.fetchOrderProxy,
  proxySellerService
};
