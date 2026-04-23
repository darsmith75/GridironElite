const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { getAdSlotsMap, logSiteTrafficEvent } = require('../utils/helpers');
const { enrichPlayerProfile } = require('../utils/enrich-player');

const router = express.Router();

router.get('/ad-slots', async (req, res) => {
  try {
    const slots = await getAdSlotsMap();
    res.json({ slots });
  } catch (error) {
    console.error('Get ad slots error:', error);
    res.status(500).json({ error: 'Failed to load ad slots' });
  }
});

router.post('/traffic/page-view', requireAuth, async (req, res) => {
  try {
    const pageKey = String(req.body?.pageKey || '').trim();
    const pagePath = String(req.body?.pagePath || '').trim();
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

    if (!pageKey) {
      return res.status(400).json({ error: 'Missing page key' });
    }

    await logSiteTrafficEvent({
      req,
      eventType: 'page_view',
      path: pagePath || pageKey,
      method: 'GET',
      userId: req.session.userId,
      role: req.session.role,
      metadata: { pageKey, ...metadata }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Page view traffic log error:', error);
    res.status(500).json({ error: 'Failed to log page view' });
  }
});

// Public: Resolve a recruiter share link and return only shared players
router.get('/recruiter-share/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Invalid share token' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const share = await db.prepare(`
      SELECT s.id, s.subject, s.message, s.recipient_email, s.expires_at, s.first_opened_at, s.open_count,
        s.coach_user_id,
        t.team_name, t.school_name, t.school_logo,
        u.full_name AS coach_name
      FROM recruiter_player_shares s
      JOIN hs_teams t ON t.id = s.team_id
      JOIN users u ON u.id = s.coach_user_id
      WHERE s.token_hash = ?
        AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `).get(tokenHash);

    if (!share) {
      return res.status(404).json({ error: 'Share link is invalid or expired' });
    }

    await db.prepare(`
      UPDATE recruiter_player_shares
      SET open_count = COALESCE(open_count, 0) + 1,
        first_opened_at = COALESCE(first_opened_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(share.id);

    const players = await db.prepare(`
      SELECT pp.*
      FROM recruiter_player_share_items items
      JOIN player_profiles pp ON pp.user_id = items.player_user_id
      WHERE items.share_id = ?
      ORDER BY pp.full_name ASC
    `).all(share.id);

    await Promise.all(players.map(player => enrichPlayerProfile(player)));

    res.json({
      share: {
        id: share.id,
        subject: share.subject || null,
        message: share.message || null,
        coachName: share.coach_name || null,
        teamName: share.team_name || null,
        schoolName: share.school_name || null,
        schoolLogo: share.school_logo || null,
        coachUserId: share.coach_user_id || null,
        expiresAt: share.expires_at,
        firstOpenedAt: share.first_opened_at,
        openCount: Number(share.open_count || 0) + 1
      },
      players
    });
  } catch (error) {
    console.error('Recruiter share fetch error:', error);
    res.status(500).json({ error: 'Failed to load shared players' });
  }
});

// Public: Get coach profile via recruiter share token (for shared context)
router.get('/recruiter-share-coach/:coachId', async (req, res) => {
  try {
    const { token } = req.query;
    const coachId = parseInt(req.params.coachId, 10);

    if (isNaN(coachId)) return res.status(400).json({ error: 'Invalid coach ID' });
    if (!token) return res.status(400).json({ error: 'Share token is required' });

    const tokenHash = crypto.createHash('sha256').update(String(token).toLowerCase()).digest('hex');
    const share = await db.prepare(`
      SELECT s.id, s.coach_user_id, s.expires_at
      FROM recruiter_player_shares s
      WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `).get(tokenHash);

    if (!share) return res.status(404).json({ error: 'Share link is invalid or expired' });

    const coach = await db.prepare(`
      SELECT u.full_name, u.phone, u.email, u.profile_picture,
        t.team_name, t.school_name, t.city, t.state
      FROM users u
      LEFT JOIN hs_teams t ON t.coach_id = u.id
      WHERE u.id = ? AND u.role = 'coach'
      LIMIT 1
    `).get(share.coach_user_id);

    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    res.json(coach);
  } catch (error) {
    console.error('Get coach via share error:', error);
    res.status(500).json({ error: 'Failed to get coach' });
  }
});

// Public: Get coach profile by ID
router.get('/coach/:id', async (req, res) => {
  try {
    const coachId = parseInt(req.params.id, 10);
    if (isNaN(coachId)) return res.status(400).json({ error: 'Invalid coach ID' });

    const coach = await db.prepare(`
      SELECT u.full_name, u.phone, u.email, u.profile_picture,
        t.team_name, t.school_name, t.city, t.state
      FROM users u
      LEFT JOIN hs_teams t ON t.coach_id = u.id
      WHERE u.id = ? AND u.role = 'coach'
      LIMIT 1
    `).get(coachId);

    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    res.json(coach);
  } catch (error) {
    console.error('Get coach error:', error);
    res.status(500).json({ error: 'Failed to get coach' });
  }
});

// Send player card image via email
router.post('/send-player-card', requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { recipientEmail, subject, message, imageData, playerName } = req.body;

    if (!recipientEmail || !imageData) {
      return res.status(400).json({ error: 'Recipient email and image are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const sender = await db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(req.session.userId);

    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    });

    const safeName = (playerName || 'Player').replace(/[^a-zA-Z0-9_ ]/g, '');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || sender.email,
      to: recipientEmail,
      subject: subject || `${safeName} - Player Card`,
      text: message || `Please see the attached player card for ${safeName}.`,
      html: `<p>${message || `Please see the attached player card for ${safeName}.`}</p><p>Sent via Gridiron Athletes</p>`,
      attachments: [{
        filename: `${safeName.replace(/\s+/g, '_')}_Player_Card.png`,
        content: base64Data,
        encoding: 'base64',
        cid: 'playercard'
      }]
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email. Please check SMTP configuration.' });
  }
});

module.exports = router;
