// Tab switching
function showTab(tab) {
  document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

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

// Login
async function login() {
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
    } else {
      window.location.href = 'agent-dashboard.html';
    }
  } else {
    alert(data.error || 'Login failed');
  }
}

// Register
async function register() {
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const fullName = document.getElementById('regFullName').value;
  
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role: 'player', fullName })
  });
  
  const data = await res.json();
  
  if (res.ok) {
    alert('Registration successful! Please login.');
    showTab('login');
  } else {
    alert(data.error || 'Registration failed');
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
    window.location.href = '/';
  }
}
