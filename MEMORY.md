# MEMORY.md - Fantasy Report Project Context

## Product Vision
**The Fantasy Report** is the best NFL news site for fantasy football players.
- **Core value:** Latest news, organized, easy to consume, zero fluff
- **Positioning:** News first, fantasy second (broader than pure fantasy)
- **Audience:** Fantasy players who want actionable intel without wading through noise

## Stack
- **Frontend:** Next.js (App Router)
- **Database:** Supabase / PostgreSQL
- **Deployment:** Vercel
- **Automation:** OpenClaw (Telegram integration, cron jobs, ingestion workflows)
- **Content:** NFL.com, ESPN, Yahoo, FantasyPros, Underdog, Sleeper, PFF

## Core Systems

### 1. Ingestion Pipeline
- Multi-source RSS/API ingestion
- Article scoring (quality, freshness, context)
- Player extraction and entity linking
- Transaction scraping (trades, signings, releases, waivers)
- Content filtering (NFL-only enforcement needed)

### 2. Article Scoring (Phase 1)
**File:** `lib/scoring.ts`
- Quality scoring: 0-100 based on source, actionability, specificity, entities, freshness
- Source quality: +20 for trusted sources
- Actionable content: +15 for start/sit, waivers, trades
- Penalties: -15 for low-value (recaps, podcasts, betting)

### 3. Trending Intelligence (Phase 2)
**File:** `lib/trending.ts`
- Server-side entity clustering (17 context types)
- Multi-source confirmation weighting
- Exponential time decay (0.5^(hours/12))
- Season-aware priority boosting
- Quality score integration
- Stable cluster keys: player:name:context

### 4. Feed Scoring (Phase 2.5)
**File:** `lib/feedScore.ts`
- Context-aware scoring (17 context types: injury, workload, trade, signing, etc.)
- Season-specific boosting:
  - Regular: injury +50%, workload +40%
  - Off-season: signing/trade +30%, mock_draft -40%
  - Preseason: starting_role +40%, depth_chart +30%
- Freshness decay: 0.5^(hours/12)
- Quality integration from Phase 1
- Off-season balancing: caps draft/mock at 40% of feed

**Formula:** feedScore = baseWeight * seasonBoost * freshness * quality

### 5. Homepage Data Flow (app/page.tsx)
**Phase 2.5 Behavior:**
1. Fetch all sections (news, rankings, advice, start-sit, injuries, waivers, DFS)
2. Score each article via calculateFeedScore()
3. Sort by feedScore DESC
4. Apply season-aware balancing (cap draft content at 40% in off-season)
5. Take top 14 for curated feed
6. Hero: pool top articles, score them, select highest-scored with image

**Before Phase 2.5:** Pure recency (latest 14 articles)
**After Phase 2.5:** Intelligent prioritization (injury updates > mock drafts)

### 6. Section System
**File:** `lib/sectionQuery.ts`
- 7 ordered sections: start-sit, waiver-wire, injury, dfs, rankings, advice, news
- Primary topic matching with secondary/topic fallback
- Provider diversity enforcement (per-provider caps, no back-to-back in first 10)
- Hybrid ranking: quality score + recency

## Key Constraints

### Development Rules
1. **No UI changes without explicit request** - Keep visual design stable
2. **Incremental changes only** - No broad refactors
3. **Safe deployments** - Build must pass, no breaking changes
4. **Season-aware** - Respect off-season, preseason, regular season modes

### Content Rules
1. **NFL-only enforcement** - Non-NFL articles must be filtered
2. **Provider diversity** - Avoid source dominance
3. **Freshness matters** - Recent content boosted but not exclusive
4. **Quality over quantity** - Better to show fewer high-signal articles

### Workflow Rules
1. **Main session (Claude):** Planning, discussion, orchestration, simple edits
2. **Codex sub-agents:** Feature implementation, refactoring, complex code
3. **Memory system:** MEMORY.md (stable facts), ROADMAP.md (phases), HANDOFF.md (current state)
4. **Repo location:** C:\Users\jftst\.openclaw\workspace\fantasy-report (active dev)

## Known Issues
1. **Ingestion reliability:** Vercel cron not consistently triggering (needs external cron backup)
2. **Content filtering:** Non-NFL articles leaking through weak classification rules
3. **Article deduplication:** No global dedupe across Hero ? Feed ? Sections (Phase 2.6 target)
4. **Clustering integration:** Feed not yet cluster-aware (Phase 2.6 target)

## Technical Debt
- Encoding safeguards (.gitattributes, pre-commit hook) to prevent UTF-8 BOM issues
- No PowerShell edits to TypeScript files (use Node.js scripts or VS Code)
- Vercel API route caching issues (sometimes need new route path to bypass)

## User Preferences (James)
- Dislikes corporate language ("premium hub", "repeat visits")
- Wants confident, direct messaging without being crude
- Values organized, scannable content over dense text
- Prefers broader "NFL news" positioning over narrow "fantasy only"
- Expects persistence through roadblocks (try 4-5 approaches before deferring)
