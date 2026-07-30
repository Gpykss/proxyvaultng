const mongoose = require('mongoose');

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/proxyvault';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false
    };
    cached.promise = mongoose.connect(mongoUri, opts).then((m) => {
      console.log('MongoDB initialized successfully.');
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

const dbReady = connectDB();

// 1. User Schema definition
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
  balance: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

// 2. Transaction Schema definition
const TransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true, enum: ['deposit', 'proxy_rent', 'sms_rent', 'sms_refund'] },
  amount: { type: Number, required: true }, // represented in kobo
  reference: { type: String, unique: true, required: true },
  status: { type: String, required: true, enum: ['pending', 'completed', 'failed'] },
  created_at: { type: Date, default: Date.now }
});

// 3. Proxy Lease Schema definition
const ProxyLeaseSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ip_address: { type: String, required: true },
  socks5_port: { type: Number, required: true },
  socks5_user: { type: String, required: true },
  socks5_pass: { type: String, required: true },
  wireguard_conf: { type: String, required: true },
  country: { type: String, required: true },
  carrier: { type: String, default: 'Broadband Residential' },
  expires_at: { type: Date, required: true },
  status: { type: String, required: true, enum: ['active', 'expired'] },
  created_at: { type: Date, default: Date.now }
});

// 4. SMS Activation Schema definition
const SmsActivationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone_number: { type: String, required: true },
  service: { type: String, required: true }, // e.g. 'telegram', 'whatsapp'
  country: { type: String, default: 'usa' },
  operator: { type: String, default: 'any' },
  cost: { type: Number, required: true },
  otp_code: { type: String, default: null },
  sms_text: { type: String, default: null },
  sms_api_id: { type: String, default: null },
  status: { type: String, required: true, enum: ['waiting', 'received', 'expired', 'cancelled'] },
  expires_at: { type: Date, required: true },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const ProxyLease = mongoose.model('ProxyLease', ProxyLeaseSchema);
const SmsActivation = mongoose.model('SmsActivation', SmsActivationSchema);

module.exports = {
  connectDB,
  dbReady,
  User,
  Transaction,
  ProxyLease,
  SmsActivation,
  mongoose
};
