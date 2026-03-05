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

Pull X analytics data, score it against algorithm weights, run the strategy performance
audit, and write findings back into Cortex so the compose skill improves over time.

## Tools

- `x:pull-analytics { days }` — returns raw CSV of post metrics
- `cortex:store` / `cortex:recall` / `cortex:search` — read and write Cortex nodes

## Step 1: Pull

```
x:pull-analytics { days: 7 }
```

Returns CSV text with columns including: impressions, likes, retweets, replies, bookmarks,
engagements, profile clicks. Read the table directly — don't parse with code.

## Step 2: Score Against Algorithm Weights

X's recommendation algorithm weights engagement very unevenly. Score every post:

| Signal | Weight | Multiplier vs like |
|--------|--------|--------------------|
| Reply + author engages back | 75 | 150x |
| Reply | 13.5 | 27x |
| Profile visit + engage | 12.0 | 24x |
| Repost | 1.0 | 2x |
| Like | 0.5 | 1x (baseline) |

Bookmarks estimated at ~10x (not officially documented).

The critical takeaway: a reply that sparks back-and-forth is worth 150x a like. Five
replies with author responses outperform fifty likes with silence.

## Step 3: Analyse Own Post Performance

Look at the CSV through the lens of those weights:

- **Reply ratio** — which posts generated replies, not just likes? High impressions +
  low replies means the algorithm won't push it further.
- **Top performer text** — read the actual words. What topics, formats, hooks, and angles
  appear in the best posts?
- **Bottom performer text** — patterns that get likes but zero replies are bad for reach.
- **Velocity** — posts lose ~50% visibility every 6 hours. Late engagement = good content,
  weak hook or timing.
- **Algorithm gold** — low impressions + high replies = content resonates, hook is weak.

## Step 4: Store General Insights

Store what you learn as `insight` nodes. Be specific and evidence-backed.

**Weekly digest:**

```json
{
  "kind": "insight",
  "title": "analytics-digest-YYYY-MM-DD",
  "body": "{\"period\":\"...\",\"top_patterns\":[...],\"avoid\":[...],\"best_reply_targets\":[...],\"engagement_score_avg\":45.2,\"sample_size\":87}",
  "tags": ["insight", "analytics", "weekly-digest"]
}
```

**Individual pattern observations:**

```json
{
  "kind": "insight",
  "title": "insight-{descriptive-slug}",
  "body": "{\"observation\":\"Replies citing a specific number from the original post get 4x more replies than generic responses\",\"evidence\":\"3 of top 5 this week cited numbers\",\"confidence\":\"medium\",\"source\":\"analytics-YYYY-MM-DD\"}",
  "tags": ["insight", "compose-pattern"]
}
```

Before storing, search for existing insights on the same topic and update rather than
duplicate:

```
cortex:search { query: "analytics digest" }
```

## Step 5: Strategy Performance Audit

This step closes the self-improvement loop. Cross-reference reply nodes against outcomes
to learn which strategies work on which author types.

### 5a. Pull reply nodes

```
cortex:search { query: "reply posted strategy" }
```

Aim for the last 30 days of replies. Pull enough to find patterns.

### 5b. For each reply node, gather:

- `strategy` tag — which strategy was used
- `author_type` — the author type at time of reply (stored on the reply node)
- `author_handle` — to check the author node for reply-back data
- `virality_rating` — what tier was the original tweet (high/medium/low)
- `niche_match` — hard or soft niche match

### 5c. Check reply-back outcomes

For each reply, pull the author node:

```
cortex:search { query: "author @{handle}" }
```

Compare `they_replied_back` count before and after our reply. If the author has replied
since our post, that's a positive outcome for this strategy × author-type combination.

Note: `they_replied_back` is a cumulative count — you're looking at whether it increased
after our reply date. If the timing is ambiguous, note it as uncertain rather than forcing
an attribution.

### 5d. Group and analyse

Group replies by `strategy` × `author_type`. For each combination with 3+ data points:

- **Reply-back rate** — what % of authors responded to this strategy × author-type combo?
- **Virality tier distribution** — does the strategy perform differently on high vs. medium
  virality tweets?
- **Niche match effect** — do hard-match tweets respond differently than soft-match?

Look for meaningful differences (>15% reply-back rate gap) before calling something a pattern.
Three data points is the minimum — don't draw conclusions from 1–2 samples.

Examples of actionable patterns worth recording:
- "contrarian on ai_researcher authors: 4/6 replied back (67%) vs baseline 25%"
- "question strategy on high-virality tweets: 1/7 replied back — authors too busy"
- "experience on developer authors consistently drives back-and-forth (5/7, 71%)"

### 5e. Author node updates

If you detect that an author replied back to one of our replies during this period, update
their author node:

```
PATCH /nodes/{author_node_id}
body: { "they_replied_back": incremented_count }
```

This keeps the author engagement history accurate for future scoring.

## Step 6: Update Playbook Performance Hints

Pull the active playbook:

```
cortex:search { query: "playbook active" }
```

Read the current `performance_hint` for each strategy. The hint includes a sample size
in parentheses — e.g. `"(n=6, medium)"`.

### Update rules

For each strategy where the audit found a pattern:

1. **Only update if new evidence is stronger** — higher n, same or higher confidence.
   Don't overwrite `(n=8, medium)` with `(n=3, low)`. Do overwrite `(n=3, low)` with
   `(n=7, medium)`.

2. **Only update if n ≥ 3** — the playbook's `confidence_threshold_for_hint_update` field
   confirms this. Never update from 1–2 data points.

3. **Be specific in the hint** — include strategy name, author type, reply-back rate, sample
   size, and confidence level. If the pattern differs by author type, note both directions.

Example hint update:
```
"67% reply-back on ai_researcher authors (n=6, medium). Underperforms on founders (20%, n=5, low)."
```

### Write the update

PATCH the playbook node with the updated body. Only change the `performance_hint` fields
for strategies where evidence meets the threshold — leave others as-is.

Also update `updated_at` to today's date.

### Surface findings to the user

After updating the playbook, summarise what changed:

- Which strategy hints were updated and why
- Which patterns had enough evidence to record
- Which patterns were observed but didn't meet the threshold yet (note n count)
- Any strong recommendations for the compose skill going forward

This is the moment where you surface strategic insights — not buried in Cortex, but
clearly communicated so the user understands how the system is improving.
