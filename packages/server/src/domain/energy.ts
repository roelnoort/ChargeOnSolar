/** Charger power minus Net power: what would flow to the grid if the charger drew nothing. */
export function surplus(reading: {
  netPowerW: number;
  chargerPowerW: number;
}): number {
  return reading.chargerPowerW - reading.netPowerW;
}

/**
 * The main fuse rating minus the House consumption current on the busiest
 * phase. Assumes the charger is on its own group fuse.
 */
export function fuseHeadroom(
  mainFuseA: number,
  phaseCurrents: {
    p1A: readonly number[];
    chargerA: readonly number[];
  }
): number {
  const houseCurrents = phaseCurrents.p1A.map(
    (p1, phase) => p1 - (phaseCurrents.chargerA[phase] ?? 0)
  );
  return mainFuseA - Math.max(...houseCurrents);
}
