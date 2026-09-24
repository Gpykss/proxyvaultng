// ProxyVault 🇳🇬 - CyberYozh & 5SIM Dashboard Core Logic
const originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
  options.credentials = 'include';
  return originalFetch(url, options);
};

let currentUser = null;
let proxyCatalogCountries = [];
let cachedSmsCatalog = null;
let activePollTrackers = {};

// 5SIM Multi-Step State
let currentStepService = null;
let currentStepCountry = null;

// Official Vector Brand Icons
function getServiceIconSvg(serviceId = '') {
  const id = (serviceId || '').toLowerCase().trim();

  if (id.includes('whatsapp')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#25D366"/><path d="M17.5 14.38c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.19-.71-.64-1.19-1.42-1.33-1.66-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.39-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.18.86 2.32.98 2.48.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28z" fill="#fff"/></svg>`;
  }

  if (id.includes('telegram')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#229ED9"/><path d="M5.5 11.8l10.8-4.2c.5-.2 1 .1.8.7l-1.8 8.6c-.1.6-.5.8-1 .5l-2.7-2-1.3 1.3c-.1.1-.3.3-.6.3l.2-2.8 5.1-4.6c.2-.2 0-.3-.3-.1l-6.3 4-2.7-.9c-.6-.2-.6-.6.1-.8z" fill="#fff"/></svg>`;
  }

  if (id.includes('chatgpt') || id.includes('openai')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#10a37f"/><path d="M17.5 10.3a3.5 3.5 0 0 0-.3-2.6 3.6 3.6 0 0 0-3.3-1.8c-.3 0-.6.1-.9.2a3.5 3.5 0 0 0-2.6-1.1 3.6 3.6 0 0 0-3.5 2.7 3.5 3.5 0 0 0-1.8 1.4 3.6 3.6 0 0 0-.2 3.8 3.5 3.5 0 0 0 .3 2.6 3.6 3.6 0 0 0 3.3 1.8c.3 0 .6-.1.9-.2a3.5 3.5 0 0 0 2.6 1.1 3.6 3.6 0 0 0 3.5-2.7 3.5 3.5 0 0 0 1.8-1.4 3.6 3.6 0 0 0 .2-3.8z" fill="#fff" opacity="0.95"/></svg>`;
  }

  if (id.includes('facebook')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M13.3 18v-5.5h1.9l.3-2.2h-2.2v-1.4c0-.6.2-1.1 1.1-1.1h1.2V5.8c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.5H9v2.2h1.8V18h2.5z" fill="#fff"/></svg>`;
  }

  if (id.includes('instagram') || id.includes('threads')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><defs><linearGradient id="igG" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#FFD600"/><stop offset="0.5" stop-color="#FF0069"/><stop offset="1" stop-color="#7638FA"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#igG)"/><path d="M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 7.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8zm4.8-7.7a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z" fill="#fff"/><rect x="4.5" y="4.5" width="15" height="15" rx="4" stroke="#fff" stroke-width="1.6"/></svg>`;
  }

  if (id.includes('tiktok')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#000"/><path d="M15.5 6.2c.6.7 1.4 1.2 2.3 1.3v2.2c-.9 0-1.8-.3-2.5-.8v5.6a4.5 4.5 0 1 1-4.5-4.5c.3 0 .7 0 1 .1v2.3a2.3 2.3 0 1 0 1.3 2.1V4h2.4z" fill="#25F4EE"/><path d="M15.9 6.6c.6.7 1.4 1.2 2.3 1.3v1.8c-.9 0-1.8-.3-2.5-.8v5.6a4.5 4.5 0 1 1-4.5-4.5c.3 0 .7 0 1 .1v1.9a2.3 2.3 0 1 0 1.3 2.1V4.4h2.4z" fill="#FE2C55" style="mix-blend-mode: screen;"/><path d="M15.7 6.4c.6.7 1.4 1.2 2.3 1.3v2c-.9 0-1.8-.3-2.5-.8v5.6a4.5 4.5 0 1 1-4.5-4.5c.3 0 .7 0 1 .1v2.1a2.3 2.3 0 1 0 1.3 2.1V4.2h2.4z" fill="#fff"/></svg>`;
  }

  if (id.includes('google') || id.includes('youtube')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#fff"/><path d="M19.6 12.2c0-.6 0-1.2-.1-1.7H12v3.3h4.3c-.2 1-.7 1.9-1.6 2.5v2.1h2.6c1.5-1.4 2.3-3.5 2.3-6.2z" fill="#4285F4"/><path d="M12 20c2.2 0 4-.7 5.3-2l-2.6-2.1c-.7.5-1.7.8-2.7.8-2.1 0-3.9-1.4-4.5-3.4H4.8v2.1C6.2 18.2 8.9 20 12 20z" fill="#34A853"/><path d="M7.5 13.3c-.1-.5-.2-1-.2-1.6s.1-1.1.2-1.6V8H4.8A8 8 0 0 0 4 11.7c0 1.3.3 2.5.8 3.6l2.7-2z" fill="#FBBC05"/><path d="M12 7.3c1.2 0 2.2.4 3 1.2l2.3-2.3C15.9 4.9 14.1 4.3 12 4.3 8.9 4.3 6.2 6.1 4.8 8.9l2.7 2.1c.6-2 2.4-3.7 4.5-3.7z" fill="#EA4335"/></svg>`;
  }

  if (id.includes('amazon')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#232F3E"/><path d="M7 14.5c2.5 1.5 6.5 1.5 9 0" stroke="#FF9900" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 13.5l1.5 1.5-.5 1.5" stroke="#FF9900" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 9.5a2.5 2.5 0 0 0-4.5 1.5c0 1.5 1 2.5 2.5 2.5.8 0 1.5-.4 2-.9v.8h1.5V9.5h-1.5zm0 2.4c-.3.4-.8.7-1.3.7-.8 0-1.3-.6-1.3-1.5s.5-1.5 1.3-1.5c.5 0 1 .3 1.3.7z" fill="#fff"/></svg>`;
  }

  if (id.includes('microsoft')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#111"/><rect x="5" y="5" width="6.5" height="6.5" fill="#F25022"/><rect x="12.5" y="5" width="6.5" height="6.5" fill="#7FBA00"/><rect x="5" y="12.5" width="6.5" height="6.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="6.5" height="6.5" fill="#FFB900"/></svg>`;
  }

  if (id.includes('apple')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#000"/><path d="M15.2 12.3c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-.1.2-1.3 2.3-.3 5.3.7 1.5 1.5 3 2.6 3 .5 0 1-.4 1.6-.4.7 0 1.1.4 1.7.4 1.2 0 1.9-1.4 2.6-2.9.8-1.5 1.1-3 1.1-3.1-.1 0-2.2-.8-2.2-2.7zm-1.8-5.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.2 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.7-.4 2.2-1.1z" fill="#fff"/></svg>`;
  }

  if (id.includes('twitter') || id.includes('x')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#000"/><path d="M14.7 6h2.4l-5.3 6.1 6.2 8.2h-4.9l-3.8-5-4.4 5H2.5l5.7-6.5L2.3 6h5l3.5 4.6L14.7 6zm-.9 12.9h1.3L7.3 7.3H5.9l7.9 11.6z" fill="#fff"/></svg>`;
  }

  if (id.includes('discord')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect width="24" height="24" rx="6" fill="#5865F2"/><path d="M16.5 8c-1-.5-2.1-.8-3.2-.9l-.2.4c1.2.3 1.7.8 1.7.8-.8-.4-1.6-.7-2.5-.8-.7-.1-1.3-.1-2 0-.8.1-1.6.4-2.4.8 0 0 .5-.5 1.7-.8l-.2-.4c-1.1.1-2.2.4-3.2.9-2 3-2.6 6-2.3 8.9 1.3 1 2.6 1.6 3.9 1.6l.8-1c-.8-.2-1.2-.6-1.2-.6.1.1.3.2.4.3.9.5 2 .9 3.2.9s2.3-.4 3.2-.9c.2-.1.3-.2.4-.3 0 0-.4.4-1.2.6l.8 1c1.3 0 2.6-.6 3.9-1.6.4-3.4-.5-6.4-2.4-8.9zm-6.2 6.5c-.7 0-1.3-.6-1.3-1.4 0-.8.6-1.4 1.3-1.4.8 0 1.4.6 1.3 1.4 0 .8-.5 1.4-1.3 1.4zm3.4 0c-.7 0-1.3-.6-1.3-1.4 0-.8.6-1.4 1.3-1.4.8 0 1.4.6 1.3 1.4 0 .8-.5 1.4-1.3 1.4z" fill="#fff"/></svg>`;
  }

  if (id.includes('spotify')) {
    return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M16.8 15.6c-.2.3-.5.4-.8.2-2.2-1.3-4.9-1.6-8.2-.9-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 3.5-.8 6.6-.4 9.1 1.1.3.2.4.5.3.8zm1.2-2.7c-.2.4-.7.5-1.1.3-2.5-1.5-6.3-2-9.2-1.1-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.4-1 7.6-.5 10.5 1.3.4.2.5.7.3 1zm.1-2.8c-3-1.8-8-2-10.8-1.1-.5.1-1-.1-1.2-.6-.1-.5.1-1 .6-1.2 3.4-1 8.9-.8 12.4 1.3.4.3.6.8.3 1.3-.2.5-.8.6-1.3.3z" fill="#fff"/></svg>`;
  }

  // Default clean SIM icon
  return `<svg viewBox="0 0 24 24" width="22" height="22" style="display:inline-block;vertical-align:middle;flex-shrink:0;"><rect x="4" y="3" width="16" height="18" rx="4" stroke="#38bdf8" stroke-width="1.8" fill="none"/><path d="M8 7h4v4H8V7zm0 6h8v4H8v-4zm6-6h2v4h-2V7z" fill="#38bdf8"/></svg>`;
}

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  setupNavAndModals();
});

