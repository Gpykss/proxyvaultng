const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function verifyCROFeatures() {
  console.log('--- Verifying Streamlined Landing Page & CRO Features ---');

  // 1. Landing Page HTML checks
  const landingRes = await get('http://localhost:3000/');
  const html = landingRes.body;

  // Requirement 1: Instant Naira / Bank Transfer Trust Badges
  console.log('1. Checking Naira & Bank Transfer Trust Badge...');
  if (!html.includes('Instant Bank Transfer') || !html.includes('OPay') || !html.includes('Automated Provisioning')) {
    throw new Error('Missing Naira / Bank Transfer / OPay trust badge micro-copy');
  }
  console.log('✓ Found trust badge micro-copy: "Pay via Instant Bank Transfer, OPay, or Card • Automated Provisioning"');

  // Requirement 2: Dual-Tab Interactive Widget (Static ISP vs SMS OTP)
  console.log('2. Checking Dual-Tab Interactive Widget...');
  if (!html.includes('id="tab-btn-proxy"') || !html.includes('id="tab-btn-sms"')) {
    throw new Error('Missing tab buttons for Proxy vs SMS');
  }
  if (!html.includes('Static ISP Proxy') || !html.includes('Instant SMS Verification')) {
    throw new Error('Tab labels missing Static ISP Proxy or Instant SMS Verification');
  }
  if (!html.includes('From ₦600')) {
    throw new Error('Missing "From ₦600" tab pill indicator');
  }
  if (!html.includes('id="landing-sms-service"') || !html.includes('id="landing-sms-country"')) {
    throw new Error('Missing SMS interactive dropdowns for platform and country');
  }
  if (!html.includes('landing-preview-sms-num') || !html.includes('landing-sms-code-display')) {
    throw new Error('Missing live simulated SMS preview elements');
  }
  if (!html.includes('Auto-Refund Guarantee')) {
    throw new Error('Missing SMS auto-refund guarantee reassurance');
  }
  if (!html.includes('pv_pending_sms')) {
    throw new Error('Missing pv_pending_sms intent logic');
  }
  console.log('✓ Dual-tab widget complete with live SMS preview, OTP simulation, and auto-refund guarantee.');

  // Check that the connection string preview box is removed from landing page as requested
  console.log('3. Verifying Connection String Output box is removed from landing page...');
  if (html.includes('landing-preview-conn') || html.includes('socks5://pv_isp_user:sec_auth@69.181.42.10:1080')) {
    throw new Error('Landing page still contains connection string output box!');
  }
  console.log('✓ Connection string output box cleanly removed from landing page.');

  // Check that the floating WhatsApp link is removed from landing page as requested
  console.log('4. Verifying Floating WhatsApp link is removed from landing page...');
  if (html.includes('floating-whatsapp-btn')) {
    throw new Error('Landing page still contains floating-whatsapp-btn!');
  }
  if (!html.includes('floating-support-btn')) {
    throw new Error('Landing page missing single Telegram support button');
  }
  console.log('✓ Floating WhatsApp link removed, keeping clean single support trigger.');

  // 5. CSS checks
  const cssRes = await get('http://localhost:3000/css/style.css');
  const css = cssRes.body;
  if (!css.includes('.direct-buy-tabs') || !css.includes('.buy-tab-btn')) {
    throw new Error('CSS missing direct-buy-tabs styles');
  }
  if (!css.includes('.direct-buy-trust-note')) {
    throw new Error('CSS missing direct-buy-trust-note styles');
  }
  console.log('✓ All active CRO CSS classes verified in style.css.');

  // 6. JS checks
  const jsRes = await get('http://localhost:3000/js/app.js');
  if (!jsRes.body.includes('pv_pending_sms')) {
    throw new Error('app.js missing pv_pending_sms handling');
  }
  console.log('✓ app.js handles pv_pending_sms and intent routing.');

  console.log('\n🎉 ALL VERIFICATIONS PASSED SUCCESSFULLY!');
}

verifyCROFeatures().catch(err => {
  console.error('Verification Failed:', err);
  process.exit(1);
});
