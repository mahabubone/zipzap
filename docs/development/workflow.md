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

## CI

```
format → lint → typecheck → unit → integration → build → container → security scan → deploy
```

Integration tests need Postgres, Redis, and NATS — Testcontainers, not mocks for the things you
are testing behaviour of.

Every push is a green build or a broken main. Merging red to unblock a demo is how main becomes
a place nobody trusts.

## Dependencies

Renovate. Grouped by ecosystem, with a weekly window.

Dependencies are pinned exactly — no `^`. A lockfile with ranges is a supply-chain surface, and
"it broke because a transitive dep moved" is not an interesting morning.

Review the diff, not the count. Fifty routine patch bumps and one major are not one pull request.

---

Related: [environment.md](environment.md) · [../testing/strategy.md](../testing/strategy.md) ·
[../architecture/module-boundaries.md](../architecture/module-boundaries.md)
