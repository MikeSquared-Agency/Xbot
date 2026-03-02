-- Seed SPEC-04 scorer weights into echo.model_weights
-- These are the default weights used by the Virality Scorer pipeline.
-- The Evolve engine updates these daily.

INSERT INTO echo.model_weights (version, weights_json, is_active, notes)
VALUES (
    'v1-scorer',
    '{
        "author_weight": 0.30,
        "content_weight": 0.40,
        "momentum_weight": 0.30,
        "watchlist_bonus": 15,
        "follower_count_w": 8,
        "follower_ratio_w": 5,
        "avg_engagement_w": 10,
        "verification_w": 3,
        "posting_freq_w": 4,
        "topic_relevance_w": 12,
        "controversy_w": 8,
        "novelty_w": 6,
        "has_media_w": 4,
        "is_thread_w": 3,
        "emotional_w": 4,
        "hook_quality_w": 3,
        "early_velocity_w": 12,
        "reply_ratio_w": 5,
        "qt_ratio_w": 5,
        "bookmark_w": 3,
        "recency_half_life_minutes": 120
    }'::jsonb,
    TRUE,
    'SPEC-04 default scorer weights — author 30%, content 40%, momentum 30%'
)
ON CONFLICT (version) DO NOTHING;

-- Deactivate older weight versions
UPDATE echo.model_weights SET is_active = FALSE WHERE version != 'v1-scorer';
