# AI MVP Architecture for Gridiron Elite

## Objective
Launch one AI feature first: Player Scouting Summary.

This MVP adds a generated summary to player detail views, with strict safety controls, low operating cost, and clear measurement.

## Why this first
- High value for agents and recruiters viewing player profiles
- Uses data you already collect (metrics, GPA, bio, videos)
- Can be delivered without changing user authentication flow
- Easy to A/B test and roll back

## Scope
In scope:
- Generate a concise summary for a player profile
- Save generated output so repeated views are instant and cheap
- Regenerate on demand with role-based tone (Agent, Recruiter, Parent)
- Moderate unsafe output and allow reporting
- Track quality and engagement metrics

Out of scope for phase 1:
- Full natural-language player search
- End-to-end recommendation ranking model
- Automated outbound messaging

## Architecture Overview
Client:
- Player detail page requests summary
- Shows cached summary immediately if available
- Allows authorized users to regenerate summary

API:
- New AI summary endpoints under /api/ai
- Auth required for all endpoints
- Role checks for regenerate actions

Service layer:
- Prompt builder converts player data into structured model input
- AI provider adapter calls the model
- Safety post-processor validates output format and content
- Cache manager stores result in PostgreSQL

Data layer:
- New ai_player_summaries table for persisted generations
- New ai_events table for observability and quality tracking

## Data Model Changes (PostgreSQL)
Add these tables in a migration script.

Table: ai_player_summaries
- id SERIAL PRIMARY KEY
- player_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
- generated_for_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
- generated_for_role VARCHAR(50) NOT NULL
- source_hash VARCHAR(64) NOT NULL
- model_name VARCHAR(100) NOT NULL
- prompt_version VARCHAR(50) NOT NULL
- summary_text TEXT NOT NULL
- strengths_json JSONB NOT NULL DEFAULT '[]'::jsonb
- improvement_areas_json JSONB NOT NULL DEFAULT '[]'::jsonb
- confidence_score NUMERIC(4,3)
- safety_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb
- is_active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
- updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

Indexes:
- idx_ai_summary_player_active on (player_user_id, is_active)
- idx_ai_summary_source_hash on (player_user_id, source_hash)
- unique active cache key:
  CREATE UNIQUE INDEX uq_ai_summary_cache
  ON ai_player_summaries (player_user_id, generated_for_role, source_hash, prompt_version, model_name)
  WHERE is_active = TRUE;

Table: ai_events
- id BIGSERIAL PRIMARY KEY
- event_type VARCHAR(64) NOT NULL
- actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
- player_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
- summary_id INTEGER REFERENCES ai_player_summaries(id) ON DELETE SET NULL
- metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
- created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

Indexes:
- idx_ai_events_event_type on (event_type)
- idx_ai_events_created_at on (created_at)
- idx_ai_events_player on (player_user_id)

## Source Hash Strategy
Use a deterministic source_hash so cached summaries invalidate only when relevant profile data changes.

Input fields for hash:
- full_name, graduation_year, position, height, weight
- forty_yard_dash, vertical_jump, bench_press, squat, shuttle_5_10_5, l_drill, broad_jump, power_clean, single_leg_squat
- gpa, high_school, achievement, bio
- count of highlight videos, count of additional images, count of verified metric videos

Implementation:
- Build canonical JSON object with stable key ordering
- SHA-256 hash the JSON string

## API Endpoints
Base path: /api/ai

1) GET /api/ai/player/:playerUserId/summary?audience=agent|recruiter|parent
- Auth required
- Returns cached active summary if source_hash unchanged
- If no cache exists, optionally returns 404 with canGenerate=true (recommended for controlled rollout)

Response fields:
- summaryId
- playerUserId
- audience
- modelName
- promptVersion
- sourceHash
- summaryText
- strengths (array of strings)
- improvementAreas (array of strings)
- confidenceScore
- createdAt

2) POST /api/ai/player/:playerUserId/summary/generate
- Auth required
- Allowed roles: agent, admin, and the player owner
- Rate limit per actor and per player
- Recomputes source_hash, checks cache, calls model only if needed
- Saves row to ai_player_summaries and event to ai_events

Request body:
- audience: agent|recruiter|parent
- forceRegenerate: boolean (default false)

3) POST /api/ai/player/:playerUserId/summary/:summaryId/feedback
- Auth required
- Stores thumbs_up or thumbs_down and optional reason
- Writes ai_events row for later quality review

Request body:
- rating: up|down
- reason: optional short text

## Provider Abstraction
Create an internal adapter to keep provider swap easy.

