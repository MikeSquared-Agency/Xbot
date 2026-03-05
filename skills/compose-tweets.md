---
name: compose-tweets
description: >
  Compose and post replies on X/Twitter as Echo. Use this skill whenever writing a reply,
  responding to a tweet, engaging with someone's post, composing a response, or posting on X.
  Also trigger when the user says "reply to this", "engage with", "respond to", "post a reply",
  "what should I say to", or references writing tweets. This skill covers the full loop: gather
  context, write the reply, present it for approval, post it, and record it. Does NOT cover
  analytics ingestion — use x-analytics for that. Does NOT cover tweet discovery — use
  research-tweets for that.
---

# Echo Reply Compose

Write and post replies on X that generate conversation, not just likes. The algorithm rewards
replies that spark back-and-forth 150x more than passive engagement.

**Human gate:** This skill always stops before posting to present suggestions for approval.
The user picks the reply (or edits it). Nothing posts without explicit confirmation.

## Tools

- `cortex:search` / `cortex:recall` — pull voice profile, playbook, insights, tweet candidates
- `x:post-reply { tweet_url, reply_text }` — post the reply via browser
- `x:check-session` — verify X session is live before posting
- `cortex:store` / `cortex:relate` — record the posted reply

## Step 1: Gather Context

Pull four things from Cortex before writing anything.

### 1. The tweet and its author context

```
cortex:search { query: "tweet status-queued" }
```

The tweet node contains `virality_rating`, `niche_match`, `virality_reasoning`,
`author_context`, `author_type`, and `author_source` — stored by the scout skill.
These tell you how much effort to invest and what angle will land.

For deeper author context if they're a known contact:

```
cortex:search { query: "author @handle" }
```

The author node has `communication_style`, `responds_to_replies`, `they_replied_back`,
and `times_we_replied`. If `they_replied_back` is high relative to `times_we_replied`,
invest heavily — every back-and-forth triggers the +75 signal.

### 2. Voice profile

```
cortex:search { query: "voice-profile active" }
```

Contains tone, vocabulary, sentence structure, hooks, personality markers, and banned
patterns. Internalise it completely — every reply must sound like this person, not
like a generic AI.

If no voice profile exists, fall back to: concise, technical, opinionated, no filler.

### 3. Playbook

```
cortex:search { query: "playbook active" }
```

Contains the five strategies with `description`, `best_when`, `avoid_when`, and
`performance_hint`. The `performance_hint` field is populated by the analytics skill
as it learns which strategies work on which author types. Read these hints — they
reflect real outcome data, not defaults.

### 4. Analytics insights + recent replies

```
cortex:search { query: "compose pattern insight" }
cortex:search { query: "reply posted recent" }
```

Insights tell you what's working (hook patterns, topics, structures). Recent replies
prevent repetition — if you used contrarian three times in a row, switch it up. Also
check you haven't replied to this author too many times today (2–3 max).

## Step 2: Select Strategy

Pick the strategy that fits the tweet AND the author. Three inputs:

1. **Tweet content** — what does this tweet call for? A strong claim invites contrarian.
   A question invites experience or additive. An insight invites additive or question.

2. **Author context** — `communication_style` and `responds_to_replies` from the author
   node or `author_context` field on the tweet. If they never respond, avoid question.
   If they engage with pushback, consider contrarian.

3. **Performance hints** — check `performance_hint` on each playbook strategy. If a hint
   says "contrarian underperforms on founders (n=8)", don't use contrarian on a founder
   unless the tweet is an unusually strong fit. Hints are advisory, not overrides.

Cross-reference the `author_type` from the tweet node against hints — hints are more
useful when the author type matches.

Don't force a strategy. If none genuinely fits, say so.

## Step 3: Write 5 Suggestions

Write one suggestion per strategy. Even if one strategy is clearly strongest, write all
five — the user may see something you don't.

For each suggestion:
- Max 280 characters. Under 120 is almost always better.
- Reference something specific from the tweet — prove you read it.
- Match or slightly elevate the author's technical level.
- Apply voice profile vocabulary, sentence structure, and personality markers.
- Cite a specific number or concrete detail if possible.
- Follow the playbook hard rules.

