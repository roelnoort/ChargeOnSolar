# Coding standards

The rules the factory's reviewer judges every change against, one per
heading; a finding cites its rule by heading. Terms are the ones in
[GLOSSARY.md](./GLOSSARY.md). Tooling (Biome, `tsc`) enforces formatting and
types; these are the rules it cannot.

The examples show the stack the spec (#23) decides: Hono on the server, one
storage module, zod schemas in the shared package, React in the web app.

## An HTTP handler that cannot continue throws an HTTPException

A Hono handler that cannot carry on throws an `HTTPException`. It does not
build an error response itself, and one `app.onError` turns every
`HTTPException` into a response, so every error has the same shape.

```ts
app.post("/api/overrides/:id/cancel", async (c) => {
  const override = await storage.findManualOverride(id);
  if (!override) throw new HTTPException(404, { message: "No such override" });
  // ...one success path from here
});
```

This is for handlers only. Domain code (the Shadow engine, the collectors,
storage) returns or throws its own domain results and knows nothing about
HTTP; the handler maps them.

## Parse untrusted input with zod at the boundary, once

Request bodies, query strings, route parameters, vendor responses and SSE
payloads are parsed with a zod schema where they enter. After that the value
has a type and is not checked again.

A check in the browser (a disabled Save button, an inline error) uses the
same schema from the shared package that the server parses with, not its own
copy of the rules.

```ts
// packages/shared: the one place the rule is written
export const phaseSettingUpdate = z.object({ phases: phaseSetting });

// server
const { phases } = phaseSettingUpdate.parse(await c.req.json());

// web
const canSave = phaseSettingUpdate.safeParse(draft).success;
```

## Check permission in the handler that performs the action

The handler that changes something checks that the caller may change it,
even when another route already checked. A guard on `GET /api/live` does not
protect `POST /api/overrides`: they are separate requests, and a native
client can call either one directly.

## Only the storage module touches the database

The database driver and Drizzle are imported only inside the storage module,
behind its single public entry. Everything else calls its async, domain-level
functions, which take and return server domain types, never ORM rows.

```ts
// Bad: a handler reaching past storage
import { db } from "../storage/db.ts";
const rows = await db.select().from(p1Readings);

// Good
const readings = await storage.listReadings({ from, to, limit });
```

## Arrange tests through the module under test

Test setup calls the module's own public functions. When the function you
need does not exist, add it to the module rather than inserting rows into
SQLite directly, so a change to how storage keeps Readings leaves its tests
alone.

## Wrap related writes in a transaction

Two writes that must both land, or neither, go in one transaction inside the
storage module. Recording a Manual override and the open pause it creates in
app state is one transaction: with only the first, the system believes in a
pause nothing will ever resume.

## Do not query in a loop

One query per item is N+1 queries. Use a join, or one query with `IN`.
Loading the Readings for each of a day's 1440 Shadow decisions one at a time
is 1440 queries; load the day's Readings once and match them in memory.

## Paginate anything that can grow

A query whose row count grows with how long the system has been running gets
a limit. Readings will: the P1 meter alone records one about every second, and
every raw Reading is kept for the whole Monitoring phase. An endpoint that
lists them takes a page or a time window, and never returns them all.

## Define a set of values once, and derive its type

A set of values the code compares against (the Phase setting's 1 and 3, the
Solar modes, a charger state) is written once: an `as const` array, or a zod
enum in the shared package when it crosses the API. Its type is derived from
it. Never a TypeScript `enum`: it is not erasable syntax, and `tsc` rejects it
under `erasableSyntaxOnly`.

```ts
// packages/shared
export const solarMode = z.enum(["solar-only", "all-solar"]);
export type SolarMode = z.infer<typeof solarMode>;

// server-only
export const phaseSettings = [1, 3] as const;
export type PhaseSetting = (typeof phaseSettings)[number];
```

## Inject the clock

Code that needs the time takes it from an injected clock, never from
`Date.now()` or `new Date()` directly. The Shadow engine gets the time in its
snapshot; everything else gets the clock the test harness controls. That is
how a test checks a 15-minute hold, a 90-day session or a Europe/Amsterdam
day on a DST change without waiting for one.

## Keep secrets on the server

Anything the web app can read is public. Vendor credentials, the encryption
key and session tokens stay in the server; the web app gets only what the API
contract returns.

## No side effects in the render path

Rendering a React component works out what to show. It does not fetch, write,
subscribe or log. Anything that touches the outside world (the SSE stream, a
Pause button's request) belongs in an effect or an event handler.

## Derive values rather than storing copies

If a value can be worked out from one you already hold, work it out. Storing
it gives you two things that must agree, and one day they will not. Surplus is
Charger power minus Net power: calculate it from the Reading, do not store it
beside them.

```tsx
// Bad
const [readings, setReadings] = useState(initial);
const [latest, setLatest] = useState(initial.at(-1));

// Good
const [readings, setReadings] = useState(initial);
const latest = readings.at(-1);
```

## Key per-entity form state on the entity's id

A component that holds form state for one entity gets `key={entity.id}`.
Without it, React keeps the component when the screen moves to the next
entity, and the old draft goes with it: a device name typed for one signed-in
device could be saved on the next.

## No comments that restate the code

Name and extract until a comment is unnecessary. A comment that says what the
code does goes stale the first time the code changes.

- A decision with trade-offs gets an ADR in `docs/adr/`, and the code links to
  it.
- A small local fact the code cannot express gets a one-line comment: a vendor
  quirk, a unit, a sign convention.

```ts
// The P1 meter reports export as negative power.
const netPower = message.active_power_w;
const watts = amps * 230 * phases; // per-phase voltage, fixed by the grid
```