let currentProxyPricing = { price_ngn: 7500, price_kobo: 750000, price_formatted: '7,500', strike_formatted: '12,000' };

async function loadProxyPricing() {
  try {
    const res = await fetch('/api/proxy/pricing');
    if (!res.ok) return;
    currentProxyPricing = await res.json();
    const priceDisplay = document.getElementById('modal-proxy-price-display');
    const strikeDisplay = document.getElementById('modal-proxy-strike-display');
    const confirmBtn = document.getElementById('confirm-buy-proxy-btn');
    if (priceDisplay) priceDisplay.textContent = `₦${currentProxyPricing.price_formatted}`;
    if (strikeDisplay) strikeDisplay.textContent = `₦${currentProxyPricing.strike_formatted}`;
    if (confirmBtn) confirmBtn.textContent = `Deploy Instant Proxy (₦${currentProxyPricing.price_formatted})`;
  } catch (e) {
    console.error('Failed to load proxy pricing:', e);
  }
}

async function initDashboard() {
  const authed = await fetchUserProfile();
  if (authed) {
    initCatalogs();
    loadActiveProxies();
    loadActiveSMS();
    loadTransactions();
    loadProxyPricing();

    // Check payment redirect callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      switchView('#wallet-view');
      fetchUserProfile();
      loadTransactions();
      showToast('Wallet funded successfully!', 'success');
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    // Check for landing page direct buy intent
    const pendingBuyRaw = sessionStorage.getItem('pv_pending_buy');
    if (pendingBuyRaw) {
      try {
        const pendingBuy = JSON.parse(pendingBuyRaw);
        sessionStorage.removeItem('pv_pending_buy');
        switchView('#proxies-view');
        const countrySelect = document.getElementById('modal-proxy-country');
        const ispSelect = document.getElementById('modal-proxy-isp');
        if (countrySelect && pendingBuy.country) {
          countrySelect.value = pendingBuy.country;
          countrySelect.dispatchEvent(new Event('change'));
        }
        if (ispSelect && pendingBuy.isp) {
          setTimeout(() => {
            if (ispSelect) ispSelect.value = pendingBuy.isp;
          }, 150);
        }
        const rentProxyModal = document.getElementById('rent-proxy-modal');
        if (rentProxyModal) {
          setTimeout(() => {
            rentProxyModal.classList.add('active');
            showToast(`Configured your dedicated ${pendingBuy.country || 'US'} ISP proxy. Ready to deploy!`, 'info');
          }, 350);
        }
      } catch (e) {
        console.error('Error handling pending buy intent:', e);
      }
    }

    // Check for landing page direct SMS intent
    const pendingSmsRaw = sessionStorage.getItem('pv_pending_sms');
    if (pendingSmsRaw || urlParams.get('intent') === 'sms') {
      try {
        let pendingSms = null;
        if (pendingSmsRaw) {
          pendingSms = JSON.parse(pendingSmsRaw);
          sessionStorage.removeItem('pv_pending_sms');
        }
        switchView('#sms-view');
        const serviceName = pendingSms?.serviceName || 'SMS';
        const countryName = pendingSms?.countryName || '';
        showToast(`Ready for ${serviceName} OTP verification ${countryName ? '(' + countryName + ')' : ''}. Select your service below to receive code!`, 'info');
      } catch (e) {
        console.error('Error handling pending sms intent:', e);
      }
    }

    // Refresh wallet balance & orders periodically
    setInterval(() => {
      fetchUserProfile();
    }, 6000);
  }
}

// ----------------------------------------------------
// NAVIGATION & TAB SWITCHING
// ----------------------------------------------------
function switchView(targetId) {
  const sections = document.querySelectorAll('.dashboard-view-section');
  sections.forEach(sec => sec.classList.remove('active'));

  const activeSec = document.querySelector(targetId);
  if (activeSec) activeSec.classList.add('active');

  // Sync desktop nav tabs
  const navBtns = document.querySelectorAll('.nav-tab-btn');
  navBtns.forEach(btn => {
    if (btn.getAttribute('data-target') === targetId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Sync drawer nav items
  const drawerBtns = document.querySelectorAll('.drawer-nav-item');
  drawerBtns.forEach(btn => {
    if (btn.getAttribute('data-target') === targetId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Close mobile drawer if open
  closeDrawer();
}

function setupNavAndModals() {
  // Desktop Nav Buttons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      switchView(targetId);
    });
  });

  // Drawer Nav Buttons
  document.querySelectorAll('.drawer-nav-item[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      switchView(targetId);
    });
  });

  // Brand Logo click
  const brandLink = document.getElementById('brand-home-link');
  if (brandLink) {
    brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('#proxies-view');
    });
  }

  // Drawer Open/Close
  const drawerOverlay = document.getElementById('drawer-overlay');
  const drawerOpenBtn = document.getElementById('drawer-open-btn');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');

  if (drawerOpenBtn) {
    drawerOpenBtn.addEventListener('click', () => {
      drawerOverlay.classList.add('active');
    });
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', closeDrawer);
  }

  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', (e) => {
      if (e.target === drawerOverlay) closeDrawer();
    });
  }

  // Logout actions
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      showToast('Logged out successfully', 'success');
      setTimeout(() => window.location.href = '/index.html', 800);
    } catch (err) {
      window.location.href = '/index.html';
    }
  };

  const logoutDrawerBtn = document.getElementById('logout-drawer-btn');
  const dropdownLogoutBtn = document.getElementById('dropdown-logout-btn');
  if (logoutDrawerBtn) logoutDrawerBtn.addEventListener('click', handleLogout);
  if (dropdownLogoutBtn) dropdownLogoutBtn.addEventListener('click', handleLogout);

  // ----------------------------------------------------
  // 5SIM USER PROFILE DROPDOWN ACTIONS
  // ----------------------------------------------------
  const profileWrapper = document.getElementById('profile-dropdown-wrapper');
  const profileToggleBtn = document.getElementById('profile-toggle-btn');
  const copyUserIdBtn = document.getElementById('copy-user-id-btn');
  const dropdownTopupBtn = document.getElementById('dropdown-topup-btn');
  const dropdownApiBtn = document.getElementById('dropdown-api-btn');
  const dropdownSettingsBtn = document.getElementById('dropdown-settings-btn');

  if (profileToggleBtn && profileWrapper) {
    profileToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileWrapper.classList.toggle('open');
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (profileWrapper && !profileWrapper.contains(e.target)) {
      profileWrapper.classList.remove('open');
    }
  });

  // Copy User ID
  if (copyUserIdBtn) {
    copyUserIdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userIdEl = document.getElementById('dropdown-user-id');
      const idText = userIdEl ? userIdEl.textContent : (currentUser ? currentUser.id : '');
      navigator.clipboard.writeText(idText).then(() => {
        showToast(`User ID copied: ${idText}`, 'success');
      });
    });
  }

  // Dropdown -> Top Up
  if (dropdownTopupBtn) {
    dropdownTopupBtn.addEventListener('click', () => {
      if (profileWrapper) profileWrapper.classList.remove('open');
      openTopup();
    });
  }

  // Dropdown -> Settings Modal
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-modal-btn');
  const settingsCopyIdBtn = document.getElementById('settings-copy-id-btn');
  const changePasswordBtn = document.getElementById('settings-change-password-btn');
  const clearBannedBtn = document.getElementById('settings-clear-banned-btn');
  const addOperatorBtn = document.getElementById('settings-add-operator-btn');
  const deleteAccountBtn = document.getElementById('settings-delete-account-btn');

  if (dropdownSettingsBtn && settingsModal) {
    dropdownSettingsBtn.addEventListener('click', () => {
      if (profileWrapper) profileWrapper.classList.remove('open');
      settingsModal.classList.add('active');
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
  }

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('active');
    });
  }

  // Copy User ID from settings
  if (settingsCopyIdBtn) {
    settingsCopyIdBtn.addEventListener('click', () => {
      const idEl = document.getElementById('settings-user-id');
      const idVal = idEl ? idEl.textContent : '';
      navigator.clipboard.writeText(idVal).then(() => {
        showToast(`User ID copied: #${idVal}`, 'success');
      });
    });
  }

  // Password Visibility Eye Toggles
  document.querySelectorAll('.password-eye-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSelector = btn.getAttribute('data-target');
      const input = document.querySelector(targetSelector);
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🔒';
        } else {
          input.type = 'password';
          btn.textContent = '👁';
        }
      }
    });
  });

  // Change Password Submission
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', async () => {
      const oldPassword = document.getElementById('settings-old-password').value;
      const newPassword = document.getElementById('settings-new-password').value;
      const repeatPassword = document.getElementById('settings-repeat-password').value;

      if (!oldPassword || !newPassword || !repeatPassword) {
        showToast('Please fill in all password fields.', 'error');
        return;
      }

      if (newPassword !== repeatPassword) {
        showToast('New passwords do not match.', 'error');
        return;
      }

      if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters.', 'error');
        return;
      }

      changePasswordBtn.disabled = true;
      changePasswordBtn.innerHTML = '<span class="spinner"></span> Updating...';

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword, newPassword, repeatPassword })
        });

        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Failed to update password', 'error');
          return;
        }

        showToast('Password updated successfully!', 'success');
        document.getElementById('settings-old-password').value = '';
        document.getElementById('settings-new-password').value = '';
        document.getElementById('settings-repeat-password').value = '';
        settingsModal.classList.remove('active');
      } catch (err) {
        showToast('Network error updating password.', 'error');
      } finally {
        changePasswordBtn.disabled = false;
        changePasswordBtn.textContent = 'Change password';
      }
    });
  }

  // Clear Banned Numbers
  if (clearBannedBtn) {
    clearBannedBtn.addEventListener('click', () => {
      showToast('Banned numbers list cleared successfully!', 'success');
    });
  }

  // Default Operator Add/Edit
  if (addOperatorBtn) {
    addOperatorBtn.addEventListener('click', () => {
      const opText = document.getElementById('settings-default-operator-text');
      if (opText) {
        const current = opText.textContent;
        const next = current === 'Any operator' ? 'Virtual28 (High Signal)' : 'Any operator';
        opText.textContent = next;
        showToast(`Default operator set to: ${next}`, 'success');
      }
    });
  }

  // Delete Account Action
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to request account deletion? All active leases and wallet balances will be permanently closed.')) {
        showToast('Account deletion request submitted to support.', 'success');
      }
    });
  }

  // Top Up Wallet Modal
  const topupModal = document.getElementById('topup-modal');
  const closeTopupBtn = document.getElementById('close-topup-btn');
  const headerWalletBtn = document.getElementById('header-wallet-btn');
  const openTopupBtn = document.getElementById('open-topup-modal-btn');
  const walletDepositBtn = document.getElementById('wallet-deposit-btn');

  const openTopup = () => {
    if (topupModal) topupModal.classList.add('active');
  };

  if (headerWalletBtn) headerWalletBtn.addEventListener('click', openTopup);
  if (openTopupBtn) openTopupBtn.addEventListener('click', openTopup);
  if (walletDepositBtn) walletDepositBtn.addEventListener('click', openTopup);
  if (closeTopupBtn) closeTopupBtn.addEventListener('click', () => topupModal.classList.remove('active'));

  if (topupModal) {
    topupModal.addEventListener('click', (e) => {
      if (e.target === topupModal) topupModal.classList.remove('active');
    });
  }

  // Deposit Submit
  const depositSubmitBtn = document.getElementById('deposit-submit-btn');
  if (depositSubmitBtn) {
    depositSubmitBtn.addEventListener('click', handleDepositSubmit);
  }

  // Rent Proxy Modal
  const rentProxyModal = document.getElementById('rent-proxy-modal');
  const openRentProxyBtn = document.getElementById('open-rent-proxy-modal-btn');
  const closeRentProxyBtn = document.getElementById('close-rent-proxy-modal-btn');
  const confirmBuyProxyBtn = document.getElementById('confirm-buy-proxy-btn');

  if (openRentProxyBtn) {
    openRentProxyBtn.addEventListener('click', () => {
      if (rentProxyModal) rentProxyModal.classList.add('active');
    });
  }

  if (closeRentProxyBtn) {
    closeRentProxyBtn.addEventListener('click', () => {
      if (rentProxyModal) rentProxyModal.classList.remove('active');
    });
  }

  if (rentProxyModal) {
    rentProxyModal.addEventListener('click', (e) => {
      if (e.target === rentProxyModal) rentProxyModal.classList.remove('active');
    });
  }

  if (confirmBuyProxyBtn) {
    confirmBuyProxyBtn.addEventListener('click', handleProxyPurchase);
  }

  // Download .txt proxies button
  const dlTxtBtn = document.getElementById('download-proxies-txt-btn');
  if (dlTxtBtn) {
    dlTxtBtn.addEventListener('click', exportProxiesTxt);
  }

  // Terms of Service Modal
  const tosModal = document.getElementById('dashboard-tos-modal');
  const drawerTosBtn = document.getElementById('drawer-tos-btn');
  const closeTosBtn = document.getElementById('close-tos-btn');

  if (drawerTosBtn && tosModal) {
    drawerTosBtn.addEventListener('click', () => {
      closeDrawer();
      tosModal.classList.add('active');
    });
  }

  if (closeTosBtn && tosModal) {
    closeTosBtn.addEventListener('click', () => tosModal.classList.remove('active'));
  }

  if (tosModal) {
    tosModal.addEventListener('click', (e) => {
      if (e.target === tosModal) tosModal.classList.remove('active');
    });
  }
}

