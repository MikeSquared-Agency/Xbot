---
name: research-tweets
description: >
  Find tweets worth replying to on X/Twitter. Use this skill whenever scouting for tweets,
  looking for engagement opportunities, finding reply candidates, browsing a watchlist or
  feed, searching for tweets by keyword, or when the user says "find tweets", "scout",
  "what should I reply to", "check the feed", "find opportunities", or "look for tweets
  about [topic]". This skill covers discovery and evaluation only — use compose-tweets
  for actually writing and posting replies.
---

# Echo Tweet Scout

Find high-value tweets to reply to. For each candidate, apply the two-stage filter
(relevance gate → virality score), understand the author, and store the full context
so the compose skill has everything it needs.

## Tools

- `x:check-session` — verify X authentication before starting
- `x:get-list-feed { list_url }` — scrape tweets from the watchlist
- `x:search-tweets { query, tab }` — search X by keyword (use `tab: "latest"`)
- `x:get-author-profile { handle }` — scrape an author's profile (bio, followers, etc.)
- `x:get-author-timeline { handle, count }` — scrape an author's recent tweets
- `cortex:search` / `cortex:recall` — pull persona, playbook, insights, known authors
- `cortex:store` — store candidates and author profiles
- `score_virality` — calculate virality score from engagement metrics

## Step 0: Authenticate

Before doing anything, verify the X session is live.

```
x:check-session
```

If `authenticated` is `true`, skip to **Load Context**.

If `authenticated` is `false`, log in via Google first:

1. **Navigate to Google** — `browser_navigate({ url: "https://accounts.google.com" })`
2. **Enter email** — `xbot_execute({ toolName: "google-enter-email", args: { email } })`.
   Ask the user for their email if not already known.
3. **Enter password** — `xbot_execute({ toolName: "google-enter-password", args: { password } })`.
   Ask the user for their password.
4. **Navigate back to X** — `browser_navigate({ url: "https://x.com/home" })`
5. **Click "Sign in with Google"** on the X login page using `browser_snapshot` +
   `browser_fallback` → `browser_click` on the Google sign-in button.
6. **Verify** — run `x:check-session` again. If still not authenticated, stop and
   tell the user.

## Step 1: Load Context

Pull the persona and any recent compose insights before scraping anything.

```
cortex:search { query: "persona active" }
cortex:search { query: "compose pattern insight" }
```

Keep both in working memory for the session. The persona node is the relevance gate
authority — everything gets checked against it.

## Step 2: Scrape Candidates

### Watchlist (primary)

```
x:get-list-feed { list_url: "https://x.com/i/lists/2027463448406204882" }
```

Curated accounts — tweets from here get natural priority over search results.

### Keyword search (secondary)

```
x:search-tweets { query: "AI agents", tab: "latest" }
```

Rotate keywords across sessions. Good keywords are specific to your niche — not so broad
you drown in noise. Keywords from `persona.topics_we_engage` are your rotation source.

## Step 3: Hard Pre-Filter

Before relevance evaluation, discard these immediately:

- Retweets, quote tweets, or replies to other users (not an original post)
- Spam: crypto giveaways, "DM me", follow-back, airdrops, NFTs, presales, whitelist
- Already in Cortex: `cortex:search { query: "tid-{tweet_id}" }` — skip if found
- Already replied to this author 2-3 times today (check recent reply nodes)

Anything that passes, move to Stage 1.

## Step 4: Stage 1 — Relevance Gate

Read the tweet. Check it against the persona node you loaded in Step 1.

### Hard niche match → proceed to scoring
Tweet clearly overlaps with `persona.topics_we_engage`. Continue.

### Soft match → proceed to scoring, flag as soft
Tweet overlaps with `persona.soft_match_topics` but not the core niche. Still worth
scoring — a soft-match tweet with a score of 800 beats a niche tweet at 200.
Mark it mentally as soft-match so you can use niche as a tiebreaker between
near-equal scores at the end.

### No match → skip immediately
No overlap with either list. Check `persona.skip_signals` — if any apply, discard.
Even if none apply but there's genuinely no angle for us, skip it. Don't force relevance.

The persona's `reply_angle` field is the gut-check: could we reply to this from the
position of a builder with hands-on AI tool experience? If no, skip.

## Step 5: Parse Engagement Metrics

For tweets that pass the relevance gate, extract the metrics needed for scoring.

X tweet innerText follows a pattern like:
```
AuthorName
@handle
· 2h
Tweet content here...
123 Replies  45 Reposts  8 Quotes  892 Likes  1.2K Bookmarks  53.4K Views
```

Parse out:
- `replies` — the "Replies" count
- `retweets` — the "Reposts" count (not Quotes)
- `likes` — the "Likes" count
- `bookmarks` — the "Bookmarks" count if visible (often hidden, treat as 0 if absent)
- `views` — the "Views" count (K = thousands, M = millions — convert to integer)
- `age_hours` — parse the timestamp: "2h" = 2, "45m" = 0.75, "1d" = 24, etc.

If a count shows as "·" or is absent, treat as 0.

