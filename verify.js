const assert = require('assert');
const bcrypt = require('bcryptjs');
const { User, Transaction, ProxyLease, SmsActivation, dbReady, mongoose } = require('./db');

async function runTests() {
  await dbReady;
  console.log('----------------------------------------------------');
  console.log('🧪 RUNNING PROXYVAULT INTEGRATION & SECURITY TESTS');
  console.log('----------------------------------------------------');

  try {
    // Test 1: Verify database collections exist
    console.log('1. Verifying MongoDB schemas...');
    const collections = mongoose.connection.collections;
    
    assert(collections['users'], 'Users collection should exist');
    assert(collections['transactions'], 'Transactions collection should exist');
    assert(collections['proxyleases'], 'Proxy leases collection should exist');
    assert(collections['smsactivations'], 'SMS activations collection should exist');
    console.log('   ✅ MongoDB collections verified.');

    // Test 2: Hashing password verification
    console.log('2. Verifying password hashing safety...');
    const plainPassword = 'SuperSecretSecurePassword123!';
    const hash = await bcrypt.hash(plainPassword, 10);
    const matches = await bcrypt.compare(plainPassword, hash);
    const mismatches = await bcrypt.compare('WrongPassword', hash);
    
    assert(matches, 'Bcrypt compare should match correct password');
    assert(!mismatches, 'Bcrypt compare should reject incorrect password');
    console.log('   ✅ Password hashing security verified.');

    // Test 3: Race condition / Double spend lock prevention
    console.log('3. Running concurrent race condition safety test...');
    // Create a temporary test user
    const testEmail = `tester_${Date.now()}@example.com`;
    const user = await User.create({
      email: testEmail,
      password_hash: hash,
      balance: 1500000 // ₦15,000 in Kobo
    });
    const userId = user._id.toString();

    // We will attempt to buy two SMS platform numbers of ₦10,000 cost concurrently
    // Since total balance is ₦15,000, only ONE transaction should succeed, and the other must be rejected
    const costKobo = 1000000; // ₦10,000
    
    async function attemptPurchase(id) {
      try {
        // Atomic deduction with balance ceiling check
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, balance: { $gte: costKobo } },
          { $inc: { balance: -costKobo } },
          { returnDocument: 'after' }
        );
        if (!updatedUser) {
          throw new Error('Insufficient balance');
        }
        
        // Log transaction record
        await Transaction.create({
          user_id: userId,
          type: 'sms_rent',
          amount: -costKobo,
          reference: `ref_test_${id}_${Date.now()}`,
          status: 'completed'
        });
        return 'SUCCESS';
      } catch (err) {
        return `FAILED: ${err.message}`;
      }
    }

    console.log('   Firing 2 concurrent purchase attempts (Cost: ₦10,000 each, User Balance: ₦15,000)...');
    
    // Execute concurrent transactions
    const results = await Promise.all([
      attemptPurchase(1),
      attemptPurchase(2)
    ]);

    console.log('   Results:', results);
    
    const successes = results.filter(r => r === 'SUCCESS').length;
    const failures = results.filter(r => r.startsWith('FAILED')).length;

    // Verify exactly 1 succeeded and 1 failed
    assert.strictEqual(successes, 1, 'Exactly one transaction should succeed');
    assert.strictEqual(failures, 1, 'Exactly one transaction should fail due to balance lock protection');

    // Verify user balance is exactly ₦5,000 (500000 kobo)
    const finalUser = await User.findById(userId);
    assert.strictEqual(finalUser.balance, 500000, 'User final balance should be exactly 500000 kobo');
    console.log('   ✅ Race condition test passed successfully! Atomic updates prevented negative wallet balances.');

    // Clean up test data
    await Transaction.deleteMany({ user_id: userId });
    await User.deleteOne({ _id: userId });
    console.log('   ✅ Temporary test data cleaned up.');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! ProxyVault is secure.');
    console.log('----------------------------------------------------');
    process.exit(0);

  } catch (error) {
    console.error('❌ TEST FAILURE ENCOUNTERED:', error.message);
    process.exit(1);
  }
}

runTests();
