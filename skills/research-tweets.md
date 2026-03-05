---
name: research-tweets
description: >
  Find tweets worth replying to on X/Twitter. Use this skill whenever scouting for tweets,
  looking for engagement opportunities, finding reply candidates, browsing a watchlist or
  feed, searching for tweets by keyword, or when the user says "find tweets", "scout",
  "what should I reply to", "check the feed", "find opportunities", or "look for tweets
  about [topic]". This skill covers discovery and evaluation only — use echo-reply-compose
  for actually writing and posting replies.
---

# Echo Tweet Scout

Find high-value tweets to reply to. For each candidate, understand the author, assess
virality potential, and store the full context so the compose skill has everything it needs.

## Tools

- `x:check-session` — verify X authentication before starting
- `x:get-list-feed { list_url }` — scrape tweets from the watchlist
- `x:search-tweets { query, tab }` — search X by keyword (use `tab: "latest"`)
- `x:get-author-profile { handle }` — scrape an author's profile (bio, followers, etc.)
- `x:get-author-timeline { handle, count }` — scrape an author's recent tweets
- `cortex:search` / `cortex:recall` — pull insights, past interactions, known authors
- `cortex:store` — store candidates and author profiles
- `google-enter-email { email }` — enter email on Google sign-in page
- `google-enter-password { password }` — enter password on Google sign-in page

## Step 0: Authenticate

Before doing anything, verify the X session is live.

```
x:check-session
```

If `authenticated` is `true`, skip to **Sources**.

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

## Sources

### Watchlist (primary)

```
x:get-list-feed { list_url: "https://x.com/i/lists/2027463448406204882" }
```

These are curated accounts. Tweets from the watchlist get natural priority.

### Keyword search (secondary)

```
x:search-tweets { query: "AI agents", tab: "latest" }
```

Rotate keywords across sessions. Good keywords are specific to your niche — not so broad
you drown in noise.

## For Every Candidate: Know the Author

Don't evaluate a tweet in isolation. Before deciding whether to reply, understand who wrote
it. This is critical — a great tweet from an author who never engages back is worth less
than a decent tweet from someone who always responds.

### Check Cortex first

```
cortex:search { query: "author @handle" }
```

If you already have an `author` node for this person with good data (bio, what they work on,
communication style, interaction history), **use it as-is**. Don't re-scrape profiles or
timelines for known authors — Cortex already has their persona.

### Only research unknown or sparse authors

If Cortex has **no author node** or the existing node is missing key fields (no bio, no
`what_they_work_on`, no `communication_style`), then scrape:

```
x:get-author-profile { handle: "Hesamation" }
x:get-author-timeline { handle: "Hesamation", count: 10 }
```

From the profile and recent tweets, form your own understanding of:

- **What do they work on?** Their bio and recent tweets reveal their domain.
- **What does their audience value?** Which tweets get the most engagement?
- **What's their communication style?** Technical? Casual? Provocative? Meme-heavy?
- **Do they engage with replies?** The most important question. The +75
  author-engages-back signal makes this the single most important author attribute.

### Store or update the author

```
cortex:store {
  kind: "author",
  title: "{handle}",
  body: "{\"handle\":\"@Hesamation\",\"display_name\":\"__ℏεsam__\",\"bio\":\"...\",\"followers\":12000,\"what_they_work_on\":\"AI research, reasoning models\",\"audience_values\":\"Technical depth, novel takes on AI capabilities\",\"communication_style\":\"Analytical, dry humor, engages with pushback\",\"responds_to_replies\":true,\"times_we_replied\":3,\"they_replied_back\":2,\"updated_at\":\"...\"}",
  tags: ["author", "author-{handle}"]
}
```

The `times_we_replied` and `they_replied_back` fields are gold. An author who replies back
2 out of 3 times is a high-priority target — every interaction triggers the +75 signal.

If updating an existing author, use `cortex:recall` to get the node ID, then update rather
than creating a duplicate.

## Assessing Virality Potential

For each tweet, judge how likely it is to blow up. This replaces the old scoring formula —
you can just read the tweet and think about it.

