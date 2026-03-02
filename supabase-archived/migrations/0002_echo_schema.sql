-- Consolidated Echo schema (SPEC-09 + SPEC-11 + enrichment + voice + evolve)
CREATE SCHEMA IF NOT EXISTS echo;

-- ============================================================
-- Authors (enriched version)
-- ============================================================
CREATE TABLE echo.authors (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    handle              text NOT NULL UNIQUE,
    display_name        text,
    bio                 text,
    followers           integer NOT NULL DEFAULT 0,
    following           integer NOT NULL DEFAULT 0,
    verified            boolean NOT NULL DEFAULT false,
    website             text,
    join_date           timestamptz,
    avg_engagement_rate double precision NOT NULL DEFAULT 0.0,
    posting_frequency   double precision NOT NULL DEFAULT 0.0,
    enrichment_brief    text,
    enrichment_updated  timestamptz,
    times_replied_to    integer NOT NULL DEFAULT 0,
    last_replied_at     timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_echo_authors_handle ON echo.authors USING btree (handle);
CREATE INDEX idx_authors_enrichment_updated ON echo.authors USING btree (enrichment_updated);

-- ============================================================
-- Tweets (scout/poller INSERT + scorer UPDATE columns)
-- ============================================================
CREATE TABLE echo.tweets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tweet_id            text NOT NULL UNIQUE,
    tweet_url           text NOT NULL,
    author_handle       text NOT NULL REFERENCES echo.authors(handle),
    author_name         text,
    author_verified     boolean DEFAULT false,
    author_followers    integer DEFAULT 0,
    content             text,
    is_quote_tweet      boolean DEFAULT false,
    is_reply            boolean DEFAULT false,
    is_thread           boolean DEFAULT false,
    has_media           boolean DEFAULT false,
    likes_t0            integer DEFAULT 0,
    retweets_t0         integer DEFAULT 0,
    replies_t0          integer DEFAULT 0,
    bookmarks_t0        integer DEFAULT 0,
    views_t0            integer DEFAULT 0,
    source              text,
    tweet_created_at    timestamptz,
    status              text NOT NULL DEFAULT 'pending',
    virality_score      double precision,
    author_score        double precision,
    content_score       double precision,
    momentum_score      double precision,
    recency_multiplier  double precision,
    content_embedding   vector(384),
    discovered_at       timestamptz NOT NULL DEFAULT now(),
    replied_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_echo_tweets_status ON echo.tweets (status);
CREATE INDEX idx_echo_tweets_tweet_id ON echo.tweets (tweet_id);

-- ============================================================
-- Voice profiles (full version with profile_json, source, is_active)
-- ============================================================
CREATE TABLE echo.voice_profiles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version             text NOT NULL UNIQUE,
    profile_json        jsonb NOT NULL,
    source              text NOT NULL CHECK (source IN ('bootstrap', 'daily_refinement', 'manual')),
    tweet_corpus_size   integer,
    notes               text,
    is_active           boolean DEFAULT false,
    created_at          timestamptz DEFAULT now()
);

-- Only one profile can be active at a time
CREATE UNIQUE INDEX idx_voice_profiles_active
    ON echo.voice_profiles (is_active)
    WHERE is_active = true;

-- ============================================================
-- Replies (merged: schema columns + analytics metric columns)
-- ============================================================
CREATE TABLE echo.replies (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tweet_id                text NOT NULL,
    reply_id                text UNIQUE,
    reply_url               text,
    reply_text              text NOT NULL,
    strategy                text,
    was_edited              boolean NOT NULL DEFAULT false,
    original_text           text,
    voice_profile_version   text,
    time_to_reply_seconds   integer,
    impressions             integer DEFAULT 0,
    likes                   integer DEFAULT 0,
    retweets                integer DEFAULT 0,
    replies_count           integer DEFAULT 0,
    bookmarks               integer DEFAULT 0,
    profile_clicks          integer DEFAULT 0,
    metrics_updated_at      timestamptz,
    posted_at               timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_echo_replies_tweet_id ON echo.replies (tweet_id);
CREATE INDEX idx_replies_posted_at ON echo.replies (posted_at DESC);
CREATE INDEX idx_replies_metrics_due ON echo.replies (posted_at, metrics_updated_at)
    WHERE posted_at IS NOT NULL AND reply_url IS NOT NULL;

-- ============================================================
-- Reply metrics (time-series snapshots)
-- ============================================================
CREATE TABLE echo.reply_metrics (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reply_id        text NOT NULL REFERENCES echo.replies(reply_id) ON DELETE CASCADE,
    impressions     integer DEFAULT 0,
    likes           integer DEFAULT 0,
    retweets        integer DEFAULT 0,
    replies         integer DEFAULT 0,
    bookmarks       integer DEFAULT 0,
    profile_clicks  integer DEFAULT 0,
    scraped_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reply_metrics_reply_id ON echo.reply_metrics (reply_id, scraped_at DESC);

-- ============================================================
-- Follower snapshots
-- ============================================================
CREATE TABLE echo.follower_snapshots (
    date            date PRIMARY KEY,
    follower_count  integer NOT NULL,
    delta           integer DEFAULT 0
);

-- ============================================================
-- Analytics imports (CSV dedup)
-- ============================================================
CREATE TABLE echo.analytics_imports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filename            text NOT NULL,
    rows_imported       integer DEFAULT 0,
    rows_unmatched      integer DEFAULT 0,
    date_range_start    timestamptz,
    date_range_end      timestamptz,
    imported_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Model weights (used by scorer + evolve)
-- ============================================================
CREATE TABLE echo.model_weights (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version         text NOT NULL UNIQUE,
    weights_json    jsonb NOT NULL,
    is_active       boolean DEFAULT false,
    notes           text,
    created_at      timestamptz DEFAULT now()
);

-- ============================================================
-- Tweet metrics (used by scorer + scout)
-- ============================================================
CREATE TABLE echo.tweet_metrics (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tweet_id        text NOT NULL,
    likes           integer DEFAULT 0,
    retweets        integer DEFAULT 0,
    replies         integer DEFAULT 0,
    bookmarks       integer DEFAULT 0,
    views           integer DEFAULT 0,
    scraped_at      timestamptz DEFAULT now()
);

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE echo.authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.tweets ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.reply_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.follower_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.analytics_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.model_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE echo.tweet_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON echo.authors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.tweets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.voice_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.reply_metrics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.follower_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.analytics_imports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.model_weights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON echo.tweet_metrics FOR ALL USING (true) WITH CHECK (true);
