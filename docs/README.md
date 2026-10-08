# docs/

Map of the documentation. `prompt.txt` (gitignored) is the raw product brainstorm; these files
are the source of truth. Every doc here is a distillation, not a transcript.

| Directory                                        | Answers                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [`product/`](product/)                           | What problem does ZipZap solve, for whom, and in what order?     |
| └ [`product/competition/`](product/competition/) | How do we compare to CarryBee, RedX and Steadfast?               |
| [`architecture/`](architecture/)                 | How is the system built, and what are the boundaries?            |
| [`domains/`](domains/)                           | What does each business domain own?                              |
| [`api/`](api/)                                   | How do clients authenticate, paginate, retry, and handle errors? |
| [`operations/`](operations/)                     | How is it run, observed, and recovered?                          |
| [`development/`](development/)                   | How do I set up and contribute?                                  |
| [`testing/`](testing/)                           | What is tested where, and how?                                   |
| [`ADR/`](ADR/)                                   | Why is it built this way, and what was rejected?                 |

Working agreements for humans and agents: [`../AGENTS.md`](../AGENTS.md).
Build order and phase gates: [`../ROADMAP.md`](../ROADMAP.md).

## Read in this order

1. [architecture/overview.md](architecture/overview.md) — how the pieces fit
2. [architecture/module-boundaries.md](architecture/module-boundaries.md) — the one rule that shapes everything
3. [domains/_index.md](domains/_index.md) — the eighteen domains
4. [architecture/provider-adapters.md](architecture/provider-adapters.md) — the seam every
   external service sits behind, and what is verified about each
5. [ADR/](ADR/) — the decisions behind it
6. [product/competition/](product/competition/) — the market we are building against
7. Everything else, on demand
