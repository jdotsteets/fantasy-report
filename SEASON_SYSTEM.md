# Season-Aware Homepage System

## Overview

The Fantasy Report homepage now dynamically adapts to the NFL calendar, showing different sections and navigation based on the current season phase.

## Season Modes

### 1. Regular Season (Default)
**Dates:** All times except March 1 - May 20

**Sections:**
- News
- Rankings
- Start/Sit
- Waiver Wire (with week number)
- Advice
- DFS
- Injuries

### 2. Free Agency Mode
**Dates:** March 1 - April 20

**Sections:**
- News
- Rankings
- Free Agency Tracker (replaces Waiver Wire)
- Start/Sit
- Advice
- DFS
- Injuries

**Detection:** Articles matching FREE_AGENCY_RX pattern:
```
/\b(free\s+agency|sign(?:ed|ing)?|re-?sign(?:ed|ing)?|trade(?:d|s)?|cut|release(?:d)?|cap\s+hit|contract|extension|tagged|franchise\s+tag|waived|claimed|restructure|restructured)\b/i
```

### 3. Draft Mode
**Dates:** April 21 - May 20

**Sections:**
- News
- Rankings
- **NFL Draft** (replaces Start/Sit) - CLUSTERED SECTION
- Advice
- DFS
- Injuries

**Detection:** Articles matching DRAFT_RX pattern:
```
/\b(mock\s+draft|nfl\s+draft|prospect|prospects?|combine|big\s+board|draft\s+class|rookie|landing\s+spot|scouting|draft|senior\s+bowl|pro\s+day|team\s+needs?|team\s+fits?|draft\s+buzz|draft\s+rumors?|stock\s+up|stock\s+down)\b/i
```

## NFL Draft Section (Clustering)

When in Draft Mode, the homepage shows a specialized **NFL Draft** section with intelligent content clustering.

### Clusters

Articles are automatically grouped into 4 editorial buckets:

#### 1. Mock Drafts
**Keywords:** mock draft, first-round, 7-round mock, full mock

**Content:** Complete mock drafts, round-by-round projections

#### 2. Prospect Rankings
**Keywords:** big board, prospect rank, top prospects, position rank, top [number]

**Content:** Player rankings, big boards, position-specific ranks

#### 3. Draft Buzz (Catch-all)
**Keywords:** stock up, stock down, combine, pro day, riser, faller, buzz, rumor, visit, meeting, medical

**Content:** Draft news, rumors, combine performances, player buzz

#### 4. Team Fits
**Keywords:** landing spot, team fit, best fit, draft need, team need

**Content:** Team-specific draft analysis, needs, landing spots

### UI Layout

**Desktop:** 2x2 grid of cluster cards  
**Mobile:** Stacked single column

**Each cluster card shows:**
- Cluster title
- Article count badge
- Up to 5 articles (most recent)
- "+X more" indicator if more than 5

**Fallback:** If fewer than 6 draft articles, shows simple list instead of clusters

### Strict NFL-Only Filtering

Draft content is filtered to exclude:
- Fantasy Baseball
- MLB, NBA, NHL content
- March Madness / college basketball (unless NFL draft prospects)
- Soccer/MLS
- Generic non-football content

## Navigation

The top toolbar dynamically changes based on season mode.

### Regular Season Nav
News | Rankings | Start/Sit | Waiver Wire | Advice | DFS | Injuries

### Free Agency Nav
News | Rankings | Free Agency | Start/Sit | Advice | DFS | Injuries

### Draft Nav
News | Rankings | **NFL Draft** | Advice | DFS | Injuries

## Local Testing

### Environment Variable Override

You can test different season modes locally without changing dates:

```bash
# Test Draft Mode
TEST_SEASON_MODE=draft npm run dev

# Test Free Agency Mode
TEST_SEASON_MODE=free-agency npm run dev

# Test Regular Season
TEST_SEASON_MODE=regular npm run dev

# Or no override (uses actual dates)
npm run dev
```

The override is logged to console:
```
[Season Override] Using TEST_SEASON_MODE=draft
```

### Manual Date Testing

Edit `app/page.tsx` temporarily to override the date:

```typescript
// In Page component, change:
const seasonMode = getEffectiveSeasonMode(new Date());

// To test specific date:
const seasonMode = getEffectiveSeasonMode(new Date('2026-05-01')); // Draft mode
```

## Files Modified

### Core System
- `lib/sectionQuery.ts` - Added `nfl-draft` and `free-agency` to ORDERED_SECTIONS
- `lib/HomeData.ts` - Extended section types and limits
- `app/page.tsx` - Activated seasonal logic, added testing override

