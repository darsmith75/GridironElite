const crypto = require('crypto');

const PROMPT_VERSION = 'v1';
const ALLOWED_AUDIENCES = new Set(['agent', 'recruiter', 'parent']);

function normalizeAudience(audience) {
  const value = String(audience || 'agent').toLowerCase();
  return ALLOWED_AUDIENCES.has(value) ? value : 'agent';
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function buildSourceHash(playerBundle) {
  const canonical = stableStringify(playerBundle || {});
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function sanitizeArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxLength);
}

function clampConfidenceScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return Math.round(num * 1000) / 1000;
}

function extractJsonObject(rawText) {
  if (!rawText) return null;
  const trimmed = String(rawText).trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return null;
}

function buildPrompt(player, audience) {
  const system = [
    'You are a neutral recruiting assistant for American football scouting notes.',
    'Use only supplied player profile data.',
    'Do not invent injuries, offers, rankings, or awards.',
    'If data is missing, explicitly say there is not enough data.',
    'Return strict JSON only with keys: summary_text, strengths, improvement_areas, confidence_score, safety_flags.'
  ].join(' ');

  const audienceGuidance = {
    agent: 'Write tactical development-focused notes for an agent evaluating next steps.',
    recruiter: 'Write projection and roster-fit oriented notes for a college recruiter.',
    parent: 'Write supportive plain-language notes for a parent.'
  };

  const user = [
    `Audience: ${audience}.`,
    audienceGuidance[audience] || audienceGuidance.agent,
    'Constraints:',
    '- summary_text: 90-180 words',
    '- strengths: 3-5 bullets',
    '- improvement_areas: 2-4 bullets',
    '- confidence_score: number from 0 to 1',
    '- safety_flags: array of strings; empty array when no issues',
    'Player data JSON:',
    JSON.stringify(player)
  ].join('\n');

  return { system, user };
}

async function callOpenAiLikeApi({ system, user, modelName, timeoutMs, maxTokens, temperature }) {
  const provider = String(process.env.AI_PROVIDER || 'openai').toLowerCase();
  const apiKey = process.env.AI_API_KEY || '';

  if (!apiKey) {
    throw new Error('AI_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === 'gemini' || provider === 'google') {
      const endpoint = (process.env.AI_GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
      const apiVersion = process.env.AI_GEMINI_API_VERSION || 'v1beta';
      const thinkingBudget = parseInt(process.env.AI_GEMINI_THINKING_BUDGET || '0', 10);
      const url = `${endpoint}/${apiVersion}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: user }]
            }
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingBudget
            }
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${body.slice(0, 400)}`);
      }

      const data = await response.json();
      const finishReason = data?.candidates?.[0]?.finishReason || '';
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini response was truncated before returning complete JSON. Increase AI_MAX_TOKENS_SUMMARY or lower AI_GEMINI_THINKING_BUDGET.');
      }
      return data?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('') || '';
    }

    if (provider === 'azure-openai') {
      const endpoint = (process.env.AI_AZURE_ENDPOINT || '').replace(/\/$/, '');
      const apiVersion = process.env.AI_AZURE_API_VERSION || '2024-06-01';
      if (!endpoint) {
        throw new Error('AI_AZURE_ENDPOINT is not configured');
      }

      const url = `${endpoint}/openai/deployments/${encodeURIComponent(modelName)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Azure OpenAI error ${response.status}: ${body.slice(0, 400)}`);
      }

      const data = await response.json();
      return data?.choices?.[0]?.message?.content || '';
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI error ${response.status}: ${body.slice(0, 400)}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function generateScoutingSummary({ player, audience }) {
  const provider = String(process.env.AI_PROVIDER || 'openai').toLowerCase();
  const defaultModelName = provider === 'gemini' || provider === 'google'
    ? 'gemini-2.5-flash'
    : 'gpt-4.1-mini';
  const modelName = process.env.AI_MODEL_SUMMARY || defaultModelName;
  const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || '10000', 10);
  const maxTokens = parseInt(process.env.AI_MAX_TOKENS_SUMMARY || '450', 10);
  const temperature = Number(process.env.AI_TEMPERATURE_SUMMARY || '0.4');

  const prompt = buildPrompt(player, normalizeAudience(audience));
  const raw = await callOpenAiLikeApi({
    system: prompt.system,
    user: prompt.user,
    modelName,
    timeoutMs,
    maxTokens,
    temperature
  });

  const rawJson = extractJsonObject(raw);
  if (!rawJson) {
    throw new Error('Model did not return a JSON object');
  }

  const parsed = JSON.parse(rawJson);
  const summaryText = String(parsed.summary_text || '').trim();
  if (!summaryText) {
    throw new Error('Model returned empty summary_text');
  }

  return {
    modelName,
    promptVersion: PROMPT_VERSION,
    summaryText,
    strengths: sanitizeArray(parsed.strengths, 5),
    improvementAreas: sanitizeArray(parsed.improvement_areas, 4),
    confidenceScore: clampConfidenceScore(parsed.confidence_score),
    safetyFlags: sanitizeArray(parsed.safety_flags, 6)
  };
}

module.exports = {
  PROMPT_VERSION,
  normalizeAudience,
  buildSourceHash,
  generateScoutingSummary
};
