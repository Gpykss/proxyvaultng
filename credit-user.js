// ProxyVault 🇳🇬 - Wallet Balance CLI Helper
// Usage: node credit-user.js <email> <amountInNaira>
// Example: node credit-user.js realgpyks@gmail.com 50000

require('dotenv').config();
const mongoose = require('mongoose');
const { User, Transaction, connectDB } = require('./db');
const crypto = require('crypto');

async function credit() {
  const args = process.argv.slice(2);
  const email = args[0] || 'realgpyks@gmail.com';
  const amountNaira = parseFloat(args[1] || '50000');

  if (isNaN(amountNaira) || amountNaira <= 0) {
    console.error('❌ Please provide a valid positive amount in Naira.');
    console.log('Usage: node credit-user.js <email> <amountInNaira>');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error(`❌ User with email "${email}" not found in database.`);
    const allUsers = await User.find({}, { email: 1 });
    console.log('Available users:', allUsers.map(u => u.email));
    await mongoose.disconnect();
    process.exit(1);
  }

  const amountKobo = Math.round(amountNaira * 100);
  const previousBalanceKobo = user.balance || 0;
  const newBalanceKobo = previousBalanceKobo + amountKobo;

  user.balance = newBalanceKobo;
  user.lowBalanceAlertSent = false;
  await user.save();

  // Record a completed transaction record so it appears in transaction history
  const reference = `pv_manual_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await Transaction.create({
    user_id: user._id,
    type: 'deposit',
    amount: amountKobo,
    reference,
    status: 'completed'
  });

  console.log('\n========================================');
  console.log('✅ WALLET CREDITED SUCCESSFULLY');
  console.log('========================================');
  console.log(`👤 User:             ${user.email}`);
  console.log(`🆔 User ID:          ${user._id}`);
  console.log(`💵 Added Amount:     ₦${amountNaira.toLocaleString()}`);
  console.log(`📈 Previous Balance: ₦${(previousBalanceKobo / 100).toLocaleString()}`);
  console.log(`💰 New Balance:      ₦${(newBalanceKobo / 100).toLocaleString()} (${newBalanceKobo} kobo in DB)`);
  console.log('========================================\n');
  console.log('👉 Refresh your browser (Ctrl+R or F5) on http://localhost:3000 to see your new balance!\n');

  await mongoose.disconnect();
}

credit().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