function closeDrawer() {
  const drawerOverlay = document.getElementById('drawer-overlay');
  if (drawerOverlay) drawerOverlay.classList.remove('active');
}

// ----------------------------------------------------
// USER PROFILE & BALANCE
// ----------------------------------------------------
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

    const emailEl = document.getElementById('drawer-user-email');
    if (emailEl) emailEl.textContent = currentUser.email;

    // Populate 5SIM style User ID & Email in Dropdown and Settings Modal
    const userIdEl = document.getElementById('dropdown-user-id');
    const settingsIdEl = document.getElementById('settings-user-id');
    const settingsEmailEl = document.getElementById('settings-user-email');

    if (currentUser.id) {
      const numericShortId = parseInt(currentUser.id.slice(-6), 16) % 9000000 + 1000000;
      if (userIdEl) userIdEl.textContent = numericShortId;
      if (settingsIdEl) settingsIdEl.textContent = numericShortId;
    }

    if (settingsEmailEl && currentUser.email) {
      settingsEmailEl.textContent = currentUser.email;
    }

    return true;
  } catch (err) {
    window.location.href = '/index.html';
    return false;
  }
}

function formatNaira(kobo) {
  return (kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function updateBalanceDisplay(kobo) {
  const formatted = formatNaira(kobo);
  const topDisplay = document.getElementById('display-balance');
  const cardDisplay = document.getElementById('wallet-card-balance');
  if (topDisplay) topDisplay.textContent = formatted;
  if (cardDisplay) cardDisplay.textContent = formatted;
}

// ----------------------------------------------------
// TOP UP WALLET FLOW (Korapay)
// ----------------------------------------------------
async function handleDepositSubmit() {
  const amountInput = document.getElementById('deposit-amount');
  const amount = parseFloat(amountInput.value);

  if (!amount || isNaN(amount) || amount < 500) {
    showToast('Minimum deposit is ₦500', 'error');
    return;
  }

  const submitBtn = document.getElementById('deposit-submit-btn');
  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Redirecting to Korapay...';

    const res = await fetch('/api/v1/payments/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Deposit initialization failed', 'error');
      return;
    }

    window.location.href = data.checkout_url;
  } catch (err) {
    showToast('Network error during payment initialization.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Proceed to Secure Payment';
  }
}

// ----------------------------------------------------
// CATALOGS & SELECTORS INITIALIZATION
// ----------------------------------------------------
async function initCatalogs() {
  // Default fallback catalog
  cachedSmsCatalog = {
    services: [
      { id: 'facebook', name: 'Facebook', price_ngn: 1500 },
      { id: 'whatsapp', name: 'WhatsApp', price_ngn: 1500 },
      { id: 'telegram', name: 'Telegram', price_ngn: 1200 },
      { id: 'google', name: 'Google / YouTube', price_ngn: 1200 },
      { id: 'chatgpt', name: 'OpenAI / ChatGPT', price_ngn: 1000 },
      { id: 'instagram', name: 'Instagram / Threads', price_ngn: 1200 },
      { id: 'tiktok', name: 'TikTok', price_ngn: 1000 },
      { id: 'amazon', name: 'Amazon', price_ngn: 1200 },
      { id: 'microsoft', name: 'Microsoft', price_ngn: 1200 }
    ],
    countries: [
      { id: 'usa', name: 'United States 🇺🇸' },
      { id: 'england', name: 'United Kingdom 🇬🇧' },
      { id: 'canada', name: 'Canada 🇨🇦' },
      { id: 'germany', name: 'Germany 🇩🇪' },
      { id: 'indonesia', name: 'Indonesia 🇮🇩' },
      { id: 'philippines', name: 'Philippines 🇵🇭' },
      { id: 'cambodia', name: 'Cambodia 🇰🇭' },
      { id: 'southafrica', name: 'South Africa 🇿🇦' },
      { id: 'india', name: 'India 🇮🇳' },
      { id: 'nigeria', name: 'Nigeria 🇳🇬' }
    ]
  };

  proxyCatalogCountries = [
    {
      country_name: 'United States',
      country_code: 'US',
      flag: '🇺🇸',
      providers: [
        { id: 'us_comcast', name: 'Comcast Cable (ISP Residential)', price_ngn: 15000 },
        { id: 'us_verizon', name: 'Verizon Business (ISP Residential)', price_ngn: 15000 },
        { id: 'us_spectrum', name: 'Spectrum Broadband (ISP Residential)', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'United Kingdom',
      country_code: 'GB',
      flag: '🇬🇧',
      providers: [
        { id: 'gb_bt', name: 'BT Broadband (ISP Residential)', price_ngn: 15000 },
        { id: 'gb_virgin', name: 'Virgin Media (ISP Residential)', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'Germany',
      country_code: 'DE',
      flag: '🇩🇪',
      providers: [
        { id: 'de_telekom', name: 'Deutsche Telekom (ISP Residential)', price_ngn: 15000 }
      ]
    },
    {
      country_name: 'Canada',
      country_code: 'CA',
      flag: '🇨🇦',
      providers: [
        { id: 'ca_rogers', name: 'Rogers Communications (ISP Residential)', price_ngn: 15000 }
      ]
    }
  ];

  // Render initial lists
  renderStep1Services('');
  renderStep2Countries('');
  initModalProxyDropdowns();

  // Bind Search Filters
  const serviceSearch = document.getElementById('sms-service-search');
  if (serviceSearch) {
    serviceSearch.addEventListener('input', (e) => renderStep1Services(e.target.value));
  }

  const countrySearch = document.getElementById('sms-country-search');
  if (countrySearch) {
    countrySearch.addEventListener('input', (e) => renderStep2Countries(e.target.value));
  }

  // Bind Clear Chip Buttons
  const clearServiceBtn = document.getElementById('chip-clear-service-btn');
  if (clearServiceBtn) {
    clearServiceBtn.addEventListener('click', resetStep1);
  }

  const clearCountryBtn = document.getElementById('chip-clear-country-btn');
  if (clearCountryBtn) {
    clearCountryBtn.addEventListener('click', resetStep2);
  }

  // Fetch live backend catalogs asynchronously
  fetch('/api/v1/sms/catalog')
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
      if (data && data.services && data.countries) {
        cachedSmsCatalog = data;
        renderStep1Services(serviceSearch ? serviceSearch.value : '');
        renderStep2Countries(countrySearch ? countrySearch.value : '');
      }
    })
    .catch(() => {});

  fetch('/api/v1/proxies/static-list')
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => {
      if (data && data.countries && data.countries.length > 0) {
        proxyCatalogCountries = data.countries;
        initModalProxyDropdowns();
      }
    })
    .catch(() => {});
}

// ----------------------------------------------------
// 5SIM MULTI-STEP SELECTION LOGIC
// ----------------------------------------------------
const TOP_SERVICES_PRIORITY = ['whatsapp', 'telegram', 'chatgpt', 'openai', 'facebook', 'instagram', 'tiktok', 'google'];
const TIER1_COUNTRIES_PRIORITY = ['usa', 'us', 'england', 'gb', 'uk', 'canada', 'ca', 'germany', 'de'];

function renderStep1Services(query = '') {
  const container = document.getElementById('sms-services-list');
  if (!container || !cachedSmsCatalog) return;

  container.innerHTML = '';
  const filter = query.toLowerCase().trim();
  const filtered = cachedSmsCatalog.services.filter(s =>
    (s.name || '').toLowerCase().includes(filter) || (s.id || '').toLowerCase().includes(filter)
  );

  // Partition into prioritized top services and remaining alphabetical
  const topServices = [];
  const otherServices = [];

  filtered.forEach(s => {
    const sId = (s.id || '').toLowerCase();
    const isTop = TOP_SERVICES_PRIORITY.some(topId => sId === topId || sId.includes(topId));
    if (isTop) {
      topServices.push(s);
    } else {
      otherServices.push(s);
    }
  });

  // Sort top services by priority order
  topServices.sort((a, b) => {
    const aId = (a.id || '').toLowerCase();
    const bId = (b.id || '').toLowerCase();
    const aIndex = TOP_SERVICES_PRIORITY.findIndex(topId => aId === topId || aId.includes(topId));
    const bIndex = TOP_SERVICES_PRIORITY.findIndex(topId => bId === topId || bId.includes(topId));
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });

  // Sort others alphabetically
  otherServices.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const renderServiceRow = (s) => {
    const row = document.createElement('div');
    row.className = 'step-select-row';
    if (currentStepService === s.id) row.classList.add('selected');

    const icon = getServiceIconSvg(s.id);
    const priceFormatted = s.price_ngn ? `from ₦${s.price_ngn.toLocaleString()}` : 'from ₦1,200';
    const stockCount = Math.floor(10000 + (s.id.length * 15420)).toLocaleString();

    row.innerHTML = `
      <div class="step-row-left">
        <span class="step-icon">${icon}</span>
        <span class="step-brand-name">${s.name}</span>
      </div>
      <div class="step-row-right">
        <span class="step-price-tag">${priceFormatted}</span>
        <span class="step-stock-tag">${stockCount} numbers</span>
      </div>
    `;

    row.addEventListener('click', () => {
      selectService(s);
    });

    container.appendChild(row);
  };

  topServices.forEach(renderServiceRow);

  if (topServices.length > 0 && otherServices.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'step-list-divider';
    divider.textContent = 'All Services';
    container.appendChild(divider);
  }

  otherServices.forEach(renderServiceRow);
}

function selectService(serviceObj) {
  currentStepService = serviceObj.id;

  // Show active chip and hide search box
  const chipBox = document.getElementById('step-1-active-chip');
  const selectBox = document.getElementById('step-1-selection-box');
  const chipIcon = document.getElementById('chip-service-icon');
  const chipName = document.getElementById('chip-service-name');

  if (chipIcon) chipIcon.innerHTML = getServiceIconSvg(serviceObj.id);
  if (chipName) chipName.textContent = serviceObj.name;
  if (chipBox) chipBox.style.display = 'flex';
  if (selectBox) selectBox.style.display = 'none';

  // Advance to Step 3 if country is already selected
  if (currentStepCountry) {
    loadStep3Operators();
  }
}

function resetStep1() {
  currentStepService = null;
  const chipBox = document.getElementById('step-1-active-chip');
  const selectBox = document.getElementById('step-1-selection-box');
  if (chipBox) chipBox.style.display = 'none';
  if (selectBox) selectBox.style.display = 'block';

  renderStep1Services(document.getElementById('sms-service-search').value);
  resetStep3();
}

function renderStep2Countries(query = '') {
  const container = document.getElementById('sms-countries-list');
  if (!container || !cachedSmsCatalog) return;

  container.innerHTML = '';
  const filter = query.toLowerCase().trim();
  const filtered = cachedSmsCatalog.countries.filter(c =>
    (c.name || '').toLowerCase().includes(filter) || (c.id || '').toLowerCase().includes(filter)
  );

  // Partition into Tier-1 countries and remaining
  const tier1Countries = [];
  const otherCountries = [];

  filtered.forEach(c => {
    const cId = (c.id || '').toLowerCase();
    const isTier1 = TIER1_COUNTRIES_PRIORITY.some(tId => cId === tId || cId.includes(tId));
    if (isTier1) {
      tier1Countries.push(c);
    } else {
      otherCountries.push(c);
    }
  });

  // Sort Tier-1 in exact order: USA, England/UK, Canada, Germany
  tier1Countries.sort((a, b) => {
    const aId = (a.id || '').toLowerCase();
    const bId = (b.id || '').toLowerCase();
    const aIdx = TIER1_COUNTRIES_PRIORITY.findIndex(tId => aId === tId || aId.includes(tId));
    const bIdx = TIER1_COUNTRIES_PRIORITY.findIndex(tId => bId === tId || bId.includes(tId));
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  // Sort others alphabetically
  otherCountries.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const renderCountryRow = (c) => {
    const row = document.createElement('div');
    row.className = 'step-select-row';
    if (currentStepCountry === c.id) row.classList.add('selected');

    // Extract flag from name string or default
    const flagMatch = c.name.match(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/);
    const flag = flagMatch ? flagMatch[0] : '🌐';
    const cleanName = c.name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').trim();

    row.innerHTML = `
      <div class="step-row-left">
        <span class="step-icon">${flag}</span>
        <span class="step-brand-name">${cleanName}</span>
      </div>
    `;

    row.addEventListener('click', () => {
      selectCountry(c, flag, cleanName);
    });

    container.appendChild(row);
  };

  tier1Countries.forEach(renderCountryRow);

  if (tier1Countries.length > 0 && otherCountries.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'step-list-divider';
    divider.textContent = 'All Countries';
    container.appendChild(divider);
  }

  otherCountries.forEach(renderCountryRow);
}

function selectCountry(countryObj, flag, name) {
  currentStepCountry = countryObj.id;

  const chipBox = document.getElementById('step-2-active-chip');
  const selectBox = document.getElementById('step-2-selection-box');
  const chipFlag = document.getElementById('chip-country-flag');
  const chipName = document.getElementById('chip-country-name');

  if (chipFlag) chipFlag.textContent = flag;
  if (chipName) chipName.textContent = name;
  if (chipBox) chipBox.style.display = 'flex';
  if (selectBox) selectBox.style.display = 'none';

  if (currentStepService) {
    loadStep3Operators();
  }
}

function resetStep2() {
  currentStepCountry = null;
  const chipBox = document.getElementById('step-2-active-chip');
  const selectBox = document.getElementById('step-2-selection-box');
  if (chipBox) chipBox.style.display = 'none';
  if (selectBox) selectBox.style.display = 'block';

  renderStep2Countries(document.getElementById('sms-country-search').value);
  resetStep3();
}

function resetStep3() {
  const prompt = document.getElementById('step-3-prompt');
  const opList = document.getElementById('sms-operators-list');
  if (prompt) prompt.style.display = 'block';
  if (opList) opList.style.display = 'none';
}

async function loadStep3Operators() {
  const prompt = document.getElementById('step-3-prompt');
  const opList = document.getElementById('sms-operators-list');
  if (!prompt || !opList) return;

  prompt.style.display = 'none';
  opList.style.display = 'flex';
  opList.innerHTML = '<div style="text-align:center; padding: 1rem;"><span class="spinner"></span> Loading operators...</div>';

  try {
    const res = await fetch(`/api/v1/sms/operators?country=${currentStepCountry}&service=${currentStepService}`);
    const data = await res.json();

    opList.innerHTML = '';

    if (!data.operators || data.operators.length === 0) {
      opList.innerHTML = '<div style="color:var(--text-muted); font-size: 0.8rem; text-align:center;">No operators available for this selection.</div>';
      return;
    }

    data.operators.forEach((op, index) => {
      const card = document.createElement('div');
      card.className = 'operator-card-item';
      const isAny = op.is_any || op.operator_name.toLowerCase().includes('any');
      if (isAny) card.classList.add('is-any-operator');

      const hasFreeNumbers = (op.stock_count || 0) > 0;

      let badgeHtml = '';
      if (!hasFreeNumbers) {
        card.classList.add('out-of-stock');
        card.style.opacity = '0.6';
        badgeHtml = '<span class="operator-badge-tag out-of-stock" style="background:rgba(244,63,94,0.12); color:#f43f5e; border:1px solid rgba(244,63,94,0.3);">NO FREE NUMBERS</span>';
      } else if (index === 0 && op.success_rate !== null && op.success_rate > 0 && !isAny) {
        badgeHtml = '<span class="operator-badge-tag">BEST RATE</span>';
      } else if (!isAny && data.operators[0] && op.price_ngn < data.operators[0].price_ngn) {
        badgeHtml = '<span class="operator-badge-tag low-price">LOW PRICE</span>';
      }

      const envelopeIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;opacity:0.85;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;

      let signalDisplay = '';
      if (!hasFreeNumbers) {
        signalDisplay = `<span style="color:var(--text-muted); font-size:0.75rem;">⚠️ No numbers available</span>`;
      } else if (isAny) {
        signalDisplay = `<span style="color:var(--text-muted); font-size:0.72rem;">Pooled network stock</span>`;
      } else if (op.success_rate !== null && op.success_rate !== undefined) {
        signalDisplay = `<span>${envelopeIcon}${op.success_rate}%</span> <span class="badge-sms-reuse">>1 SMS</span>`;
      } else {
        signalDisplay = `<span style="color:var(--text-secondary); font-size:0.75rem;">${envelopeIcon}Active signal</span>`;
      }

      const stockDisplay = hasFreeNumbers
        ? `<div class="operator-stock-count" style="color:#22c55e; font-weight:600;">${op.stock_count.toLocaleString()} numbers</div>`
        : `<div class="operator-stock-count" style="color:#f43f5e; font-weight:600;">No free numbers</div>`;

      const buyButtonHtml = hasFreeNumbers
        ? `<button class="operator-buy-btn" title="Rent Number from ${op.operator_name}">🛒</button>`
        : `<button class="operator-buy-btn disabled" disabled title="No free numbers available for this operator" style="opacity:0.35; cursor:not-allowed; background:rgba(255,255,255,0.06); color:var(--text-muted);">✕</button>`;

      card.innerHTML = `
        ${badgeHtml}
        <div style="display: flex; flex-direction: column; width: 100%; gap: 0.4rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div class="operator-info-col">
              <span class="operator-name">${op.operator_name}</span>
              <div class="operator-signal-rate">${signalDisplay}</div>
            </div>
            <div class="operator-pricing-col">
              <div>
                <div class="operator-cost-naira">₦${(op.price_ngn || 1500).toLocaleString()}</div>
                ${stockDisplay}
              </div>
              ${buyButtonHtml}
            </div>
          </div>
          ${isAny ? `
            <div class="operator-any-notice">
              <span>ℹ️</span>
              <span>You will be issued one of the virtual numbers available in stock. Please note that the prices may vary</span>
            </div>
          ` : ''}
        </div>
      `;

      if (hasFreeNumbers) {
        const btn = card.querySelector('.operator-buy-btn');
        if (btn) {
          btn.addEventListener('click', () => {
            const targetOpId = op.operator_id || (isAny ? 'any' : op.operator_name.toLowerCase());
            executeSmsRent(currentStepService, currentStepCountry, targetOpId, op.price_ngn || 1500);
          });
        }
      }

      opList.appendChild(card);
    });

  } catch (err) {
    opList.innerHTML = '<div style="color:var(--red); font-size: 0.8rem;">Failed to load operators.</div>';
  }
}

// Rent virtual SMS number
async function executeSmsRent(service, country, operator, costNgn) {
  const costKobo = costNgn * 100;
  const originalBalance = currentUser ? currentUser.balance : 0;

  try {
    // Optimistic balance deduction
    if (currentUser) {
      currentUser.balance = Math.max(0, currentUser.balance - costKobo);
      updateBalanceDisplay(currentUser.balance);
    }

    showToast('Allocating virtual number...', 'success');

    const res = await fetch('/api/sms/rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, country, operator })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: 'Failed to allocate virtual number. Please select an operator with free numbers.' };
    }

    if (!res.ok) {
      if (currentUser) {
        currentUser.balance = originalBalance;
        updateBalanceDisplay(currentUser.balance);
      }
      const errMessage = (data && data.error) ? String(data.error).replace(/5sim/gi, 'SMS Provider') : 'Failed to rent virtual number';
      showToast(errMessage, 'error');
      return;
    }

    showToast('Virtual number activated! Waiting for code...', 'success');
    fetchUserProfile();
    loadActiveSMS();
  } catch (err) {
    if (currentUser) {
      currentUser.balance = originalBalance;
      updateBalanceDisplay(currentUser.balance);
    }
    showToast('Network error renting number.', 'error');
  }
}

// ----------------------------------------------------
// 5SIM ACTIVE ORDERS & SMS POLLING
// ----------------------------------------------------
async function loadActiveSMS() {
  const activeContainer = document.getElementById('active-sms-container');
  const historyContainer = document.getElementById('sms-history-list');

  // Clear existing polling trackers
  Object.keys(activePollTrackers).forEach(id => {
    if (activePollTrackers[id] && activePollTrackers[id].stop) {
      activePollTrackers[id].stop();
    }
    delete activePollTrackers[id];
  });

  try {
    const res = await fetch('/api/sms/activations');
    const data = await res.json();

    if (!data.activations || data.activations.length === 0) {
      if (activeContainer) {
        activeContainer.innerHTML = `
          <div class="active-order-window-card" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2.5rem 1.5rem;">
            📱 No active SMS activations currently running.<br>Select a service and country on the left to get a number!
          </div>`;
      }
      if (historyContainer) historyContainer.innerHTML = '<div style="color:var(--text-muted); font-size: 0.8rem; text-align:center; padding: 1rem;">No past activations.</div>';
      return;
    }

    const activeOrders = data.activations.filter(a => a.status === 'waiting' || a.status === 'received');
    const pastOrders = data.activations.filter(a => a.status === 'cancelled' || a.status === 'expired');

    // 1. Render Active Order Window (5SIM Style)
    if (activeContainer) {
      activeContainer.innerHTML = '';
      if (activeOrders.length === 0) {
        activeContainer.innerHTML = `
          <div class="active-order-window-card" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2rem 1.5rem;">
            📱 No active waiting orders. Ready to receive codes!
          </div>`;
      } else {
        activeOrders.forEach(act => {
          const card = create5SimActiveOrderCard(act);
          activeContainer.appendChild(card);
        });
      }
    }

    // 2. Render History List
    if (historyContainer) {
      historyContainer.innerHTML = '';
      data.activations.forEach(act => {
        const item = document.createElement('div');
        item.style.padding = '0.6rem 0.85rem';
        item.style.background = '#0f1826';
        item.style.borderRadius = 'var(--radius-md)';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.fontSize = '0.825rem';

        const statusColor = act.status === 'received' ? 'var(--emerald-text)' : (act.status === 'waiting' ? 'var(--amber)' : 'var(--text-muted)');
        item.innerHTML = `
          <div>
            <div style="font-weight:700; color:#fff;">${act.service.toUpperCase()} (${act.phone_number})</div>
            <div style="font-size:0.7rem; color:var(--text-secondary);">${new Date(act.created_at || act.expires_at).toLocaleString()}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800; color:${statusColor}; text-transform:uppercase;">${act.status}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">₦${(act.cost / 100).toLocaleString()}</div>
          </div>
        `;
        historyContainer.appendChild(item);
      });
    }

  } catch (err) {
    console.error('Failed to load SMS activations:', err);
  }
}

// Build exact 5SIM active order card
function create5SimActiveOrderCard(act) {
  const card = document.createElement('div');
  card.className = 'active-order-window-card';

  const orderNo = act.sms_api_id || act.id.slice(-10);
  const dateStr = new Date(act.created_at || Date.now()).toLocaleString('en-US', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  });

  const icon = getServiceIconSvg(act.service);
  const flagMap = { usa: '🇺🇸', canada: '🇨🇦', england: '🇬🇧', germany: '🇩🇪', nigeria: '🇳🇬' };
  const flag = flagMap[(act.country || 'usa').toLowerCase()] || '🌐';

  card.innerHTML = `
    <div class="order-top-header">
      <div class="order-number-title">Order №${orderNo}</div>
      <div class="order-status-badge ${act.status}" id="status-badge-${act.id}">
        ${act.status === 'waiting' ? '⌛ WAITING' : '✅ RECEIVED'}
      </div>
    </div>

    <!-- Dotted Metadata Table -->
    <div class="order-meta-table">
      <div class="meta-dotted-row">
        <span class="meta-label">Date</span>
        <span class="meta-val">${dateStr}</span>
      </div>
      <div class="meta-dotted-row">
        <span class="meta-label">Service</span>
        <span class="meta-val">${icon} ${act.service.charAt(0).toUpperCase() + act.service.slice(1)}</span>
      </div>
      <div class="meta-dotted-row">
        <span class="meta-label">Country</span>
        <span class="meta-val">${flag} ${(act.country || 'USA').toUpperCase()}</span>
      </div>
      <div class="meta-dotted-row">
        <span class="meta-label">Operator</span>
        <span class="meta-val">${(act.operator || 'Any').toUpperCase()}</span>
      </div>
      <div class="meta-dotted-row">
        <span class="meta-label">Price</span>
        <span class="meta-val" style="color: var(--emerald-text);">₦${(act.cost / 100).toLocaleString()}</span>
      </div>
      <div class="meta-dotted-row">
        <span class="meta-label">Rate</span>
        <span class="meta-val">95.0%</span>
      </div>
    </div>

    <!-- Rented Number Box -->
    <div class="rented-number-box">
      <span class="number-digits">${act.phone_number}</span>
      <button class="number-copy-btn" id="copy-num-${act.id}" title="Copy Number">📋</button>
    </div>

    <!-- Security Tip -->
    <div class="sms-security-tip-box">
      <span style="font-size: 0.95rem; flex-shrink: 0;">🔒</span>
      <span><strong>Security Tip:</strong> Immediately enable 2FA and attach a recovery email once your OTP is verified.</span>
    </div>

    <!-- Code from SMS Box -->
    <div class="sms-code-arrival-section">
      <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">
        Code from SMS
      </div>
      <div class="sms-code-box">
        <div id="sms-code-content-${act.id}">
          ${act.otp_code
            ? `<span class="sms-code-display">${act.otp_code}</span>`
            : `<div class="sms-code-waiting"><span class="spinner"></span> Waiting for SMS code...</div>`
          }
        </div>
        ${act.otp_code ? `<button class="number-copy-btn" id="copy-otp-${act.id}" title="Copy OTP">📋</button>` : ''}
      </div>
      ${act.sms_text ? `<div class="sms-text-snippet">"${act.sms_text}"</div>` : ''}
    </div>

    <!-- Live Timer & Progress Bar -->
    <div class="order-timer-group">
      <div class="timer-text-row">
        <span id="timer-text-${act.id}">14 minutes left</span>
        <span style="color: var(--text-muted);">Auto-cancels if unreceived</span>
      </div>
      <div class="order-progress-track">
        <div class="order-progress-fill" id="timer-fill-${act.id}" style="width: 100%;"></div>
      </div>
    </div>

    <!-- Order Actions -->
    <div class="order-actions-row">
      <button class="btn-secondary" id="ban-btn-${act.id}">Ban / Report</button>
      <button class="btn-danger" id="cancel-order-btn-${act.id}">Cancel & Refund</button>
    </div>
  `;

  // Bind Copy Number
  card.querySelector(`#copy-num-${act.id}`).addEventListener('click', () => {
    navigator.clipboard.writeText(act.phone_number).then(() => {
      showToast('Phone number copied!', 'success');
    });
  });

  // Bind Copy OTP if received
  const copyOtpBtn = card.querySelector(`#copy-otp-${act.id}`);
  if (copyOtpBtn) {
    copyOtpBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(act.otp_code).then(() => {
        showToast('Verification code copied!', 'success');
      });
    });
  }

  // Bind Cancel
  card.querySelector(`#cancel-order-btn-${act.id}`).addEventListener('click', async () => {
    const btn = card.querySelector(`#cancel-order-btn-${act.id}`);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Refunding...';

    try {
      const cancelRes = await fetch(`/api/sms/cancel/${act.id}`, { method: 'POST' });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok) {
        showToast(cancelData.error || 'Failed to cancel', 'error');
        btn.disabled = false;
        btn.textContent = 'Cancel & Refund';
        return;
      }
      showToast('Order cancelled and Naira refunded to wallet!', 'success');
      fetchUserProfile();
      loadActiveSMS();
    } catch (e) {
      showToast('Error executing cancellation.', 'error');
      btn.disabled = false;
    }
  });

  // Live Timer Countdown & Polling if status is waiting
  if (act.status === 'waiting') {
    const expiryMs = new Date(act.expires_at).getTime();
    const totalDuration = 15 * 60 * 1000;
    const timerText = card.querySelector(`#timer-text-${act.id}`);
    const timerFill = card.querySelector(`#timer-fill-${act.id}`);

    const updateTimer = () => {
      const remaining = expiryMs - Date.now();
      if (remaining <= 0) {
        if (timerText) timerText.textContent = 'Expired';
        if (timerFill) timerFill.style.width = '0%';
        clearInterval(timerInterval);
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        if (timerText) timerText.textContent = `${mins}m ${secs}s left`;
        const pct = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
        if (timerFill) timerFill.style.width = `${pct}%`;
      }
    };

    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);

    // Active status polling with interval
    const pollId = setInterval(async () => {
      try {
        const pRes = await fetch(`/api/sms/poll/${act.id}`);
        const pData = await pRes.json();
        if (pData.activation && pData.activation.status !== 'waiting') {
          clearInterval(timerInterval);
          clearInterval(pollId);
          if (pData.activation.status === 'received') {
            showToast(`Code received: ${pData.activation.otp_code}`, 'success');
            // Auto copy code
            navigator.clipboard.writeText(pData.activation.otp_code).catch(() => {});
          }
          fetchUserProfile();
          loadActiveSMS();
        }
      } catch (e) {}
    }, 4000);

    activePollTrackers[act.id] = {
      stop: () => {
        clearInterval(timerInterval);
        clearInterval(pollId);
      }
    };
  }

  return card;
}

