# Workflow

How a change gets made and reviewed.

## Branches

```
main                    protected, deployable
feat/<domain>-<thing>   e.g. feat/shipment-idempotency
fix/<domain>-<thing>
chore/<thing>
```

Domain-first branch names, because the diff usually crosses files in one module and the name
should say which.

## A change, end to end

1. Read [../AGENTS.md](../AGENTS.md) and the relevant `docs/domains/<module>.md`
2. If it changes an architectural boundary → write the ADR **first**
3. Write the test that fails
4. Implement
5. `pnpm verify`
6. Update docs: new table → migration + `database.md`; new rule → the domain doc; new event →
   the event catalog
7. PR

## Definition of done

- [ ] `pnpm lint && pnpm typecheck && pnpm test` passes
- [ ] money and state-machine changes have unit tests — not optional
- [ ] mutations are idempotency-keyed where the domain requires it
- [ ] events are written to the outbox **in the same transaction**
- [ ] no cross-module table access
- [ ] `rules/` files import no framework
- [ ] migrations are additive and reversible
- [ ] OpenAPI regenerated, api-client regenerated, contract test updated
- [ ] the domain doc reflects the new behaviour

## Commit messages

```
<scope>: <imperative summary>

Why it was needed, and what the alternative was if there was one.

Refs: ADR-0005
```

Scopes match domains: `shipment`, `finance`, `tracking`, `infra`, `docs`.

The body exists because a diff shows _what_ changed and never _why_. Six months later, "why" is
the only part that matters.

## Reviewing

The questions worth asking, in order of how much they cost when missed:

1. **Does this cross a module boundary?** If so, is it a service call or an event, and not a
   table access?
2. **Does this update a status directly?** If so, where is the transition validated?
3. **Is the outbox row in the same transaction?** Not after. Not from a later hook.
4. **Is this money?** Integer minor units? Append-only? Derived or stored?
5. **Can this be retried?** What happens on a duplicate?
6. **Does any `rules/` file import anything from the framework?**
7. **Is the test actually asserting?** A test that cannot fail is worse than no test, because it
   looks like coverage.

## The gate

There is no CI in this repository, so the sequence below runs on your machine, from a pre-commit
hook, and on demand. Nothing runs it when this is pushed anywhere — that is a real gap and it is
stated rather than implied.

```
boundaries → format → proofs → typecheck → unit
```

| Command                 | What it proves                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm boundaries:check` | No cross-schema SQL, no framework in `rules/`, no provider wire format outside its adapter, no float on a money-shaped name                                  |
| `pnpm format:check`     | One formatter, so a diff is about the change and not about the author's editor                                                                               |
| `pnpm prove`            | Eleven zero-dependency proofs, including one that reads the backend's scan kinds and asserts the dock's vocabulary covers each                               |
| `pnpm typecheck`        | Every workspace, and the generated client against the spec                                                                                                   |
| `pnpm test`             | Unit tests. Vitest, colocated `*.spec.ts`, no mocks of the code under test                                                                                   |
| `pnpm test:integration` | The behaviour of the above against real Postgres, Redis and NATS — Testcontainers, not mocks, for the things being tested                                    |
| `pnpm prove:stack`      | Six proofs against a running API: the typed client's decoding, tokens, the webhook portal, the OpenAPI round trip, notification preferences, delivery proofs |
| `pnpm prove:browser`    | Three proofs in a real browser against the running stack: the map's projection and tile policy, the login split, the public tracking page                    |

`pnpm verify` runs the first five. `.githooks/pre-commit` (installed with `pnpm hooks:install`)
runs the boundary checker in full and Prettier on the staged files only, because a hook that takes
a minute is a hook that gets `--no-verify`'d. Integration tests are deliberately not in the hook.

### Two proofs that are not wired, and why

Sixteen `verify-*.mjs` scripts existed with no command reaching any of them. Fourteen now do. The two
that do not are left in the tree with the reason written at the top of each, because a script that
silently does not run is worse than one that is known to be stale:

- **`apps/frontends/hub-console/scripts/verify-console.mjs`** — written against bearer tokens, before
  the HttpOnly session cookie (ADR-0016), and against a hub console that took a hub code in the URL
  rather than resolving one from `GET /v1/hubs/my-hub`. It needs a cookie jar and a `hub.staff` fixture
  row; that is a rewrite of its auth half, not a field rename.
- **`apps/frontends/control-tower/scripts/verify-map-fallback.mjs`** — needs two dev servers of its
  own, because the tile URL is baked in at build time and the whole point is for it to be wrong. It
  cannot run against the stack that is already up.

Both are run by hand, deliberately, and both are documented where they live.

**Order matters if you are also photographing the app**: `dashboard.integration.test.ts` empties the
shipment, rider, COD and delivery tables, so run it _before_ `pnpm seed:shots`, never after.

When this repository is released publicly, the same sequence belongs in a workflow. Until then,
`pnpm verify` passing is a claim you make about your own work rather than one the repository makes
for you.

## Dependencies

Renovate. Grouped by ecosystem, with a weekly window.

Dependencies are pinned exactly — no `^`. A lockfile with ranges is a supply-chain surface, and
"it broke because a transitive dep moved" is not an interesting morning.

Review the diff, not the count. Fifty routine patch bumps and one major are not one pull request.

---

Related: [environment.md](environment.md) · [../testing/strategy.md](../testing/strategy.md) ·
[../architecture/module-boundaries.md](../architecture/module-boundaries.md)
