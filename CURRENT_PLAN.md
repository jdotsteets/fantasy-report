# CURRENT_PLAN.md - Active Development Plan

**Last Updated:** Wed Apr 1, 2026 21:47 CDT  
**Status:** Cataloged - Ready for execution  
**Focus:** Content completeness is PRIMARY issue, not scoring/trending

---

## 🚨 PHASE 1 — CONTENT COMPLETENESS (PRIMARY FOCUS)

### 1. NFL Draft Section (DO FIRST) 🔴 HIGHEST PRIORITY
- [ ] **Fix mock draft classification**
  - Issue: Mock draft articles not routing to NFL Draft section correctly
  - Root cause: Classification logic or section filtering
  - File: `lib/classify.ts` or section query logic
  
- [x] **Fix "+10 more" expansion**
  - Issue: Expand behavior not working properly
  - Expected: Click to show more articles in section
  - File: Section components
  
- [x] **Improve desktop layout**
  - Issue: Layout issues on desktop view
  - Context: Whitespace / spacing problems

**👉 This is your biggest visible gap right now**

---

### 2. Validate Missing Content (CRITICAL) 🔴
**Goal:** Determine WHERE the content gap is in the pipeline

**Test Plan:**
- [ ] Check ESPN NFL homepage articles
  - [ ] Visit espn.com/nfl
  - [ ] List 10 recent articles
  - [ ] Search DB for each by title/URL
  - [ ] Document: In DB? Which source? Filtered out?

- [ ] Check Yahoo NFL homepage articles
  - [ ] Visit sports.yahoo.com/nfl
  - [ ] List 10 recent articles
  - [ ] Search DB for each
  - [ ] Document findings

- [ ] Check CBS Sports + PFF
  - [ ] Sample 10 articles from each
  - [ ] Search DB
  - [ ] Document findings

**This determines:**
- Is it a **source issue** (not fetching)?
- Is it a **parsing issue** (fetch fails)?
- Is it a **filtering issue** (blocked by allowItem)?
- Is it a **section routing issue** (in DB but not shown)?

---

### 3. Source Health / Coverage Tool (BUILD THIS) 🟡
**Merge James's idea + Claw's proposal**

**Purpose:** Truth system for content coverage

**Features:**
- [ ] For each configured source:
  - [ ] Scrape live homepage
  - [ ] Compare articles vs what's in DB
  - [ ] Show missing articles with reason
  - [ ] Show fetch success rate
  - [ ] Show filter pass rate
  - [ ] Show last successful ingest timestamp

**Deliverables:**
- [ ] Admin route: `/api/admin/source-health`
- [ ] Returns JSON per source:
  ```json
  {
    "sourceId": 3134,
    "name": "ESPN NFL",
    "liveArticles": 20,
    "inDb": 2,
    "missing": 18,
    "lastSuccess": "2026-04-01T10:00:00Z",
    "missingExamples": [...]
  }
  ```

**Impact:** Know exactly where content is lost

---

### 4. Fix Weak Sources (AFTER VALIDATION) 🟡
- [ ] **ESPN NFL (3134)** - Only 1 article in 7 days
  - Diagnose: Fetch failing? Parser broken? Feed URL changed?
  
- [ ] **NFL.com (3139, 3140)** - 0 articles
  - Likely not in cron OR feed broken
  
- [ ] **Rotoballer (7)** - 85 blocked/day (6.8% of attempts)
  - Review allowItem() filter logic
  - May be too aggressive for this source

---

### 5. Add New Sources (ONLY AFTER ABOVE) 🟢
**Do NOT add sources until validation complete**

- [ ] Bleacher Report NFL
- [ ] More FantasyPros feeds (rankings, start/sit, waiver, DFS)
- [ ] Draft-heavy sources (e.g., The Draft Network, NFL Draft Diamonds)
- [ ] Team beat writers (high-signal local sources)

---

## 🟡 PHASE 2 — CONTENT PLACEMENT / UX

### 6. Toolbar Behavior
- [ ] **Selected section = isolate view**
  - Current: All sections still visible
  - Expected: When section chip clicked, ONLY show that section
  - Remove "blank section" feel

- [ ] **Improve empty state messaging**
  - If section truly empty, show helpful message
  - Not just blank space

**File:** `components/beta/BetaNav.tsx`, section components

---