## Step 6: Stage 2 — Virality Score

```
score_virality {
  replies: 123,
  retweets: 45,
  likes: 892,
  bookmarks: 1200,
  views: 53400,
  age_hours: 2,
  author_followers: 107900,
  author_replies_back: true
}
```

You need `author_followers` and `author_replies_back` for an accurate score. If you
haven't profiled this author yet, use the Cortex check in Step 7 first — the author
node may already have both fields. If not, use `author_followers: 0` (falls back to
reach factor 0.5) and `author_replies_back: false` for the initial score, then update
after profiling.

Ratings:
- **high** (500+): top priority, your best work
- **medium** (150–499): solid candidate, worth replying
- **low** (50–149): only if nothing better
- **skip** (<50): discard

Use niche match as a tiebreaker between candidates with close scores:
a niche-match tweet at 300 beats a soft-match tweet at 310 only marginally —
a soft-match tweet at 600 clearly wins over a niche-match at 310.

## Step 7: Know the Author

Don't evaluate a tweet in isolation. Before finalising a candidate, understand who wrote it.

### Check Cortex first

```
cortex:search { query: "author @handle" }
```

If a rich author node exists (has `bio`, `what_they_work_on`, `communication_style`,
`responds_to_replies`) — use it as-is. Don't re-scrape known authors.

If the node is missing or sparse, scrape:

```
x:get-author-profile { handle: "handle" }
x:get-author-timeline { handle: "handle", count: 10 }
```

From profile and recent tweets, form your own understanding of:

- **What do they work on?** Their domain and focus area.
- **What's their communication style?** Technical? Casual? Provocative? Meme-heavy?
- **What does their audience value?** Which tweets get the most engagement?
- **Do they engage with replies?** The +75 author-engages-back signal makes this the
  single most important author attribute — more than followers, more than niche fit.
- **Author type** — classify as one of: `ai_researcher`, `founder`, `developer`,
  `builder`, `designer`, `investor`, `devrel`. Use your judgment from their bio and
  content. This is used by analytics to find strategy × author-type patterns.

### Store or update the author

```
cortex:store {
  kind: "author",
  title: "{handle}",
  body: "{\"handle\":\"@handle\",\"display_name\":\"...\",\"bio\":\"...\",\"followers\":12000,\"author_type\":\"developer\",\"what_they_work_on\":\"...\",\"audience_values\":\"...\",\"communication_style\":\"...\",\"responds_to_replies\":true,\"times_we_replied\":0,\"they_replied_back\":0,\"updated_at\":\"...\"}",
  tags: ["author", "author-{handle}"]
}
```

If the author already has a node, use `cortex:recall` to get the ID, then PATCH rather
than creating a duplicate.

Re-score with accurate `author_followers` and `author_replies_back` if the initial
score used fallback values.

## Step 8: Final Selection

3–5 strong candidates per session. Rank by:

1. Virality score (primary)
2. Niche match (tiebreaker for near-equal scores)
3. Author engages-back rate (booster — an author who replies back 80% of the time
   is worth deprioritising a slightly lower score)

If nothing scores above 150, say so. Don't force mediocre candidates through.

## Step 9: Store Candidates

For each selected tweet:

```
cortex:store {
  kind: "tweet",
  title: "{tweet_id}",
  body: "{\"content\":\"...\",\"author_handle\":\"@handle\",\"author_type\":\"developer\",\"tweet_url\":\"...\",\"likes_t0\":892,\"retweets_t0\":45,\"replies_t0\":123,\"views_t0\":53400,\"virality_score\":1240,\"virality_rating\":\"high\",\"niche_match\":\"hard\",\"virality_reasoning\":\"...\",\"author_context\":\"...\",\"discovered_at\":\"...\",\"source\":\"watchlist\"}",
  tags: ["tweet", "status-queued", "tid-{tweet_id}", "author-{handle}"]
}
```

Key fields for downstream skills:
- `virality_score` and `virality_rating` — how much effort compose should invest
- `niche_match` — `"hard"` or `"soft"` — context for strategy selection
- `author_type` — used by analytics for strategy × author-type pattern detection
- `virality_reasoning` — the score breakdown in plain language
- `author_context` — a 1–2 sentence summary of the author for the compose skill

## Step 10: Generate Reply Suggestions

After storing candidates, immediately write **5 reply suggestions** for each one.
Don't ask — just do it.

Pull the active voice profile:
```
cortex:search { query: "voice-profile active" }
```

Pull the active playbook:
```
cortex:search { query: "playbook active" }
```

For each candidate, write one suggestion per strategy from the playbook. Use the full
context: tweet content, author communication style, author type, niche match, and any
`performance_hint` values on the playbook strategies — hints are advisory signals
about what's worked before on similar author types.

Voice rules: follow the banned patterns, good patterns, and tone in the voice profile.
Sound like a real person. Not an AI assistant.

Present all 5 suggestions per candidate clearly labelled with their strategy name.
The user will pick one (or edit it) — do not post anything here. Posting happens
in the compose skill.