### Score it

Use `score_virality` to calculate a score for each candidate. Parse the tweet's metrics
(replies, retweets, likes, views, age in hours) and the author's data (followers, whether
they reply back), then call:

```
score_virality {
  replies: 250,
  retweets: 15,
  likes: 443,
  views: 53000,
  age_hours: 4,
  author_followers: 107900,
  author_replies_back: false
}
```

Returns `{ score, rating, reasoning, breakdown }`. The rating maps to priority:
- **high** (500+): top priority, write your best reply
- **medium** (150-499): solid candidate, worth replying
- **low** (50-149): only if nothing better
- **skip** (<50): don't bother

The score uses X algorithm weights (reply 13.5x, retweet 20x, bookmark 10x, like 1x),
exponential time decay (50% every 6h), author reach (log-scaled followers), and a +75
bonus if the author replies back. Store the score and rating with the tweet in Cortex.

### Content (your judgment)

The score handles momentum and author reach. You handle content quality:

- **Is it a strong take that invites debate?** Debate generates replies, replies fuel the
  algorithm.
- **Is it about something trending or breaking?** Trending topics get an algorithmic boost.
- **Is it novel or surprising?** Unexpected claims generate more engagement than obvious ones.
- **Does it contain a claim people will challenge or build on?** That's your opening.

Use content quality to break ties between candidates with similar scores.

## Hard Filters — Skip Immediately

- Retweets, quote tweets, or replies to other tweets
- Older than 6 hours (unless exceptional outlier, see Momentum)
- Spam: crypto giveaways, "DM me", follow-back, airdrops, NFT promos, presales, whitelist
- Already replied to this account 2-3 times today
- Already in Cortex (`cortex:search { query: "tid-{tweet_id}" }`)

## Storing Candidates

For each tweet worth replying to:

```
cortex:store {
  kind: "tweet",
  title: "{tweet_id}",
  body: "{\"content\":\"...\",\"author_handle\":\"@handle\",\"tweet_url\":\"...\",\"likes_t0\":12,\"retweets_t0\":3,\"replies_t0\":5,\"virality_assessment\":\"high\",\"virality_reasoning\":\"Strong contrarian take on GPT-5, 40 likes in 15 min, author has 50k engaged followers and replies back 80% of the time\",\"author_context\":\"AI researcher, responds to technical pushback, replied to us 2/3 times\",\"discovered_at\":\"...\",\"source\":\"watchlist\"}",
  tags: ["tweet", "status-queued", "tid-{tweet_id}", "author-{handle}"]
}
```

The `virality_assessment`, `virality_reasoning`, and `author_context` fields are there for
the compose skill. A high-virality tweet from an author who engages back deserves your best
work. A medium-virality tweet from an unknown author gets a solid but faster reply.

## How Many

3-5 strong candidates per session. If nothing good surfaces, say so. Don't force mediocre
tweets through — bad candidates produce bad replies that hurt your account reputation over
time.

## Generate Reply Suggestions

After storing candidates, immediately write **5 reply suggestions** for each candidate.
Don't ask whether to compose — just do it.

For each suggestion, use the full context you've gathered:
- The tweet content and what it's asking/claiming
- The author's communication style and what their audience values (from Cortex or research)
- Our voice profile and past interactions with this author
- The virality assessment (high-virality tweets deserve your best work)

### Voice rules

Pull the active voice profile from Cortex before writing replies:
```
cortex:search { query: "voice-profile active" }
```
Follow the banned patterns, good patterns, and tone guidance stored there. The core
principle: sound like a real person on Twitter, not an AI assistant.

Vary the 5 suggestions across different strategies:
1. **Add value** — share a specific experience, insight, or example that builds on the tweet
2. **Contrarian/challenge** — respectfully push back or offer an alternative perspective
3. **Ask a sharp question** — something that makes the author think and want to respond
4. **Humor/wit** — a clever observation that's still on-topic
5. **Signal boost** — agree enthusiastically with a concrete reason why

Present all 5 to the user so they can pick, edit, or riff on their favourite.
