# ProxyVault 🇳🇬

> **Premium Dedicated Static Residential SOCKS5 Proxies & Global Virtual SMS OTP Platform tailored for Nigerian Professionals.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Web](https://img.shields.io/badge/platform-Web-darkblue.svg)]()

---

## 🌟 Overview

**ProxyVault** is a full-stack platform engineered specifically for developers, growth teams, and remote professionals in Nigeria. It bridges the gap between global digital infrastructure and local payment methods, enabling instant funding in Nigerian Naira (NGN) to rent dedicated residential IPs and receive instant virtual SMS verification codes.

### Key Capabilities:
- 🌐 **Static Residential IPs**: Rent clean, dedicated SOCKS5 proxies (Comcast, Verizon, AT&T, BT, Rogers) that remain fixed for 30-day lease windows.
- 📱 **Virtual SMS OTP Activations**: Instantly generate virtual numbers across 50+ countries to receive one-time passcodes (Telegram, WhatsApp, ChatGPT, Google, TikTok, etc.).
- 💳 **Naira-First Direct Wallet Funding**: Seamless NGN deposits using debit/credit cards, direct bank transfer, and USSD via the **Korapay** gateway.
- 💱 **Smart Dynamic FX Engine**: Real-time USD/NGN exchange rate integration with an automated volatility buffer (`+₦40`) and custom black market rate override support.
- 💬 **Live Telegram Support Bot**: Interactive customer support ticketing connected directly to admin Telegram channels.
- 📧 **Transactional Emails**: Automated transaction and lease receipt notifications powered by **Resend**.
- 🛡️ **Atomic Wallet Operations**: High-concurrency database architecture with atomic balance checks to prevent overdrafts or double-spending.

---

## 🛠️ Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/) (ES6+)
- **Backend Framework**: [Express.js](https://expressjs.com/)
- **Database & ODM**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/)
- **Frontend / UI**: Semantic HTML5, Vanilla CSS3 (Custom Dark Navy Theme, Glassmorphism, Responsive Grid/Flexbox), Vanilla JavaScript (No heavy frameworks required)
- **Payment Gateway**: [Korapay API](https://korapay.com/)
- **Upstream Providers**:
  - Proxy Infrastructure: **CyberYozh API**
  - SMS & Virtual Numbers: **5SIM API**
- **Communications**: [Resend](https://resend.com/) (Email), Telegram Bot API (Live Chat)

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **MongoDB**: A running local instance or MongoDB Atlas connection string.

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/Gpykss/proxyvaultng.git
cd proxyvaultng
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory by copying `.env.example`:

```bash
cp .env.example .env
```

Configure your environment variables:

```env
# System Configuration
PORT=3000
SESSION_SECRET=your_super_secret_session_key
CLIENT_URL=http://localhost:3000

# Sandbox / Simulation Mode
# Set to 'false' for live vendor production APIs, or 'true' for offline sandbox testing.
SIMULATION_MODE=false

# Korapay Gateway
KORAPAY_SECRET_KEY=your_korapay_secret_key
KORAPAY_PUBLIC_KEY=your_korapay_public_key

# Proxy Vendor (CyberYozh)
CYBERYOZH_API_KEY=your_cyberyozh_api_key

# SMS Vendor (5SIM)
SMS_5SIM_API_KEY=your_5sim_api_key

# Database Connection
MONGO_URI=mongodb://127.0.0.1:27017/proxyvault

# Telegram Support Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_ADMIN_CHAT_ID=-1000000000000

# Resend Email Configuration
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=notifications@yourdomain.com

# Exchange Rate & Black Market FX Settings (Optional)
# Set a fixed base rate (e.g. 1550 or 1600). If omitted, automatically fetches live rates.
USD_NGN_EXCHANGE_RATE=
# Volatility / margin added on top of base exchange rate in Naira (default: 40)
FX_MARKUP_NAIRA=40
```

### 4. Run the Application

#### Production Mode:
```bash
npm start
```
*(or `node server.js` / `npm.cmd start` on Windows)*

#### Development Mode (with Nodemon):
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

---

## 📐 Exchange Rate & Pricing Architecture

ProxyVault converts upstream USD wholesale costs into local Naira pricing dynamically:

$$\text{Effective FX Rate} = (\text{Live Market Rate or .env Override}) + \text{FX\_MARKUP\_NAIRA}$$

$$\text{Retail Price (NGN)} = \lceil (\text{Wholesale USD} \times 2) \times \text{Effective FX Rate} \rceil$$

- **Automatic Caching**: Rates are cached in-memory for 30 minutes to reduce external API requests.
- **Fail-safe Fallback**: In the event of network timeouts, the system safely falls back to `₦1,600/USD` + markup.
- **Manual Control**: Developers can lock in custom black market rates using `USD_NGN_EXCHANGE_RATE` in `.env`.

---

## 📂 Project Structure

```text
├── public/
│   ├── css/
│   │   └── style.css            # Dark Navy Design System & responsive layouts
│   ├── js/
│   │   └── app.js              # Client-side state, tab routing, and API integrations
│   ├── index.html              # Modern, responsive landing page
│   ├── dashboard.html          # Unified customer dashboard & order management
│   └── favicon.ico
├── services/
│   ├── proxyService.js         # CyberYozh API client & proxy lease provisioning
│   ├── smsService.js           # 5SIM API client & OTP polling engine
│   ├── emailService.js         # Resend transactional email handler
│   └── balanceNotifier.js      # Low-balance automated notifications
├── db.js                       # Mongoose schemas (User, Transaction, Lease, SMS)
├── server.js                   # Express server, authentication, APIs & webhook endpoints
├── .env.example                # Template for environment configuration
├── package.json
└── README.md
```

---

## 🔒 Security & Concurrency

- **Session Security**: Cookie sessions with `HttpOnly`, `SameSite=Lax`, and secret hashing.
- **Atomic Operations**: Balance transactions utilize MongoDB's atomic `{ $inc: { balance: -cost } }` with `{ balance: { $gte: cost } }` conditional queries, guaranteeing protection against race conditions and double-spending.
- **Password Protection**: Salting and hashing via `bcryptjs`.
- **Webhook Signature Verification**: Korapay webhook payload validation against HMAC SHA256 hashes.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