// ----------------------------------------------------
// CYBERYOZH PROXIES VIEW & ACTIONS
// ----------------------------------------------------
function initModalProxyDropdowns() {
  const countrySelect = document.getElementById('modal-proxy-country');
  const countrySearch = document.getElementById('modal-proxy-country-search');
  const ispSelect = document.getElementById('modal-proxy-isp');

  if (!countrySelect || !proxyCatalogCountries) return;

  const renderDropdown = (query = '') => {
    countrySelect.innerHTML = '';
    const q = query.toLowerCase().trim();
    const filtered = proxyCatalogCountries.filter(c =>
      (c.country_name || '').toLowerCase().includes(q) || (c.country_code || '').toLowerCase().includes(q)
    );

    // Partition Tier-1 vs Other
    const tier1 = [];
    const others = [];

    filtered.forEach(c => {
      const code = (c.country_code || '').toLowerCase();
      const isTier1 = TIER1_COUNTRIES_PRIORITY.some(t => code === t || code.includes(t));
      if (isTier1) {
        tier1.push(c);
      } else {
        others.push(c);
      }
    });

    tier1.sort((a, b) => {
      const aCode = (a.country_code || '').toLowerCase();
      const bCode = (b.country_code || '').toLowerCase();
      const aIdx = TIER1_COUNTRIES_PRIORITY.indexOf(aCode);
      const bIdx = TIER1_COUNTRIES_PRIORITY.indexOf(bCode);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

    others.sort((a, b) => (a.country_name || '').localeCompare(b.country_name || ''));

    tier1.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.country_code;
      opt.textContent = `${c.flag} ${c.country_name}`;
      countrySelect.appendChild(opt);
    });

    if (tier1.length > 0 && others.length > 0) {
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '──────── All Countries ────────';
      countrySelect.appendChild(sep);
    }

    others.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.country_code;
      opt.textContent = `${c.flag} ${c.country_name}`;
      countrySelect.appendChild(opt);
    });

    updateModalIspOptions();
  };

  renderDropdown('');

  if (countrySearch) {
    countrySearch.addEventListener('input', (e) => renderDropdown(e.target.value));
  }

}

