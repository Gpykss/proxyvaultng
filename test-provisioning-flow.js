const assert = require('assert');
const { ProxyLease, mongoose } = require('./db');
const proxySellerService = require('./services/proxySellerService');
const proxyService = require('./services/proxyService');

async function testProvisioningFlow() {
  console.log('🧪 Testing Provisioning Flow & Schema Support...');

  // 1. Verify schema supports 'provisioning'
  const lease = new ProxyLease({
    user_id: new mongoose.Types.ObjectId(),
    order_id: '5281162',
    upstream_provider: 'proxy_seller',
    upstream_order_id: '5281162',
    ip_address: 'Allocating...',
    protocol: 'socks5',
    socks5_port: 0,
    socks5_user: 'Allocating...',
    socks5_pass: 'Allocating...',
    country: 'US',
    carrier: 'Broadband Residential (ISP)',
    isp_carrier: 'Verizon/AT&T (ISP Residential)',
    fraud_score: 0,
    replacement_count: 0,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: 'provisioning'
  });

  const err = lease.validateSync();
  assert.strictEqual(err, undefined, 'Provisioning lease should validate successfully with Mongoose');
  console.log('✓ ProxyLease schema supports status "provisioning" and allocating credentials.');

  // 2. Verify fetchOrderProxy is exported
  assert.strictEqual(typeof proxySellerService.fetchOrderProxy, 'function', 'fetchOrderProxy must be exported by proxySellerService');
  assert.strictEqual(typeof proxyService.fetchOrderProxy, 'function', 'fetchOrderProxy must be exported by proxyService');
  console.log('✓ fetchOrderProxy is exported across proxy services.');

  // 3. Test real fetchOrderProxy with Proxy-Seller live API for order 5281162
  console.log('Testing live fetchOrderProxy for order 5281162...');
  const liveOrder = await proxySellerService.fetchOrderProxy('5281162');
  if (liveOrder && liveOrder.ip_address) {
    console.log(`✓ Successfully retrieved live proxy from order 5281162: IP ${liveOrder.ip_address}, port ${liveOrder.socks5_port}, user ${liveOrder.socks5_user}`);
    assert.ok(liveOrder.ip_address.includes('.'), 'IP address should be valid format');
  } else {
    console.log('Note: In simulation mode or live order not found.');
  }

  console.log('\n🎉 ALL PROVISIONING TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

testProvisioningFlow().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
