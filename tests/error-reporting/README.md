# Error Reporting System Tests

Test utilities for the GLSL shader error reporting system.

## Files

- **`test-error-reporting.js`** - Interactive test that introduces a deliberate typo
- **`revert-test.js`** - Reverts test changes
- **`test-errors-direct.mjs`** - Direct Node.js test (requires compilation)
- **`DEMO-ERROR-OUTPUT.md`** - Documentation showing example output

## Quick Test

### 1. Introduce a deliberate error:
```bash
node tests/error-reporting/test-error-reporting.js
```

### 2. Start the dev server:
```bash
npm run dev
```

### 3. Check browser console
You'll see formatted error messages with:
- Module context
- Source code highlighting
- Function suggestions
- Typo detection

### 4. Revert the test:
```bash
node tests/error-reporting/revert-test.js
```

## What Gets Tested

- ✅ Raw GLSL error parsing
- ✅ Line mapping to source modules
- ✅ Function name extraction
- ✅ Typo detection (Levenshtein distance)
- ✅ Available function auto-discovery
- ✅ Error deduplication
- ✅ ANSI-colored console output
- ✅ Source context display

## Example Output

See `DEMO-ERROR-OUTPUT.md` for complete examples of the error translation system in action.
