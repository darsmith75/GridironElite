const nodemailer = require('nodemailer');
const { getClientIp } = require('./helpers');

// ---------------------------------------------------------------------------
// URL & HTML helpers
// ---------------------------------------------------------------------------

function getPublicAppUrl(req) {
  const configured = String(process.env.APP_URL || process.env.PUBLIC_BASE_URL || '').trim();
  const configuredSanitized = configured.replace(/\/$/, '');
  const isConfiguredLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(configuredSanitized);

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req?.get?.('host') || req?.headers?.host;
  const protocol = forwardedProto || req?.protocol || 'https';

  if (configuredSanitized && !isConfiguredLocal) {
    return configuredSanitized;
  }

  if (host) {
    return `${protocol}://${host}`.replace(/\/$/, '');
  }

  if (configuredSanitized) {
    return configuredSanitized;
  }

  return 'https://gridironathletes.com';
}

function escapeHtmlEmail(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Shared transporter factory
// ---------------------------------------------------------------------------

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
}

// ---------------------------------------------------------------------------
// Email senders
// ---------------------------------------------------------------------------

async function sendVerificationEmail(toEmail, token, req) {
  const appUrl = getPublicAppUrl(req);
  const verifyUrl = `${appUrl}/api/verify-email?token=${token}`;
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Verify your Gridiron Athletes account',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Welcome to Gridiron Athletes!</h2>
        <p>Thanks for registering. Click the button below to verify your email address and activate your account.</p>
        <p style="margin:32px 0">
          <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Verify Email Address</a>
        </p>
        <p style="color:#6b7280;font-size:13px">If you didn't create a Gridiron Athletes account, you can safely ignore this email.</p>
      </div>
    `,
    text: `Welcome to Gridiron Athletes!\n\nPlease verify your email address by visiting the link below:\n\n${verifyUrl}\n\nIf you didn't create an account, please ignore this email.`
  });
}

async function sendPasswordResetEmail(toEmail, token, req) {
  const appUrl = getPublicAppUrl(req);
  const resetUrl = `${appUrl}/reset-password.html?token=${token}`;
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Reset your Gridiron Athletes password',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Password reset request</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one.</p>
        <p style="margin:32px 0">
          <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Reset Password</a>
        </p>
        <p style="color:#6b7280;font-size:13px">This link expires in 60 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `Use this link to reset your password (valid for 60 minutes):\n\n${resetUrl}`
  });
}

async function sendSupportContactEmail({ name, email, subject, message, req }) {
  const transporter = createTransporter();
  const toAddress = process.env.SUPPORT_CONTACT_TO || 'nextupinfootball@gmail.com';
  const safeName = escapeHtmlEmail(name);
  const safeEmail = escapeHtmlEmail(email);
  const safeSubject = escapeHtmlEmail(subject);
  const safeMessage = escapeHtmlEmail(message).replace(/\n/g, '<br/>');
  const ip = getClientIp(req) || 'unknown';

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toAddress,
    replyTo: email,
    subject: `[Gridiron Support] ${subject}`,
    html: `
      <div style="font-family:sans-serif;max-width:680px;margin:auto;padding:20px">
        <h2 style="color:#1e3a5f;margin:0 0 12px;">New Contact Support Submission</h2>
        <p style="margin:0 0 6px;"><strong>Name:</strong> ${safeName}</p>
        <p style="margin:0 0 6px;"><strong>Email:</strong> ${safeEmail}</p>
        <p style="margin:0 0 6px;"><strong>Subject:</strong> ${safeSubject}</p>
        <p style="margin:0 0 16px;"><strong>IP:</strong> ${escapeHtmlEmail(ip)}</p>
        <div style="border:1px solid #d6deea;border-radius:10px;padding:14px;background:#f8fafc;">
          <p style="margin:0;white-space:pre-wrap;line-height:1.55;">${safeMessage}</p>
        </div>
      </div>
    `,
    text: [
      'New Contact Support Submission',
      `Name: ${name}`,
      `Email: ${email}`,
      `Subject: ${subject}`,
      `IP: ${ip}`,
      '',
      message
    ].join('\n')
  });
}

async function sendTeamInviteEmail(toEmail, inviteToken, coachName, teamName, schoolName, req) {
  const appUrl = getPublicAppUrl(req);
  const acceptUrl = `${appUrl}/coach-dashboard.html?acceptInvite=${inviteToken}`;
  const transporter = createTransporter();
  const displaySchool = schoolName ? ` at ${schoolName}` : '';
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: `You've been invited to join ${teamName} on Gridiron Athletes`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Team Invitation</h2>
        <p>${coachName || 'Your coach'} has invited you to join <strong>${teamName}</strong>${displaySchool} on Gridiron Athletes.</p>
        <p>Click the button below to accept the invitation and join the team.</p>
        <p style="margin:32px 0">
          <a href="${acceptUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Accept Invitation</a>
        </p>
        <p style="color:#6b7280;font-size:13px">This invitation expires in 7 days. If you don't have an account yet, please register as an Athlete first, then click the link above.</p>
        <p style="color:#6b7280;font-size:13px">If you did not expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
    text: `${coachName || 'Your coach'} has invited you to join ${teamName}${displaySchool} on Gridiron Athletes.\n\nAccept the invitation here:\n${acceptUrl}\n\nThis invitation expires in 7 days.`
  });
}

async function sendRecruiterShareEmail({
  toEmail,
  shareToken,
  coachName,
  teamName,
  schoolName,
  subject,
  message,
  playerCount,
  expiresAt,
  appUrl
}) {
  const shareUrl = `${appUrl}/recruiter-share.html?token=${encodeURIComponent(shareToken)}`;
  const transporter = createTransporter();
  const safeSubject = String(subject || '').trim() || `${teamName || 'Team'} Player Profiles`;
  const displaySchool = schoolName ? ` (${schoolName})` : '';
  const escapedMessage = escapeHtmlEmail(message || '').trim();
  const expiresText = new Date(expiresAt).toLocaleString();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: safeSubject,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <div style="background:#1e3c72;border-radius:10px;padding:12px 14px;margin:0 0 12px;">
          <h2 style="color:#ffffff;margin:0;">Player Profiles Shared With You</h2>
        </div>
        <p><strong>${escapeHtmlEmail(coachName || 'A coach')}</strong> shared ${playerCount} player profile${playerCount === 1 ? '' : 's'} from <strong>${escapeHtmlEmail(teamName || 'their team')}</strong>${escapeHtmlEmail(displaySchool)}.</p>
        ${escapedMessage ? `<p style="background:#f5f8ff;border:1px solid #d9e4ff;border-radius:8px;padding:12px;white-space:pre-wrap;">${escapedMessage}</p>` : ''}
        <p style="margin:24px 0">
          <a href="${shareUrl}" style="background:#1e3c72;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">View Shared Players</a>
        </p>
        <p style="font-size:12px;color:#6b7280;">This secure link expires on ${escapeHtmlEmail(expiresText)}.</p>
      </div>
    `,
    text: `${coachName || 'A coach'} shared ${playerCount} player profile${playerCount === 1 ? '' : 's'} from ${teamName || 'their team'}${displaySchool}.\n\n${message ? `${message}\n\n` : ''}Open this secure link: ${shareUrl}\n\nThis link expires on ${expiresText}.`
  });
}

module.exports = {
  getPublicAppUrl,
  escapeHtmlEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSupportContactEmail,
  sendTeamInviteEmail,
  sendRecruiterShareEmail
};