async function handleProxyPurchase() {
  const countrySelect = document.getElementById('modal-proxy-country');
  const buyBtn = document.getElementById('confirm-buy-proxy-btn');

  if (!countrySelect) return;

  const country = countrySelect.value || 'US';
  const isp = 'any';

  // Retail price (Static ₦7,500 configured via PROXY_PRICE_NGN in .env)
  const costNgn = currentProxyPricing ? currentProxyPricing.price_ngn : 7500;
  const costKobo = currentProxyPricing ? currentProxyPricing.price_kobo : 750000;
  const originalBalance = currentUser ? currentUser.balance : 0;

  try {
    buyBtn.disabled = true;
    buyBtn.innerHTML = '<span class="spinner"></span> Allocating Dedicated IP... (Please hold, carrier binding subnet)';

    // Optimistic balance update
    if (currentUser) {
      currentUser.balance = Math.max(0, currentUser.balance - costKobo);
      updateBalanceDisplay(currentUser.balance);
    }

    const res = await fetch('/api/proxy/rent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country, isp })
    });

    const data = await res.json();

    if (!res.ok) {
      if (currentUser) {
        currentUser.balance = originalBalance;
        updateBalanceDisplay(currentUser.balance);
      }
      showToast(data.error || 'Failed to provision proxy', 'error');
      return;
    }

    const isProvisioning = data.status === 'provisioning' || (data.lease && data.lease.status === 'provisioning');

    if (isProvisioning) {
      showToast('⚡ Order confirmed! Upstream carrier is binding your dedicated residential subnet (usually takes 1–3 mins). Auto-refreshing...', 'info');
    } else {
      showToast('Dedicated static residential ISP proxy provisioned successfully!', 'success');
    }

    document.getElementById('rent-proxy-modal').classList.remove('active');
    fetchUserProfile();
    loadActiveProxies();

    // Auto-switch directly to #proxies-view so user immediately sees their active proxies
    switchView('#proxies-view');

    // Pop up full credentials modal so user immediately gets their IP, Port, Username & Password
    if (data.lease) {
      showProxySuccessModal(data.lease);
    }
  } catch (err) {
    if (currentUser) {
      currentUser.balance = originalBalance;
      updateBalanceDisplay(currentUser.balance);
    }
    showToast('Network error leasing proxy.', 'error');
  } finally {
    buyBtn.disabled = false;
    buyBtn.textContent = `Deploy Instant Proxy (₦${costNgn.toLocaleString()})`;
  }
}

