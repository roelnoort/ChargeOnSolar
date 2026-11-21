# ChargeOnSolar

A home energy management system for one household: it charges the EV from solar power that the house itself isn't using.

## Language

### Energy

**Surplus**:
The power that would flow to the grid if the charger drew nothing: Solar production the house is not consuming. Equal to Charger power minus Net power, totalled over all phases. Negative when the house alone already imports.
_Avoid_: Surplus before charging, excess, overproduction, export (export is only the part that actually flows to the grid)

**Net power**:
The household's total power exchange with the grid across all phases, as measured at the smart meter: positive when importing, negative when exporting.
_Avoid_: Grid power, meter power

**Solar production**:
The power the solar panels are delivering.
_Avoid_: Generation, PV power, yield

**Charger power**:
The power the charger is currently delivering to the EV.
_Avoid_: Charging load, EV consumption

**House consumption**:
The power used by the house apart from the charger.
_Avoid_: Household load, base load

**Reading**:
A timestamped measurement taken from one device (charger, solar system, or P1 meter).
_Avoid_: Sample, datapoint, metric

### Charging

**Charging current**:
The current, in amperes, that the charger is set to deliver to the EV. It is the quantity the system controls; the voltage is fixed by the grid.
_Avoid_: Charging voltage, charge rate

**Phase setting**:
Whether the charger charges on 1 phase or on 3 phases, as chosen by the user. Charging on 1 phase is slower and suits days of steady Surplus; 3 phases is for charging quickly.
_Avoid_: Phase mode, phase count

**Fuse headroom**:
How much current the charger can still draw before the main fuse is overloaded: the main fuse rating minus the House consumption current on the busiest phase.
_Avoid_: Available current, capacity

**Solar mode**:
The user's choice of how strictly charging must be paid for by Surplus: **Solar only** or **All solar**.
_Avoid_: Charging mode, strategy

**Solar only**:
The Solar mode in which the EV charges only when the Surplus covers at least the charger's minimum current.
_Avoid_: Pure solar, strict mode

**All solar**:
The Solar mode in which every bit of Surplus goes into the EV: when the Surplus is below the charger's minimum current, the EV still charges at that minimum and the rest comes from the grid.
_Avoid_: Any solar, solar plus grid, boost

**User**:
A household member with their own account. All Users have the same rights in v1; every Manual override records which User sent it.
_Avoid_: Account, operator, admin

**Manual override**:
A pause or resume command that the user sends to the charger by hand. Setting the Charging current by hand is not part of it.
_Avoid_: Manual mode, force charge

**External pause**:
A pause of the charger that the user made outside ChargeOnSolar, for example in the Zaptec app. A pause by the car itself or by a charging schedule is not an External pause.
_Avoid_: Foreign pause, app pause

**Switch budget**:
How many more times charging may be interrupted in the current charge session: starts, stops and phase switches all count, whoever causes them. The charger allows 20 per session.
_Avoid_: Switch limit, cycle count

**Shadow decision**:
What Automatic control would do at a given moment (start, stop, or which Charging current to use). It is calculated and shown to the user, but never sent to the charger.
_Avoid_: Dry run, simulation, recommendation

**Automatic control**:
The system sending its own charging decisions to the charger. Not part of v1.
_Avoid_: Auto mode, smart charging

**Monitoring phase**:
The period in which the system records Readings and makes Shadow decisions while Automatic control stays off, so the user can learn to trust the decisions.
_Avoid_: Trial, test mode
