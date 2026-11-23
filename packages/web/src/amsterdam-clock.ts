/** The household's clock, as hh:mm: Enphase intervals end on its 5-minute marks. */
export const amsterdamClockTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
