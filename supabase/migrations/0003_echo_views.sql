-- Echo views for CLI and analytics

-- ============================================================
-- reply_queue — Active reply queue (what the CLI shows)
-- ============================================================
CREATE VIEW echo.reply_queue AS
SELECT t.*,
       a.display_name, a.bio, a.followers, a.enrichment_brief
FROM echo.tweets t
JOIN echo.authors a ON t.author_handle = a.handle
WHERE t.status = 'queued'
  AND t.virality_score >= 30
ORDER BY t.virality_score DESC;

-- ============================================================
-- strategy_leaderboard — Rolling 7-day strategy performance
-- ============================================================
CREATE VIEW echo.strategy_leaderboard AS
SELECT strategy,
       COUNT(*) as total_replies,
       AVG(impressions) as avg_impressions,
       AVG(likes) as avg_likes,
       AVG(profile_clicks) as avg_profile_clicks
FROM echo.replies
WHERE posted_at > NOW() - INTERVAL '7 days'
  AND impressions IS NOT NULL
GROUP BY strategy
ORDER BY avg_impressions DESC;

-- ============================================================
-- daily_performance — Daily performance trend
-- ============================================================
CREATE VIEW echo.daily_performance AS
SELECT DATE(posted_at) as day,
       COUNT(*) as replies,
       AVG(impressions) as avg_impressions,
       AVG(time_to_reply_seconds) as avg_response_time
FROM echo.replies
WHERE posted_at IS NOT NULL
GROUP BY DATE(posted_at)
ORDER BY day DESC;