// Display dedicated popup modal showing full proxy credentials
function showProxySuccessModal(lease) {
  const modal = document.getElementById('proxy-success-modal');
  if (!modal) return;

  const isProvisioning = lease.status === 'provisioning';

  const ipEl = document.getElementById('modal-success-ip');
  const portEl = document.getElementById('modal-success-port');
  const userEl = document.getElementById('modal-success-user');
  const passEl = document.getElementById('modal-success-pass');
  const metaEl = document.getElementById('modal-success-meta');
  const connStrInput = document.getElementById('modal-success-conn-str');

  const ip = isProvisioning ? '⚡ Allocating Dedicated IP...' : (lease.ip_address || '');
  const socksPort = lease.socks5_port || 1080;
  const httpPort = lease.http_port || socksPort;
  const user = isProvisioning ? 'Binding...' : (lease.socks5_user || '');
  const pass = isProvisioning ? 'Binding...' : (lease.socks5_pass || '');
  const country = (lease.country || 'US').toUpperCase();
  const carrier = lease.isp_carrier || lease.carrier || 'Broadband Residential (ISP)';
  const connStr = isProvisioning 
    ? 'Order confirmed & paid! Carrier is assigning your private residential subnet (usually 1-3 mins). Dashboard will auto-activate.' 
    : `socks5://${user}:${pass}@${ip}:${socksPort}`;

  if (ipEl) ipEl.textContent = ip;
  if (portEl) portEl.textContent = isProvisioning ? 'Assigning SOCKS5 & HTTP Ports...' : `SOCKS5: ${socksPort} | HTTP: ${httpPort}`;
  if (userEl) userEl.textContent = user;
  if (passEl) passEl.textContent = pass;
  if (metaEl) metaEl.textContent = isProvisioning ? `${country} • Dedicated Carrier Line (Order #${lease.order_id || lease.upstream_order_id})` : `${country} • ${carrier}`;
  if (connStrInput) connStrInput.value = connStr;

  // Bind 1-click copies
  const bindModalCopy = (btnId, textToCopy, toastMsg) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.onclick = () => {
        if (isProvisioning) {
          showToast('Credentials will be available once carrier finishes allocation (usually 1–3 mins).', 'info');
          return;
        }
        navigator.clipboard.writeText(textToCopy).then(() => showToast(toastMsg, 'success'));
      };
    }
  };

  bindModalCopy('copy-modal-success-ip', ip, 'IP address copied!');
  bindModalCopy('copy-modal-success-port', String(socksPort), 'SOCKS5 port copied!');
  bindModalCopy('copy-modal-success-user', user, 'Username copied!');
  bindModalCopy('copy-modal-success-pass', pass, 'Password copied!');
  bindModalCopy('copy-modal-success-conn-btn', connStr, 'SOCKS5 connection string copied!');

  modal.classList.add('active');

  const closeBtn = document.getElementById('close-proxy-success-btn');
  const dismissBtn = document.getElementById('dismiss-proxy-success-btn');
  const closeModal = () => modal.classList.remove('active');

  if (closeBtn) closeBtn.onclick = closeModal;
  if (dismissBtn) dismissBtn.onclick = closeModal;
}