Interface:
- generateScoutingSummary(input, options) -> structured object

Options:
- modelName
- maxTokens
- temperature
- timeoutMs

Provider configuration via environment variables:
- AI_PROVIDER (openai, azure-openai, or gemini)
- AI_API_KEY
- AI_MODEL_SUMMARY
- AI_TIMEOUT_MS (default 10000)
- AI_MAX_TOKENS_SUMMARY (default 450)
- AI_FEATURE_ENABLED (true or false)
- AI_GEMINI_API_VERSION (default v1beta)
- AI_GEMINI_ENDPOINT (default https://generativelanguage.googleapis.com)

Recommended low-cost dev setup:
- AI_PROVIDER=gemini
- AI_MODEL_SUMMARY=gemini-2.5-flash

## Prompt Template (Versioned)
Prompt version: v1

System intent:
- You are a neutral recruiting assistant for American football player scouting notes.
- Use only supplied profile data.
- Do not invent injuries, offers, rankings, or awards.
- Keep language factual and specific.
- If data is missing, say not enough data.

Output contract:
- JSON object only
- keys: summary_text, strengths, improvement_areas, confidence_score, safety_flags
- summary_text length: 90 to 180 words
- strengths: 3 to 5 bullets
- improvement_areas: 2 to 4 bullets
- confidence_score: 0 to 1

Audience tuning:
- agent: tactical and development-focused
- recruiter: projection and roster-fit oriented
- parent: plain language and supportive tone

## Safety Controls
Pre-generation checks:
- Confirm requester has access rights
- Validate player exists
- Enforce request size and timeout bounds

Post-generation checks:
- Parse strict JSON only
- Reject if output contains disallowed content categories
- Redact personal contact details if surfaced unexpectedly
- If invalid output, return safe fallback message and log ai_events event_type=summary_generation_failed

UI safety:
- Label as AI-generated
- Show generation timestamp and model version
- Add Report button that writes ai_events event_type=summary_reported

## Caching and Cost Control
Cache key:
- player_user_id + audience + source_hash + prompt_version + model_name

Cost controls:
- Daily cap: max generations per actor and per player
- Cooldown window: no forced regenerate more than once per 10 minutes
- Reuse cached summary on profile views
- Log token estimates in ai_events metadata_json

## Observability and KPIs
Track events in ai_events:
- summary_viewed
- summary_generated
- summary_cache_hit
- summary_cache_miss
- summary_feedback_up
- summary_feedback_down
- summary_reported
- summary_generation_failed

Primary success metrics (first 30 days):
- Player detail page engagement: +15% average time on page
- Message starts from agent flow: +10%
- Positive feedback ratio: at least 70%
- Cache hit ratio after week 2: at least 60%

## Rollout Plan
Phase 0: Internal dry run (1-2 days)
- Enable only for admin users
- Validate output quality and safety logs

Phase 1: Limited beta (3-5 days)
- Enable for 10 to 20 percent of agent accounts
- Monitor failed generation rate and feedback

Phase 2: General availability
- Enable for all agents and player owners
- Keep rate limits and report workflow active

Kill switches:
- AI_FEATURE_ENABLED=false disables all generation endpoints
- Endpoint still returns cached summaries if desired, configurable by policy

## Implementation Steps in Your Current App
1. Add migration file to create ai_player_summaries and ai_events.
2. Add helper functions:
- buildPlayerSourceHash(profileBundle)
- getCachedSummary(...)
- saveSummary(...)
- logAiEvent(...)
3. Add provider adapter module and prompt builder module.
4. Add three /api/ai routes and connect to requireAuth and role checks.
5. Update player detail page to fetch summary, render UI, and allow regenerate where authorized.
6. Add lightweight admin report query for feedback and failure rates.

## Example Event Metadata
summary_generated metadata_json:
- model_name
- prompt_version
- audience
- source_hash
- latency_ms
- input_token_estimate
- output_token_estimate
- cache_used (false)

summary_cache_hit metadata_json:
- model_name
- prompt_version
- audience
- source_hash
- cache_used (true)

## Testing Checklist
- Unit tests
- source hash deterministic for same input
- cache hit and miss logic
- prompt output parser rejects invalid schema

- Integration tests
- generate endpoint auth and role enforcement
- feedback endpoint writes ai_events
- regenerate cooldown enforced

- Manual tests
- player with sparse data returns safe partial summary
- player with full metrics yields specific actionable output
- model timeout returns graceful fallback and logs failure event

## Phase 2 Preview (after MVP proves value)
- Natural language player search with embeddings
- Similar player recommendations
- Message drafting assistant in conversations
