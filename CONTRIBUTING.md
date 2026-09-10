# Contributing

## Setup

```bash
npm install
cp .env.example .env
npm run build --workspace @faregate/shared
```

Node 20 or newer. Node 24 is what this was built on.

## Running

```bash
npm run dev:api     # gateway on :8402
npm run dev:web     # dashboard on :3000
npm run agent -- --agent trial.agents.faregate.eth --ask "balance of 0x... today"
```

The gateway starts with every subsystem simulated and says so on `/health`.
Fill in `.env` to turn subsystems live one at a time.

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

All four must pass before a commit; `npm run check` runs them together. Lint
covers the dashboard (ESLint with the Next.js rules); the gateway and the
shared package are held to `tsc --strict`. Tests run directly on the TypeScript
sources under Node's type stripping, which is why source files carry `.ts`
import specifiers and why constructor parameter properties, enums and
decorators are not used.

## Conventions

- Money is integer micro-USD everywhere except the display edge.
- Nothing simulated may be presented as a chain fact. If you add a subsystem,
  give it a `live` / `simulated` mode and carry the mode through provenance.
- The policy engine stays pure. No I/O, no clock reads, no model calls inside
  it.
- Commit small, commit often, and write the commit message for the reviewer
  who has to understand why, not what.
