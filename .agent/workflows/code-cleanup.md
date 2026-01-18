---
description: Major code cleanup, bug fixing, optimization, and standardization workflow for Sage
---

# Sage Code Cleanup & Optimization Workflow

This workflow is specifically tailored for the Sage Discord bot codebase. Follow these phases systematically.

---

## Phase 1: Pre-Cleanup Assessment

### 1.1 Run Quality Gates

Capture baseline metrics before making changes.

// turbo

```bash
npm run lint 2>&1 | tee lint-baseline.log
```

// turbo

```bash
npm run build 2>&1 | tee build-baseline.log
```

// turbo

```bash
npm test 2>&1 | tee test-baseline.log
```

### 1.2 Run Doctor & Certification Check

// turbo

```bash
npm run doctor
```

// turbo

```bash
npx prisma validate
```

### 1.3 Document Baseline Metrics

Create a summary of:

- Number of lint warnings/errors from `lint-baseline.log`
- Number of TypeScript errors from `build-baseline.log`
- Test pass/fail count from `test-baseline.log`
- Any console warnings during build

### 1.4 Scan for Problem Areas

Search the codebase for issues:

**Bug Patterns to Find:**

```bash
# Unhandled promise rejections
grep -r "\.then(" src/ --include="*.ts" | grep -v "\.catch"

# console.log statements (should use logger)
grep -rn "console\.log" src/ --include="*.ts"

# TODO/FIXME comments
grep -rn "TODO\|FIXME" src/ --include="*.ts"

# any types
grep -rn ": any" src/ --include="*.ts"
```

**Key Areas to Examine:**

- `src/core/` - Core logic modules
- `src/bot/handlers/` - Discord event handlers
- `src/core/llm/` - LLM integration
- `src/core/memory/` - Memory system
- `test/unit/` - Unit tests

---

## Phase 2: Bug Fixes (Priority Order)

### 2.1 Critical Bugs

Fix bugs that could cause:

- Bot crashes or unhandled exceptions
- Data corruption in Prisma/SQLite database
- Memory leaks from unclosed connections
- Security vulnerabilities

### 2.2 High-Priority Bugs

Fix:

- Incorrect Discord event handling
- Race conditions in async code
- LLM response parsing failures
- User profile corruption

### 2.3 Low-Priority Bugs

Fix:

- Edge cases in rate limiting
- Minor logging issues
- Non-critical warnings

**For Each Bug Fix:**

1. Document the bug in a comment or commit message
2. Write a test case in `test/unit/` if applicable
3. Implement the fix
4. Run `npm test` to verify
5. Run `npm run lint` to ensure no new issues

---

## Phase 3: Code Optimization

### 3.1 Performance Optimization

Focus areas for Sage:

- **Database queries** - Check Prisma queries in `src/core/memory/` and `src/core/relationships/`
- **LLM calls** - Optimize prompt construction in `src/core/llm/`
- **Event handlers** - Reduce redundant processing in `src/bot/handlers/`

### 3.2 Memory Optimization

- Ensure Discord.js event listeners are properly cleaned up
- Close Prisma connections appropriately
- Clear timeouts/intervals on shutdown

### 3.3 Dependency Cleanup

// turbo

```bash
npx depcheck
```

Remove unused dependencies from `package.json` if found.

---

## Phase 4: Standardization

### 4.1 Code Style

**Sage Naming Conventions:**

