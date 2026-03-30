# ROADMAP.md - Fantasy Report Development Phases

## Overview
Evolution from basic content aggregation to intelligent fantasy signal prioritization.

---

## Phase 1: Ingest Tightening (Article Quality Scoring)
**Status:** ? CODE-VERIFIED COMPLETE  
**Commit:** 660f2da (Sat Mar 28 23:00:32 2026)  
**Evidence Level:** Code-verified

### Objective
Establish baseline article quality measurement to differentiate high-signal content from noise.

### Implementation
**NEW FILES:**
- `lib/scoring.ts` (143 lines)
  - Quality scoring: 0-100 based on multiple signals
  - Source quality: +20 for trusted sources
  - Actionable content: +15 for start/sit, waivers, trades
  - Topic specificity: +10 for specific topics
  - Entity presence: +5 per player (max +15)
  - Freshness: +10 (0-2h) down to +3 (12-24h)
  - Penalties: -15 for low-value (recaps, podcasts, betting)
  - Penalties: -5 for generic news, deep URLs

**UPDATED FILES:**
- `lib/sectionQuery.ts` - Hybrid ranking (40% quality + 60% recency)
- `lib/HomeData.ts` - Score-aware sorting
- `app/api/admin/score-articles/route.ts` - Batch scoring endpoint (NEW)

### Key Changes
- Populated unused 'score' field in articles table (no schema change)
- Hybrid ranking balances fresh + high-quality
- Admin route to score existing articles
- Trusted sources prioritized

### Impact
- High-quality actionable content rises to top
- Recaps/podcasts/betting pushed down
- Foundation for Phase 2-3 intelligent systems

---

## Phase 2: Trending Intelligence (Entity Clustering)
**Status:** ? CODE-VERIFIED COMPLETE  
**Commit:** f8d23f0 (Sun Mar 29 00:03:36 2026)  
**Evidence Level:** Code-verified

### Objective
Replace brittle client-side trending with intelligent server-side entity clustering.

### Implementation
**NEW FILES:**
- `lib/trending.ts` (384 lines)
  - 17 context types (injury, workload, depth_chart, trade, signing, mock_draft, etc.)
  - Entity extraction (players from title + players array)
  - Multi-source confirmation weighting (log scale)
  - Exponential time decay: 0.5^(hours/12)
  - Season-aware priority boosting
  - Quality score integration
  - Stable cluster keys: player:name:context

**UPDATED FILES:**
- `components/beta/BetaTrending.tsx` - Now receives TrendCluster[] from server (removed client-side regex)
- `app/page.tsx` - Computes trends server-side, passes to component

### Clustering Algorithm
1. Extract players from title + players array
2. Detect contexts via regex patterns
3. Group by player + context (stable keys)
4. Score clusters:
   - score = (quality/100) * log2(sources+1) * sqrt(articles) * timeDecay * seasonBoost * contextPriority
5. Sort by score DESC, take top 8

### Time Decay
- Formula: 0.5^(hours/12)
- Result: Fresh stories rise fast, old stories cool naturally
- 0h: 1.0 | 12h: 0.5 | 24h: 0.25

### Example Clusters
- "Saquon Barkley workload concern" (3 articles, 2 sources)
- "Joe Burrow injury update" (5 articles, 3 sources)
- "Chiefs backfield depth chart shift" (2 articles, 2 sources)

### Impact
- Cross-source stories rise above one-off mentions
- Entity + context labels (not generic "trending")
- Old trends decay naturally
- Season-aware (boosts relevant contexts)
- Server-side (no client-side computation)

---

## Phase 2.5: Homepage Intelligence & Signal Flow (Feed Scoring)
**Status:** ? CODE-VERIFIED COMPLETE  
**Commit:** 218505d (Sun Mar 29 23:03:39 2026)  
**Evidence Level:** Code-verified

### Objective
Transform homepage from "list of recent articles" into "prioritized fantasy signal system".

### Implementation
**NEW FILES:**
- `lib/feedScore.ts` (176 lines)
  - Context-aware scoring (17 context types)
  - Injury/workload/starting_role: 100-85pts
  - Mock_draft/generic_news: 20-15pts
  - Season-specific boosting:
    - Regular: injury +50%, workload +40%
    - Off-season: signing/trade +30%, mock_draft -40%
    - Preseason: starting_role +40%, depth_chart +30%
  - Freshness decay: 0.5^(hours/12)
  - Quality score integration from Phase 1
  - Off-season balancing: caps draft/mock at 40% of feed

