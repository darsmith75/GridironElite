// Tab switching
function showTab(tab) {
  document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';

  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeButtonIndex = tab === 'register' ? 1 : 0;
  const activeButton = document.querySelectorAll('.tab-btn')[activeButtonIndex];
  if (activeButton) activeButton.classList.add('active');
}

function setAuthMessage(message, type = 'info', targetId = 'authMessage') {
  const messageEl = document.getElementById(targetId);
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.className = `auth-message ${type}`;
  messageEl.style.display = 'block';
}

function clearAuthMessage(targetId = 'authMessage') {
  const messageEl = document.getElementById(targetId);
  if (!messageEl) return;
  messageEl.textContent = '';
  messageEl.className = 'auth-message';
  messageEl.style.display = 'none';
}

// Handle ?verified=... query param on page load
(function handleVerifiedParam() {
  const params = new URLSearchParams(window.location.search);
  const verified = params.get('verified');
  if (!verified) return;
  // Clean URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
  if (verified === 'true') {
    setAuthMessage('Email verified! You can now log in.', 'success');
  } else if (verified === 'already') {
    setAuthMessage('Your email is already verified. Please log in.', 'info');
  } else {
    setAuthMessage('This verification link is invalid or has already been used. Please register again or contact support.', 'error');
  }
})();

// Handle Enter key for login
function handleLoginKeyPress(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    login();
  }
}

// Handle Enter key for register
function handleRegisterKeyPress(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    register();
  }
}

function openForgotPasswordModal(event) {
  if (event) event.preventDefault();
  clearAuthMessage('forgotMessage');
  document.getElementById('forgotPasswordModal').style.display = 'flex';
  document.getElementById('forgotEmail').focus();
}

function closeForgotPasswordModal() {
  clearAuthMessage('forgotMessage');
  document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function requestPasswordReset() {
  clearAuthMessage('forgotMessage');
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) {
    setAuthMessage('Please enter your email address.', 'error', 'forgotMessage');
    return;
  }

  const res = await fetch('/api/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const data = await res.json();

  if (res.ok) {
    setAuthMessage(data.message || 'If an account exists for that email, you will receive a reset link shortly.', 'success');
    closeForgotPasswordModal();
    document.getElementById('forgotEmail').value = '';
  } else {
    setAuthMessage(data.error || 'Unable to send reset email right now.', 'error', 'forgotMessage');
  }
}

// Login
async function login() {
  clearAuthMessage();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await res.json();
  
  if (res.ok) {
    if (data.role === 'player') {
      window.location.href = 'player-profile.html';
    } else if (data.role === 'admin') {
      window.location.href = 'admin-dashboard.html';
    } else if (data.role === 'coach') {
      window.location.href = 'coach-dashboard.html';
    } else {
      window.location.href = 'agent-dashboard.html';
    }
  } else {
    setAuthMessage(data.error || 'Login failed', 'error');
  }
}

// Register
async function register() {
  clearAuthMessage();
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const fullName = document.getElementById('regFullName').value;
  const role = document.getElementById('regRole').value;
  
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role, fullName })
  });
  
  const data = await res.json();
  
  if (res.ok) {
    setAuthMessage('Account created! Please check your email for a verification link before logging in.', 'success');
    showTab('login');
  } else {
    setAuthMessage(data.error || 'Registration failed', 'error');
  }
}

// Logout
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

