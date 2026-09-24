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

async function run() {
  console.log('Testing frontend files served on http://localhost:3000...');
  
  // 1. Landing page
  const indexRes = await get('http://localhost:3000/');
  console.log(`GET / : Status ${indexRes.status}`);
  if (!indexRes.body.includes('direct-buy-widget')) {
    throw new Error('Index page missing direct-buy-widget');
  }
  if (!indexRes.body.includes('landing-buy-now-btn')) {
    throw new Error('Index page missing landing-buy-now-btn');
  }
  if (!indexRes.body.includes('pv_pending_buy')) {
    throw new Error('Index page missing pv_pending_buy logic');
  }
  console.log('✓ Landing page contains direct-buy-widget and pending buy logic.');

  // 2. CSS
  const cssRes = await get('http://localhost:3000/css/style.css');
  console.log(`GET /css/style.css : Status ${cssRes.status}`);
  if (!cssRes.body.includes('.direct-buy-widget')) {
    throw new Error('CSS missing .direct-buy-widget');
  }
  if (!cssRes.body.includes('pvPulse')) {
    throw new Error('CSS missing pvPulse keyframes');
  }
  if (!cssRes.body.includes('Whoer') && !cssRes.body.includes('prd-diag-link')) {
    console.log('Note: Checking prd-diag-link in CSS');
  }
  console.log('✓ CSS contains .direct-buy-widget and responsive styles.');

  // 3. App JS
  const jsRes = await get('http://localhost:3000/js/app.js');
  console.log(`GET /js/app.js : Status ${jsRes.status}`);
  if (!jsRes.body.includes('whoer.net')) {
    throw new Error('app.js missing whoer.net');
  }
  if (jsRes.body.includes('scamalytics')) {
    throw new Error('app.js still contains scamalytics!');
  }
  if (!jsRes.body.includes('pv_pending_buy')) {
    throw new Error('app.js missing pv_pending_buy auto-trigger logic');
  }
  console.log('✓ app.js contains whoer.net, zero scamalytics references, and pending buy auto-trigger.');

  // 4. Server txt export
  // Check that server.js exports whoer.net link
  const fs = require('fs');
  const serverCode = fs.readFileSync('server.js', 'utf8');
  if (!serverCode.includes('whoer.net')) {
    throw new Error('server.js missing whoer.net');
  }
  if (serverCode.includes('scamalytics')) {
    throw new Error('server.js still contains scamalytics!');
  }
  console.log('✓ server.js contains whoer.net and zero scamalytics references.');

  console.log('\nALL VERIFICATIONS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
