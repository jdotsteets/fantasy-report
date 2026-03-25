# ENCODING SAFEGUARDS - Updated 2026-03-25

## The Problem

PowerShell file operations (`Out-File`, `Set-Content`, `>`) can introduce:
- UTF-8 BOM markers (0xEF 0xBB 0xBF)
- CRLF line endings on Windows
- Invisible control characters

These break webpack's WasmHash function during Next.js builds, causing:
```
TypeError: Cannot read properties of undefined (reading 'length')
at WasmHash._updateWithBuffer
```

## RULES - Follow Strictly

### ✅ SAFE Methods (Use These)

**For code files (.ts, .tsx, .js, .jsx):**
1. **VS Code** - Primary editor, respects .editorconfig
2. **GitHub web editor** - Guaranteed clean encoding
3. **`git checkout HEAD -- <file>`** - Restore from last commit
4. **Node.js scripts with explicit encoding:**
   ```javascript
   import { writeFileSync } from 'fs';
   writeFileSync('file.ts', content, 'utf8'); // No BOM
   ```

**For non-code files (.md, .txt, .json):**
- PowerShell is OK: `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`

### ❌ UNSAFE Methods (Never Use on Code)

- `Out-File` (adds BOM)
- `Set-Content` (adds BOM)
- `>` or `>>` redirection (adds BOM)
- PowerShell string replacement on .ts/.tsx files
- Copy-paste from Windows apps with hidden formatting

## Automated Safeguards

### 1. Pre-commit Hook
`.husky/pre-commit` - Checks all staged .ts/.tsx files for:
- UTF-8 BOM markers
- Suspicious control characters
- Blocks commit if issues found

### 2. GitHub Action
`.github/workflows/encoding-check.yml` - Runs on every push:
- Scans for BOM markers
- Warns about CRLF line endings
- Fails CI if encoding issues detected

### 3. .editorconfig
Enforces:
```
[*.{ts,tsx,js,jsx}]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

## If Encoding Breaks (Emergency Fix)

1. **Identify broken file:**
   ```bash
   git diff
   ```

2. **Restore clean version:**
   ```bash
   git checkout HEAD -- path/to/file.tsx
   ```

3. **Make changes in VS Code**, not PowerShell

4. **OR use Node.js script:**
   ```javascript
   import { writeFileSync } from 'fs';
   writeFileSync('file.tsx', newContent, 'utf8');
   ```

5. **Force rebuild on Vercel:**
   - Push a trivial change to a non-code file (README.md)
   - Vercel will rebuild from clean git state

## Prevention Checklist

Before committing code changes:
- [ ] Edited in VS Code (not PowerShell)?
- [ ] File opens normally in VS Code?
- [ ] No webpack errors locally?
- [ ] Pre-commit hook passed?

## Why This Matters

Webpack uses WasmHash for file hashing during builds. BOM markers or invalid UTF-8 sequences cause:
- WasmHash to receive malformed buffers
- Build failures on Vercel (even if local works)
- Hours of debugging encoding issues

**Solution:** Use proper tools. PowerShell is for scripting, not editing code.