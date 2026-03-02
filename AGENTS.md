# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-02
**Project:** omo-switch - Profile manager for oh-my-opencode

## OVERVIEW
CLI tool for managing oh-my-opencode configuration profiles.

## COMMANDS

```bash
# CLI Build & Run
npm run build                    # Compile TypeScript to dist/
npm run dev -- <args>           # Run CLI directly with ts-node
npm link && omo-switch --help    # Test globally


# Testing
npm test                        # Run all tests (Vitest)
npm run test:watch              # Watch mode
npm run test:coverage           # Coverage report (text, json, html)

# Single Test File
npx vitest run src/commands/add.test.ts
npm test -- src/commands/add.test.ts
```

## STRUCTURE
```
.
├── src/
│   ├── index.ts           # CLI entry point (Commander.js)
│   ├── commands/          # Command implementations
│   ├── store/             # StoreManager, ProjectStoreManager
│   └── utils/             # validator, downloader, config-path
├── shared/                # JSON schemas, default templates
└── dist/                 # Compiled output
```

## CODE STYLE

**Imports**
```ts
// Third-party
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";

// Local modules
import { StoreManager, Profile } from "../store";
import { Validator } from "../utils/validator";

// No import { ... } from "../utils/downloader" - use named exports
import { downloadFile } from "../utils/downloader";
```

**Formatting**
- Indentation: 2 spaces
- Quotes: Double quotes
- Semicolons: Required
- Max line length: Not enforced (be reasonable)

**Types**
```ts
// Interfaces in dedicated files (types.ts)
export interface Profile {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Explicit return types on public methods
function deriveIdFromName(name: string): string { ... }
validate(data: Record<string, unknown>): { valid: boolean; errors: string[] }

// Use unknown over any, as needed
const err: unknown = ...;
if (err instanceof Error) { ... }
```

**Naming Conventions**
- Classes: `PascalCase` (StoreManager, Validator)
- Functions/Variables: `camelCase` (loadIndex, getProfileConfigPath)
- Constants: `SCREAMING_SNAKE_CASE` (SCHEMA_URL)
- Interfaces: `PascalCase` (Profile, StoreIndex)
- Private members: `private` keyword (no underscore prefix)
- Test files: `<name>.test.ts`
- Command exports: `export const addCommand = new Command("add")`

**Error Handling**
```ts
const spinner = ora().start();

try {
  spinner.text = "Processing...";
  // ... logic
  spinner.succeed("Done!");
} catch (err) {
  spinner.fail(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`);
  process.exit(1);
}
```

**Spinner Pattern**
- Start early: `ora().start()`
- Update status: `spinner.text = "New message"`
- Stop with result: `spinner.succeed()` / `spinner.fail()` / `spinner.warn()`
- User prompts: `spinner.stop()` before `await select(...)`, then `spinner.start()`

## CONVENTIONS

| Area | Convention |
|------|------------|
| **Commands** | Export `Command` instance, not a function |
| **Store I/O** | Use `StoreManager`/`ProjectStoreManager`; never `fs` directly in commands |
| **Backups** | Always call `createBackup()` before `apply` |
| **Config formats** | Supports `.json` and `.jsonc` (`.jsonc` preferred for comments) |
| **Schema validation** | AJV-based; validate before applying any config |
| **Scope resolution** | `user` (global) or `project` (local) |
| **Path resolution** | Use `config-path.ts`; don't hardcode paths |
| **Network calls** | Async only; fall back to bundled assets on failure |

## ANTI-PATTERNS

- ❌ NEVER use `fs` directly in commands; use `StoreManager` or `ProjectStoreManager`
- ❌ NEVER write configs without creating backup first
- ❌ DON'T modify `~/.omo-switch` structure without bumping `STORE_VERSION`
- ❌ AVOID sync network operations; all downloads are async
- ❌ DON'T assume config files exist; check `configExists()` first
- ❌ AVOID direct path manipulation; use `config-path.ts` utilities

## TESTING

- Framework: Vitest with memfs for filesystem mocking
- Test setup: `src/test-setup.ts` mocks `process.exit`
- Mock imports: `vi.mock()` at top of test file
- Path normalization: Use `path.normalize()` for cross-platform tests
- Test helpers: Define within test file for clarity

Run single test: `npx vitest run src/commands/add.test.ts`

## NOTES

- CLI targets Windows primary, XDG paths for Linux/macOS
 Schema URL: `https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json`
 Slim Schema URL: `https://raw.githubusercontent.com/Poorgramer-Zack/omo-switch/main/shared/assets/oh-my-opencode-slim.schema.json`
 Bundled schema fallback in `shared/assets/oh-my-opencode.schema.json` and `oh-my-opencode-slim.schema.json`
- No ESLint/Prettier configured - follow existing conventions
