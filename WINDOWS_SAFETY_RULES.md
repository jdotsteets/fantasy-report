# Windows File Safety Rules

## Critical Rules for This Workspace

### ❌ NEVER Use These PowerShell Commands on Source Files
- `Set-Content`
- `Add-Content`
- `Out-File`
- `>` (redirection)
- `>>` (append redirection)

**Why:** These add UTF-8 BOM markers that break webpack builds.

### ✅ ALWAYS Use These Instead

**Priority 1: apply_patch (when available)**
```
Apply patches for code changes
```

**Priority 2: Python**
```python
from pathlib import Path
content = Path('file.ts').read_text(encoding='utf-8-sig')  # Strips BOM if present
Path('file.ts').write_text(content, encoding='utf-8', newline='\n')  # Never adds BOM
```

**Priority 3: Node.js**
```javascript
import { readFileSync, writeFileSync } from 'fs';
const content = readFileSync('file.ts', 'utf8');
writeFileSync('file.ts', content, 'utf8');  // Explicit UTF-8, no BOM
```

### Automated BOM Protection

**Pre-commit hook** (`scripts/check-bom.mjs`):
- Scans all staged files for BOM markers
- Auto-removes BOMs if found
- Blocks commit until files are clean
- Re-stage and commit again

**Checked extensions:**
`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.md`, `.sql`, `.yml`, `.yaml`

### Workflow

1. Make code changes using approved methods
2. Stage files: `git add <files>`
3. Commit: `git commit -m "message"`
4. Pre-commit hook runs automatically
5. If BOMs found:
   - Hook removes them
   - Commit is blocked
   - Re-stage: `git add -u`
   - Commit again: `git commit`

### PowerShell Usage

**✅ Safe for:**
- Git operations (`git add`, `git commit`, `git push`)
- File system navigation (`cd`, `ls`, `Test-Path`)
- Running scripts (`node script.mjs`, `python script.py`)
- Non-code files (logs, temp files)

**❌ Never for:**
- Editing `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css` files
- Any file that gets committed to git
- Any file that webpack processes

### Emergency BOM Removal

If a BOM slips through:

```bash
node scripts/check-bom.mjs
```

This will scan the entire project and remove all BOMs automatically.

### Shell Preference

Use `pwsh` (PowerShell Core) over Windows PowerShell when possible.

---

**Last Updated:** 2026-03-25  
**Enforcement:** Automated via pre-commit hooks