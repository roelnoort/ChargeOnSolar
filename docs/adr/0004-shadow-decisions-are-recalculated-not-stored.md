# Shadow decisions are recalculated from Readings, never stored

Replaces [0002](./0002-simulated-charger-from-the-last-shadow-decision.md).

The Monitoring phase is for finding out how Automatic control should decide:
change the Settings, look back at past days, and compare the Shadow chart with
what really happened. Stored Shadow decisions answer a different question,
what the engine said at the time with the Settings it had then, and they go
stale the moment a Setting changes. So Shadow decisions are not stored. Every
day's Shadow decisions are recalculated on the server from that day's stored
Readings with the current Settings, as if those Settings had held all day.

## Decision

- Each day is replayed on its own: from midnight (Amsterdam time), starting
  from "No car" with the whole Switch budget unused, and nothing carried over
  from the day before. There is no sun at midnight, so the simulated charger
  cannot be charging then.
- The Shadow decision card on the Now tab is the latest decision of today's
  replay. Today is extended by one tick every minute, and replayed again from
  midnight when the Settings change.
- No Shadow decision is made while the newest P1 or charger Reading is older
  than 2 minutes, so a gap in the Readings stays a gap in the Shadow chart.

## Consequences

- There is no record of what the engine said at the time. A change to the
  Settings or the rules rewrites the Shadow chart of every past day.
- A car left plugged in overnight starts each day's replay with a fresh Switch
  budget, though the charge session began the day before. This is rare
  enough to accept.
- The commands that Automatic control will send to the charger are a
  different thing from Shadow decisions, and will need a log of their own.
