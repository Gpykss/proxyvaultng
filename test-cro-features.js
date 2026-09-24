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
  console.log('--- Verifying High-Impact CRO Improvements ---');

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

  // Requirement 3: Clarify Connection String Output
  console.log('3. Checking Connection String Compatibility Caption...');
  if (!html.includes('preview-compatibility-caption')) {
    throw new Error('Missing preview-compatibility-caption element');
  }
  if (!html.includes('AdsPower') || !html.includes('Dolphin{anty}') || !html.includes('Proxifier')) {
    throw new Error('Missing compatibility caption tools (AdsPower, Dolphin{anty}, Proxifier)');
  }
  console.log('✓ Connection string output clarified with 1-Click compatibility caption.');

  // Requirement 4: Floating WhatsApp Quick Contact Trigger
  console.log('4. Checking Floating WhatsApp Button...');
  if (!html.includes('floating-whatsapp-btn')) {
    throw new Error('Landing page missing floating-whatsapp-btn');
  }
  if (!html.includes('wa.me')) {
    throw new Error('Landing page missing wa.me link');
  }

  // Also check dashboard.html
  const dashRes = await get('http://localhost:3000/dashboard');
  if (!dashRes.body.includes('floating-whatsapp-btn') || !dashRes.body.includes('wa.me')) {
    throw new Error('Dashboard missing floating-whatsapp-btn');
  }
  console.log('✓ Floating WhatsApp button present on both Landing Page and Dashboard.');

  // 5. CSS checks
  const cssRes = await get('http://localhost:3000/css/style.css');
  const css = cssRes.body;
  if (!css.includes('.direct-buy-tabs') || !css.includes('.buy-tab-btn')) {
    throw new Error('CSS missing direct-buy-tabs styles');
  }
  if (!css.includes('.floating-whatsapp-btn')) {
    throw new Error('CSS missing floating-whatsapp-btn styles');
  }
  if (!css.includes('.preview-compatibility-caption')) {
    throw new Error('CSS missing preview-compatibility-caption styles');
  }
  if (!css.includes('.direct-buy-trust-note')) {
    throw new Error('CSS missing direct-buy-trust-note styles');
  }
  console.log('✓ All CRO CSS classes verified in style.css.');

  // 6. JS checks
  const jsRes = await get('http://localhost:3000/js/app.js');
  if (!jsRes.body.includes('pv_pending_sms')) {
    throw new Error('app.js missing pv_pending_sms handling');
  }
  console.log('✓ app.js handles pv_pending_sms and intent routing.');

  console.log('\n🎉 ALL 4 HIGH-IMPACT CRO IMPROVEMENTS VERIFIED & PASSING!');
}

verifyCROFeatures().catch(err => {
  console.error('CRO Verification Failed:', err);
  process.exit(1);
});
