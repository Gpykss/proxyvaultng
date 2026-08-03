// Automatically include credentials (session cookies) on all fetch requests
const originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
  options.credentials = 'include';
  return originalFetch(url, options);
};

// ProxyVault Dashboard Core Logic
let currentUser = null;
let activePollIntervals = {};
let proxyCatalogCountries = [];
let cachedSmsCatalog = null;

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  setupEventListeners();
});

// Initialize dashboard components
async function initDashboard() {
  const authed = await fetchUserProfile();
  if (authed) {
    fetchDynamicSelectors();
    loadActiveProxies();
    loadActiveSMS();
    loadTransactions();

    // Reconcile and navigate back to wallet on successful payment callback redirects
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      // Navigate user tab back to Wallet
      switchDashboardTab('#wallet-card');
      
      // Update UI displays immediately
      fetchUserProfile();
      loadTransactions();

      // Display beautiful toast alert
      showToast('Wallet funded successfully!', 'success');

      // Clean URL params to prevent duplicate messages on manually refreshing page
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    // Poll wallet balance and recent transactions list every 5 seconds for real-time updates
    setInterval(() => {
      fetchUserProfile();
      loadTransactions();
    }, 5000);
  }
}

// Fetch dynamic lists for country and service selectors
async function fetchDynamicSelectors() {
  const countrySelect = document.getElementById('sms-country');
  const serviceSelect = document.getElementById('sms-service');
  const proxySelect = document.getElementById('proxy-country');

  // --- 1. PRE-POPULATE DEFAULTS SYNCHRONOUSLY SO SELECTORS ARE NEVER BLANK ---
  cachedSmsCatalog = {
    services: [
      { id: 'telegram', name: 'Telegram' },
      { id: 'whatsapp', name: 'WhatsApp' },
      { id: 'google', name: 'Google Account' },
      { id: 'chatgpt', name: 'ChatGPT / OpenAI' },
      { id: 'tiktok', name: 'TikTok' }
    ],
    countries: [
      { id: 'usa', name: 'United States 🇺🇸' },
      { id: 'canada', name: 'Canada 🇨🇦' },
      { id: 'england', name: 'United Kingdom 🇬🇧' },
      { id: 'germany', name: 'Germany 🇩🇪' },
      { id: 'nigeria', name: 'Nigeria 🇳🇬' }
    ]
  };

  proxyCatalogCountries = [
    {
      country_name: 'United States',
      country_code: 'US',
      flag: '🇺🇸',
      providers: [
        { id: 'us_comcast', name: 'Comcast Cable (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'us_verizon', name: 'Verizon Business (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'us_spectrum', name: 'Spectrum Broadband (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'United Kingdom',
      country_code: 'GB',
      flag: '🇬🇧',
      providers: [
        { id: 'gb_bt', name: 'BT Broadband (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'gb_virgin', name: 'Virgin Media (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'gb_sky', name: 'Sky Broadband (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'Germany',
      country_code: 'DE',
      flag: '🇩🇪',
      providers: [
        { id: 'de_telekom', name: 'Deutsche Telekom (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'de_vodafone', name: 'Vodafone Germany (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'de_1and1', name: '1&1 Broadband (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'Canada',
      country_code: 'CA',
      flag: '🇨🇦',
      providers: [
        { id: 'ca_rogers', name: 'Rogers Communications (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'ca_bell', name: 'Bell Canada (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 },
        { id: 'ca_telus', name: 'Telus Broadband (ISP Residential)', speed: '150 Mbps', price_ngn: 15000 }
      ]
    }
  ];

  // Render defaults immediately
  renderSmsServices('');
  renderSmsCountries('');
  if (countrySelect) {
    countrySelect.value = 'usa';
  }
  if (proxySelect) {
    renderProxyCountries('');
  }
  updateProxyIspSelector();
  await updateOperatorSelector();

  // --- 2. BIND STATIC LISTENERS ---
  if (countrySelect && serviceSelect) {
    countrySelect.addEventListener('change', updateOperatorSelector);
    serviceSelect.addEventListener('change', updateOperatorSelector);
  }
  if (proxySelect) {
    proxySelect.addEventListener('change', updateProxyIspSelector);
  }

  const countrySearch = document.getElementById('sms-country-search');
  if (countrySearch) {
    countrySearch.addEventListener('input', (e) => {
      renderSmsCountries(e.target.value);
      updateOperatorSelector();
    });
  }

  const serviceSearch = document.getElementById('sms-service-search');
  if (serviceSearch) {
    serviceSearch.addEventListener('input', (e) => {
      renderSmsServices(e.target.value);
      updateOperatorSelector();
    });
  }

  const proxyCountrySearch = document.getElementById('proxy-country-search');
  if (proxyCountrySearch) {
    proxyCountrySearch.addEventListener('input', (e) => {
      renderProxyCountries(e.target.value);
      updateProxyIspSelector();
    });
  }

  // --- 3. FETCH LIVE CATALOG OVERWRITES ASYNCHRONOUSLY ---
  fetch('/api/v1/sms/catalog')
    .then(res => res.ok ? res.json() : Promise.reject('Failed SMS catalog response'))
    .then(async (data) => {
      if (data && data.countries && data.countries.length > 0) {
        cachedSmsCatalog = data;
        renderSmsServices('');
        renderSmsCountries('');
        if (countrySelect && cachedSmsCatalog.countries.some(c => c.id === 'usa')) {
          countrySelect.value = 'usa';
        }
        await updateOperatorSelector();
      }
    })
    .catch(err => {
      console.error('SMS dynamic catalog fetch error:', err);
    });

  fetch('/api/v1/proxies/static-list')
    .then(res => res.ok ? res.json() : Promise.reject('Failed proxy catalog response'))
    .then(data => {
      if (data && data.countries && data.countries.length > 0) {
        proxyCatalogCountries = data.countries;
        if (proxySelect) {
          renderProxyCountries('');
        }
        updateProxyIspSelector();
      }
    })
    .catch(err => {
      console.error('Proxy dynamic catalog fetch error:', err);
    });
}

// Helper to filter and render Proxy countries dropdown based on query string
function renderProxyCountries(filterText = '') {
  const proxySelect = document.getElementById('proxy-country');
  if (!proxySelect || !proxyCatalogCountries) return;

  const currentVal = proxySelect.value;
  proxySelect.innerHTML = '';

  const query = filterText.toLowerCase();
  const filtered = proxyCatalogCountries.filter(c => 
    (c.country_name || '').toLowerCase().includes(query) || (c.country_code || '').toLowerCase().includes(query)
  );

  // Sort popular ones first
  const POPULAR_COUNTRY_CODES = ['US', 'CA', 'DE', 'GB', 'KH', 'PH', 'IN'];
  const sorted = filtered.sort((a, b) => {
    const idxA = POPULAR_COUNTRY_CODES.indexOf(a.country_code.toUpperCase());
    const idxB = POPULAR_COUNTRY_CODES.indexOf(b.country_code.toUpperCase());
    
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    
    return a.country_name.localeCompare(b.country_name);
  });

  sorted.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.country_code;
    const minPrice = c.providers && c.providers.length > 0
      ? Math.min(...c.providers.map(p => p.price_ngn || 15000))
      : 15000;
    opt.textContent = `${c.flag} ${c.country_name} (from ₦${minPrice.toLocaleString()}/mo)`;
    proxySelect.appendChild(opt);
  });

  // Try to preserve selection
  if (currentVal && sorted.some(c => c.country_code === currentVal)) {
    proxySelect.value = currentVal;
  } else if (sorted.length > 0) {
    proxySelect.value = sorted[0].country_code;
  }
}

// Update available proxy ISPs dynamically based on the selected target country
function updateProxyIspSelector() {
  const countrySelect = document.getElementById('proxy-country');
  const ispSelect = document.getElementById('proxy-isp');
  const buyBtn = document.getElementById('buy-proxy-btn');
  if (!countrySelect || !ispSelect || !proxyCatalogCountries) return;

  const selectedCountryCode = countrySelect.value;
  const countryData = proxyCatalogCountries.find(c => c.country_code === selectedCountryCode);

  ispSelect.innerHTML = '';
  
  const updateButtonPrice = () => {
    const selectedOpt = ispSelect.options[ispSelect.selectedIndex];
    const price = selectedOpt ? parseInt(selectedOpt.dataset.price) : 15000;
    if (buyBtn) {
      buyBtn.textContent = `Rent Static IP (₦${price.toLocaleString()}/mo)`;
    }
  };

  if (countryData && countryData.providers && countryData.providers.length > 0) {
    countryData.providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      const priceVal = p.price_ngn !== undefined ? p.price_ngn : 15000;
      opt.textContent = `${p.name} — ₦${priceVal.toLocaleString()}/mo`;
      opt.dataset.price = priceVal;
      ispSelect.appendChild(opt);
    });

    // Clean up previous listener to prevent duplicate bindings
    ispSelect.removeEventListener('change', updateButtonPrice);
    ispSelect.addEventListener('change', updateButtonPrice);
    
    // Set initial button price
    updateButtonPrice();
  } else {
    const opt = document.createElement('option');
    opt.value = 'any';
    opt.textContent = 'Any Residential ISP — ₦15,000/mo';
    ispSelect.appendChild(opt);
    if (buyBtn) {
      buyBtn.textContent = 'Rent Static IP (₦15,000/mo)';
    }
  }
}

// Helper to filter and render SMS countries dropdown based on query string
function renderSmsCountries(filterText = '') {
  const countrySelect = document.getElementById('sms-country');
  if (!countrySelect || !cachedSmsCatalog) return;

  const currentVal = countrySelect.value;
  countrySelect.innerHTML = '';
  
  const query = filterText.toLowerCase();
  const filtered = cachedSmsCatalog.countries.filter(c => 
    (c.name || '').toLowerCase().includes(query) || (c.id || '').toLowerCase().includes(query)
  );

  const POPULAR_SMS_COUNTRIES = ['usa', 'canada', 'germany', 'england', 'unitedkingdom', 'cambodia', 'philippines', 'india'];
  const sorted = filtered.sort((a, b) => {
    const idxA = POPULAR_SMS_COUNTRIES.indexOf(a.id.toLowerCase());
    const idxB = POPULAR_SMS_COUNTRIES.indexOf(b.id.toLowerCase());
    
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    countrySelect.appendChild(opt);
  });

  // Try to preserve current selection
  if (currentVal && sorted.some(c => c.id === currentVal)) {
    countrySelect.value = currentVal;
  } else if (sorted.length > 0) {
    countrySelect.value = sorted[0].id;
  }
}

// Helper to filter and render SMS services dropdown based on query string
function renderSmsServices(filterText = '') {
  const smsSelect = document.getElementById('sms-service');
  if (!smsSelect || !cachedSmsCatalog) return;

  const currentVal = smsSelect.value;
  smsSelect.innerHTML = '';

  const query = filterText.toLowerCase();
  const filtered = cachedSmsCatalog.services.filter(s => 
    (s.name || '').toLowerCase().includes(query) || (s.id || '').toLowerCase().includes(query)
  );

  const POPULAR_SMS_PLATFORMS = ['facebook', 'whatsapp', 'telegram', 'instagram', 'pof', 'google', 'youtube'];
  const sorted = filtered.sort((a, b) => {
    const idxA = POPULAR_SMS_PLATFORMS.indexOf(a.id.toLowerCase());
    const idxB = POPULAR_SMS_PLATFORMS.indexOf(b.id.toLowerCase());
    
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.dataset.price = s.price_ngn || 1500;
    opt.textContent = s.name; // Hide the wholesale/retail NGN cost per request
    smsSelect.appendChild(opt);
  });

  // Try to preserve current selection
  if (currentVal && sorted.some(s => s.id === currentVal)) {
    smsSelect.value = currentVal;
  } else if (sorted.length > 0) {
    smsSelect.value = sorted[0].id;
  }
}

// Fetch available operators and update signal success rate indicator badge
async function updateOperatorSelector() {
  const countrySelect = document.getElementById('sms-country');
  const serviceSelect = document.getElementById('sms-service');
  const operatorSelect = document.getElementById('sms-operator');
  const ratingBadge = document.getElementById('sms-rating-badge');

  if (!countrySelect || !serviceSelect || !operatorSelect) return;

  const country = countrySelect.value;
  const service = serviceSelect.value;

  try {
    const res = await fetch(`/api/v1/sms/operators?country=${country}&service=${service}`);
    if (res.ok) {
      const data = await res.json();
      operatorSelect.innerHTML = '';

      const buySmsBtn = document.getElementById('buy-sms-btn');

      const updateSmsButtonPrice = () => {
        const selectedOpt = operatorSelect.options[operatorSelect.selectedIndex];
        const price = selectedOpt ? parseInt(selectedOpt.dataset.price) : 1500;
        if (buySmsBtn) {
          buySmsBtn.textContent = `Rent Number (₦${price.toLocaleString()})`;
        }
      };

      data.operators.forEach(op => {
        const opt = document.createElement('option');
        opt.value = op.operator_name;
        opt.textContent = `${op.operator_name.toUpperCase()} (Signal: ${op.success_rate}%)`;
        opt.dataset.rating = op.success_rate;
        opt.dataset.price = op.price_ngn;
        operatorSelect.appendChild(opt);
      });

      // Pre-select operator at index [0] (highest success rate due to API sorting!)
      if (data.operators.length > 0) {
        const highest = data.operators[0];
        operatorSelect.value = highest.operator_name;
        if (ratingBadge) {
          ratingBadge.textContent = `📶 Signal Strength: ${highest.success_rate}%`;
        }
      }

      // Bind listener to update success badge and purchase button cost
      operatorSelect.removeEventListener('change', updateSmsButtonPrice);
      operatorSelect.addEventListener('change', updateSmsButtonPrice);
      operatorSelect.addEventListener('change', () => {
        const selectedOpt = operatorSelect.options[operatorSelect.selectedIndex];
        const rating = selectedOpt ? selectedOpt.dataset.rating : '--';
        if (ratingBadge) {
          ratingBadge.textContent = `📶 Signal Strength: ${rating}%`;
        }
      });

      // Set initial button price
      updateSmsButtonPrice();
    }
  } catch (err) {
    console.error('Failed to load carrier operators:', err);
  }
}

// Fetch user profile and update balance
async function fetchUserProfile() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/index.html';
      return false;
    }
    const data = await res.json();
    currentUser = data.user;
    updateBalanceDisplay(currentUser.balance);
    return true;
  } catch (err) {
    console.error('Profile fetch error:', err);
    window.location.href = '/index.html';
    return false;
  }
}

// Helper to convert kobo integer to NGN format
function formatNaira(kobo) {
  return (kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function updateBalanceDisplay(koboBalance) {
  document.getElementById('display-balance').textContent = formatNaira(koboBalance);
}

// ----------------------------------------------------
// EVENT LISTENERS & MODALS
// ----------------------------------------------------

// Sidebar navigation click helpers for tab switching (Global scope)
function switchDashboardTab(targetId) {
  const walletCard = document.getElementById('wallet-card');
  const txCard = document.getElementById('tx-card');
  const proxyCard = document.getElementById('proxy-card');
  const smsCard = document.getElementById('sms-card');
  const guideCard = document.getElementById('guide-card');

  if (walletCard) walletCard.style.display = 'none';
  if (txCard) txCard.style.display = 'none';
  if (proxyCard) proxyCard.style.display = 'none';
  if (smsCard) smsCard.style.display = 'none';
  if (guideCard) guideCard.style.display = 'none';

  if (targetId === '#wallet-card') {
    if (walletCard) walletCard.style.display = 'block';
    if (txCard) txCard.style.display = 'block';
  } else if (targetId === '#proxy-card') {
    if (proxyCard) proxyCard.style.display = 'block';
  } else if (targetId === '#sms-card') {
    if (smsCard) smsCard.style.display = 'block';
  } else if (targetId === '#guide-card') {
    if (guideCard) guideCard.style.display = 'block';
  }

  // Keep mobile tab highlights in sync
  const mobileTabItems = document.querySelectorAll('.mobile-tab-item');
  mobileTabItems.forEach(item => {
    if (item.getAttribute('data-target') === targetId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Keep desktop sidebar highlights in sync
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('href') === targetId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function setupEventListeners() {
  // Logout handler
  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        showToast('Logged out successfully', 'success');
        setTimeout(() => window.location.href = '/index.html', 1000);
      }
    } catch (err) {
      showToast('Logout failed', 'error');
    }
  };

  // Bind logout buttons
  const logoutBtnDk = document.getElementById('logout-btn-desktop');
  const logoutBtnMb = document.getElementById('logout-btn-mobile');
  if (logoutBtnDk) logoutBtnDk.addEventListener('click', handleLogout);
  if (logoutBtnMb) logoutBtnMb.addEventListener('click', handleLogout);

  // Sidebar navigation click helpers for tab switching
  const navItems = document.querySelectorAll('.nav-item');
  const mobileTabItems = document.querySelectorAll('.mobile-tab-item');

  // Switch to initial active tab on dashboard load
  const initialActive = document.querySelector('.nav-item.active');
  if (initialActive) {
    switchDashboardTab(initialActive.getAttribute('href'));
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('href');
      switchDashboardTab(targetId);
    });
  });

  mobileTabItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      switchDashboardTab(targetId);
    });
  });

  // Modal Open/Close handlers
  const topupModal = document.getElementById('topup-modal');
  const txModal = document.getElementById('tx-modal');

  document.getElementById('open-topup-btn').addEventListener('click', () => {
    topupModal.classList.add('active');
  });

  document.getElementById('close-topup-btn').addEventListener('click', () => {
    topupModal.classList.remove('active');
  });

  const openTxBtn = document.getElementById('open-tx-btn');
  if (openTxBtn) {
    openTxBtn.addEventListener('click', () => {
      if (txModal) {
        txModal.classList.add('active');
        loadTransactions();
      } else {
        const txCard = document.getElementById('tx-card');
        if (txCard) {
          txCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Highlight active nav item for logs
          navItems.forEach(n => n.classList.remove('active'));
          const logNav = document.querySelector('a[href="#wallet-card"]');
          if (logNav) logNav.classList.add('active');
        }
      }
    });
  }

  const closeTxBtn = document.getElementById('close-tx-btn');
  if (closeTxBtn && txModal) {
    closeTxBtn.addEventListener('click', () => {
      txModal.classList.remove('active');
    });
  }

  // Top up balance handler
  document.getElementById('deposit-submit-btn').addEventListener('click', handleDepositInit);

  // Buy Proxy handler
  document.getElementById('buy-proxy-btn').addEventListener('click', handleProxyPurchase);

  // Buy SMS handler
  document.getElementById('buy-sms-btn').addEventListener('click', handleSMSPurchase);

}

