-- Voice dictation for doctors (apps/api/src/ai/stt.ts, docs/VOICE_SCRIBE.md). The audio itself is never stored —
-- it passes through the API's memory to the speech-to-text server and is dropped. ai_usage gets one row per
-- dictation (route 'dictation') with the length of the recording, never the transcript.
ALTER TABLE ai_usage ADD COLUMN audio_seconds numeric(8,1) CHECK (audio_seconds IS NULL OR audio_seconds >= 0);

-- Per-doctor rate limit (30 dictations per hour) reads the doctor's recent dictation rows.
CREATE INDEX ai_usage_dictation ON ai_usage (membership_id, created_at DESC) WHERE route = 'dictation';
