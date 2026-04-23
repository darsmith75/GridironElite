const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Player: Get top 10 schools by average rating
router.get('/player/top-schools', requireAuth, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT c.id, c.name, c.logo, c.conference, c.team,
             ROUND(AVG(r.rating_value)::numeric, 2) AS avg_rating,
             COUNT(r.id) AS rated_categories
      FROM player_school_ratings r
      JOIN colleges c ON c.id = r.college_id
      WHERE r.user_id = ?
      GROUP BY c.id, c.name, c.logo, c.conference, c.team
      ORDER BY avg_rating DESC, rated_categories DESC
      LIMIT 5
    `).all(req.session.userId);
    res.json(rows);
  } catch (error) {
    console.error('Player top schools error:', error);
    res.status(500).json({ error: 'Failed to get top schools' });
  }
});

// Player: Get school ratings for a college
router.get('/player/colleges/:collegeId/ratings', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const ratings = await db.prepare(`
      SELECT c.id AS category_id,
        c.category_name,
        c.what_to_rate,
        c.why_it_matters,
        c.sort_order,
        c.is_active,
        r.rating_value,
        r.updated_at AS rating_updated_at
      FROM school_rating_categories c
      LEFT JOIN player_school_ratings r
        ON r.category_id = c.id
       AND r.user_id = ?
       AND r.college_id = ?
      WHERE c.is_active = true
      ORDER BY c.sort_order ASC, c.id ASC
    `).all(req.session.userId, collegeId);

    res.json(ratings.map(item => ({
      categoryId: item.category_id,
      categoryName: item.category_name,
      whatToRate: item.what_to_rate,
      whyItMatters: item.why_it_matters,
      sortOrder: Number(item.sort_order || 0),
      ratingValue: item.rating_value ? Number(item.rating_value) : null,
      updatedAt: item.rating_updated_at || null
    })));
  } catch (error) {
    console.error('Get school ratings error:', error);
    res.status(500).json({ error: 'Failed to get school ratings' });
  }
});

// Player: Upsert a school rating by category
router.put('/player/colleges/:collegeId/ratings/:categoryId', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    const categoryId = parseInt(req.params.categoryId, 10);
    const parsedRating = parseInt(req.body?.rating, 10);

    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    if (isNaN(categoryId)) return res.status(400).json({ error: 'Invalid category ID' });
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
    }

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const category = await db.prepare(
      'SELECT id FROM school_rating_categories WHERE id = ? AND is_active = true'
    ).get(categoryId);
    if (!category) return res.status(404).json({ error: 'Rating category not found' });

    await db.prepare(`
      INSERT INTO player_school_ratings (user_id, college_id, category_id, rating_value, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, college_id, category_id)
      DO UPDATE SET
        rating_value = EXCLUDED.rating_value,
        updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, collegeId, categoryId, parsedRating);

    res.json({ success: true, categoryId, ratingValue: parsedRating });
  } catch (error) {
    console.error('Save school rating error:', error);
    res.status(500).json({ error: 'Failed to save school rating' });
  }
});