// ----------------------------------------------------
// WALLET DEPOSITS & SIMULATION FLOW
// ----------------------------------------------------
async function handleDepositInit() {
  const amountInput = document.getElementById('deposit-amount');
  const amount = parseFloat(amountInput.value);

  if (!amount || isNaN(amount) || amount < 500) {
    showToast('Minimum deposit is ₦500', 'error');
    return;
  }

  const submitBtn = document.getElementById('deposit-submit-btn');
  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Initializing...';

    const res = await fetch('/api/v1/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to initialize deposit', 'error');
      return;
    }

    // Live mode redirect
    window.location.href = data.checkout_url;
  } catch (err) {
    showToast('Network error during checkout initialization.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Proceed to Payment';
  }
}



// ----------------------------------------------------
// STATIC RESIDENTIAL PROXIES FLOW
// ----------------------------------------------------
async function handleProxyPurchase() {
  const country = document.getElementById('proxy-country').value;
  const isp = document.getElementById('proxy-isp').value;
  const buyBtn = document.getElementById('buy-proxy-btn');

  const displayBalanceEl = document.getElementById('display-balance');
  const originalBalance = currentUser ? currentUser.balance : 0;
  const costNgn = 15000;

  try {
    buyBtn.disabled = true;
    buyBtn.innerHTML = '<span class="spinner"></span> Allocation in Progress...';

    // Optimistic balance update
    if (currentUser) {
      currentUser.balance -= costNgn;
      displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const res = await fetch('/api/proxy/rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country, isp })
    });

    const data = await res.json();
    
    if (res.status === 401) {
      showToast('Session expired. Please log in again.', 'error');
      setTimeout(() => { window.location.href = '/index.html'; }, 1000);
      return;
    }

    if (!res.ok) {
      // Rollback optimistic balance
      if (currentUser) {
        currentUser.balance = originalBalance;
        displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      showToast(data.error || 'Failed to lease proxy address', 'error');
      return;
    }

    showToast(data.message, 'success');
    
    fetchUserProfile();
    loadActiveProxies();
  } catch (err) {
    // Rollback optimistic balance
    if (currentUser) {
      currentUser.balance = originalBalance;
      displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    showToast('Network error purchasing proxy IP.', 'error');
  } finally {
    buyBtn.disabled = false;
    buyBtn.textContent = `Rent Static IP (₦15,000/mo)`;
  }
}

// Fetch proxy list and build elements dynamically
async function loadActiveProxies() {
  const container = document.getElementById('active-proxies-container');
  try {
    const res = await fetch('/api/proxy/leases');
    const data = await res.json();
    
    if (data.leases.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0;">
          No active proxy leases found.
        </div>`;
      return;
    }

    container.innerHTML = '';
    data.leases.forEach(lease => {
      const cardItem = document.createElement('div');
      cardItem.className = 'proxy-list-item'; // Collapsed by default

      const expDate = new Date(lease.expires_at).toLocaleDateString();
      const flagMap = { 'US': '🇺🇸', 'GB': '🇬🇧', 'DE': '🇩🇪' };
      const flag = flagMap[lease.country] || '🌐';

      // HTML details containing collapsible headers and tabs
      cardItem.innerHTML = `
        <div class="proxy-list-item-header">
          <span style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
            ${flag} Dedicated Static IP (${lease.ip_address})
          </span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: auto; margin-right: 1rem;">
            Expires: ${expDate}
          </span>
          <span class="chevron">▼</span>
        </div>
        
        <div class="proxy-list-item-content">
          <div class="credential-item" style="margin-top: 0.25rem; margin-bottom: 0.75rem;">
            <span class="credential-label" style="font-weight: bold; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">📶 ISP Carrier</span>
            <span class="credential-value" style="font-weight: 700; color: var(--emerald-text); font-size: 0.78rem;">${lease.carrier || 'Broadband Residential'}</span>
          </div>
          <div class="tabs" style="margin-bottom: 0.75rem;">
            <button class="tab-btn active" id="tab-wg-${lease.id}">WireGuard Profile</button>
            <button class="tab-btn" id="tab-socks-${lease.id}">SOCKS5 Credentials</button>
          </div>

          <div class="tab-content active" id="pane-wg-${lease.id}">
            <div style="display: flex; flex-direction: column; align-items: center;">
              <div class="qr-container" style="position: relative; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.05); border-radius: 0.25rem;">
                <div class="spinner" id="qr-spinner-${lease.id}" style="position: absolute; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--cyan);"></div>
                <img class="qr-canvas" id="qr-img-${lease.id}" style="width: 160px; height: 160px; object-fit: contain; background: #fff; padding: 5px; border-radius: 0.25rem; opacity: 0; transition: opacity 0.3s;" alt="WireGuard QR Profile" />
              </div>
              <button class="btn btn-outline" id="dl-wg-${lease.id}" style="font-size: 0.8rem; padding: 0.5rem 1rem;">
                📥 Download Config File
              </button>
            </div>
          </div>

          <div class="tab-content" id="pane-socks-${lease.id}">
            <div class="credential-item">
              <span class="credential-label">Host IP</span>
              <span class="credential-value">${lease.ip_address}</span>
            </div>
            <div class="credential-item">
              <span class="credential-label">Port</span>
              <span class="credential-value">${lease.socks5_port}</span>
            </div>
            <div class="credential-item">
              <span class="credential-label">Username</span>
              <span class="credential-value">${lease.socks5_user}</span>
            </div>
            <div class="credential-item">
              <span class="credential-label">Password</span>
              <span class="credential-value">${lease.socks5_pass}</span>
            </div>
            <button class="btn btn-outline" id="copy-socks-${lease.id}" style="margin-top: 0.5rem; font-size: 0.8rem; padding: 0.5rem 1rem; width: 100%;">
              📋 Copy Connection String
            </button>
          </div>
        </div>
      `;

      container.appendChild(cardItem);

      // Accordion dropdown expand/collapse click handler
      const header = cardItem.querySelector('.proxy-list-item-header');
      header.addEventListener('click', () => {
        cardItem.classList.toggle('open');
      });

      // Retrieve dynamic server-side WireGuard base64 QR code and config stream
      (async () => {
        try {
          const wgRes = await fetch('/api/v1/proxies/wireguard-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ip: lease.ip_address,
              port: lease.socks5_port,
              username: lease.socks5_user,
              password: lease.socks5_pass,
              conf: lease.wireguard_conf
            })
          });
          if (wgRes.ok) {
            const wgData = await wgRes.json();
            const qrImg = document.getElementById(`qr-img-${lease.id}`);
            const qrSpinner = document.getElementById(`qr-spinner-${lease.id}`);
            if (qrImg) {
              qrImg.src = wgData.qr_code_base64;
              qrImg.style.opacity = '1';
            }
            if (qrSpinner) {
              qrSpinner.remove();
            }
          }
        } catch (error) {
          console.error('Failed to load server WireGuard profile:', error);
        }
      })();

      // Download .conf Config file implementation from backend stream
      cardItem.querySelector(`#dl-wg-${lease.id}`).addEventListener('click', (e) => {
        e.stopPropagation();
        // Redirect browser to trigger file download attachment stream
        const downloadUrl = `/api/v1/proxies/wireguard-generate?download=true&ip=${lease.ip_address}&port=${lease.socks5_port}&conf=${encodeURIComponent(lease.wireguard_conf)}`;
        window.location.href = downloadUrl;
        showToast('Configuration file downloaded!', 'success');
      });

      // Add Dual Tab Toggles inside Proxy Details
      const wgTab = cardItem.querySelector(`#tab-wg-${lease.id}`);
      const socksTab = cardItem.querySelector(`#tab-socks-${lease.id}`);
      const wgPane = cardItem.querySelector(`#pane-wg-${lease.id}`);
      const socksPane = cardItem.querySelector(`#pane-socks-${lease.id}`);

      wgTab.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering accordion close
        wgTab.classList.add('active');
        socksTab.classList.remove('active');
        wgPane.classList.add('active');
        socksPane.classList.remove('active');
      });

      socksTab.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering accordion close
        socksTab.classList.add('active');
        wgTab.classList.remove('active');
        socksPane.classList.add('active');
        wgPane.classList.remove('active');
      });

      // Copy SOCKS5 connection string implementation (host:port:user:pass)
      const copySocksBtn = cardItem.querySelector(`#copy-socks-${lease.id}`);
      copySocksBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const connStr = `${lease.ip_address}:${lease.socks5_port}:${lease.socks5_user}:${lease.socks5_pass}`;
        navigator.clipboard.writeText(connStr).then(() => {
          showToast('SOCKS5 connection details copied!', 'success');
          
          const originalText = copySocksBtn.innerHTML;
          const originalBg = copySocksBtn.style.background;
          const originalBorder = copySocksBtn.style.borderColor;
          const originalColor = copySocksBtn.style.color;

          copySocksBtn.innerHTML = 'Copied! ✓';
          copySocksBtn.style.background = 'rgba(16, 185, 129, 0.15)';
          copySocksBtn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
          copySocksBtn.style.color = '#10b981';

          setTimeout(() => {
            copySocksBtn.innerHTML = originalText;
            copySocksBtn.style.background = originalBg;
            copySocksBtn.style.borderColor = originalBorder;
            copySocksBtn.style.color = originalColor;
          }, 2000);
        }).catch(err => {
          showToast('Failed to copy credentials automatically', 'error');
        });
      });
    });
  } catch (err) {
    console.error('Failed to load proxy leases:', err);
  }
}

