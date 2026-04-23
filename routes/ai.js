const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { normalizeAudience, buildSourceHash, generateScoutingSummary, generatePlayerRating } = require('../ai-provider');
const {
  isAiGenerationEnabled, parseAiPlayerId, isAiGenerationRateLimited,
  mapSummaryRow, logAiEvent, canAccessPlayerSummary,
  loadPlayerSummarySourceBundle, getCachedAiSummary, saveAiSummary
} = require('../utils/ai-helpers');

const router = express.Router();

// AI: Get cached player scouting summary
router.get('/ai/player/:playerUserId/summary', requireAuth, async (req, res) => {
  try {
    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) return res.status(400).json({ error: 'Invalid player user ID' });

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const audience = normalizeAudience(req.query.audience);
    const sourceBundle = await loadPlayerSummarySourceBundle(playerUserId);
    if (!sourceBundle) return res.status(404).json({ error: 'Player not found' });

    const sourceHash = buildSourceHash(sourceBundle);
    const cached = await getCachedAiSummary(playerUserId, audience, sourceHash);
    if (!cached) {
      await logAiEvent({
        eventType: 'summary_cache_miss',
        actorUserId: req.session.userId,
        playerUserId,
        metadata: { audience, sourceHash }
      });
      return res.status(404).json({
        error: 'No cached summary for current profile data',
        canGenerate: isAiGenerationEnabled(),
        sourceHash
      });
    }

    await logAiEvent({
      eventType: 'summary_cache_hit',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: cached.id,
      metadata: { audience, sourceHash, promptVersion: cached.prompt_version, modelName: cached.model_name }
    });

    await logAiEvent({
      eventType: 'summary_viewed',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: cached.id,
      metadata: { audience }
    });

    res.json({ ...mapSummaryRow(cached), cached: true });
  } catch (error) {
    console.error('AI summary get error:', error);
    res.status(500).json({ error: 'Failed to fetch AI summary' });
  }
});

