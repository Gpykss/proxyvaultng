const { Resend } = require('resend');

let resend = null;
const apiKey = process.env.RESEND_API_KEY;

if (apiKey && apiKey !== 're_123456789_your_actual_key') {
  try {
    resend = new Resend(apiKey);
    console.log('Resend email service initialized successfully.');
  } catch (err) {
    console.error('Resend initialization failed:', err.message);
  }
} else {
  console.log('Resend API key is missing or set to placeholder. Email notifications will operate in simulation mode (logging to console).');
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

/**
 * Send Low Balance Notification (Amount in Naira)
 */
async function sendLowBalanceEmail(toEmail, username, balanceNgn) {
  try {
    if (!resend) {
      console.log(`[SIMULATION EMAIL SENT]
To: ${toEmail}
Subject: ⚠️ ProxyVault: Low Wallet Balance Alert
Body: Hi ${username}, your wallet balance is ₦${balanceNgn.toFixed(2)} (Below ₦1,000 threshold).`);
      return { success: true, simulation: true };
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: '⚠️ ProxyVault: Low Wallet Balance Alert',
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 8px;">
          <h2 style="color: #06b6d4;">Low Balance Warning</h2>
          <p>Hi <strong>${username}</strong>,</p>
          <p>Your current wallet balance is <strong>₦${balanceNgn.toFixed(2)}</strong>, which is below the minimum operational threshold of ₦1,000.00.</p>
          <p>Please top up your account to prevent service disruption to your active proxies or SMS routes.</p>
          <a href="https://proxyvaultng.vercel.app/dashboard.html" style="display: inline-block; background-color: #06b6d4; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Top Up Wallet</a>
        </div>
      `,
    });

    if (error) throw new Error(error.message);
    return { success: true, data };
  } catch (err) {
    console.error(`[Resend Error] Failed to send email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Transaction / Top-up Confirmation (Amount in Naira)
 */
async function sendDepositReceiptEmail(toEmail, username, amountNgn, txRef) {
  try {
    if (!resend) {
      console.log(`[SIMULATION EMAIL SENT]
To: ${toEmail}
Subject: ✅ ProxyVault: Deposit Successful
Body: Hi ${username}, your wallet has been credited with ₦${amountNgn.toFixed(2)} (Ref: ${txRef}).`);
      return { success: true, simulation: true };
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: '✅ ProxyVault: Deposit Successful',
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 8px;">
          <h2 style="color: #22c55e;">Deposit Confirmed</h2>
          <p>Hi <strong>${username}</strong>,</p>
          <p>We've successfully credited <strong>₦${amountNgn.toFixed(2)}</strong> to your ProxyVault account balance.</p>
          <p><strong>Transaction Ref:</strong> ${txRef}</p>
          <p>Thank you for using ProxyVault!</p>
        </div>
      `,
    });

    if (error) throw new Error(error.message);
    return { success: true, data };
  } catch (err) {
    console.error(`[Resend Error] Failed to send receipt to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send Welcome Email on registration (Amount in Naira)
 */
async function sendWelcomeEmail(toEmail, username) {
  try {
    if (!resend) {
      console.log(`[SIMULATION EMAIL SENT]
To: ${toEmail}
Subject: Welcome to ProxyVault 🇳🇬
Body: Hi ${username}, welcome to ProxyVault! Your registration is complete.`);
      return { success: true, simulation: true };
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: 'Welcome to ProxyVault 🇳🇬',
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 8px;">
          <h2 style="color: #06b6d4;">Welcome to ProxyVault!</h2>
          <p>Hi <strong>${username}</strong>,</p>
          <p>We are excited to have you on board! ProxyVault is Nigeria's premier portal for dedicated clean static residential proxies and instant global virtual SMS OTP allocations.</p>
          <h3>Getting Started is Simple:</h3>
          <ul style="line-height: 1.6;">
            <li><strong>Fund Your Wallet</strong>: Top up using Naira bank transfer, card, or USSD instantly.</li>
            <li><strong>Rent Static IPs</strong>: Select from static resident carrier IPs (Comcast, Verizon, Rogers, BT, etc.) that last 30 days.</li>
            <li><strong>SMS OTP Verification</strong>: Select dynamic country and service options to verify WhatsApp, Telegram, ChatGPT, etc.</li>
          </ul>
          <a href="https://proxyvaultng.vercel.app/dashboard.html" style="display: inline-block; background-color: #06b6d4; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Go to Dashboard</a>
        </div>
      `,
    });

    if (error) throw new Error(error.message);
    return { success: true, data };
  } catch (err) {
    console.error(`[Resend Error] Failed to send welcome email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendLowBalanceEmail,
  sendDepositReceiptEmail,
  sendWelcomeEmail,
};
