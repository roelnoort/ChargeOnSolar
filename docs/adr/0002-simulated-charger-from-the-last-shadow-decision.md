# The simulated charger carries on from the last Shadow decision after a restart

The Shadow engine decides from the simulated charger: whether it would be
charging, at which Charging current, since when, and how much of the Switch
budget it has used. That state lives in the Shadow runner's memory, so a
restart would lose it, and the first tick after a restart in the middle of a
sunny afternoon would "start" a charge session the engine already started.

## Decision

- Every Shadow decision row records the simulated charger as it is after the
  decision. On start, the runner reads the most recent row and carries on from
  that state; with no row it starts from "No car".
- The runner does not try to work out what happened while it was down. The
  engine's own rules handle the gap: a car unplugged meanwhile gives "No car"
  and a fresh session; a minimum on-time or current hold that ran out during
  the gap has simply run out.
- The Surplus averages are not restored. The 5- and 10-minute windows fill
  again from live data, and until they do they average whatever has arrived
  since the restart.

## Consequences

- No separate table or file for runner state: the decision rows already hold
  it, and they cannot disagree with it.
- After a long outage, the simulated charger may still be "charging" from the
  afternoon before. The first tick then judges that session by today's
  Surplus, which is what Automatic control would face after a restart too.
- A change to the shape of the simulated charger needs to read rows written
  in the old shape, or fall back to "No car".
