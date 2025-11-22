# Changelog Maintenance

## Always Update CHANGELOG.md When Versioning

**CRITICAL:** Every time the version number is incremented (via `npm version`), **ALWAYS update [CHANGELOG.md](mdc:CHANGELOG.md)** with release notes.

## Version Increment Triggers

Update changelog when running:
- `npm version patch` (0.9.X → 0.9.X+1)
- `npm version minor` (0.9.X → 0.10.0)
- `npm version major` (0.X.X → 1.X.X)

## Changelog Format

Use Homebridge-compatible format (not strict Keep a Changelog):

```markdown
## X.Y.Z (YYYY-MM-DD)

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Security
- Security fixes
```

## Entry Guidelines

### Use Clear Categories
- **Fixed** - Bug fixes (most common for patches)
- **Added** - New features
- **Changed** - Changes to existing functionality
- **Improved** - Performance or UX enhancements
- **Security** - Security-related changes

### Mark Critical Issues
Use **CRITICAL:** prefix for breaking bugs:
```markdown
- **CRITICAL:** Fixed crash in API error handling
```

### Include Impact
Explain what the fix means for users:
```markdown
### Fixed
- **CRITICAL:** Fixed crash in API error handling - `this.log.error is not a function`
  - API class was calling `this.log.error()` but only had `this.log()` available
  - Users will now see proper error messages instead of crashes
  - Affects initialization failures and profile API errors
```

### Technical Details When Relevant
For complex fixes, add technical context:
```markdown
### Technical Details
- Session refresh was setting cookies and immediately calling APIs before backend was ready
- Added 2-second delay after setting cookies to allow backend to propagate
```

## Workflow Integration

1. **Before** running `npm version`:
   - Draft changelog entry based on what changed
   
2. **After** running `npm version`:
   - Insert the new version section **above** the previous release
   - Use current date in `YYYY-MM-DD` format
   - Commit changelog with version bump
   
3. **Push together**:
   ```bash
   git push origin latest --tags
   ```

## Example Workflow

```bash
# 1. Make code changes
# 2. Update CHANGELOG.md with new version section
# 3. Bump version (this commits package.json)
npm version patch -m "Bump to %s - fix critical bug"
# 4. Commit changelog
git add CHANGELOG.md
git commit --amend --no-edit
# 5. Push
git push origin latest --tags
```

## Common Mistakes to Avoid

❌ **Don't:**
- Bump version without updating changelog
- Put new versions at the bottom (they go at top)
- Use vague descriptions ("bug fixes")
- Forget the date

✅ **Do:**
- Update changelog BEFORE or WITH version bump
- New versions at top, oldest at bottom
- Specific, actionable descriptions
- Include date in YYYY-MM-DD format
- Mark breaking/critical changes clearly

## Unreleased Section

Keep an `Unreleased` section at the top for work-in-progress:

```markdown
## Unreleased

### Fixed
- Work in progress...

## 0.9.13 (2025-10-20)
...
```

When you release, move items from `Unreleased` to the new version section.

## Important: Format for Homebridge UI

**Use parentheses, not square brackets and dashes:**
- ✅ `## 0.9.13 (2025-10-20)` - Homebridge UI can parse this
- ❌ `## [0.9.13] - 2025-10-20` - Keep a Changelog format, breaks Homebridge UI parser