// AI: Generate or refresh player scouting summary
router.post('/ai/player/:playerUserId/summary/generate', requireAuth, async (req, res) => {
  try {
    if (!isAiGenerationEnabled()) {
      return res.status(503).json({ error: 'AI summary generation is disabled' });
    }

    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) return res.status(400).json({ error: 'Invalid player user ID' });

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const audience = normalizeAudience(req.body?.audience);
    const forceRegenerate = !!req.body?.forceRegenerate;

    if (req.session.role !== 'admin' && isAiGenerationRateLimited(req.session.userId, playerUserId)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
    }

    const sourceBundle = await loadPlayerSummarySourceBundle(playerUserId);
    if (!sourceBundle) return res.status(404).json({ error: 'Player not found' });
    const sourceHash = buildSourceHash(sourceBundle);

    const cached = await getCachedAiSummary(playerUserId, audience, sourceHash);
    if (cached && !forceRegenerate) {
      await logAiEvent({
        eventType: 'summary_cache_hit',
        actorUserId: req.session.userId,
        playerUserId,
        summaryId: cached.id,
        metadata: { audience, sourceHash, path: 'generate' }
      });
      return res.json({ ...mapSummaryRow(cached), cached: true });
    }

    const startMs = Date.now();
    const generated = await generateScoutingSummary({ player: sourceBundle, audience });
    const saved = await saveAiSummary({
      playerUserId,
      generatedForUserId: req.session.userId,
      audience,
      sourceHash,
      modelName: generated.modelName,
      summaryText: generated.summaryText,
      strengths: generated.strengths,
      improvementAreas: generated.improvementAreas,
      confidenceScore: generated.confidenceScore,
      safetyFlags: generated.safetyFlags
    });

    await logAiEvent({
      eventType: 'summary_generated',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: saved.id,
      metadata: {
        audience,
        sourceHash,
        modelName: generated.modelName,
        promptVersion: generated.promptVersion,
        latencyMs: Date.now() - startMs,
        forceRegenerate
      }
    });

    res.json({ ...mapSummaryRow(saved), cached: false });
  } catch (error) {
    console.error('AI summary generate error:', error);
    await logAiEvent({
      eventType: 'summary_generation_failed',
      actorUserId: req.session?.userId || null,
      playerUserId: parseAiPlayerId(req.params.playerUserId),
      metadata: { message: error.message || 'unknown-error' }
    });
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

// AI: Summary feedback
router.post('/ai/player/:playerUserId/summary/:summaryId/feedback', requireAuth, async (req, res) => {
  try {
    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    const summaryId = parseInt(req.params.summaryId, 10);
    if (!playerUserId || !Number.isInteger(summaryId) || summaryId <= 0) {
      return res.status(400).json({ error: 'Invalid player or summary ID' });
    }

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rating = String(req.body?.rating || '').toLowerCase();
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (rating !== 'up' && rating !== 'down') {
      return res.status(400).json({ error: 'rating must be up or down' });
    }

    const summary = await db.prepare('SELECT id, player_user_id FROM ai_player_summaries WHERE id = ?').get(summaryId);
    if (!summary || summary.player_user_id !== playerUserId) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    await logAiEvent({
      eventType: rating === 'up' ? 'summary_feedback_up' : 'summary_feedback_down',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId,
      metadata: { reason }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('AI summary feedback error:', error);
    res.status(500).json({ error: 'Failed to submit summary feedback' });
  }
});

// AI: Get cached player rating
router.get('/ai/player/:playerUserId/rating', async (req, res) => {
  try {
    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    const row = await db.prepare(
      'SELECT overall_score, scores_json, model_name, updated_at FROM ai_player_ratings WHERE player_user_id = ?'
    ).get(playerUserId);

    if (!row) {
      return res.status(404).json({ error: 'No rating found' });
    }

    res.json({
      overallScore: row.overall_score,
      categories: typeof row.scores_json === 'string' ? JSON.parse(row.scores_json) : row.scores_json,
      modelName: row.model_name,
      updatedAt: row.updated_at
    });
  } catch (error) {
    console.error('AI rating fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch rating' });
  }
});

// AI: Generate (or regenerate) player rating
router.post('/ai/player/:playerUserId/rating/generate', requireAuth, async (req, res) => {
  try {
    if (!isAiGenerationEnabled()) {
      return res.status(503).json({ error: 'AI features are not enabled' });
    }

    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    if (req.session.role !== 'admin' && isAiGenerationRateLimited(req.session.userId, playerUserId)) {
      return res.status(429).json({ error: 'Rate limit reached. Try again shortly.' });
    }

    const sourceBundle = await loadPlayerSummarySourceBundle(playerUserId);
    if (!sourceBundle) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const sourceHash = buildSourceHash(sourceBundle);

    // Return cached rating if data hasn't changed
    const existing = await db.prepare(
      'SELECT overall_score, scores_json, model_name, updated_at FROM ai_player_ratings WHERE player_user_id = ? AND source_hash = ?'
    ).get(playerUserId, sourceHash);

    if (existing) {
      return res.json({
        overallScore: existing.overall_score,
        categories: typeof existing.scores_json === 'string' ? JSON.parse(existing.scores_json) : existing.scores_json,
        modelName: existing.model_name,
        updatedAt: existing.updated_at,
        cached: true
      });
    }

    const result = await generatePlayerRating({ player: sourceBundle });

    const scoresJson = JSON.stringify(result.categories);

    await db.prepare(`
      INSERT INTO ai_player_ratings (player_user_id, source_hash, overall_score, scores_json, model_name, updated_at)
      VALUES (?, ?, ?, ?::jsonb, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (player_user_id) DO UPDATE SET
        source_hash = EXCLUDED.source_hash,
        overall_score = EXCLUDED.overall_score,
        scores_json = EXCLUDED.scores_json,
        model_name = EXCLUDED.model_name,
        updated_at = EXCLUDED.updated_at
    `).run(playerUserId, sourceHash, result.overallScore, scoresJson, result.modelName);

    await logAiEvent({
      eventType: 'rating_generated',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: null,
      metadata: { modelName: result.modelName, overallScore: result.overallScore }
    });

    res.json({
      overallScore: result.overallScore,
      categories: result.categories,
      modelName: result.modelName,
      cached: false
    });
  } catch (error) {
    console.error('AI rating generate error:', error);
    res.status(500).json({ error: 'Failed to generate rating' });
  }
});

module.exports = router;