// ----------------------------------------------------
// VIRTUAL SMS ACTIVATIONS FLOW
// ----------------------------------------------------
async function handleSMSPurchase() {
  const service = document.getElementById('sms-service').value;
  const country = document.getElementById('sms-country').value;
  const operator = document.getElementById('sms-operator').value;
  const buyBtn = document.getElementById('buy-sms-btn');

  const displayBalanceEl = document.getElementById('display-balance');
  const originalBalance = currentUser ? currentUser.balance : 0;
  
  // Find dynamic price in our cached catalog
  let costNgn = 1200; // Default fallback
  if (cachedSmsCatalog && cachedSmsCatalog.services) {
    const serviceObj = cachedSmsCatalog.services.find(s => s.id === service);
    if (serviceObj && serviceObj.price_ngn) {
      costNgn = serviceObj.price_ngn;
    }
  }

  try {
    buyBtn.disabled = true;
    buyBtn.innerHTML = '<span class="spinner"></span> Ordering Number...';

    // Optimistic balance update
    if (currentUser) {
      currentUser.balance -= costNgn;
      displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const res = await fetch('/api/sms/rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, country, operator })
    });

    const data = await res.json();
    
    if (res.status === 401) {
      showToast('Session expired. Please log in again.', 'error');
      setTimeout(() => { window.location.href = '/index.html'; }, 1000);
      return;
    }

    if (!res.ok) {
      // Rollback optimistic balance
      if (currentUser) {
        currentUser.balance = originalBalance;
        displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      showToast(data.error || 'Failed to rent virtual number', 'error');
      return;
    }

    showToast('Virtual phone number rented successfully.', 'success');
    
    fetchUserProfile();
    loadActiveSMS();
  } catch (err) {
    // Rollback optimistic balance
    if (currentUser) {
      currentUser.balance = originalBalance;
      displayBalanceEl.textContent = currentUser.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    showToast('Network error renting SMS activations.', 'error');
  } finally {
    buyBtn.disabled = false;
    buyBtn.textContent = 'Rent Virtual Number';
  }
}

// Poll status of active subscriptions
async function loadActiveSMS() {
  const container = document.getElementById('active-sms-container');
  
  // Clear any existing global UI intervals/timeouts before rebuilding
  Object.keys(activePollIntervals).forEach(key => {
    if (activePollIntervals[key]) {
      if (activePollIntervals[key].stop) {
        activePollIntervals[key].stop();
      } else {
        clearInterval(activePollIntervals[key]);
      }
    }
    delete activePollIntervals[key];
  });

  try {
    const res = await fetch('/api/sms/activations');
    const data = await res.json();

    if (data.activations.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0;">
          No active OTP activations listed.
        </div>`;
      return;
    }

    container.innerHTML = '';
    data.activations.forEach(act => {
      const actCard = document.createElement('div');
      actCard.className = 'proxy-list-item';
      
      const capitalizedService = act.service.charAt(0).toUpperCase() + act.service.slice(1);
      
      const countryFlags = {
        usa: '🇺🇸',
        canada: '🇨🇦',
        england: '🇬🇧',
        germany: '🇩🇪',
        nigeria: '🇳🇬'
      };
      const flag = countryFlags[(act.country || 'usa').toLowerCase()] || '🇺🇸';
      
      let statusMarkup = '';
      
      if (act.status === 'waiting') {
        statusMarkup = `
          <div class="active-number-container">
            <span style="font-size: 0.8rem; color: var(--cyan-text); font-weight: bold; text-transform: uppercase;">Rented Number</span>
            <div class="number-display" id="num-disp-${act.id}">${act.phone_number}</div>
            
            <div class="otp-box">
              <div class="otp-label">Incoming Verification Code (OTP)</div>
              <div class="otp-code" id="otp-code-${act.id}" style="font-size: 1.15rem; color: var(--text-muted); letter-spacing: normal;">
                <span class="spinner" style="margin-right: 0.5rem; width: 14px; height: 14px; border-top-color: var(--cyan);"></span> Waiting for SMS...
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
              <span class="countdown-timer" id="timer-${act.id}">Expires: Loading...</span>
              <button class="btn btn-outline" id="cancel-${act.id}" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.75rem; color: var(--red); border-color: rgba(239,68,68,0.2);">
                🚫 Cancel Number
              </button>
            </div>
          </div>
        `;
      } else if (act.status === 'received') {
        statusMarkup = `
          <div class="active-number-container" style="background: rgba(16, 185, 129, 0.05); border-color: rgba(16, 185, 129, 0.4);">
            <span style="font-size: 0.8rem; color: var(--emerald-text); font-weight: bold;">NUMBER: ${act.phone_number}</span>
            <div class="otp-box" style="border-color: rgba(16, 185, 129, 0.3);">
              <div class="otp-label" style="color: var(--emerald-text);">Received Code</div>
              <div class="otp-code" id="otp-disp-${act.id}" style="cursor: pointer;" title="Click to Copy">${act.otp_code}</div>
              <p style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.2;">"${act.sms_text}"</p>
            </div>
            <button class="btn btn-outline" id="copy-otp-${act.id}" style="font-size: 0.75rem; padding: 0.4rem; width: 100%;">
              📋 Copy Verification Code
            </button>
          </div>
        `;
      } else {
        // Expired or Cancelled status
        const color = act.status === 'cancelled' ? 'var(--text-muted)' : 'var(--red)';
        statusMarkup = `
          <div style="padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; text-align: center; background: rgba(0,0,0,0.1); margin-top: 0.5rem;">
            <div style="font-size: 0.85rem; color: #FFF; font-weight: bold;">${act.phone_number}</div>
            <div style="font-size: 0.75rem; color: ${color}; font-weight: bold; text-transform: uppercase; margin-top: 0.25rem;">
              Status: ${act.status} (Naira Refunded)
            </div>
          </div>
        `;
      }

      const opLabel = act.operator ? act.operator.toUpperCase() : 'ANY';
      actCard.innerHTML = `
        <div class="proxy-list-item-header">
          <span style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
            📱 ${capitalizedService} ${flag} (${act.phone_number}) <span style="font-size: 0.7rem; background: rgba(142, 154, 175, 0.15); padding: 0.15rem 0.35rem; border-radius: 0.25rem; color: var(--text-secondary); font-weight: bold;">${opLabel}</span>
          </span>
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: auto; margin-right: 1rem;">
            ₦${(act.cost / 100).toLocaleString()} | <span style="text-transform: uppercase; font-weight: bold; color: ${act.status === 'received' ? 'var(--lavender-grey)' : 'var(--text-secondary)'};">${act.status}</span>
          </span>
          <span class="chevron">▼</span>
        </div>
        
        <div class="proxy-list-item-content">
          ${statusMarkup}
        </div>
      `;

      container.appendChild(actCard);

      // Accordion toggle click handler
      const header = actCard.querySelector('.proxy-list-item-header');
      header.addEventListener('click', () => {
        actCard.classList.toggle('open');
      });

      // Setup logic if waiting
      if (act.status === 'waiting') {
        // Start timers
        const expiryTime = new Date(act.expires_at).getTime();
        const timerEl = document.getElementById(`timer-${act.id}`);
        
        function updateTimer() {
          const distance = expiryTime - Date.now();
          if (distance <= 0) {
            timerEl.textContent = 'Expired';
            clearInterval(timerInterval);
            // Polling handles cancellation/cleanup automatically
          } else {
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);
            timerEl.textContent = `Expires in: ${minutes}m ${seconds}s`;
          }
        }
        
        updateTimer();
        const timerInterval = setInterval(updateTimer, 1000);
        
        // Start active status check polling for SMS arrivals with step backoff
        let elapsedSeconds = 0;
        let checkTimeoutId = null;

        function checkNext() {
          let intervalMs = 3000; // 0-60s: 3s
          if (elapsedSeconds > 180) {
            intervalMs = 12000; // 180+s: 12s
          } else if (elapsedSeconds > 60) {
            intervalMs = 7000; // 60-180s: 7s
          }

          checkTimeoutId = setTimeout(async () => {
            elapsedSeconds += (intervalMs / 1000);
            const statusChanged = await pollSMSStatus(act.id, timerInterval);
            if (!statusChanged) {
              checkNext();
            }
          }, intervalMs);

          // Track callback wrapper so it can be stopped on cancel or reload
          activePollIntervals[act.id] = {
            type: 'timeout',
            id: checkTimeoutId,
            stop: () => {
              clearTimeout(checkTimeoutId);
            }
          };
        }

        checkNext();

        // Cancel Active Number click listener
        cardItemSetupCancel(act.id, timerInterval, activePollIntervals[act.id]);
      }

      // Copy OTP listener
      if (act.status === 'received') {
        const copyBtn = document.getElementById(`copy-otp-${act.id}`);
        const otpText = document.getElementById(`otp-disp-${act.id}`);
        
        const copyFn = () => {
          navigator.clipboard.writeText(act.otp_code).then(() => {
            showToast('OTP code copied!', 'success');
            
            if (copyBtn) {
              const originalText = copyBtn.innerHTML;
              const originalBg = copyBtn.style.background;
              const originalBorder = copyBtn.style.borderColor;
              const originalColor = copyBtn.style.color;

              copyBtn.innerHTML = 'Copied! ✓';
              copyBtn.style.background = 'rgba(16, 185, 129, 0.15)';
              copyBtn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
              copyBtn.style.color = '#10b981';

              setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.style.background = originalBg;
                copyBtn.style.borderColor = originalBorder;
                copyBtn.style.color = originalColor;
              }, 2000);
            }
          });
        };

        if (copyBtn) copyBtn.addEventListener('click', copyFn);
        if (otpText) otpText.addEventListener('click', copyFn);
      }
    });

  } catch (err) {
    console.error('Failed to load SMS activations:', err);
  }
}

// Bind cancel button click
function cardItemSetupCancel(id, timerInterval, pollTracker) {
  const cancelBtn = document.getElementById(`cancel-${id}`);
  if (!cancelBtn) return;

  cancelBtn.addEventListener('click', async () => {
    try {
      cancelBtn.disabled = true;
      cancelBtn.innerHTML = '<span class="spinner" style="width:10px; height:10px;"></span>...';
      
      const res = await fetch(`/api/sms/cancel/${id}`, { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        showToast(data.error || 'Failed to cancel number', 'error');
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
        return;
      }

      clearInterval(timerInterval);
      if (pollTracker) {
        if (pollTracker.stop) {
          pollTracker.stop();
        } else {
          clearInterval(pollTracker);
        }
      }
      
      showToast(data.message, 'success');
      
      fetchUserProfile();
      loadActiveSMS();
    } catch (err) {
      showToast('Error cancelling number.', 'error');
      cancelBtn.disabled = false;
    }
  });
}

// Poller method to request activation checks
async function pollSMSStatus(id, timerInterval) {
  try {
    const res = await fetch(`/api/sms/poll/${id}`);
    const data = await res.json();

    if (!res.ok) return false;

    // Check if status changed
    if (data.activation.status !== 'waiting') {
      clearInterval(timerInterval);
      const pollTracker = activePollIntervals[id];
      if (pollTracker) {
        if (pollTracker.stop) {
          pollTracker.stop();
        } else {
          clearInterval(pollTracker);
        }
      }
      
      if (data.activation.status === 'received') {
        showToast('OTP verification code arrived!', 'success');
      } else {
        showToast('Activation timed out and refunded.', 'error');
      }
      
      fetchUserProfile();
      loadActiveSMS();
      return true; // Status changed, stop polling loop
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
  return false; // Still waiting
}

// ----------------------------------------------------
// TRANSACTION LOGGER & RECENT AUDITS
// ----------------------------------------------------
async function loadTransactions() {
  const container = document.getElementById('tx-history-list');
  try {
    const res = await fetch('/api/wallet/transactions');
    const data = await res.json();

    if (data.transactions.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 1.5rem 0;">
          No transactions found.
        </div>`;
      return;
    }

    container.innerHTML = '';
    data.transactions.forEach(tx => {
      const date = new Date(tx.created_at).toLocaleString();
      const amountFormatted = formatNaira(Math.abs(tx.amount));
      
      let typeText = '';
      let styleColor = '';
      let prefix = '';

      switch (tx.type) {
        case 'deposit':
          typeText = 'Wallet Fund';
          styleColor = 'var(--emerald-text)';
          prefix = '+';
          break;
        case 'proxy_rent':
          typeText = 'Proxy Lease (30d)';
          styleColor = 'var(--red)';
          prefix = '-';
          break;
        case 'sms_rent':
          typeText = 'SMS verification';
          styleColor = 'var(--red)';
          prefix = '-';
          break;
        case 'sms_refund':
          typeText = 'SMS Refund';
          styleColor = 'var(--emerald-text)';
          prefix = '+';
          break;
      }

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justify = 'space-between';
      row.style.padding = '0.75rem 0';
      row.style.borderBottom = '1px solid var(--border-color)';
      
      row.innerHTML = `
        <div>
          <div style="font-weight: 600; color: var(--text-primary);">${typeText}</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.15rem;">${date}</div>
          <div style="font-size: 0.65rem; color: var(--text-secondary); font-family: monospace;">Ref: ${tx.reference}</div>
        </div>
        <div style="font-weight: 800; color: ${styleColor}; font-size: 0.95rem;">
          ${prefix}₦${amountFormatted}
        </div>
      `;
      container.appendChild(row);
    });

  } catch (err) {
    console.error('Failed to load transaction history logs:', err);
  }
}



// ----------------------------------------------------
// TOAST WRAPPER
// ----------------------------------------------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}
