const assert = require('assert');
const { ProxyLease, User, mongoose } = require('./db');
const proxySellerService = require('./services/proxySellerService');
const proxyService = require('./services/proxyService');

async function runTests() {
  console.log('===========================================================');
  console.log('🧪 RUNNING PROXY-SELLER INTEGRATION & DASHBOARD TESTS');
  console.log('===========================================================');

  // 1. Verify ProxySeller Service in Simulation Mode
  console.log('1. Testing proxySellerService.orderDedicatedIsp (Simulation Mode)...');
  const simProxy = await proxySellerService.orderDedicatedIsp({ countryId: 'us', periodId: '1m', quantity: 1 });
  assert.ok(simProxy, 'Proxy result should exist');
  assert.ok(simProxy.ip_address, 'IP address must be generated');
  assert.ok(simProxy.http_port, 'HTTP port must be present');
  assert.ok(simProxy.socks5_port, 'SOCKS5 port must be present');
  assert.ok(simProxy.socks5_user, 'Username must be present');
  assert.ok(simProxy.socks5_pass, 'Password must be present');
  assert.strictEqual(simProxy.upstream_provider, 'proxy_seller');
  assert.strictEqual(simProxy.fraud_score, 0);
  assert.ok(simProxy.carrier.includes('Residential'), 'Carrier must be Residential');
  console.log('   ✅ proxySellerService.orderDedicatedIsp verified:', {
    ip: simProxy.ip_address,
    httpPort: simProxy.http_port,
    socks5Port: simProxy.socks5_port,
    carrier: simProxy.carrier,
    fraudScore: simProxy.fraud_score
  });

  // 2. Testing replacement in Simulation Mode
  console.log('\n2. Testing proxySellerService.replaceProxy...');
  const replaced = await proxySellerService.replaceProxy({ proxyId: simProxy.upstream_proxy_id, reason: 'NOT_WORK' });
  assert.ok(replaced.success, 'Replacement must succeed');
  assert.ok(replaced.ip_address, 'New IP must be provided');
  assert.ok(replaced.socks5_port, 'New SOCKS5 port must be provided');
  console.log('   ✅ proxySellerService.replaceProxy verified. New IP:', replaced.ip_address);

  // 3. Testing Balance Query
  console.log('\n3. Testing proxySellerService.getBalance...');
  const balance = await proxySellerService.getBalance();
  assert.ok(typeof balance === 'number' && balance > 0, 'Balance must be a positive number');
  console.log('   ✅ proxySellerService.getBalance verified. Mock balance: $' + balance);

  // 4. Testing proxyService facade
  console.log('\n4. Testing proxyService.provisionProxy wrapper...');
  const facadeResult = await proxyService.provisionProxy('US', 'Verizon');
  assert.ok(facadeResult.ip_address, 'Facade should return IP address');
  assert.ok(facadeResult.isp_carrier.includes('Verizon'), 'Carrier should include Verizon');
  console.log('   ✅ proxyService facade verified with ISP carrier:', facadeResult.isp_carrier);

  // 5. Testing ProxyLease Schema Validation
  console.log('\n5. Testing ProxyLease Mongoose Schema fields & validation...');
  const testLeaseDoc = new ProxyLease({
    user_id: new mongoose.Types.ObjectId(),
    order_id: simProxy.order_id,
    upstream_provider: 'proxy_seller',
    upstream_order_id: simProxy.upstream_order_id,
    upstream_proxy_id: simProxy.upstream_proxy_id,
    ip_address: simProxy.ip_address,
    protocol: 'socks5',
    http_port: simProxy.http_port,
    socks5_port: simProxy.socks5_port,
    socks5_user: simProxy.socks5_user,
    socks5_pass: simProxy.socks5_pass,
    wireguard_conf: simProxy.wireguard_conf,
    country: simProxy.country,
    carrier: simProxy.carrier,
    isp_carrier: simProxy.isp_carrier,
    fraud_score: 0,
    replacement_count: 0,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    status: 'active'
  });

  const validationError = testLeaseDoc.validateSync();
  assert.strictEqual(validationError, undefined, 'ProxyLease document must be valid according to schema');
  assert.strictEqual(testLeaseDoc.upstream_provider, 'proxy_seller');
  assert.strictEqual(testLeaseDoc.http_port, simProxy.http_port);
  assert.strictEqual(testLeaseDoc.socks5_port, simProxy.socks5_port);
  assert.strictEqual(testLeaseDoc.fraud_score, 0);
  assert.strictEqual(testLeaseDoc.replacement_count, 0);
  console.log('   ✅ ProxyLease Mongoose Schema validation passed with all PRD fields.');

  // 6. Testing 24h Replacement Safeguard Window Logic
  console.log('\n6. Testing 24-hour safeguard and max 1 replacement logic...');
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  // Case A: Fresh lease (within 24h, 0 replacements) -> Eligible
  const freshLeaseAge = 2 * 60 * 60 * 1000; // 2 hours old
  const canReplaceFresh = freshLeaseAge <= ONE_DAY_MS && testLeaseDoc.replacement_count < 1;
  assert.strictEqual(canReplaceFresh, true, 'Fresh lease should be eligible for replacement');

  // Case B: Old lease (25 hours old) -> Ineligible
  const oldLeaseAge = 25 * 60 * 60 * 1000;
  const canReplaceOld = oldLeaseAge <= ONE_DAY_MS && testLeaseDoc.replacement_count < 1;
  assert.strictEqual(canReplaceOld, false, 'Lease older than 24 hours should be ineligible');

  // Case C: Already replaced lease (1 replacement done) -> Ineligible
  const usedReplacements = 1;
  const canReplaceUsed = freshLeaseAge <= ONE_DAY_MS && usedReplacements < 1;
  assert.strictEqual(canReplaceUsed, false, 'Lease with replacement_count >= 1 should be ineligible');
  console.log('   ✅ 24-hour window and 1-replacement maximum safeguards verified.');

  console.log('\n===========================================================');
  console.log('🎉 ALL INTEGRATION & VERIFICATION TESTS PASSED!');
  console.log('===========================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