function normalizeNavLabel(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findTopNavLinkByLabel(nav, label) {
  const expected = normalizeNavLabel(label);
  const links = Array.from(nav.querySelectorAll('a.nav-link'));
  return links.find(link => normalizeNavLabel(link.textContent) === expected) || null;
}

function getProfilePathForRole(role) {
  if (role === 'player') return 'player-profile.html';
  if (role === 'admin') return 'admin-profile.html';
  if (role === 'coach') return 'coach-profile.html';
  return 'agent-profile.html';
}

function ensureDashboardLink(nav, shouldShow) {
  let dashboardLink = findTopNavLinkByLabel(nav, 'Dashboard');

  if (!shouldShow) {
    if (dashboardLink) dashboardLink.remove();
    return;
  }

  if (!dashboardLink) {
    dashboardLink = document.createElement('a');
    dashboardLink.className = 'nav-link';
    dashboardLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>Dashboard';

    const homeLink = findTopNavLinkByLabel(nav, 'Home');
    if (homeLink && homeLink.parentNode) {
      homeLink.insertAdjacentElement('afterend', dashboardLink);
    } else {
      nav.prepend(dashboardLink);
    }
  }

  dashboardLink.href = 'admin-dashboard.html';
}

function applyRoleBasedTopNav(user) {
  const nav = document.querySelector('.top-nav-menu');
  if (!nav || !user || !user.role) return;

  const homeLink = findTopNavLinkByLabel(nav, 'Home');
  if (homeLink) {
    if (user.role === 'player') homeLink.href = 'agent-dashboard.html';
    else if (user.role === 'coach') homeLink.href = 'coach-dashboard.html';
    else homeLink.href = 'agent-dashboard.html';
  }

  // Only admins retain access to the Messages area.
  const messagesLink = findTopNavLinkByLabel(nav, 'Messages');
  if (messagesLink) {
    messagesLink.style.display = user.role === 'admin' ? '' : 'none';
  }

  const profileLink = findTopNavLinkByLabel(nav, 'My Profile');
  if (profileLink) {
    profileLink.href = getProfilePathForRole(user.role);
    profileLink.style.display = ''; // Show for authenticated users
  }

  // Show Sign out, hide Login
  const signOutLink = findTopNavLinkByLabel(nav, 'Sign out');
  if (signOutLink) signOutLink.style.display = '';
  
  const loginLink = findTopNavLinkByLabel(nav, 'Login');
  if (loginLink) loginLink.style.display = 'none';

  ensureDashboardLink(nav, user.role === 'admin');
}

// Check authentication (requires valid session, redirects on failure)
async function checkAuth(requiredRole) {
  const res = await fetch('/api/user');
  
  if (!res.ok) {
    window.location.href = '/';
    return null;
  }
  
  const user = await res.json();
  if (requiredRole && user.role !== requiredRole) {
    // Admin can access any page
    if (user.role !== 'admin') {
      window.location.href = '/';
      return null;
    }
  }

  window.currentUser = user;
  applyRoleBasedTopNav(user);
  return user;
}

// Try authentication (optional, no redirect)
async function tryAuth() {
  try {
    const res = await fetch('/api/user');
    if (!res.ok) return null;
    
    const user = await res.json();
    window.currentUser = user;
    return user;
  } catch (_) {
    return null;
  }
}

// Apply nav for unauthenticated users (shows Login button)
function applyPublicTopNav() {
  const nav = document.querySelector('.top-nav-menu');
  if (!nav) return;

  // Hide Messages, My Profile and Sign out
  const messagesLink = findTopNavLinkByLabel(nav, 'Messages');
  if (messagesLink) messagesLink.style.display = 'none';
  
  const profileLink = findTopNavLinkByLabel(nav, 'My Profile');
  if (profileLink) profileLink.style.display = 'none';
  
  const signOutLink = findTopNavLinkByLabel(nav, 'Sign out');
  if (signOutLink) signOutLink.style.display = 'none';

  // Show or create Login button
  let loginLink = findTopNavLinkByLabel(nav, 'Login');
  if (!loginLink) {
    loginLink = document.createElement('a');
    loginLink.className = 'nav-link';
    loginLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H7a2 2 0 00-2 2v14a2 2 0 002 2h8"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Login';
    loginLink.href = '/login';
    nav.appendChild(loginLink);
  } else {
    loginLink.style.display = '';
    loginLink.href = '/login';
  }
}

async function loadAdSlots() {
  try {
    const res = await fetch('/api/ad-slots');
    if (!res.ok) return {};
    const data = await res.json();
    return data?.slots || {};
  } catch (_) {
    return {};
  }
}

function renderAdSlotHtml(slotEl, html) {
  slotEl.innerHTML = html;
  const scripts = Array.from(slotEl.querySelectorAll('script'));
  scripts.forEach(oldScript => {
    const newScript = document.createElement('script');
    for (const attr of oldScript.attributes) {
      newScript.setAttribute(attr.name, attr.value);
    }
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

async function applyManagedAdSlots(root = document) {
  const slotElements = Array.from(root.querySelectorAll('[data-ad-slot]'));
  if (!slotElements.length) return;

  const slots = await loadAdSlots();
  slotElements.forEach(slotEl => {
    const slotKey = slotEl.dataset.adSlot;
    const slotConfig = slots[slotKey];
    if (!slotConfig) return;

    if (slotConfig.enabled === false) {
      // Ad is disabled, keep hidden
      slotEl.style.display = 'none';
      return;
    }

    // Ad is enabled, show placeholder by default
    slotEl.style.display = 'flex';
    
    const contentHtml = String(slotConfig.contentHtml || '').trim();
    if (!contentHtml) {
      // No content configured yet, show placeholder
      return;
    }

    // Content is configured, render it
    renderAdSlotHtml(slotEl, contentHtml);
    slotEl.classList.add('ad-slot-configured');
  });
}

async function logPageView(pageKey, metadata = {}) {
  try {
    await fetch('/api/traffic/page-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageKey,
        pagePath: window.location.pathname,
        metadata
      })
    });
  } catch (_) {}
}