### 7. Trending Topics Overhaul
- [ ] **Better entity detection**
  - Current: Generic phrases showing up
  - Expected: Actual player names + context
  
- [ ] **Remove generic phrases**
  - Filter out "NFL", "Fantasy Football", etc from trending
  
- [ ] **Click = expand inline (not full-site filter)**
  - Current: Clicking trending topic filters entire site
  - Expected: Expand to show related articles inline
  - Do NOT change global view

**File:** `components/beta/BetaTrending.tsx`, `lib/trending.ts`

---

### 8. "Why This Matters" Summaries
- [ ] **Ensure summaries actually display**
  - May already exist in code but not rendering
  - Check if data is present but UI not showing it

**File:** Article cards, trending components

---

### 9. Layout Polish
- [ ] **Fix 3-column desktop whitespace issue**
  - Cards should fill width better
  - Reduce excessive whitespace between columns

**File:** Beta components, CSS/Tailwind

---

### 10. Provider Filter Fix
- [ ] **Likely quick bug**
  - Provider filter not working correctly
  - Probably simple UI state issue

**File:** Filter components

---

## 🔵 PHASE 3 — SYSTEM INTELLIGENCE

### 11. Reduce Dedupe Noise
- [ ] **Smarter update logic**
  - Current: 96% dedupe rate (932 processed, 34 inserted)
  - Problem: Legitimate (PFF republishing guides)
  - Solution: Only update if content changed, not just timestamp
  - Check: `ON CONFLICT (canonical_url) DO UPDATE` logic

**File:** `lib/ingest.ts` upsertArticle

---

### 12. Cluster-Aware Feed
- [ ] **Reduce duplicates across sections**
  - Hero + Feed + Sections should not repeat articles
  - Use trending clusters to select best representative per story
  
**Status:** Partially done (uncommitted WIP)  
**File:** `app/page.tsx`, `lib/feedScore.ts`

---

### 13. Observability Dashboard
- [ ] **Internal debugging tools**
  - Article score inspector
  - Cluster visualization
  - Source performance metrics

**File:** New admin routes

---

## 🚀 PHASE 4 — GROWTH

### 14. Social Automation
- [ ] **Post top articles + trends automatically**
  - Twitter/X
  - Other platforms?

---

### 15. Resume Scheduled Tweets
- [ ] **Re-enable social posting**
  - Was previously working?
  - Check cron schedule

---

### 16. SEO
- [ ] **Improve search visibility**
  - Meta tags
  - Sitemap
  - Structured data

---

## 📋 IMMEDIATE NEXT ACTIONS (This Session)

1. **Verify Vercel Cron Status** (5 min)
   - Check Vercel dashboard
   - Confirm cron is actually firing hourly

2. **Manual Content Validation** (30 min)
   - Visit ESPN, Yahoo, CBS homepages
   - Document 10 articles from each
   - Search DB for each
   - Create gap analysis

3. **Build Source Health Tool** (1-2 hours)
   - Admin route to scrape + compare
   - Returns missing article report
   - Becomes ongoing monitoring tool

---

## 🎯 SUCCESS CRITERIA

**Phase 1 Complete When:**
- ✅ NFL Draft section shows 20+ articles
- ✅ Mock draft articles route correctly
- ✅ ESPN/Yahoo/CBS coverage validated at >80%
- ✅ Source health tool operational
- ✅ All major sources producing articles

**Phase 2 Complete When:**
- ✅ Section isolation works correctly
- ✅ Trending shows real players/contexts only
- ✅ Summaries display consistently
- ✅ Desktop layout polished

**Phase 3 Complete When:**
- ✅ Dedupe rate <50% (more new vs updates)
- ✅ No duplicate articles across sections
- ✅ Admin dashboard operational

---

## ⚠️ KEY PRINCIPLES

1. **Content completeness FIRST** - Nothing else matters if articles are missing
2. **Validate before fixing** - Build truth system (source health tool) before making changes
3. **One phase at a time** - Don't jump to Phase 2 until Phase 1 done
4. **Evidence-based** - Use source health tool to guide all source decisions

---

## 📝 NOTES

- Do NOT optimize scoring/trending/feed until content coverage is solved
- Do NOT add new sources until you know why current ones are weak
- Build validation/monitoring tools BEFORE making changes
- James's intuition: "content completeness is the issue" - trust this