What not to do (from playbook hard rules):
- No hashtags
- No @-mentioning other accounts
- No generic affirmations ("Great post!", "This is so true")
- No threads
- Nothing that could trigger a report

## Step 4: Present for Approval — STOP HERE

Present the suggestions clearly before doing anything else. Format:

---
**Tweet:** [tweet content, truncated if long]
**Author:** @handle ([author_type]) — [responds_to_replies: yes/no], replied back [X/Y] times

**Suggestions:**

1. **contrarian** — [reply text]
2. **experience** — [reply text]
3. **additive** — [reply text]
4. **question** — [reply text]
5. **pattern_interrupt** — [reply text]

**Recommended:** #[N] ([strategy name]) — [one sentence on why, referencing performance hint if relevant]
---

Wait for the user to:
- Pick a number (1–5)
- Edit one of the suggestions
- Provide their own text to post instead
- Say skip/pass to drop this candidate

Do not proceed to posting until you have explicit confirmation of what to post.

## Step 5: Post

### 1. Check session

```
x:check-session
```

If not authenticated, stop and tell the user.

### 2. Post the approved reply

```
x:post-reply {
  tweet_url: "https://x.com/author/status/123",
  reply_text: "the approved reply text"
}
```

Returns `{ reply_id, reply_url }` on success.

## Step 6: Record in Cortex

Store the reply immediately after posting:

```
cortex:store {
  kind: "reply",
  title: "reply-{tweet_id}-{timestamp}",
  body: "{\"tweet_id\":\"...\",\"reply_text\":\"...\",\"strategy\":\"contrarian\",\"author_handle\":\"@handle\",\"author_type\":\"developer\",\"posted_at\":\"...\",\"reply_id\":\"...\",\"reply_url\":\"...\",\"virality_rating\":\"high\",\"niche_match\":\"hard\"}",
  tags: ["reply", "tweet-{tweet_id}", "strategy-{strategy}", "author-type-{author_type}"]
}
```

Then create the edge:

```
cortex:relate {
  from_id: reply_node_id,
  to_id: tweet_node_id,
  relation: "reply_to"
}
```

Critical fields for analytics:
- `strategy` — the strategy actually used (not just generated), drives performance audit
- `author_type` — enables strategy × author-type pattern detection
- `virality_rating` — correlates strategy performance with tweet quality
- `niche_match` — `"hard"` or `"soft"`, context for evaluating outcomes

### Create or update the author node

Check whether this author already has a Cortex node:

```
cortex:search { query: "author @handle" }
```

**If the node exists** (watchlist author or previously replied-to author):
PATCH to increment `times_we_replied` by 1. Do not touch `they_replied_back` — that
only updates when analytics detects an actual reply from them.

**If no node exists** (first reply to a home feed or search author):
This is the moment to promote them from working memory to the graph. The `author_context`
field on the tweet node has everything the scout scraped — use it to create the full
author node now:

```
cortex:store {
  kind: "author",
  title: "{handle}",
  body: "{\"handle\":\"@handle\",\"display_name\":\"...\",\"bio\":\"...\",\"followers\":...,\"author_type\":\"...\",\"what_they_work_on\":\"...\",\"audience_values\":\"...\",\"communication_style\":\"...\",\"responds_to_replies\":...,\"times_we_replied\":1,\"they_replied_back\":0,\"source\":\"search\",\"updated_at\":\"...\"}",
  tags: ["author", "author-{handle}"]
}
```

Set `times_we_replied: 1` directly — this is that first reply. Set `source` to `"home"`
or `"search"` from the tweet node's `author_source` field.

## Step 7: Mark Tweet as Replied

Update the tweet node status tag. Pull the tweet node ID, then PATCH:

```
PATCH /nodes/{tweet_id}
body: { "tags": updated to replace "status-queued" with "status-replied" }
```

This prevents the scout skill from re-queuing the same tweet.
