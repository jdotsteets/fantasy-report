# Collapsible Sections Feature - Implementation Summary

## Branch
`feature/collapsible-sections`

## Changed Files
1. **components/beta/BetaLoadMoreSection.tsx** (modified)
2. **components/beta/BetaLoadMoreSection.tsx.backup** (created - backup of original)

## What Changed

### Enhanced BetaLoadMoreSection Component

#### Previous Behavior
- Showed `initialDisplay` items by default
- "More Articles" button immediately triggered API call
- Single expansion state (no intermediate local expansion)
- "Show Less" only appeared when API pagination was complete

#### New Behavior
**Three-stage expansion:**

1. **Collapsed (default)**
   - Shows `initialDisplay` items (e.g., 4 articles)
   - Button: "Show X more" (where X = hidden initial items count)

2. **Expanded (local)**
   - Shows all `initialItems` without API call
   - Button: "More Articles" (loads from API)
   - Button: "Show Less" (collapses back to `initialDisplay`)

3. **Loaded (API pagination)**
   - Shows all items (initial + API-fetched)
   - Button: "More [Section Name]" (continues pagination)
   - Button: "Show Less" (collapses back to `initialDisplay`)

#### Key Improvements

✅ **Per-section default limits** - Each section respects its `initialDisplay` prop
✅ **Inline "Show X more"** - Clear count of hidden items
✅ **Local expansion first** - No API call needed to see all initial items
✅ **Show Less functionality** - Always available when expanded (not just when done)
✅ **Display-mode toggle unchanged** - Existing image/headlines behavior preserved
✅ **Analytics tracking** - Optional gtag event on expansion

## Code Changes

### State Management
- **Before:** Single `expanded` boolean
- **After:** Three-state `viewState`: "collapsed" | "expanded" | "loaded"

### Button Logic
- **Show X more** - Expands local items (no API)
- **More Articles** - Triggers first API load
- **More [Section]** - Continues pagination
- **Show Less** - Collapses to initial limit

## Testing Checklist

### Visual Testing
- [ ] Sections show `initialDisplay` items on load
- [ ] "Show X more" button displays correct count
- [ ] Clicking "Show X more" reveals all initial items (no API call)
- [ ] "More Articles" button appears after local expansion
- [ ] "Show Less" button collapses back to `initialDisplay`
- [ ] Headlines variant renders correctly
- [ ] Responsive behavior (mobile/desktop)

### Functional Testing
- [ ] Local expansion shows all initial items
- [ ] API pagination loads additional items
- [ ] Deduplication works (no duplicate articles)
- [ ] Error states display properly
- [ ] Loading states work correctly
- [ ] Multiple expand/collapse cycles work

### Per-Section Testing
Verify on homepage sections with different `initialDisplay` values:
- [ ] Curated feed (6 items)
- [ ] Latest news (2 items)
- [ ] Rankings (4 items)
- [ ] Start/Sit (4 items)
- [ ] More news headlines variant (8 items)
- [ ] Waiver wire (4 items)
- [ ] DFS (4 items)
- [ ] Injuries (4 items)

## Rollback Instructions

```bash
cd C:\Users\jftst\.openclaw\workspace\projects\fantasy-report
git checkout feature/collapsible-sections
git checkout -- components/beta/BetaLoadMoreSection.tsx
Copy-Item components\beta\BetaLoadMoreSection.tsx.backup components\beta\BetaLoadMoreSection.tsx -Force
```

Or switch back to main:
```bash
git checkout main
```

## Next Steps

1. **Install dependencies** (if needed):
   ```bash
   npm install
   ```

2. **Start dev server**:
   ```bash
   npm run dev
   ```

3. **Test locally** at `http://localhost:3000`

4. **Review and commit**:
   ```bash
   git add components/beta/BetaLoadMoreSection.tsx
   git commit -m "feat: add inline show more/less with per-section limits"
   ```

5. **Push feature branch**:
   ```bash
   git push origin feature/collapsible-sections
   ```

6. **Create PR** on GitHub

## Benefits

**User Experience:**
- Less overwhelming initial view
- Clear visibility into available content
- Easy expansion without page reload
- Reversible (Show Less)

**Performance:**
- Fewer images loaded initially
- Deferred API calls
- Better initial page load

**Analytics:**
- Track which sections users expand
- Measure engagement per section
- Inform content prioritization

**Maintainability:**
- Single component handles all sections
- Per-section customization via props
- Backward compatible with existing API