// Player: Get all colleges (read-only, for players)
router.get('/player/colleges', requireAuth, async (req, res) => {
  try {
    const colleges = await db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    const interests = await db.prepare('SELECT college_id, is_favorite, has_offer FROM player_school_interests WHERE user_id = ?').all(req.session.userId);
    const interestMap = {};
    interests.forEach(i => { interestMap[i.college_id] = { is_favorite: i.is_favorite, has_offer: i.has_offer }; });
    const result = colleges.map(c => ({
      ...c,
      is_favorite: interestMap[c.id]?.is_favorite || 0,
      has_offer: interestMap[c.id]?.has_offer || 0
    }));
    res.json(result);
  } catch (error) {
    console.error('Get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Player: Toggle favorite on a college
router.post('/player/colleges/:collegeId/favorite', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = await db.prepare('SELECT id, is_favorite FROM player_school_interests WHERE user_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.is_favorite ? 0 : 1;
      await db.prepare('UPDATE player_school_interests SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ is_favorite: newVal });
    } else {
      await db.prepare('INSERT INTO player_school_interests (user_id, college_id, is_favorite) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ is_favorite: 1 });
    }
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Player: Toggle offer on a college
router.post('/player/colleges/:collegeId/offer', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = await db.prepare('SELECT id, has_offer FROM player_school_interests WHERE user_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.has_offer ? 0 : 1;
      await db.prepare('UPDATE player_school_interests SET has_offer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ has_offer: newVal });
    } else {
      await db.prepare('INSERT INTO player_school_interests (user_id, college_id, has_offer) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ has_offer: 1 });
    }
  } catch (error) {
    console.error('Toggle offer error:', error);
    res.status(500).json({ error: 'Failed to toggle offer' });
  }
});

// Player: Save college logo order
router.post('/player/college-logo-order', requireAuth, express.json(), async (req, res) => {
  try {
    const { orderData } = req.body;
    if (!orderData || typeof orderData !== 'object') {
      return res.status(400).json({ error: 'orderData must be an object' });
    }

    const query = `UPDATE player_profiles SET college_logo_order = $1::jsonb WHERE user_id = $2`;
    await db.prepare(query).run(orderData, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Save college logo order error:', error);
    res.status(500).json({ error: 'Failed to save college logo order' });
  }
});

// Player: Get notes for a specific college
router.get('/player/colleges/:collegeId/notes', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const notes = await db.prepare(
      `SELECT *
       FROM school_notes
       WHERE user_id = ? AND college_id = ?
       ORDER BY
         COALESCE(
           CASE
             WHEN visit_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN visit_date::date
             ELSE NULL
           END,
           created_at::date
         ) DESC,
         created_at DESC`
    ).all(req.session.userId, collegeId);
    res.json(notes);
  } catch (error) {
    console.error('Get school notes error:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Player: Add a note for a college
router.post('/player/colleges/:collegeId/notes', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = await db.prepare(
      'INSERT INTO school_notes (user_id, college_id, note, visit_date) VALUES (?, ?, ?, ?)'
    ).run(req.session.userId, collegeId, note.trim(), visitDate || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Player: Update a note
router.put('/player/colleges/:collegeId/notes/:noteId', requireAuth, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    await db.prepare('UPDATE school_notes SET note = ?, visit_date = ? WHERE id = ?').run(note.trim(), visitDate || null, noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Update school note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Player: Delete a note
router.delete('/player/colleges/:collegeId/notes/:noteId', requireAuth, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });

    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    await db.prepare('DELETE FROM school_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Player: Get contacts for a specific college
router.get('/player/colleges/:collegeId/contacts', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const contacts = await db.prepare(
      'SELECT * FROM school_contacts WHERE user_id = ? AND college_id = ? ORDER BY name ASC'
    ).all(req.session.userId, collegeId);
    res.json(contacts);
  } catch (error) {
    console.error('Get school contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Player: Add a contact for a college
router.post('/player/colleges/:collegeId/contacts', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = await db.prepare(
      'INSERT INTO school_contacts (user_id, college_id, name, title, email, phone, twitter_handle, follows_player_on_twitter, instagram_handle, follows_player_on_instagram) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.session.userId,
      collegeId,
      name.trim(),
      title?.trim() || null,
      email?.trim() || null,
      phone?.trim() || null,
      twitterHandle?.trim() || null,
      !!followsPlayerOnTwitter,
      instagramHandle?.trim() || null,
      !!followsPlayerOnInstagram
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Player: Update a contact
router.put('/player/colleges/:collegeId/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    await db.prepare('UPDATE school_contacts SET name = ?, title = ?, email = ?, phone = ?, twitter_handle = ?, follows_player_on_twitter = ?, instagram_handle = ?, follows_player_on_instagram = ? WHERE id = ?')
      .run(
        name.trim(),
        title?.trim() || null,
        email?.trim() || null,
        phone?.trim() || null,
        twitterHandle?.trim() || null,
        !!followsPlayerOnTwitter,
        instagramHandle?.trim() || null,
        !!followsPlayerOnInstagram,
        contactId
      );
    res.json({ success: true });
  } catch (error) {
    console.error('Update school contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Player: Delete a contact
router.delete('/player/colleges/:collegeId/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });

    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    await db.prepare('DELETE FROM school_contacts WHERE id = ?').run(contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
