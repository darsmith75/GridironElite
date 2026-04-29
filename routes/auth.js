const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { isSupportContactRateLimited, isLikelyValidEmail, logSiteTrafficEvent, isLoginRateLimited, isForgotPasswordRateLimited } = require('../utils/helpers');
const { sendVerificationEmail, sendPasswordResetEmail, sendSupportContactEmail } = require('../utils/email');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { email, password, role, fullName } = req.body;
  const ALLOWED_PUBLIC_ROLES = ['player', 'agent', 'coach'];
  if (!ALLOWED_PUBLIC_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const result = await db.prepare(
      'INSERT INTO users (email, password, role, email_verified, email_verification_token) VALUES (?, ?, ?, false, ?)'
    ).run(email, hashedPassword, role, verificationToken);

    if (role === 'player') {
      await db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(result.lastInsertRowid, fullName);
    }

    if (role === 'coach') {
      const teamName = (fullName ? fullName + "'s Team" : 'My Team');
      await db.prepare('INSERT INTO hs_teams (coach_id, team_name) VALUES (?, ?)').run(result.lastInsertRowid, teamName);
    }

    // Send verification email (non-fatal – log error but still return success)
    try {
      await sendVerificationEmail(email, verificationToken, req);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    res.json({ success: true, message: 'Registration successful! Please check your email to verify your account.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: 'Email already exists or registration failed' });
  }
});

// Email verification
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return res.redirect('/?verified=invalid');
  }
  try {
    const user = await db.prepare('SELECT id, email_verified FROM users WHERE email_verification_token = ?').get(token);
    if (!user) {
      return res.redirect('/?verified=invalid');
    }
    if (user.email_verified) {
      return res.redirect('/?verified=already');
    }
    await db.prepare('UPDATE users SET email_verified = true, email_verification_token = NULL WHERE id = ?').run(user.id);
    res.redirect('/?verified=true');
  } catch (error) {
    console.error('Email verification error:', error);
    res.redirect('/?verified=error');
  }
});

// Forgot password - always return success so emails cannot be enumerated
router.post('/forgot-password', async (req, res) => {
  if (isForgotPasswordRateLimited(req)) {
    return res.status(429).json({ error: 'Too many reset requests. Please wait a few minutes and try again.' });
  }

  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    const user = await db.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?').get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + (60 * 60 * 1000));
      await db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?').run(token, expiresAt.toISOString(), user.id);
      try {
        await sendPasswordResetEmail(user.email, token, req);
      } catch (emailErr) {
        console.error('Failed to send password reset email:', emailErr.message);
      }
    }
    return res.json({ success: true, message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

router.post('/support/contact', async (req, res) => {
  try {
    if (isSupportContactRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
    }

    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
    }
    if (name.length > 120 || email.length > 180 || subject.length > 200 || message.length > 4000) {
      return res.status(400).json({ error: 'One or more fields are too long.' });
    }
    if (!isLikelyValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('Support contact email disabled: SMTP_USER or SMTP_PASS not configured');
      return res.status(503).json({ error: 'Email service is temporarily unavailable.' });
    }

    await sendSupportContactEmail({ name, email, subject, message, req });
    res.json({ success: true });
  } catch (error) {
    console.error('Support contact send error:', error);
    res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  const token = (req.body?.token || '').trim().toLowerCase();
  const newPassword = req.body?.newPassword || '';

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  try {
    const user = await db.prepare(
      'SELECT id, password_reset_expires FROM users WHERE password_reset_token = ?'
    ).get(token);

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const expiresAtMs = user.password_reset_expires ? new Date(user.password_reset_expires).getTime() : NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare(
      'UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?'
    ).run(hashedPassword, user.id);

    return res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    if (isLoginRateLimited(req)) {
      return res.status(429).json({ error: 'Too many login attempts. Please wait a few minutes and try again.' });
    }

    const { email, password } = req.body;
    let user;
    try {
      user = await db.prepare(
        'SELECT id, email, password AS password_hash, role, is_active, email_verified FROM users WHERE email = ?'
      ).get(email);
    } catch (queryError) {
      // Backward compatibility for environments where is_active has not been migrated yet.
      if (!/is_active/i.test(String(queryError?.message || ''))) throw queryError;
      user = await db.prepare(
        'SELECT id, email, password AS password_hash, role, email_verified FROM users WHERE email = ?'
      ).get(email);
    }

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_active === false) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox for the verification link.' });
    }

    await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?').run(user.id);

    req.session.userId = user.id;
    req.session.role = user.role;
    await logSiteTrafficEvent({
      req,
      eventType: 'login',
      path: '/login',
      method: 'POST',
      userId: user.id,
      role: user.role,
      metadata: { email: user.email }
    });
    res.json({ success: true, role: user.role });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
router.get('/user', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

module.exports = router;
