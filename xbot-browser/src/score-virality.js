'use strict'

// X algorithm weights (from open-sourced recommendation code)
const WEIGHTS = {
  reply: 13.5,
  retweet: 20,
  bookmark: 10,
  like: 1,
}

// Time decay: ~50% every 6 hours
const HALF_LIFE_HOURS = 6

function scoreVirality({ replies = 0, retweets = 0, likes = 0, bookmarks = 0, views = 0, age_hours = 0, author_followers = 0, author_replies_back = false }) {
  // Raw engagement score weighted by algorithm importance
  const raw = (replies * WEIGHTS.reply) + (retweets * WEIGHTS.retweet) + (bookmarks * WEIGHTS.bookmark) + (likes * WEIGHTS.like)

  // Time decay (exponential, half-life = 6h)
  const decay = Math.pow(0.5, age_hours / HALF_LIFE_HOURS)

  // Velocity: engagement per hour (avoid division by zero)
  const hours = Math.max(age_hours, 0.1)
  const velocity = raw / hours

  // Reply-to-like ratio (high = algorithm is boosting)
  const replyRatio = likes > 0 ? replies / likes : 0

  // Engagement rate (if we have views)
  const engagementRate = views > 0 ? (replies + retweets + likes) / views : 0

  // Author reach factor: log scale so 100K followers isn't 100x better than 1K
  const reachFactor = author_followers > 0 ? Math.log10(author_followers) / Math.log10(100000) : 0.5

  // Author reply-back bonus (+75 in X algo, massive signal)
  const replyBackBonus = author_replies_back ? 75 : 0

  // Final composite score
  const score = Math.round((raw * decay * reachFactor) + (velocity * 10) + replyBackBonus)

  // Rating thresholds
  let rating
  if (score >= 500) rating = 'high'
  else if (score >= 150) rating = 'medium'
  else if (score >= 50) rating = 'low'
  else rating = 'skip'

  // Build reasoning
  const parts = []
  parts.push(`raw engagement: ${Math.round(raw)} (${replies} replies, ${retweets} RTs, ${likes} likes)`)
  parts.push(`age: ${age_hours}h, decay: ${(decay * 100).toFixed(0)}%`)
  parts.push(`velocity: ${Math.round(velocity)}/h`)
  if (replyRatio > 0.3) parts.push(`high reply ratio (${replyRatio.toFixed(2)}) = algo boost`)
  if (author_followers > 0) parts.push(`author reach: ${author_followers.toLocaleString()} followers`)
  if (author_replies_back) parts.push(`author replies back (+75 bonus)`)
  if (engagementRate > 0) parts.push(`engagement rate: ${(engagementRate * 100).toFixed(2)}%`)

  return {
    score,
    rating,
    reasoning: parts.join(', '),
    breakdown: {
      raw_engagement: Math.round(raw),
      time_decay: parseFloat(decay.toFixed(3)),
      velocity: Math.round(velocity),
      reply_ratio: parseFloat(replyRatio.toFixed(2)),
      reach_factor: parseFloat(reachFactor.toFixed(2)),
      reply_back_bonus: replyBackBonus,
    }
  }
}

module.exports = { scoreVirality }
