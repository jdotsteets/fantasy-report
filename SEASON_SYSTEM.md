# Season-Aware Homepage - 3 Mode System

## Overview

The Fantasy Report homepage adapts to the NFL calendar with 3 distinct modes:

## Mode 1: Regular Season
**Dates:** September 10 - January 31 (approximately)

**Sections:**
- News
- Rankings
- **Start/Sit** ✓
- **Waiver Wire** ✓ (with week number)
- Advice
- DFS
- Injuries

**Navigation:**
News | Rankings | Start/Sit | Waiver Wire | Advice | DFS | Injuries

---

## Mode 2: Off-Season ⭐
**Dates:** February 1 - May 10

**What's Different:**
- **BOTH Free Agency AND NFL Draft** shown together
- No Start/Sit or Waiver Wire (not relevant)
- Focus on roster moves and draft analysis

**Sections:**
- News
- Rankings
- **Free Agency Tracker** ✓ (signings, trades, cuts)
- **NFL Draft** ✓ (mocks, prospects, buzz - CLUSTERED)
- Advice
- DFS
- Injuries

**Navigation:**
News | Rankings | Free Agency | NFL Draft | Advice | DFS | Injuries

### Why Combined?

**Free Agency doesn't stop during draft season!**
- Trades continue through draft
- Post-draft signings happen
- Cut players find new teams
- Both are relevant simultaneously

**Draft content is available NOW:**
- Mocks start in February
- Combine is late February
- Pro days March-April
- Draft is late April

Users want to see BOTH types of content during off-season.

---

## Mode 3: Preseason
**Dates:** July 25 - September 10

**What's Different:**
- Fantasy draft prep focus
- Rankings and sleepers emphasized
- No waivers yet (season hasn't started)

**Sections:**
- News
- Rankings
- **Fantasy Draft Prep** ✓ (rankings, sleepers, strategy)
- Advice
- DFS
- Injuries

**Navigation:**
News | Rankings | Draft Prep | Advice | DFS | Injuries

---

## NFL Draft Section Details

### Paywall Filtering ⭐

**ONLY FREE CONTENT** appears in the draft section.

Excluded domains:
- `theathletic.com` (subscription required)
- `espn.com/insider` (ESPN+ required)
- `si.com/vault` (SI+ required)
- `footballoutsiders.com/premium` (premium required)

Regular ESPN, SI, and other non-paywalled content **is included**.

### Clustering

Articles grouped into 4 editorial buckets:

1. **Mock Drafts**
   - Keywords: mock draft, first-round, 7-round mock
   - Content: Complete draft projections

2. **Prospect Rankings**
   - Keywords: big board, prospect rank, top prospects
   - Content: Player rankings and big boards

3. **Draft Buzz** (Catch-all)
   - Keywords: stock up/down, combine, risers, rumors
   - Content: Draft news and player buzz

4. **Team Fits**
   - Keywords: landing spot, team fit, draft needs
   - Content: Team-specific draft analysis

### UI
- Desktop: 2x2 grid of cluster cards
- Mobile: Stacked single column
- 5 articles per cluster
- Fallback to simple list if <6 articles

---

## Current Status

**As of March 28, 2026:**

✅ **OFF-SEASON MODE is ACTIVE**

You will see:
- Free Agency Tracker section
- NFL Draft section (clustered)
- Both appear on homepage simultaneously
- Nav shows: Free Agency | NFL Draft

---

## Local Testing

Test any mode without changing dates:

```bash
# Test Off-Season (Free Agency + Draft together)
TEST_SEASON_MODE=off-season npm run dev

# Test Preseason (Fantasy draft prep)
TEST_SEASON_MODE=preseason npm run dev

# Test Regular Season (Start/Sit + Waivers)
TEST_SEASON_MODE=regular npm run dev
```

Override is logged to console:
```
[Season Override] Using TEST_SEASON_MODE=off-season
```

---

## Date Ranges Explained

### Off-Season: Feb 1 - May 10

**Why February 1?**
- NFL legal tampering starts ~March 13
- But: Mock drafts start in February
- Combine is late February
- Draft prep content is active

**Why May 10?**
- NFL Draft is late April (usually ~April 25)
- Post-draft analysis continues into early May
- Free agency signings continue after draft
- Rookie mini-camps mid-May

### Preseason: July 25 - Sept 10

**Why July 25?**
- Training camps open late July
- Fantasy draft season begins
- Rankings finalized
- Preseason games start early August

**Why September 10?**
- Week 1 kickoff typically ~Sept 7-10
- Switches to regular season mode

### Regular Season: Sept 10 - Jan 31

**Why September 10?**
- Season starts, waivers become relevant
- Start/Sit decisions matter
- Weekly content focus

**Why January 31?**
- Super Bowl is early February
- Pro Bowl is before Super Bowl
- Season ends, shifts to free agency prep

---

## Files Modified

- `app/page.tsx` - Updated to 3-mode system
- `components/beta/BetaNav.tsx` - Updated navigation logic
- `components/beta/BetaDraftSection.tsx` - Added paywall filter
- `SEASON_SYSTEM.md` - This documentation

---

## Benefits of 3-Mode System

### vs Previous 4-Mode System:

**OLD (Complex):**
- Regular
- Free Agency only
- Draft only
- (Users missed content depending on exact date)

**NEW (Simple):**
- Regular
- **Off-Season (Free Agency + Draft together)** ⭐
- Preseason

**Why Better:**
1. ✅ Users see BOTH free agency and draft content
2. ✅ No arbitrary cutoff (March 31 vs April 1)
3. ✅ Reflects reality (signings happen during draft season)
4. ✅ More content, not less
5. ✅ Simpler date logic

---

## Implementation Notes

### Draft Content Detection

```javascript
const DRAFT_RX = /\b(mock\s+draft|nfl\s+draft|prospect|
                    combine|big\s+board|landing\s+spot|
                    pro\s+day|team\s+needs?|stock\s+up|down)\b/i;
```

### Free Agency Detection

```javascript
const FREE_AGENCY_RX = /\b(free\s+agency|sign(?:ed|ing)?|
                          trade(?:d|s)?|cut|release|
                          contract|extension|tagged)\b/i;
```

### Paywall Detection

```javascript
const PAYWALL_DOMAINS = [
  'theathletic.com',
  'espn.com/insider',
  'si.com/vault',
  'footballoutsiders.com/premium',
];
```

---

## Adding More Paywall Exclusions

Edit `components/beta/BetaDraftSection.tsx`:

```typescript
const PAYWALL_DOMAINS = [
  'theathletic.com',
  'espn.com/insider',
  // Add new paywalled domains here
  'newsite.com/premium',
];
```

---

## Future Enhancements

1. **Track paywall hits**
   - Log how many articles are filtered
   - Identify high-quality paywalled sources
   - Consider summarization for premium content

2. **Add more draft sources**
   - The Draft Network
   - Walter Football
   - Dane Brugler analysis

3. **Real-time draft coverage**
   - Live tracker during actual draft
   - Pick-by-pick analysis
   - Team grade cards

4. **Rookie landing spot analysis**
   - Post-draft impact projections
   - Depth chart analysis
   - Fantasy value updates