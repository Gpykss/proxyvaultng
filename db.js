const mongoose = require('mongoose');

let mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/proxyvault';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

let mongodInstance = null;

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = (async () => {
      const opts = {
        bufferCommands: false,
        serverSelectionTimeoutMS: 3000
      };

      try {
        const m = await mongoose.connect(mongoUri, opts);
        console.log('MongoDB initialized successfully.');
        return m;
      } catch (err) {
        // Fallback for local preview if local MongoDB daemon is not running
        if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') {
          try {
            console.log('Local MongoDB not detected. Starting in-memory MongoDB for local preview...');
            const { MongoMemoryServer } = require('mongodb-memory-server');
            mongodInstance = await MongoMemoryServer.create();
            const memoryUri = mongodInstance.getUri();
            const m = await mongoose.connect(memoryUri, { bufferCommands: false });
            console.log('In-memory MongoDB initialized successfully for local preview.');
            return m;
          } catch (memErr) {
            console.error('Failed to initialize in-memory MongoDB:', memErr.message);
            throw err;
          }
        }
        throw err;
      }
    })();
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}



// 1. User Schema definition
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
  balance: { type: Number, default: 0 },
  lowBalanceAlertSent: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

// 2. Transaction Schema definition
const TransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true, enum: ['deposit', 'proxy_rent', 'sms_rent', 'sms_refund', 'proxy_refund'] },
  amount: { type: Number, required: true }, // represented in kobo
  reference: { type: String, unique: true, required: true },
  status: { type: String, required: true, enum: ['pending', 'completed', 'failed'] },
  created_at: { type: Date, default: Date.now }
});

// 3. Proxy Lease Schema definition
const ProxyLeaseSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order_id: { type: String, default: null },
  upstream_provider: { type: String, default: 'proxy_seller' },
  upstream_order_id: { type: String, default: null },
  upstream_proxy_id: { type: String, default: null },
  ip_address: { type: String, default: 'Allocating...' },
  protocol: { type: String, default: 'socks5' },
  http_port: { type: Number, default: null },
  socks5_port: { type: Number, default: 0 },
  socks5_user: { type: String, default: 'Allocating...' },
  socks5_pass: { type: String, default: 'Allocating...' },
  wireguard_conf: { type: String, default: '' },
  country: { type: String, required: true },
  carrier: { type: String, default: 'Broadband Residential' },
  isp_carrier: { type: String, default: 'Verizon/Comcast (ISP Residential)' },
  fraud_score: { type: Number, default: 0 },
  replacement_count: { type: Number, default: 0 },
  expires_at: { type: Date, required: true },
  status: { type: String, required: true, enum: ['active', 'expired', 'provisioning', 'pending'], default: 'active' },
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

// 5. Telegram Ticket Mapping Schema (for support relay bot)
const TelegramTicketMappingSchema = new mongoose.Schema({
  admin_message_id: { type: Number, required: true, unique: true },
  user_telegram_id: { type: Number, required: true },
  created_at: { type: Date, default: Date.now, expires: 172800 } // automatically delete old ticket mappings after 2 days
});

// 6. Telegram Support Session Schema (tracks active session states & timeouts)
const TelegramSupportSessionSchema = new mongoose.Schema({
  user_telegram_id: { type: Number, required: true, unique: true },
  last_admin_message_id: { type: Number, required: true },
  last_activity: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const ProxyLease = mongoose.model('ProxyLease', ProxyLeaseSchema);
const SmsActivation = mongoose.model('SmsActivation', SmsActivationSchema);
const TelegramTicketMapping = mongoose.model('TelegramTicketMapping', TelegramTicketMappingSchema);
const TelegramSupportSession = mongoose.model('TelegramSupportSession', TelegramSupportSessionSchema);

module.exports = {
  connectDB,
  get dbReady() {
    return connectDB();
  },
  User,
  Transaction,
  ProxyLease,
  SmsActivation,
  TelegramTicketMapping,
  TelegramSupportSession,
  mongoose
};


