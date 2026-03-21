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
  window.location.href = '/';
}

// Check authentication
async function checkAuth(requiredRole) {
  const res = await fetch('/api/user');
  
  if (!res.ok) {
    window.location.href = '/';
    return;
  }
  
  const user = await res.json();
  if (requiredRole && user.role !== requiredRole) {
    // Admin can access any page
    if (user.role !== 'admin') {
      window.location.href = '/';
    }
  }
}