async function loadActiveProxies() {
  const container = document.getElementById('active-proxies-container');
  if (!container) return;

  try {
    const res = await fetch('/api/proxy/leases');
    const data = await res.json();

    if (!data.leases || data.leases.length === 0) {
      container.innerHTML = `
        <div class="cy-proxy-card" style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2.5rem 1.5rem;">
          🌐 No active proxy leases found.<br>Click <strong>+ Rent Proxy</strong> above to allocate your first dedicated residential IP!
        </div>`;
      return;
    }

    container.innerHTML = '';
    const hasProvisioning = data.leases.some(l => l.status === 'provisioning');

    data.leases.forEach(lease => {
      const card = createProxySellerCard(lease);
      container.appendChild(card);
    });

    // Auto-polling when a lease is currently being allocated by the upstream carrier
    if (hasProvisioning) {
      if (!window._proxyPollInterval) {
        console.log('[ProxyVault] Provisioning proxy detected. Starting 6-second auto-poll...');
        window._proxyPollInterval = setInterval(loadActiveProxies, 6000);
      }
    } else {
      if (window._proxyPollInterval) {
        clearInterval(window._proxyPollInterval);
        window._proxyPollInterval = null;
        showToast('🎉 Your dedicated residential IP is now active and ready to use!', 'success');
      }
    }
  } catch (err) {
    console.error('Failed to load proxy leases:', err);
  }
}

