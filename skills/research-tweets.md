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

- `x:get-list-feed { list_url }` — scrape tweets from the watchlist
- `x:search-tweets { query, tab }` — search X by keyword (use `tab: "latest"`)
- `x:get-author-profile { handle }` — scrape an author's profile (bio, followers, etc.)
- `x:get-author-timeline { handle, count }` — scrape an author's recent tweets
- `cortex:search` / `cortex:recall` — pull insights, past interactions, known authors
- `cortex:store` — store candidates and author profiles

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

If you already have an `author` node for this person, read it. It has their bio, what they
work on, how they engage, and your past interaction history with them (how many times you've
replied, whether they responded back).

### If unknown or stale, scrape

```
x:get-author-profile { handle: "Hesamation" }
x:get-author-timeline { handle: "Hesamation", count: 10 }
```

From the profile and recent tweets, form your own understanding of:

- **What do they work on?** Their bio and recent tweets reveal their domain. For example,
  @Hesamation works on AI research and reasoning models — a reply about frontend frameworks
  would miss completely.
- **What does their audience value?** Look at which of their tweets get the most engagement.
  That's what their followers respond to. If their top tweets are deep technical threads,
  their audience wants depth, not hot takes.
- **What's their communication style?** Technical? Casual? Provocative? Meme-heavy? Your
  reply needs to match their register or you'll feel out of place in their thread.
- **Do they engage with replies?** This is the most important question. Look at their recent
  tweets — do they respond in the replies? An author who responds triggers the +75
  author-engages-back signal. This single data point should heavily influence whether you
  prioritise this tweet.

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

### Momentum (observable right now)

- **How old is it?** First 1-2 hours is the sweet spot. After 4 hours, skip it.
- **Engagement velocity** — 20 likes in 10 minutes is a rocket. 20 likes in 4 hours is
  stalled. Look at the ratio of engagement to tweet age.
- **Reply-to-like ratio** — high replies relative to likes means the algorithm is actively
  boosting it. Replies are 27x a like in algorithm weight.

### Content (your judgment)

- **Is it a strong take that invites debate?** Debate generates replies, replies fuel the
  algorithm.
- **Is it about something trending or breaking?** Trending topics get an algorithmic boost.
  First-mover takes spread fastest.
- **Is it novel or surprising?** Unexpected claims generate more engagement than obvious ones.
- **Does it contain a claim people will challenge or build on?** That's your opening.

### Author (from the enrichment above)

- **Follower count × engagement rate** — a 50k-follower account with 2% engagement puts
  your reply in front of ~1,000 active people.
- **Premium / verified?** Premium posts get 2-4x reach. Premium user replies get prioritised
  to the top of threads.
- **Does their content historically go viral?** Check their recent timeline.
- **Will they reply back?** This is worth repeating — the +75 signal makes this the single
  most important author attribute.

### Rate it

Score each candidate: **high / medium / low** virality potential. Include a one-line
reasoning. Store both with the tweet so the compose skill can calibrate effort accordingly.

## Hard Filters — Skip Immediately

- Retweets, quote tweets, or replies to other tweets
- Older than 4 hours
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
