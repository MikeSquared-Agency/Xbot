-- Seed default model weights so the scoring system has a starting point

INSERT INTO echo.model_weights (version, weights_json, is_active, notes)
VALUES (
    'v1.0',
    '{
        "virality": {
            "likes":      0.20,
            "retweets":   0.25,
            "replies":    0.15,
            "bookmarks":  0.10,
            "views":      0.10,
            "velocity":   0.20
        },
        "author": {
            "followers":        0.30,
            "engagement_rate":  0.35,
            "verified_bonus":   0.10,
            "posting_frequency": 0.25
        },
        "content": {
            "semantic_relevance": 0.40,
            "thread_bonus":      0.15,
            "media_bonus":       0.10,
            "keyword_match":     0.35
        },
        "recency": {
            "half_life_hours": 4,
            "max_age_hours":   24
        },
        "thresholds": {
            "min_virality_score": 30,
            "min_author_followers": 100
        }
    }'::jsonb,
    TRUE,
    'Initial default weights — baseline for scoring calibration'
);