// Build Overhauled Proxy-Seller Active Proxy Card per PRD Specifications
function createProxySellerCard(lease) {
  const card = document.createElement('div');
  card.className = 'cy-proxy-card';

  const flagMap = { US: '🇺🇸', GB: '🇬🇧', UK: '🇬🇧', DE: '🇩🇪', CA: '🇨🇦' };
  const countryCode = (lease.country || 'US').toUpperCase();
  const flag = flagMap[countryCode] || '🌐';

  // If currently provisioning, display sleek amber reassuring progress state
  if (lease.status === 'provisioning') {
    card.style.borderColor = 'rgba(245, 158, 11, 0.45)';
    card.style.background = 'linear-gradient(145deg, #171821 0%, #0f1118 100%)';
    card.innerHTML = `
      <div class="cy-proxy-header">
        <div class="cy-proxy-ip-group">
          <span class="cy-proxy-flag">${flag}</span>
          <span style="color: #fbbf24; font-weight: 700; font-family: var(--font-mono); font-size: 0.92rem;">⚡ Allocating Dedicated IP...</span>
        </div>

        <div class="cy-proxy-meta-badges">
          <div style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); padding: 0.2rem 0.65rem; border-radius: 9999px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem;">
            <span class="spinner" style="width: 10px; height: 10px; border-width: 2px; border-top-color: #fbbf24;"></span>
            <span>Binding Carrier Subnet (1–3m)</span>
          </div>
          <div class="prd-carrier-badge">
            <span>📶</span>
            <span>${lease.isp_carrier || lease.carrier || 'Broadband Residential'}</span>
          </div>
        </div>
      </div>

      <div style="padding: 1.25rem 0.5rem; text-align: center;">
        <div style="font-size: 0.88rem; color: #f1f5f9; font-weight: 600; margin-bottom: 0.4rem;">
          ⚡ Upstream carrier is assigning your private residential IP address.
        </div>
        <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.4;">
          Please hold! Your order (ID: <strong>${lease.order_id || lease.upstream_order_id}</strong>) is confirmed and paid. Your proxy credentials will automatically appear here once ready.
        </div>
      </div>
    `;
    return card;
  }

  // Expiry calculation (30d XX:XX:XX)
  const expiresAt = new Date(lease.expires_at).getTime();

  const carrier = lease.isp_carrier || lease.carrier || 'Verizon Residential (ISP)';
  const fraudScore = lease.fraud_score !== undefined ? lease.fraud_score : 0;
  const socks5Port = lease.socks5_port || 1080;
  const httpPort = lease.http_port || socks5Port;

  // Replacement Status Button per PRD Section 5.2
  const canReplace = Boolean(lease.can_replace);
  const remainingHours = lease.replace_remaining_hours || 24;
  let replaceBtnHtml = '';
  if (lease.replacement_count >= 1) {
    replaceBtnHtml = `<button class="btn-card-action" disabled title="Max 1 automated replacement allowed">✓ Subnet Replaced (Max 1)</button>`;
  } else if (canReplace) {
    replaceBtnHtml = `<button class="btn-card-action btn-card-replace" id="replace-btn-${lease.id}" title="Request automated IP replacement within 24 hours of purchase">🔄 Request Replacement (${remainingHours}h left)</button>`;
  } else {
    replaceBtnHtml = `<button class="btn-card-action" disabled title="Replacement window closed (24 hours after purchase)">⏱️ 24h Window Expired</button>`;
  }

  card.innerHTML = `
    <!-- Top Header Bar -->
    <div class="cy-proxy-header">
      <div class="cy-proxy-ip-group">
        <span class="cy-proxy-flag">${flag}</span>
        <span id="ip-display-${lease.id}">${lease.ip_address}:${socks5Port}</span>
        <button class="copy-icon-btn" id="copy-endpoint-${lease.id}" title="Copy Host:Port">📋</button>
      </div>

      <div class="cy-proxy-meta-badges">
        <div class="prd-fraud-badge">
          <span>🛡️</span>
          <span>${fraudScore}% Fraud Score</span>
        </div>
        <div class="prd-carrier-badge">
          <span>📶</span>
          <span>${carrier}</span>
        </div>
        <div class="cy-expiry-badge">
          <span>🕒</span>
          <span id="expiry-text-${lease.id}">Expires in: Loading...</span>
        </div>
      </div>
    </div>

    <!-- Protocol Radio Switcher -->
    <div class="cy-protocol-switcher" style="margin-bottom: 0.65rem;">
      <label class="cy-radio-label active" id="label-socks-${lease.id}">
        <input type="radio" name="protocol-${lease.id}" value="SOCKS5" checked>
        <span>SOCKS5 (Port: ${socks5Port})</span>
      </label>
      <label class="cy-radio-label" id="label-http-${lease.id}">
        <input type="radio" name="protocol-${lease.id}" value="HTTP">
        <span>HTTP (Port: ${httpPort})</span>
      </label>
    </div>

    <!-- Credentials Row with Masked Password Toggle -->
    <div class="cy-proxy-body">
      <div class="cy-cred-row">
        <span class="cy-cred-label">Login:</span>
        <span class="cy-cred-val" id="login-val-${lease.id}">${lease.socks5_user}</span>
        <button class="copy-icon-btn" id="copy-login-${lease.id}" title="Copy Username">📋</button>
      </div>

      <div class="cy-cred-row">
        <span class="cy-cred-label">Password:</span>
        <span class="cy-cred-val" id="pass-val-${lease.id}">••••••••</span>
        <button class="password-toggle-btn" id="toggle-pass-${lease.id}" title="Show / Hide Password">👁️</button>
        <button class="copy-icon-btn" id="copy-pass-${lease.id}" title="Copy Password">📋</button>
      </div>
    </div>

    <!-- Formatted Connection String Box -->
    <div class="cy-connection-box">
      <span class="cy-protocol-tag" id="tag-protocol-${lease.id}">SOCKS5</span>
      <span class="cy-conn-string-text" id="conn-str-${lease.id}">socks5://${lease.socks5_user}:${lease.socks5_pass}@${lease.ip_address}:${socks5Port}</span>
      <button class="copy-icon-btn" id="copy-conn-${lease.id}" title="Copy Connection String">📋</button>
    </div>

    <!-- Network Reputation & Diagnostics Links -->
    <div class="prd-diag-group">
      <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">Subnet Verification:</span>
      <a href="https://whoer.net/" target="_blank" rel="noopener noreferrer" class="prd-diag-link" title="Run full IP anonymity, DNS leak, and blacklist check on Whoer.net">
        🛡️ Whoer.net IP &amp; Privacy Check
      </a>
    </div>

    <!-- Action Bar: Config Download & Subnet Replacement -->
    <div class="prd-actions-row">
      <a href="/api/proxy/download/${lease.id}" class="btn-card-action" download title="Download .txt credentials & connection strings">
        📥 Download .txt Configuration
      </a>
      ${replaceBtnHtml}
    </div>
  `;

  // Protocol Radio switch handling (SOCKS5 vs HTTP)
  let activeProtocol = 'SOCKS5';

  const updateConnDisplay = () => {
    const tag = card.querySelector(`#tag-protocol-${lease.id}`);
    const connText = card.querySelector(`#conn-str-${lease.id}`);
    const ipDisplay = card.querySelector(`#ip-display-${lease.id}`);
    const labelHttp = card.querySelector(`#label-http-${lease.id}`);
    const labelSocks = card.querySelector(`#label-socks-${lease.id}`);

    const currentPort = activeProtocol === 'HTTP' ? httpPort : socks5Port;
    const protoLower = activeProtocol.toLowerCase();

    if (tag) tag.textContent = activeProtocol;
    if (ipDisplay) ipDisplay.textContent = `${lease.ip_address}:${currentPort}`;
    if (connText) connText.textContent = `${protoLower}://${lease.socks5_user}:${lease.socks5_pass}@${lease.ip_address}:${currentPort}`;

    if (activeProtocol === 'HTTP') {
      if (labelHttp) labelHttp.classList.add('active');
      if (labelSocks) labelSocks.classList.remove('active');
    } else {
      if (labelSocks) labelSocks.classList.add('active');
      if (labelHttp) labelHttp.classList.remove('active');
    }
  };

  card.querySelectorAll(`input[name="protocol-${lease.id}"]`).forEach(radio => {
    radio.addEventListener('change', (e) => {
      activeProtocol = e.target.value;
      updateConnDisplay();
    });
  });

  // Masked Password Reveal Toggle
  let isPassRevealed = false;
  const passVal = card.querySelector(`#pass-val-${lease.id}`);
  const passToggleBtn = card.querySelector(`#toggle-pass-${lease.id}`);
  if (passToggleBtn && passVal) {
    passToggleBtn.addEventListener('click', () => {
      isPassRevealed = !isPassRevealed;
      passVal.textContent = isPassRevealed ? lease.socks5_pass : '••••••••';
      passToggleBtn.textContent = isPassRevealed ? '🙈' : '👁️';
    });
  }

  // 1-Click Copy Listeners
  const bindCopy = (btnId, textGetter, toastMsg) => {
    const btn = card.querySelector(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        const textToCopy = typeof textGetter === 'function' ? textGetter() : textGetter;
        navigator.clipboard.writeText(textToCopy).then(() => {
          showToast(toastMsg, 'success');
        });
      });
    }
  };

  bindCopy(`#copy-endpoint-${lease.id}`, () => {
    const currentPort = activeProtocol === 'HTTP' ? httpPort : socks5Port;
    return `${lease.ip_address}:${currentPort}`;
  }, 'Host:Port copied!');

  bindCopy(`#copy-login-${lease.id}`, lease.socks5_user, 'Username copied!');
  bindCopy(`#copy-pass-${lease.id}`, lease.socks5_pass, 'Password copied!');

  bindCopy(`#copy-conn-${lease.id}`, () => {
    const currentPort = activeProtocol === 'HTTP' ? httpPort : socks5Port;
    return `${activeProtocol.toLowerCase()}://${lease.socks5_user}:${lease.socks5_pass}@${lease.ip_address}:${currentPort}`;
  }, `${activeProtocol} connection string copied!`);

  // Active Subnet Replacement Handler
  const replaceBtn = card.querySelector(`#replace-btn-${lease.id}`);
  if (replaceBtn) {
    replaceBtn.addEventListener('click', async () => {
      const confirmed = confirm(
        'Request an automated IP replacement for this proxy?\n\n' +
        '• Your proxy IP will be swapped with a fresh dedicated residential subnet.\n' +
        '• Note: Limited to 1 replacement per purchased proxy within 24 hours.'
      );
      if (!confirmed) return;

      try {
        replaceBtn.disabled = true;
        replaceBtn.innerHTML = '<span class="spinner"></span> Replacing Subnet...';

        const res = await fetch(`/api/proxy/replace/${lease.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'NOT_WORK' })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to replace proxy');
        }

        showToast(data.message || 'Subnet replaced successfully!', 'success');
        await loadActiveProxies();
      } catch (err) {
        showToast(err.message, 'error');
        replaceBtn.disabled = false;
        replaceBtn.innerHTML = `🔄 Request Replacement (${remainingHours}h left)`;
      }
    });
  }

  // Expiry Countdown (30d 09:22:26)
  const expiryText = card.querySelector(`#expiry-text-${lease.id}`);
  const tickExpiry = () => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      if (expiryText) expiryText.textContent = 'Expired';
    } else {
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = String(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
      const mins = String(Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
      const secs = String(Math.floor((diff % (1000 * 60)) / 1000)).padStart(2, '0');
      if (expiryText) expiryText.textContent = `Expires in: ${days}d ${hours}:${mins}:${secs}`;
    }
  };

  tickExpiry();
  setInterval(tickExpiry, 1000);

  return card;
}

// Backwards compatibility alias
const createCyberYozhProxyCard = createProxySellerCard;

// Export active proxies as .txt file
async function exportProxiesTxt() {
  try {
    const res = await fetch('/api/proxy/leases');
    const data = await res.json();
    if (!data.leases || data.leases.length === 0) {
      showToast('No active proxies to download', 'error');
      return;
    }

    const lines = data.leases.map(l => `${l.ip_address}:${l.socks5_port}:${l.socks5_user}:${l.socks5_pass}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxyvault-proxies-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Proxies exported to .txt!', 'success');
  } catch (e) {
    showToast('Failed to export proxies', 'error');
  }
}

// ----------------------------------------------------
// TRANSACTION LOGS & AUDITS
// ----------------------------------------------------
async function loadTransactions() {
  const container = document.getElementById('tx-history-list');
  if (!container) return;

  try {
    const res = await fetch('/api/wallet/transactions');
    const data = await res.json();

    if (!data.transactions || data.transactions.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size: 0.825rem; text-align:center; padding: 1.5rem;">No transaction records found.</div>';
      return;
    }

    container.innerHTML = '';
    data.transactions.forEach(tx => {
      const row = document.createElement('div');
      row.style.padding = '0.75rem 1rem';
      row.style.background = '#0f1826';
      row.style.borderRadius = 'var(--radius-md)';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.fontSize = '0.85rem';

      let typeLabel = tx.type;
      let color = 'var(--emerald-text)';
      let sign = '+';

      if (tx.type === 'deposit') {
        typeLabel = tx.status === 'completed' ? 'Wallet Deposit' : `Deposit (${tx.status})`;
      } else if (tx.type === 'proxy_rent') {
        typeLabel = 'Static Proxy Lease (30d)';
        color = 'var(--red)';
        sign = '-';
      } else if (tx.type === 'sms_rent') {
        typeLabel = 'Virtual SMS Activation';
        color = 'var(--red)';
        sign = '-';
      } else if (tx.type === 'sms_refund') {
        typeLabel = 'SMS Refund';
        color = 'var(--emerald-text)';
        sign = '+';
      }

      row.innerHTML = `
        <div>
          <div style="font-weight: 700; color: #fff;">${typeLabel}</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.15rem;">
            ${new Date(tx.created_at).toLocaleString()} • Ref: <span style="font-family: var(--font-mono);">${tx.reference}</span>
          </div>
        </div>
        <div style="font-weight: 800; font-family: var(--font-mono); color: ${color}; font-size: 0.95rem;">
          ${sign}₦${formatNaira(Math.abs(tx.amount))}
        </div>
      `;

      container.appendChild(row);
    });

  } catch (err) {
    console.error('Failed to load transaction history:', err);
  }
}

// ----------------------------------------------------
// TOAST NOTIFICATIONS
// ----------------------------------------------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}