### Components
- `components/beta/BetaNav.tsx` - Made seasonal (accepts `seasonMode` prop)
- `components/beta/BetaDraftSection.tsx` - NEW: Clustered draft section

### Configuration
None - all logic is in code, no config files

## How It Works

### Season Detection

1. `getSeasonMode(now: Date)` checks current date against ranges
2. `getEffectiveSeasonMode(now: Date)` adds TEST_SEASON_MODE override support
3. Returns: `"regular"` | `"free-agency"` | `"draft"`

### Content Filtering

1. All articles fetched normally from database
2. Draft articles: `draftItems = latest.filter(a => DRAFT_RX.test(title + url))`
3. Free agency: `freeAgencyItems = latest.filter(a => FREE_AGENCY_RX.test(title + url))`

### Rendering Logic

```typescript
{seasonMode === "draft" ? (
  <BetaDraftSection articles={draftItems.slice(0, 20)} />
) : seasonMode === "free-agency" ? (
  <BetaLoadMoreSection title="Free Agency Tracker" ... />
) : (
  <BetaLoadMoreSection title="Waiver Wire — Week X" ... />
)}
```

### Navigation Updates

```typescript
<BetaNav seasonMode={seasonMode} />
```

Component internally generates appropriate links based on mode.

## Adding New Draft Sources

To improve draft coverage, add sources to the database:

1. Identify reputable draft sources (examples below)
2. Add via admin panel or SQL INSERT
3. Mark as `allowed=true` and `sport='nfl'`
4. Set appropriate `priority` (1-10)
5. Configure `fetch_mode` (rss, adapter, or scrape)

### Recommended Draft Sources

**Already Active (verify in database):**
- PFF - NFL Draft content
- ESPN NFL Draft
- NFL.com Draft section
- CBS Sports Draft
- Yahoo Sports Draft
- The Draft Network
- Dane Brugler / The Athletic

**Potential Additions:**
- Pro Football Focus Draft Analysis
- NFL Mock Draft Database
- Walter Football
- Draft Tek
- Draft Scout
- Lance Zierlein (NFL.com)

## Future Enhancements

### Phase 1 (Current) ✅
- Seasonal section switching
- Draft content clustering
- Dynamic navigation
- Local testing support

### Phase 2 (Future)
- Dedicated draft content ingestion
- External search integration for draft articles
- Real-time draft tracker during event
- Team-specific draft needs analysis

### Phase 3 (Future)
- Historical draft analysis
- Rookie player pages
- Draft grade tracking
- Landing spot impact analysis

## Troubleshooting

### Draft section not showing
1. Check date is April 21 - May 20
2. Or set `TEST_SEASON_MODE=draft`
3. Verify draft articles exist: check `draftItems.length`
4. Check browser console for season override log

### Wrong season mode
1. Verify server date/time
2. Check `getSeasonMode()` date ranges
3. Clear `TEST_SEASON_MODE` if set

### Nav not updating
1. Verify `seasonMode` prop passed to `<BetaNav>`
2. Check browser dev tools for prop value
3. Hard refresh browser (Ctrl+F5)

### Clusters not showing
1. Need 6+ draft articles for clustering
2. Falls back to simple list if sparse
3. Check article keywords match cluster patterns

## Performance

### Impact
- Minimal: Season detection is a simple date check
- Filtering: Regex on already-fetched articles (no extra queries)
- Rendering: One conditional section swap

### Caching
- Season mode computed per request (server-side)
- No caching needed (fast calculation)
- Client-side rendering for draft clusters

## Maintenance

### Updating Season Dates

Edit `app/page.tsx`:

```typescript
function getSeasonMode(now: Date): SeasonMode {
  if (inRange(now, { month: 3, day: 1 }, { month: 4, day: 20 })) 
    return "free-agency";
  if (inRange(now, { month: 4, day: 21 }, { month: 5, day: 20 })) 
    return "draft";
  return "regular";
}
```

### Adding New Clusters

Edit `components/beta/BetaDraftSection.tsx`:

```typescript
const CLUSTERS: Omit<DraftCluster, 'articles'>[] = [
  // ... existing clusters
  {
    title: "New Cluster Name",
    keywords: /your|keyword|pattern/i,
  },
];
```

### Adjusting Patterns

Update regex in `app/page.tsx`:

```typescript
const DRAFT_RX = /your|enhanced|pattern/i;
const FREE_AGENCY_RX = /your|enhanced|pattern/i;
```