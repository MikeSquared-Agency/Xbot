---
name: compose-tweets
description: >
  Compose and post replies on X/Twitter as Echo. Use this skill whenever writing a reply,
  responding to a tweet, engaging with someone's post, composing a response, or posting on X.
  Also trigger when the user says "reply to this", "engage with", "respond to", "post a reply",
  "what should I say to", or references writing tweets. This skill covers the full loop: gather
  context, write the reply, post it, record it, and follow up. Does NOT cover analytics
  ingestion — use echo-analytics-ingestion for that.
---

# Echo Reply Compose

Write and post replies on X that generate conversation, not just likes. The algorithm rewards
replies that spark back-and-forth 150x more than passive engagement.

## Tools

- `cortex:search` / `cortex:recall` — pull voice profile, insights, recent replies, tweet candidates
- `x:post-reply { tweet_url, reply_text }` — post the reply via browser
- `x:check-session` — verify X session is live before posting
- `cortex:store` — record the posted reply

## Before You Write Anything

Gather four things from Cortex:

### 1. The tweet and its author context

The scout skill stores tweet candidates with `virality_assessment`, `virality_reasoning`,
and `author_context` baked in. Read these — they tell you how much effort to invest and
what angle will land with this specific author.

```
cortex:search { query: "tweet status-queued" }
```

For deeper author understanding, pull their full author node:

```
cortex:search { query: "author @handle" }
```

This has what they work on, what their audience values, their communication style, and
critically — whether they reply back to you. If `they_replied_back` is high relative to
`times_we_replied`, invest heavily. Every back-and-forth triggers the +75 signal.

### 2. Voice profile

```
cortex:search { query: "voice profile active" }
```

The voice profile is a `voice_profile` node with tag `active`. It contains tone, vocabulary,
sentence structure, hooks, personality markers. Internalise it — every reply should sound
like this person, not like a generic AI.

If no voice profile exists, fall back to: concise, technical, opinionated, no filler.

### 3. Analytics insights

```
cortex:search { query: "compose pattern insight" }
cortex:search { query: "analytics digest weekly" }
```

These are `insight` nodes stored by the analytics ingestion skill. They contain what's
working (hook patterns, topics, structural patterns) and what to avoid. Apply them.

### 4. Recent replies

```
cortex:search { query: "reply posted recent" }
```

Check recent `reply` nodes to avoid repeating yourself. If you used a contrarian angle on
the last three replies, switch it up. Also check you haven't already replied to this author
too many times today (2-3 max).

## Writing the Reply

### Strategy selection

Pick the strategy that fits the tweet AND the author. What you know about the author from
the scout data should directly influence your approach — if they respond well to pushback,
go contrarian. If they engage with questions, ask one.

- **Contrarian** — disagree with a specific, reasoned counter-take. Best when the tweet makes a strong claim and the author respects pushback.
- **Experience** — "We built X and found..." Share a real-world data point. Best when the topic overlaps with your domain and the author values practitioner credibility.
- **Additive** — build on their point with something they missed. Best when the tweet is good but incomplete, and the author engages with depth.
- **Question** — ask something specific and thought-provoking. Best when the author actively responds to replies (directly triggers the +75 signal).
- **Pattern interrupt** — unexpected reframing or cross-domain connection. Best when the author appreciates novelty and you can genuinely surprise.

Don't force a strategy. If none fits the tweet + author combination, skip it.

### Reply rules

- **Max 280 characters.** Shorter is almost always better. Under 120 chars tends to perform best.
- **Add genuine value.** Insight, experience, a contrarian angle, or a specific question. Never "Great post!", "This is so true", "Couldn't agree more", or any variant.
- **Reference specific details from the tweet.** Prove you read it. Generic replies get ignored.
- **Match or slightly elevate the author's technical level.** Don't talk down, don't over-jargon.
- **Write in the voice profile's style.** Use their vocabulary, sentence structure, personality markers. Not yours.
- **Cite specific numbers when possible.** Replies containing a concrete metric or data point consistently outperform vague ones.

### What not to do

- No hashtags (they hurt reach for replies)
- No @-mentioning other accounts in the reply (looks spammy)
- Nothing that could trigger reports — one report is -369x, which wipes out hundreds of likes. Be provocative enough to spark debate, never enough to offend.
- No threads as replies (single tweet only)
- Don't reply to the same account more than 2-3 times per day (looks like stalking)

## Posting

### 1. Check session

```
x:check-session
```

If not authenticated, stop and tell the user to log in.

### 2. Post

```
x:post-reply { tweet_url: "https://x.com/author/status/123", reply_text: "your reply" }
```

This returns `{ reply_id, reply_url }` on success.

### 3. Record in Cortex

After posting, store the reply so analytics can track it later:

```
cortex:store {
  kind: "reply",
  title: "reply-{tweet_id}-{timestamp}",
  body: "{\"tweet_id\":\"...\",\"reply_text\":\"...\",\"strategy\":\"contrarian\",\"posted_at\":\"...\",\"reply_id\":\"...\",\"reply_url\":\"...\",\"author_handle\":\"@target\"}",
  tags: ["reply", "tweet-{tweet_id}", "strategy-{strategy}"]
}
```

Then create the edge:

```
cortex:relate { from_id: reply_node_id, to_id: tweet_node_id, relation: "reply_to" }
```
