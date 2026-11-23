import type { LocalDay } from "@charge-on-solar/shared";

const amsterdamDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Europe/Amsterdam calendar day at `now` (ms since the epoch). */
export function amsterdamToday(now: number): LocalDay {
  return amsterdamDate.format(now);
}

const hourMs = 3_600_000;

/** When the Europe/Amsterdam day after the one at `now` begins (ms since the epoch). */
export function nextAmsterdamDayAt(now: number): number {
  const tomorrow = shiftDay(amsterdamToday(now), 1);
  const utcMidnight = Date.parse(`${tomorrow}T00:00:00.000Z`);
  // Amsterdam is UTC+2 in summer and UTC+1 in winter.
  const summerMidnight = utcMidnight - 2 * hourMs;
  return amsterdamToday(summerMidnight) === tomorrow
    ? summerMidnight
    : utcMidnight - hourMs;
}

/** The calendar day `days` after `day`; negative goes back. */
export function shiftDay(day: LocalDay, days: number): LocalDay {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const calendarDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function describeDay(day: LocalDay, today: LocalDay): string {
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  return calendarDate.format(new Date(`${day}T00:00:00.000Z`)).replace(",", "");
}
