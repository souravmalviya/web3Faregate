# Faregate console design system

The console is where a person controls what their AI agents may buy. This
document records what the product needs from its interface and the design
decisions that follow from it, so later changes can be judged against the
same reasons.

## 1. What the interface is for

**Product.** A gateway between AI agents and paid onchain data. Every request
is checked against the agent's passport, may wait for a human, is paid per
query, and only then is answered.

**Who uses it.** The owner of a small fleet of agents: a treasury or research
lead, or the engineer on call for them. They are responsible for money and for
what the agents did. They open the console to act, not to browse.

**Primary action.** Decide on requests that are waiting: approve or reject,
with enough context to decide in seconds.

**What must be noticed first.** In order: anything waiting for a signature;
whether money is moving within limits; whether the gateway is live or
simulated.

**Secondary tasks.** Check why something was refused. Prove a payment
happened. Review an agent's limits. Revoke an agent. Read the audit record.

**Personality.** A fare gate and a passport desk: an official, slightly
bureaucratic instrument that is calm, exact, and leaves a paper trail. It
should feel closer to a well-made ledger or a transit timetable than to a
marketing site.

## 2. Principles

1. **The verdict is the interface.** Every request resolves to pass, hold or
   stop. Those three states get the only saturated colours.
2. **Paper, not glass.** Flat surfaces, hairline rules, no shadows except on
   things that float (notifications).
3. **Dense where it is scanned, open where it is decided.** The request ledger
   is a table. The approval ticket gives a single decision room.
4. **Say it in the product's words.** Fare, passport, gate, cleared, refused.
   No generic "items" or "resources" in the UI.
5. **Motion only for change.** A new row is tinted briefly when it arrives.
   Nothing floats, pulses or glows.

## 3. Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `paper` | `#F3F0E8` | Page ground |
| `sheet` | `#FBFAF6` | Header, tickets, open rows |
| `sheet-2` | `#ECE8DD` | Meter tracks, code, skeletons |
| `rule` | `#DDD7CA` | Hairline dividers |
| `rule-strong` | `#BFB7A5` | Input borders, ticket edges |
| `ink` | `#1C1B18` | Primary text, primary buttons, the gate track |
| `ink-2` | `#4A463E` | Secondary text |
| `muted` | `#787164` | Metadata, labels |
| `brand` | `#2446A6` | Stamp blue: links, focus, selection, "cleared" |
| `pass` | `#1E6A44` | Delivered, settled, approve |
| `hold` | `#95570A` | Waiting on a person |
| `stop` | `#B0261E` | Refused, revoked, destructive actions |

Each semantic colour has a pale tint for stamp and notice backgrounds. There
are no gradients. Stamp blue was chosen over the common SaaS blues because it
reads as ink on a document and stays clearly separate from the three verdict
colours.

### Type

| Role | Face | Size | Notes |
|---|---|---|---|
| Page title | Barlow Semi Condensed 600 | 30px | Signage voice, used once per page |
| Section heading | Barlow Semi Condensed 600 | 17px | Sentence case |
| Label, column head, stamp | Barlow Semi Condensed 600 | 11.5px | Uppercase, 0.06 to 0.07em tracking |
| Body and controls | IBM Plex Sans 400/500 | 13.5 to 16px | |
| Money, ids, times | IBM Plex Mono 400/500 | 11.5 to 26px | Tabular figures |

The condensed signage face carries identity and saves width in dense tables.
Plex Sans stays readable at small sizes. Plex Mono makes amounts and
transaction ids line up and read as exact values.

### Shape and space

- Radius: 2px for stamps, 3px for controls. Nothing larger.
- Rules: 1px hairlines; a 2px ink rule under each page header.
- Spacing steps: 4, 8, 12, 16, 20, 24, 32, 40px.
- Layout: 1200px maximum width. The requests page uses an asymmetric
  two-column grid: the working column, and a 320px reference rail.

## 4. Components

| Component | Decision |
|---|---|
| **Stamp** | Square, bordered, uppercase verdict: `Needs you`, `Cleared`, `Delivered`, `Refused`. Replaces pill badges. |
| **Gate track** | A request's route drawn like a transit line: Asked, Passport, You (or Auto), Fare, Data. A filled stop is passed, a ring is waiting, a red square is where it stopped. Shape carries meaning as well as colour. |
| **Approval ticket** | A waiting request with a perforated stub holding the fare and the Approve and Reject controls. It says in a sentence what the agent wants and why it needs you. |
| **Ledger table** | Time, agent, request, gate, fare, status. Rows open in place to show the decision, payment and data side by side. |
| **Figure strip** | Page-level numbers in a single row divided by rules, not cards. |
| **Spend meter** | A 4px bar with the exact amount in mono beside it. Turns red at 90% of the daily limit. |
| **Buttons** | Primary is ink. Approve is green because it is an allow decision. Reject and revoke are red outlines that fill on hover. Quiet buttons have no border. |
| **Notice** | A tinted row with a 3px left rule: stop for errors, hold for simulated subsystems. |
| **Copyable value** | Ids, addresses and commands show a copy control on hover or focus. |

## 5. States

- **Loading.** Skeleton rows until the first poll answers, so an empty list is
  never shown before the data arrives.
- **Empty.** A sentence describing what will appear, with the command that
  makes it happen.
- **Error.** The gateway being unreachable is a stop notice with the command
  to start it; the console keeps retrying.
- **Disabled.** Signed actions are disabled without a wallet on Sepolia, and
  the reason is written next to them rather than hidden in a tooltip.
- **Validation.** Forms validate on submit and mark the field that is wrong.
- **Success.** A notification in the corner states exactly what was signed.

## 6. Information architecture

| Page | Purpose |
|---|---|
| **Requests** | Waiting approvals, then every request. Rail: passports, a test request form, gateway status. |
| **Passports** | Each agent's identity, limits, allowed data and spend; how to revoke. |
| **Ledger** | Every fare collected, with the Hedera transaction. |
| **Audit log** | The append-only record, filterable by actor and text. |

## 7. Things deliberately left out

Gradients, glow, glass panels, oversized hero headings, decorative
illustration, entrance animations, pill buttons, and robot or sparkle icons.
Each was considered and rejected because it adds no information about agents,
limits or money.