- Files: `camelCase.ts` (e.g., `chatEngine.ts`, `userProfileRepo.ts`)
- Classes: `PascalCase` (e.g., `ChatEngine`, `ContextBudgeter`)
- Functions: `camelCase` (e.g., `generateReply`, `ingestEvent`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_CONTEXT_TOKENS`)
- Interfaces/Types: `PascalCase` (e.g., `UserProfile`, `LLMResponse`)

**Apply Prettier:**

// turbo

```bash
npx prettier --write "src/**/*.ts" "test/**/*.ts"
```

### 4.2 Error Handling Standardization

Sage uses Pino for logging. Ensure:

- Use `logger.error()` instead of `console.error()`
- Use `logger.warn()` instead of `console.warn()`
- Use `logger.info()` and `logger.debug()` for informational logs
- Avoid `console.log()` in production code

### 4.3 Type Standardization

- Remove `as any` casts where possible
- Add proper type annotations to functions
- Use Zod schemas for runtime validation (already set up)

### 4.4 Import Organization

Sage import order:

1. Node.js built-ins (`import { execSync } from 'child_process'`)
2. External packages (`import { Client } from 'discord.js'`)
3. Internal modules with alias (`import { config } from '@/config'`)
4. Relative imports (`import { logger } from '../utils/logger'`)
5. Type imports (`import type { Message } from 'discord.js'`)

---

## Phase 5: Documentation & Cleanup

### 5.1 Remove Dead Code

- Delete unused functions/classes
- Remove commented-out code blocks
- Delete unused imports (ESLint will catch these)
- Remove unused variables

### 5.2 Update Documentation

Key files to check and update:

- **`README.md`** - Update to reflect latest codebase:
  - Verify features list matches current functionality
  - Update architecture diagram if modules changed
  - Ensure all npm scripts are documented
  - Check environment variables table is accurate
  - Update version number if applicable
- `docs/deploy.md` - Deployment instructions
- `docs/decision-log.md` - Architecture decisions
- `.env.example` - All required env vars documented

**README.md Update Checklist:**

```
[ ] Features section reflects current capabilities
[ ] Quick Start instructions work correctly
[ ] Configuration tables match .env.example
[ ] Development commands are all listed
[ ] Architecture diagram is accurate
[ ] Version badge/number is current
```

### 5.3 Organize Files

Sage directory structure:

```
src/
├── bot/            # Discord.js handlers and client setup
│   └── handlers/   # Event handlers (messageCreate, voiceStateUpdate, etc.)
├── core/           # Core business logic
│   ├── agentRuntime/   # Agent runtime components
│   ├── chat/           # Chat engine
│   ├── llm/            # LLM integration
│   ├── memory/         # User memory system
│   ├── orchestration/  # MoE orchestration
│   ├── relationships/  # User relationship graph
│   ├── summary/        # Channel summaries
│   └── voice/          # Voice handling
├── db/             # Database client
├── scripts/        # CLI scripts (doctor, cert)
└── utils/          # Shared utilities
```

Ensure files are in the correct locations.

---

## Phase 6: Verification

### 6.1 Run All Quality Gates

// turbo

```bash
npm run lint
```

// turbo

```bash
npm run build
```

// turbo

```bash
npm test
```

### 6.2 Run Prisma Validation

// turbo

```bash
npx prisma validate
```

### 6.3 Run Full Certification

// turbo

```bash
npm run cert
```

### 6.4 Run Doctor Check

// turbo

```bash
npm run doctor
```

### 6.5 Manual Verification (Optional)

If changes affect bot behavior:

1. Start bot with `npm run dev`
2. Test in Discord:
   - Mention bot and verify response
   - Check rate limiting works
   - Verify memory persistence
3. Check logs for errors

### 6.6 Create Summary Report

Document:

- All bugs fixed (brief description of each)
- Optimizations implemented
- Standardization changes made
- Before/after metrics comparison

---

## Quick Reference Checklist

```
[ ] Phase 1: Assessment
    [ ] Run lint/build/test and save baselines
    [ ] Run doctor and prisma validate
    [ ] Document baseline metrics
    [ ] Identify problem areas

[ ] Phase 2: Bug Fixes
    [ ] Fix critical bugs (crashes, data corruption)
    [ ] Fix high-priority bugs (incorrect behavior)
    [ ] Fix low-priority bugs (edge cases)
    [ ] Write tests for fixed bugs

[ ] Phase 3: Optimization
    [ ] Optimize database queries
    [ ] Fix memory leaks
    [ ] Remove unused dependencies

[ ] Phase 4: Standardization
    [ ] Apply naming conventions
    [ ] Run Prettier
    [ ] Standardize error handling
    [ ] Organize imports

[ ] Phase 5: Cleanup
    [ ] Remove dead code
    [ ] Update documentation
    [ ] Verify file organization

[ ] Phase 6: Verification
    [ ] npm run lint ✓
    [ ] npm run build ✓
    [ ] npm test ✓
    [ ] npx prisma validate ✓
    [ ] npm run cert ✓
    [ ] npm run doctor ✓
    [ ] Manual testing (if needed)
    [ ] Summary report created
```

---

## Critical Notes

- **Commit Frequently**: Make small, focused commits after each logical unit of work
- **Use Logger**: Always use `logger` from `@/utils/logger` instead of `console`
- **Test Early**: Run `npm test` after each change
- **Preserve Behavior**: When refactoring, ensure existing functionality is preserved
- **Check .env.example**: If adding/removing env vars, update `.env.example`

---

## Sage-Specific Commands Quick Reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Start bot in development mode with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Run ESLint on `src/` |
| `npm test` | Run Vitest tests |
| `npm run doctor` | Check config and database connection |
| `npm run cert` | Full certification (lint + build + test + prisma) |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run db:migrate` | Run Prisma migrations |
| `npx prisma validate` | Validate Prisma schema |
| `npx prettier --write "src/**/*.ts"` | Format all source files |
