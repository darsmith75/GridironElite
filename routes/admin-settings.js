const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { METRIC_TIP_CONFIG, METRIC_TIP_KEYS, AD_SLOT_CONFIG, AD_SLOT_KEYS } = require('../utils/constants');
const { getAdSlotsMap } = require('../utils/helpers');
const { getMetricTipsMap, getMetricYoutubeUrlsMap } = require('../utils/ai-helpers');

const router = express.Router();

function sanitizeYoutubeUrl(url) {
  const raw = (url || '').toString().trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      return raw;
    }
  } catch (_) {}
  return '';
}

// Admin: Get all metric pro tips
router.get('/admin/metric-pro-tips', requireAdmin, async (req, res) => {
  try {
    const tips = await getMetricTipsMap();
    const youtube_urls = await getMetricYoutubeUrlsMap();
    res.json({ tips, youtube_urls, metrics: METRIC_TIP_CONFIG });
  } catch (error) {
    console.error('Admin get metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to get metric tips' });
  }
});

// Admin: Save metric pro tips
router.put('/admin/metric-pro-tips', requireAdmin, async (req, res) => {
  try {
    const incomingTips = req.body?.tips;
    const incomingYoutubeUrls = req.body?.youtube_urls;
    if (!incomingTips || typeof incomingTips !== 'object') {
      return res.status(400).json({ error: 'Invalid tips payload' });
    }

    for (const [metricKey, tipValue] of Object.entries(incomingTips)) {
      if (!METRIC_TIP_KEYS.has(metricKey)) continue;
      const tipText = (tipValue || '').toString().trim();
      const youtubeUrl = sanitizeYoutubeUrl((incomingYoutubeUrls && incomingYoutubeUrls[metricKey]) || '');
      await db.prepare(`
        INSERT INTO metric_pro_tips (metric_key, tip_text, youtube_url, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (metric_key)
        DO UPDATE SET
          tip_text = EXCLUDED.tip_text,
          youtube_url = EXCLUDED.youtube_url,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(metricKey, tipText, youtubeUrl, req.session.userId);
    }

    const tips = await getMetricTipsMap();
    const youtube_urls = await getMetricYoutubeUrlsMap();
    res.json({ success: true, tips, youtube_urls });
  } catch (error) {
    console.error('Admin save metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to save metric tips' });
  }
});

// Admin: Get school rating categories list
router.get('/admin/school-rating-categories', requireAdmin, async (req, res) => {
  try {
    const categories = await db.prepare(`
      SELECT id, category_name, what_to_rate, why_it_matters, sort_order, is_active, updated_at
      FROM school_rating_categories
      ORDER BY sort_order ASC, id ASC
    `).all();

    res.json({
      categories: categories.map(item => ({
        id: item.id,
        categoryName: item.category_name,
        whatToRate: item.what_to_rate,
        whyItMatters: item.why_it_matters,
        sortOrder: Number(item.sort_order || 0),
        isActive: !!item.is_active,
        updatedAt: item.updated_at || null
      }))
    });
  } catch (error) {
    console.error('Admin get school rating categories error:', error);
    res.status(500).json({ error: 'Failed to load school rating categories' });
  }
});

// Admin: Save school rating categories list
router.put('/admin/school-rating-categories', requireAdmin, async (req, res) => {
  const incomingCategories = req.body?.categories;

  if (!Array.isArray(incomingCategories)) {
    return res.status(400).json({ error: 'Invalid categories payload' });
  }

  if (incomingCategories.length > 100) {
    return res.status(400).json({ error: 'Too many categories submitted' });
  }

  const normalizedCategories = [];
  for (let i = 0; i < incomingCategories.length; i++) {
    const item = incomingCategories[i] || {};
    const parsedId = parseInt(item.id, 10);
    const id = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
    const categoryName = String(item.categoryName || '').trim();
    const whatToRate = String(item.whatToRate || '').trim();
    const whyItMatters = String(item.whyItMatters || '').trim();
    const parsedSortOrder = parseInt(item.sortOrder, 10);
    const sortOrder = Number.isInteger(parsedSortOrder) ? parsedSortOrder : (i + 1);

    if (!categoryName || !whatToRate || !whyItMatters) {
      return res.status(400).json({ error: 'Each category must include category name, what to rate, and why it matters.' });
    }

    normalizedCategories.push({
      id,
      categoryName: categoryName.slice(0, 120),
      whatToRate: whatToRate.slice(0, 2000),
      whyItMatters: whyItMatters.slice(0, 2000),
      sortOrder,
      isActive: item.isActive !== false
    });
  }

  try {
    await db.withTransaction(async (tx) => {
      const existingRows = await tx.prepare('SELECT id FROM school_rating_categories').all();
      const existingIds = new Set(existingRows.map(row => Number(row.id)));
      const keptIds = [];

      for (const item of normalizedCategories) {
        if (item.id && existingIds.has(item.id)) {
          await tx.prepare(`
            UPDATE school_rating_categories
            SET category_name = ?,
              what_to_rate = ?,
              why_it_matters = ?,
              sort_order = ?,
              is_active = ?,
              updated_by_user_id = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(
            item.categoryName,
            item.whatToRate,
            item.whyItMatters,
            item.sortOrder,
            item.isActive,
            req.session.userId,
            item.id
          );
          keptIds.push(item.id);
        } else {
          const inserted = await tx.prepare(`
            INSERT INTO school_rating_categories (
              category_name,
              what_to_rate,
              why_it_matters,
              sort_order,
              is_active,
              updated_by_user_id,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(
            item.categoryName,
            item.whatToRate,
            item.whyItMatters,
            item.sortOrder,
            item.isActive,
            req.session.userId
          );
          if (inserted?.lastInsertRowid) {
            keptIds.push(Number(inserted.lastInsertRowid));
          }
        }
      }

      if (keptIds.length > 0) {
        const placeholders = keptIds.map(() => '?').join(', ');
        await tx.prepare(`DELETE FROM school_rating_categories WHERE id NOT IN (${placeholders})`).run(...keptIds);
      } else {
        await tx.prepare('DELETE FROM school_rating_categories').run();
      }
    });

    const categories = await db.prepare(`
      SELECT id, category_name, what_to_rate, why_it_matters, sort_order, is_active, updated_at
      FROM school_rating_categories
      ORDER BY sort_order ASC, id ASC
    `).all();

    res.json({
      success: true,
      categories: categories.map(item => ({
        id: item.id,
        categoryName: item.category_name,
        whatToRate: item.what_to_rate,
        whyItMatters: item.why_it_matters,
        sortOrder: Number(item.sort_order || 0),
        isActive: !!item.is_active,
        updatedAt: item.updated_at || null
      }))
    });
  } catch (error) {
    console.error('Admin save school rating categories error:', error);
    res.status(500).json({ error: 'Failed to save school rating categories' });
  }
});

// Admin: Get ad slots
router.get('/admin/ad-slots', requireAdmin, async (req, res) => {
  try {
    const slots = await getAdSlotsMap();
    res.json({ slots, config: AD_SLOT_CONFIG });
  } catch (error) {
    console.error('Admin get ad slots error:', error);
    res.status(500).json({ error: 'Failed to load ad slots' });
  }
});

// Admin: Save ad slots
router.put('/admin/ad-slots', requireAdmin, async (req, res) => {
  try {
    const incomingSlots = req.body?.slots;
    if (!incomingSlots || typeof incomingSlots !== 'object') {
      return res.status(400).json({ error: 'Invalid ad slots payload' });
    }

    for (const [slotKey, slotValue] of Object.entries(incomingSlots)) {
      if (!AD_SLOT_KEYS.has(slotKey)) continue;
      const enabled = !!slotValue?.enabled;
      const contentHtml = (slotValue?.contentHtml || '').toString();

      await db.prepare(`
        INSERT INTO site_ad_slots (slot_key, enabled, content_html, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (slot_key)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          content_html = EXCLUDED.content_html,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(slotKey, enabled, contentHtml, req.session.userId);
    }

    const slots = await getAdSlotsMap();
    res.json({ success: true, slots, config: AD_SLOT_CONFIG });
  } catch (error) {
    console.error('Admin save ad slots error:', error);
    res.status(500).json({ error: 'Failed to save ad slots' });
  }
});

module.exports = router;