**UPDATED FILES:**
- `app/page.tsx` (28 line changes)
  - Feed rebuilt as scored mix (was pure recency)
  - Pools ALL sections (7 total)
  - Scores each article via calculateFeedScore()
  - Sorts by feedScore DESC
  - Applies season-aware balancing
  - Takes top 14 for curated feed
  - Hero improved: pools top articles, scores them, selects highest-scored with image

### Scoring Formula
feedScore = baseWeight * seasonBoost * freshness * quality

**Where:**
- baseWeight: 100 (injury) to 15 (generic news)
- seasonBoost: 0.6-1.5x (context + season dependent)
- freshness: 0.5^(hours/12) exponential decay
- quality: (article.score / 100) from Phase 1

### Example Scores (Regular Season, 2h old, quality=70)
- Injury update: 100 * 1.5 * 0.89 * 0.70 = 93.5
- Mock draft: 20 * 1.0 * 0.89 * 0.70 = 12.5
- Result: Injury prioritized 7.5x higher

### Off-Season Balancing
- Caps mock_draft + landing_spot + rookie at 40% of feed
- Ensures signing/trade news not buried by draft content
- Fills remaining slots with highest scored articles

### Before vs After
**BEFORE:**
- feed = uniqueArticles(latest, rankings, advice, startSit).slice(0, 14)
- Pure recency
- No importance weighting
- Draft content dominates in off-season

**AFTER:**
- feed = balanceFeed(scoreAndSort(allArticles, season), season, 14)
- Context-aware prioritization
- Injury updates > mock drafts
- Season-specific boosts
- Draft capped at 40% in off-season
- Quality + freshness integrated

### Impact
? Feed prioritizes fantasy-important signals  
? Draft content no longer dominates (40% cap)  
? Hero reflects most important story (scored pool)  
? Season-aware (injury in Sept ? mock draft in March)  
? Quality-aware (integrates Phase 1 scores)  
? Fresh content boosted (exponential decay)

### No Regressions
? No UI changes  
? No schema changes  
? No new data fetching  
? Existing sections unchanged  
? Build passes  
? Deduplication still works

---

## Phase 2.6: Cluster-Aware Feed & Global Deduplication
**Status:** ? NOT STARTED  
**Evidence Level:** Requested but not implemented

### Objective
Make curated feed cluster-aware to prevent duplicate stories and improve hero selection.

### Requested Implementation

#### 1. Make Curated Feed Cluster-Aware
- Use trending clusters as input
- Select best article per cluster
- Remove duplicate stories in feed

#### 2. Add Global Dedupe
- Hero ? Feed ? Sections consumption order
- Prevent duplicate articles across sections
- Track consumed article IDs through the data flow

#### 3. Improve Hero
- Select from top cluster, not just top article
- Ensures hero represents most important trending story

#### 4. Add Lightweight "Why It Matters"
- Derived from context (no LLM)
- Show brief explanation of why story is trending

### Constraints
- **NO UI changes**
- **NO major refactor**
- **Incremental and safe only**
- Must build on existing Phase 2.5 infrastructure

### Dependencies
- Phase 2: Trending clusters (? available)
- Phase 2.5: Feed scoring (? available)
- Existing deduplication logic (? exists in lib/HomeData.ts)

### Files Likely Touched
- `lib/feedScore.ts` - Cluster-aware feed selection
- `app/page.tsx` - Global dedupe flow
- `lib/HomeData.ts` - Dedupe consumption order
- `lib/trending.ts` - Potentially expose cluster metadata

### Expected Behavior After Implementation
1. Feed shows diverse stories (one article per cluster)
2. Hero selected from top cluster
3. No article appears in both Hero and Feed
4. No article appears in multiple sections
5. "Why it matters" context displayed (lightweight)

### Not Included
- UI redesign
- New components
- Schema changes
- External API calls

---

## Future Phases (Not Defined)

### Potential Phase 3: Observability & Debug
- Admin dashboard for scoring/clustering transparency
- Debug routes to inspect article scores
- Cluster visualization

### Potential Phase 4: Personalization
- User preferences
- Team/player following
- Custom feed weights

---

## Notes
- All phases build incrementally on previous work
- No breaking changes introduced
- Season-aware from Phase 2 onwards
- Quality-aware from Phase 1 onwards
