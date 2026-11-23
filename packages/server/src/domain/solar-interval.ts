/** Five minutes of Solar production, as Enphase reports it. */
export interface SolarInterval {
  /** When the five minutes ended. Identifies the interval. */
  endAt: Date;
  /** Average Solar production over the interval, in watts. */
  solarProductionW: number;
  /** Energy produced in the interval, in watt-hours. */
  energyWh: number;
  /** How many microinverters had reported for it; may grow on a revision. */
  devicesReporting: number | null;
}
