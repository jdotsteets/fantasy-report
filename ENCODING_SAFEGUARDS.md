# Webpack WasmHash Error Prevention

## Problem
Webpack build fails with: `TypeError: Cannot read properties of undefined (reading 'length')`

This happens when files have **incorrect encoding** (usually caused by PowerShell file operations).

## Root Cause
- PowerShell's `Out-File` and `Set-Content` can introduce encoding issues
- Even with `-Encoding utf8` specified, BOM markers or line ending issues occur
- Webpack's hash function fails on these malformed files

## Prevention Rules

### ✅ SAFE Methods
1. **Use git checkout to restore files:**
   ```bash
   git checkout <commit> -- path/to/file.tsx
   ```

2. **Edit files manually in VS Code** (respects .editorconfig)

3. **Use System.IO.File with explicit encoding:**
   ```powershell
   $utf8 = New-Object System.Text.UTF8Encoding($false)
   [System.IO.File]::WriteAllLines($path, $lines, $utf8)
   ```

### ❌ AVOID
1. PowerShell `Out-File` without explicit encoding
2. PowerShell `Set-Content` (even with -Encoding utf8)
3. Editing TypeScript/TSX files with regex replacements in PowerShell
4. Copy-pasting code blocks via PowerShell variables

## Quick Fix If Build Fails
1. Check which file was recently modified:
   ```bash
   git diff HEAD~1 --name-only
   ```

2. Restore from last working commit:
   ```bash
   git checkout <last-good-commit> -- components/beta/BadFile.tsx
   ```

3. Make changes manually in VS Code instead

## Files Most Susceptible
- `components/beta/*.tsx` (frequently edited)
- `lib/*.ts` (utility files)
- Any file with emojis or special characters

## Long-term Solution
- Use VS Code for all code edits
- Reserve PowerShell for git operations and file system tasks only
- Consider creating scripts in TypeScript/Node instead of PowerShell for file manipulation
