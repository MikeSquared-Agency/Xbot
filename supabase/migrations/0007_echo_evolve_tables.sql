-- Evolve engine tables (SPEC-04b: self-improving loop)
CREATE SCHEMA IF NOT EXISTS echo;

-- Strategy scores (updated daily by evolve, read by compose/strategies.py)
CREATE TABLE IF NOT EXISTS echo.strategy_scores (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date                date NOT NULL,
    strategy            text NOT NULL,
    total_replies       integer DEFAULT 0,
    wins                integer DEFAULT 0,
    rolling_7d_win_rate double precision DEFAULT 0.0,
    created_at          timestamptz DEFAULT now(),
    UNIQUE (date, strategy)
);

CREATE INDEX idx_strategy_scores_date ON echo.strategy_scores (date DESC);
CREATE INDEX idx_strategy_scores_strategy ON echo.strategy_scores (strategy);

-- Daily digest (read by compose/generator.py get_winning_patterns())
CREATE TABLE IF NOT EXISTS echo.daily_digests (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    date                     date NOT NULL UNIQUE,
    digest_json              jsonb NOT NULL,
    total_replies_analysed   integer DEFAULT 0,
    avg_engagement_score     double precision DEFAULT 0.0,
    created_at               timestamptz DEFAULT now()
);

CREATE INDEX idx_daily_digests_date ON echo.daily_digests (date DESC);

-- RLS
ALTER TABLE echo.strategy_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.daily_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON echo.strategy_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.daily_digests FOR ALL USING (true) WITH CHECK (true);
