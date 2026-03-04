---
name: x-analytics
description: >
  Ingest X/Twitter analytics data and store performance insights into Cortex graph memory.
  Use this skill whenever pulling analytics, reviewing post performance, analysing engagement
  metrics, scoring tweets, or updating what's working / not working. Also trigger when the
  user mentions "analytics", "metrics", "what's performing", "engagement", "impressions",
  or asks to review recent posts. This skill covers ingestion and analysis only — not
  composing or posting.
---

# Echo Analytics Ingestion

Pull X analytics data, score it against the real algorithm weights, and store actionable
insights into Cortex so the compose process can use them later.

## Tools

- `x:pull-analytics { days }` — returns raw CSV of post metrics
- `cortex:store` — persist insight nodes
- `cortex:search` / `cortex:recall` — check for existing insights before duplicating

## Flow

### 1. Pull

```
x:pull-analytics { days: 7 }
```

This returns CSV text with columns like impressions, likes, retweets, replies, bookmarks,
engagements, profile clicks. Read it directly — don't parse it with code, just read the table.

### 2. Score against algorithm weights

X's recommendation algorithm weights engagement very unevenly. A like is not a like. Score
every post using these weights from X's open-sourced recommendation code:

| Signal | Weight | Multiplier vs like |
|--------|--------|--------------------|
| Reply + author engages back | 75 | 150x |
| Reply | 13.5 | 27x |
| Profile visit + engage | 12.0 | 24x |
| Conversation click + engage | 11.0 | 22x |
| Dwell time (2+ min) | 10.0 | 20x |
| Repost | 1.0 | 2x |
| Like | 0.5 | 1x (baseline) |

Bookmarks are estimated at ~10x (not officially documented).

The critical takeaway: a reply that sparks back-and-forth is worth 150x a like. The algorithm
rewards conversation, not passive engagement. Five replies with author responses outperform
fifty likes with silence.

### 3. Analyse

Look at the CSV through the lens of those weights. Focus on:

- **Reply ratio** — which posts generated replies, not just likes? Replies are 27x more
  valuable. High impressions + low replies means the algorithm won't push it further.
- **Repost triggers** — reposts are 2x a like but signal shareability. What made someone
  hit share?
- **Algorithm gold** — low impressions + high replies means the content resonates but the
  hook was weak. Fix the hook and you have a winner.
- **Top performer text** — read the actual words. What topics, formats, hooks, and angles
  appear in the best posts?
- **Bottom performer text** — what to stop doing. Patterns that get likes but zero replies
  are actively bad for reach.
- **Velocity** — engagement in the first 30 minutes is critical. Posts lose ~50% visibility
  every 6 hours. If a post got engagement late, the content was good but the timing or hook
  was off.

### 4. Store insights into Cortex

Store what you learn as `insight` nodes. Be specific and actionable — "posts about AI do
well" is useless. "Posts that make a specific technical claim with a contrarian angle get
3-5x more replies than generic observations" is useful.

**Weekly digest:**

```json
{
  "kind": "insight",
  "title": "analytics-digest-YYYY-MM-DD",
  "body": "{\"period\":\"...\",\"top_patterns\":[...],\"avoid\":[...],\"best_reply_targets\":[...],\"engagement_score_avg\":45.2,\"sample_size\":87}",
  "tags": ["insight", "analytics", "weekly-digest"]
}
```

The `top_patterns` array should contain specific, evidence-backed observations. The `avoid`
array is equally important — patterns that look good on vanity metrics but score poorly on
algorithm weights.

**Individual pattern observations:**

```json
{
  "kind": "insight",
  "title": "insight-specific-numbers-in-replies",
  "body": "{\"observation\":\"Replies citing a specific number from the original post get 4x more replies than generic responses\",\"evidence\":\"3 of top 5 this week cited numbers\",\"confidence\":\"medium\",\"source\":\"analytics-2025-03-03\"}",
  "tags": ["insight", "compose-pattern"]
}
```

**Target account observations:**

```json
{
  "kind": "insight",
  "title": "target-somehandle",
  "body": "{\"handle\":\"@somehandle\",\"why\":\"Replies to our replies 60% of the time — triggers the +75 author-engages-back signal\",\"avg_impressions\":1200,\"last_updated\":\"2025-03-03\"}",
  "tags": ["insight", "target-account"]
}
```

Before storing, search Cortex for existing insights on the same topic and update rather than
duplicate. Use `cortex:search { query: "analytics digest" }` to check.

### 5. Done

Insights are in Cortex. A separate compose process will pull them when writing.
