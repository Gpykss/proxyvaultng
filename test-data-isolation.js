const axios = require('axios');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- 1. Testing Unauthenticated Access Rejections ---');
  try {
    await axios.get(`${BASE_URL}/api/user/proxies`);
    assert.fail('Unauthenticated request to /api/user/proxies should have failed');
  } catch (err) {
    assert.strictEqual(err.response.status, 401, 'Should return 401 Unauthorized');
    console.log('✅ Unauthenticated /api/user/proxies returned 401 Unauthorized.');
  }

  try {
    await axios.get(`${BASE_URL}/api/proxy/some-random-id`);
    assert.fail('Unauthenticated request to /api/proxy/:id should have failed');
  } catch (err) {
    assert.strictEqual(err.response.status, 401, 'Should return 401 Unauthorized');
    console.log('✅ Unauthenticated /api/proxy/:id returned 401 Unauthorized.');
  }

  console.log('\n--- 2. Setting Up User A (Seeded Admin/Buyer) & User B (New User) ---');
  const userAClient = axios.create({ baseURL: BASE_URL, withCredentials: true });
  const userBClient = axios.create({ baseURL: BASE_URL, withCredentials: true });

  const emailA = 'realgpyks@gmail.com';
  const loginA = await userAClient.post('/api/auth/login', { email: emailA, password: 'password123' });
  assert.strictEqual(loginA.status, 200);
  const cookieA = loginA.headers['set-cookie'];
  userAClient.defaults.headers.common['Cookie'] = cookieA;
  const userAId = loginA.data.userId;
  console.log(`✅ User A logged in (${emailA}, id: ${userAId})`);

  const emailB = `fresh_user_${Date.now()}@test.com`;
  const regB = await userBClient.post('/api/auth/register', { email: emailB, password: 'Password123!' });
  assert.strictEqual(regB.status, 201);
  const cookieB = regB.headers['set-cookie'];
  userBClient.defaults.headers.common['Cookie'] = cookieB;
  const userBId = regB.data.userId;
  console.log(`✅ User B registered (${emailB}, id: ${userBId})`);

  console.log('\n--- 3. Verifying Empty State For Fresh User B ---');
  // Test /api/user/proxies
  const resBUserProxies = await userBClient.get('/api/user/proxies');
  assert.strictEqual(resBUserProxies.status, 200);
  assert(Array.isArray(resBUserProxies.data), 'Expected array response from /api/user/proxies');
  assert.strictEqual(resBUserProxies.data.length, 0, 'User B must have 0 proxies');
  console.log('✅ GET /api/user/proxies returned [] with status 200 for user with no proxies.');

  // Test /api/proxies
  const resBProxies = await userBClient.get('/api/proxies');
  assert.strictEqual(resBProxies.status, 200);
  assert(Array.isArray(resBProxies.data), 'Expected array response from /api/proxies');
  assert.strictEqual(resBProxies.data.length, 0, 'User B must have 0 proxies');
  console.log('✅ GET /api/proxies returned [] with status 200 for user with no proxies.');

  // Test /api/proxy/leases
  const resBLeases = await userBClient.get('/api/proxy/leases');
  assert.strictEqual(resBLeases.status, 200);
  assert.strictEqual(resBLeases.data.leases.length, 0, 'User B leases must be empty array');
  console.log('✅ GET /api/proxy/leases returned empty leases array with status 200.');

  // Ensure test order 5281162 / 208.214.167.61 is NOT present in any response
  const jsonStr = JSON.stringify(resBUserProxies.data) + JSON.stringify(resBLeases.data);
  assert(!jsonStr.includes('208.214.167.61'), 'Mock IP 208.214.167.61 must not be leaked!');
  assert(!jsonStr.includes('5281162'), 'Order 5281162 must not be leaked!');
  console.log('✅ Verified zero trace of test/admin IP 208.214.167.61:50101 or order 5281162 in User B responses.');

  console.log('\n--- 4. Provisioning Proxy for User A ---');
  const buyRes = await userAClient.post('/api/proxy/buy', { country: 'US' });
  assert.strictEqual(buyRes.status, 201);
  const leaseA = buyRes.data.lease;
  console.log(`✅ User A successfully rented proxy (id: ${leaseA.id}, IP: ${leaseA.ip_address}, owner: ${leaseA.user_id})`);

  console.log('\n--- 5. Verifying Strict Multi-Tenant Data Isolation ---');
  // User A should see their proxy
  const userAProxies = await userAClient.get('/api/user/proxies');
  assert(userAProxies.data.length >= 1, 'User A should have at least 1 proxy');
  assert(userAProxies.data.some(p => p.id === leaseA.id), 'User A proxies must include newly rented proxy');
  console.log('✅ User A correctly sees their own provisioned proxy.');

  // User B MUST STILL SEE 0 PROXIES!
  const userBProxiesAfter = await userBClient.get('/api/user/proxies');
  assert.strictEqual(userBProxiesAfter.data.length, 0, 'User B must still see 0 proxies!');
  console.log('✅ User B strictly isolated: continues to receive [] with status 200.');

  console.log('\n--- 6. Security Audit: ID Guessing Protection ---');
  // User B tries to fetch User A's proxy details via /api/proxy/:id
  try {
    await userBClient.get(`/api/proxy/${leaseA.id}`);
    assert.fail('User B should not be able to access User A proxy via /api/proxy/:id');
  } catch (err) {
    assert.strictEqual(err.response.status, 404, 'Must return 404 for unauthorized proxy access');
    console.log(`✅ User B querying User A proxy ID (${leaseA.id}) received 404 unauthorized.`);
  }

  // User B tries to fetch via /api/proxies/:id
  try {
    await userBClient.get(`/api/proxies/${leaseA.id}`);
    assert.fail('User B should not be able to access User A proxy via /api/proxies/:id');
  } catch (err) {
    assert.strictEqual(err.response.status, 404, 'Must return 404 for unauthorized proxy access');
    console.log(`✅ User B querying /api/proxies/${leaseA.id} received 404 unauthorized.`);
  }

  // User B tries to download User A's proxy credentials via /api/proxy/download/:leaseId
  try {
    await userBClient.get(`/api/proxy/download/${leaseA.id}`);
    assert.fail('User B should not be able to download User A proxy configuration');
  } catch (err) {
    assert.strictEqual(err.response.status, 404, 'Must return 404 for unauthorized download');
    console.log(`✅ User B downloading User A proxy config received 404 unauthorized.`);
  }

  // User B tries to request replacement for User A's proxy
  try {
    await userBClient.post(`/api/proxy/replace/${leaseA.id}`, { reason: 'NOT_WORK' });
    assert.fail('User B should not be able to trigger replacement on User A proxy');
  } catch (err) {
    assert.strictEqual(err.response.status, 404, 'Must return 404 for unauthorized replacement');
    console.log(`✅ User B attempting replacement on User A proxy received 404 unauthorized.`);
  }

  // User A CAN access their own proxy details
  const ownerDetails = await userAClient.get(`/api/proxy/${leaseA.id}`);
  assert.strictEqual(ownerDetails.status, 200);
  assert.strictEqual(ownerDetails.data.id, leaseA.id);
  assert.strictEqual(ownerDetails.data.user_id, userAId);
  console.log(`✅ Owner (User A) successfully fetched their own proxy details.`);

  console.log('\n--- 7. Dual-Buyer Test: User B Also Buys a Proxy ---');
  // Login as User B to activate demo balance in simulation mode
  const loginB = await userBClient.post('/api/auth/login', { email: emailB, password: 'Password123!' });
  assert.strictEqual(loginB.status, 200);
  const buyResB = await userBClient.post('/api/proxy/rent', { country: 'US' });
  assert.strictEqual(buyResB.status, 201);
  const leaseB = buyResB.data.lease;
  console.log(`✅ User B bought their own proxy (id: ${leaseB.id}, IP: ${leaseB.ip_address}, owner: ${leaseB.user_id})`);

  // Verify User A and User B received completely different proxies & credentials
  assert.notStrictEqual(leaseA.id, leaseB.id, 'Proxy IDs must be completely unique');
  assert.notStrictEqual(leaseA.ip_address, leaseB.ip_address, 'IP addresses must be completely different');
  assert.notStrictEqual(leaseA.socks5_user, leaseB.socks5_user, 'SOCKS5 usernames must be completely unique');
  assert.notStrictEqual(leaseA.socks5_pass, leaseB.socks5_pass, 'SOCKS5 passwords must be completely unique');
  console.log('✅ Verified: User A and User B received completely DIFFERENT IP addresses, ports, logins, and passwords.');

  // Verify User A ONLY sees User A's proxy
  const userAProxiesFinal = await userAClient.get('/api/user/proxies');
  assert(userAProxiesFinal.data.some(p => p.id === leaseA.id), 'User A must see Proxy A');
  assert(!userAProxiesFinal.data.some(p => p.id === leaseB.id), 'User A MUST NEVER see Proxy B');
  console.log('✅ Verified: User A dashboard ONLY displays User A proxy (zero trace of User B proxy).');

  // Verify User B ONLY sees User B's proxy
  const userBProxiesFinal = await userBClient.get('/api/user/proxies');
  assert(userBProxiesFinal.data.some(p => p.id === leaseB.id), 'User B must see Proxy B');
  assert(!userBProxiesFinal.data.some(p => p.id === leaseA.id), 'User B MUST NEVER see Proxy A');
  console.log('✅ Verified: User B dashboard ONLY displays User B proxy (zero trace of User A proxy).');

  // Cross-tenant ID guessing protection
  try {
    await userAClient.get(`/api/proxy/${leaseB.id}`);
    assert.fail('User A should not access User B proxy details');
  } catch (err) {
    assert.strictEqual(err.response.status, 404);
    console.log('✅ User A attempting to inspect User B proxy received 404 unauthorized.');
  }

  try {
    await userBClient.get(`/api/proxy/${leaseA.id}`);
    assert.fail('User B should not access User A proxy details');
  } catch (err) {
    assert.strictEqual(err.response.status, 404);
    console.log('✅ User B attempting to inspect User A proxy received 404 unauthorized.');
  }

  console.log('\n========================================');
  console.log('🎉 ALL DATA-ISOLATION & DUAL-BUYER TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message, err.response ? err.response.data : '');
  process.exit(1);
});
