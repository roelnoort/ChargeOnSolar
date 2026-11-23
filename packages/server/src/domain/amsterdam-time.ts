// The household lives in Europe/Amsterdam: its days and months start at local
// midnight, which is 22:00 or 23:00 UTC depending on summer time.
const timeZone = "Europe/Amsterdam";

const wallClockFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(at: Date): WallClock & { second: number } {
  const parts = Object.fromEntries(
    wallClockFormat
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** How far Amsterdam's clock is ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: Date): number {
  const wall = wallClock(at);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second
  );
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment Amsterdam's clock shows this wall-clock time. */
function fromWallClock({ year, month, day, hour, minute }: WallClock): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wallAsUtc - offsetMs(new Date(wallAsUtc));
  return new Date(wallAsUtc - offsetMs(new Date(guess)));
}

/** When the Amsterdam day that `at` falls in began. */
export function amsterdamDayStart(at: Date): Date {
  const { year, month, day } = wallClock(at);
  return fromWallClock({ year, month, day, hour: 0, minute: 0 });
}

/** The first moment after `after` at which Amsterdam's clock shows hour:minute. */
export function nextAmsterdamTime(
  after: Date,
  hour: number,
  minute: number
): Date {
  const { year, month, day } = wallClock(after);
  const today = fromWallClock({ year, month, day, hour, minute });
  if (today.getTime() > after.getTime()) return today;
  return fromWallClock({ year, month, day: day + 1, hour, minute });
}

/** The Amsterdam calendar month `at` falls in, as YYYY-MM. */
export function amsterdamMonth(at: Date): string {
  const { year, month } = wallClock(at);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** How many days of its Amsterdam month are left at `at`, today included. */
export function amsterdamDaysLeftInMonth(at: Date): number {
  const { year, month, day } = wallClock(at);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return daysInMonth - day + 1;
}

/** The Amsterdam calendar day `at` falls in, as YYYY-MM-DD. */
export function amsterdamDate(at: Date): string {
  const { year, month, day } = wallClock(at);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${year}-${twoDigits(month)}-${twoDigits(day)}`;
}

/**
 * When the Amsterdam day `date` (YYYY-MM-DD) begins and ends: 24 hours apart,
 * or 23 and 25 on the days summer time starts and ends.
 */
export function amsterdamDayBounds(date: string): { start: Date; end: Date } {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return {
    start: fromWallClock({ year, month, day, hour: 0, minute: 0 }),
    end: fromWallClock({ year, month, day: day + 1, hour: 0, minute: 0 }),
  };
}
