/** The sample clock starts at Wednesday, October 22, 2026, 00:00. */

export const DAY_MINUTES = 24 * 60;

export function at(day: 0 | 1, hour: number, minute = 0): number {
  return day * DAY_MINUTES + hour * 60 + minute;
}

export const DEMO_NOW = at(0, 16, 0);
export const HORIZON_END = at(1, 15, 0);
export const ARRIVAL_BUFFER_MIN = 15;

const DAY_NAMES = ["Wed", "Thu", "Fri"] as const;
const DAY_LONG = ["Wednesday", "Thursday", "Friday"] as const;

export function dayIndex(minute: number): number {
  return Math.floor(minute / DAY_MINUTES);
}

export function formatClock(minute: number): string {
  const within = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(within / 60);
  const mins = within % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${mins.toString().padStart(2, "0")} ${suffix}`;
}

export function formatWhen(minute: number): string {
  const day = DAY_NAMES[dayIndex(minute)] ?? `Day ${dayIndex(minute) + 1}`;
  return `${day} ${formatClock(minute)}`;
}

export function formatDayLong(day: number): string {
  return DAY_LONG[day] ?? `Day ${day + 1}`;
}

/** "Wed 4:00–6:00 PM" or a cross-midnight range when needed. */
export function formatRange(start: number, end: number): string {
  if (dayIndex(start) !== dayIndex(end)) {
    return `${formatWhen(start)} – ${formatWhen(end)}`;
  }
  const startClock = formatClock(start);
  const endClock = formatClock(end);
  const startSuffix = startClock.slice(-2);
  const endSuffix = endClock.slice(-2);
  const day = DAY_NAMES[dayIndex(start)] ?? "Day";
  if (startSuffix === endSuffix) {
    return `${day} ${startClock.slice(0, -3)}–${endClock}`;
  }
  return `${day} ${startClock}–${endClock}`;
}

export function durationLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hr" : `${hours} hr`;
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} hr ${rest} min`;
  }
  return `${minutes} min`;
}

export const DEMO_CLOCK_LABEL = "Wednesday, Oct 22, 2026 · 4:00 PM";
