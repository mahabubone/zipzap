/**
 * Module boundary enforcement.
 *
 * Rule 2 in AGENTS.md is the rule this repository is most at risk of breaking, because a
 * cross-module table access is a permanent, invisible dependency: it escapes the type system,
 * survives code review, cannot be found by grep-ing for "JOIN", and makes the module
 * impossible to extract. See docs/ADR/0002-postgresql-schema-boundaries.md.
 *
 * This is crude on purpose. It catches the careless cases, which are most of them. The real
 * enforcement is the per-module schema-scoped TypeORM connection, which makes a cross-module
 * query fail at runtime — this makes it fail in CI, which is cheaper.
 *
 * Zero dependencies, so it runs anywhere pnpm does.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const SRC_ROOT = join(REPO_ROOT, 'apps', 'backend', 'src');

/** The schema each module owns, from src/database/schemas.ts. Kept in sync by a test. */
const OWNED = {
  system: 'system',
  identity: 'identity',
  merchant: 'merchant',
  shipment: 'shipment',
  tracking: 'tracking',
};

const MODULES_DIR = join(SRC_ROOT, 'modules');
const COMMON_DIR = join(SRC_ROOT, 'common');
const DATABASE_DIR = join(SRC_ROOT, 'database');

/** @type {{ file: string; rule: string; line: number; text: string }[]} */
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith('.ts')) {
      inspect(full);
    }
  }
}

function add(file, rule, index, text) {
  violations.push({ file: relative(REPO_ROOT, file), rule, line: index + 1, text: text.trim() });
}

function moduleOf(file) {
  const rel = relative(MODULES_DIR, file);
  if (rel.startsWith('..')) return null;
  return rel.split(sep)[0];
}

function inspect(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const owner = moduleOf(file);
  // `rules/` is the purity marker: plain TS, zero framework imports. See AGENTS.md rule 3.
  const inRules = file.includes(`${sep}rules${sep}`);
  const rel = relative(REPO_ROOT, file);

  lines.forEach((text, index) => {
    const line = text.trim();
    if (line.startsWith('*') || line.startsWith('//')) return;

    // 1. A module querying a schema it does not own.
    if (owner && Object.hasOwn(OWNED, owner)) {
      const owned = OWNED[owner];
      // `system.` is written by every module on purpose: the outbox is the one deliberate
      // exception to isolation, because it is the mechanism that makes isolation possible.
      const foreign = [...line.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)\./g)]
        .map((match) => match[1])
        .filter((schema) => schema !== owned && schema !== 'system');
      if (foreign.length > 0) {
        add(file, `schema "${foreign[0]}" is not owned by module "${owner}"`, index, text);
      }
    }

    // 2. Framework imports inside rules/. Rule 3.
    if (inRules && /from\s+'(?:@nestjs|typeorm|bullmq|@hono)/.test(line)) {
      add(file, 'rules/ must not import the framework (rule 3)', index, text);
    }

    // 3. class-validator decorators in rules/ — a transport concern.
    if (inRules && /^\s*@(Is[A-Z]\w*|Validate\w*|Transform)/.test(text)) {
      add(file, 'rules/ must not carry class-validator decorators (rule 3)', index, text);
    }

    // 4. A module reaching into another module's persistence.
    // In the flat layout the entity file is the persistence: `merchant.entity.ts`,
    // `shipment.entity.ts`, `tracking-event.entity.ts`. Importing another module's
    // `*.entity.ts` IS the cross-schema read — use a contract or an event instead.
    if (owner) {
      const reach = /from\s+['"](?:\.{1,2}\/)*([a-z][a-z0-9_-]*)\/([a-z][a-z0-9_-]*\.entity)(?:\.ts)?['"]/.exec(line);
      const target = reach?.[1];
      if (target && target !== owner) {
        add(file, `module "${owner}" imports "${target}" persistence — use a contract or an event`, index, text);
      }
    }

    // 5. A provider's wire format escaping the adapter layer. Rule 11.
    // Token list narrowed once — see docs/ADR/0002-postgresql-schema-boundaries.md; a rule that
    // fires on valid code gets disabled, which is worse than not having it.
    if (!rel.includes(`${sep}provider${sep}`)) {
      if (/\b(status_code|trx_status|expair_Date|transactionType|mobileNumber|senderName)\b\s*[:'"]/.test(line)
        && !/\bsenderName\b\s*:/.test(line)) {
        add(file, 'provider wire format outside an adapter (rule 11)', index, text);
      }
    }

    // 6. Floating-point money. Rule 4.
    if (/(amount|balance|total|fee|price|cod)\w*\s*[:=]\s*-?\d+\.\d+/.test(line)) {
      add(file, 'decimal literal assigned to a money-like name (rule 4 — use integer minor units)', index, text);
    }
  });
}

// The module list must not drift from src/database/schemas.ts.
function checkSchemaListIsInSync() {
  const schemas = readFileSync(join(DATABASE_DIR, 'schemas.ts'), 'utf8');
  const declared = [...schemas.matchAll(/^\s*'([a-z_]+)',$/gm)].map((m) => m[1]);
  for (const [module, schema] of Object.entries(OWNED)) {
    if (module !== schema) {
      violations.push({ file: 'scripts/check-boundaries.mjs', rule: `${module} owns schema ${schema} — expected matching names`, line: 0, text: '' });
    }
    if (!declared.includes(schema)) {
      violations.push({ file: 'docs (schemas.ts)', rule: `module "${module}" owns unknown schema "${schema}"`, line: 0, text: '' });
    }
  }
}

walk(MODULES_DIR);
walk(COMMON_DIR);
walk(DATABASE_DIR);
checkSchemaListIsInSync();

if (violations.length > 0) {
  console.error('\nModule boundary violations:\n');
  for (const violation of violations) {
    const where = violation.line ? `${violation.file}:${violation.line}` : violation.file;
    console.error(`  ${where}\n    ${violation.rule}`);
    if (violation.text) console.error(`    > ${violation.text}`);
  }
  console.error(`\n${violations.length} violation(s). See docs/ADR/0002-postgresql-schema-boundaries.md.\n`);
  process.exit(1);
}

console.log('boundaries ok');
