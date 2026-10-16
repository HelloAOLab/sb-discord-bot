// Turning a day and time picked in someone's time zone into an exact moment, and back. Discord
// doesn't tell the app anyone's time zone, so the time picker asks for one (remembered with
// /preferences), and its preview uses Discord's timestamps (<t:…>), which every viewer sees in
// their own local time: a wrong time zone shows up as the wrong time before the session is booked.
// Times are Unix seconds, as Discord's timestamps use.

/** A day and time on the clock in some time zone, e.g. { date: "2026-10-14", hour: 19, minute: 0 }. */
export interface LocalTime {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
}

/** A time zone offered in the time picker, from west to east. */
export interface TimeZoneChoice {
  id: string;
  label: string;
}

/**
 * The time zones listed in the picker. Anyone elsewhere can set theirs with /preferences, and the
 * picker then lists it first.
 */
export const TIME_ZONES: TimeZoneChoice[] = [
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "America/Los_Angeles", label: "Pacific Time (Los Angeles, Vancouver)" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Denver", label: "Mountain Time (Denver, Calgary)" },
  { id: "America/Chicago", label: "Central Time (Chicago, Dallas)" },
  { id: "America/Mexico_City", label: "Mexico City" },
  { id: "America/New_York", label: "Eastern Time (New York, Toronto)" },
  { id: "America/Bogota", label: "Bogotá, Lima" },
  { id: "America/Halifax", label: "Atlantic Time (Halifax)" },
  { id: "America/Sao_Paulo", label: "São Paulo, Brasília" },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { id: "UTC", label: "UTC" },
  { id: "Europe/London", label: "London, Dublin, Lisbon" },
  { id: "Africa/Lagos", label: "Lagos, Kinshasa" },
  { id: "Europe/Paris", label: "Central Europe (Paris, Berlin, Madrid)" },
  { id: "Africa/Johannesburg", label: "Johannesburg, Harare" },
  { id: "Africa/Cairo", label: "Cairo" },
  { id: "Europe/Athens", label: "Eastern Europe (Athens, Kyiv, Bucharest)" },
  { id: "Asia/Jerusalem", label: "Jerusalem" },
  { id: "Africa/Nairobi", label: "Nairobi, Addis Ababa" },
  { id: "Europe/Istanbul", label: "Istanbul" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Kathmandu", label: "Kathmandu" },
  { id: "Asia/Dhaka", label: "Dhaka" },
  { id: "Asia/Bangkok", label: "Bangkok, Hanoi, Jakarta" },
  { id: "Asia/Shanghai", label: "China, Hong Kong, Taipei" },
  { id: "Asia/Singapore", label: "Singapore, Kuala Lumpur" },
  { id: "Asia/Manila", label: "Manila" },
  { id: "Australia/Perth", label: "Perth" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Adelaide", label: "Adelaide" },
  { id: "Australia/Brisbane", label: "Brisbane" },
  { id: "Australia/Sydney", label: "Sydney, Melbourne" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

/**
 * A first guess at someone's time zone from their Discord language, used until they pick one.
 * It's often wrong (English covers the whole US), which is why the picker shows a preview.
 */
const ZONE_BY_LOCALE: Record<string, string> = {
  "en-US": "America/New_York",
  "en-GB": "Europe/London",
  "es-419": "America/Mexico_City",
  "es-ES": "Europe/Paris",
  "pt-BR": "America/Sao_Paulo",
  fr: "Europe/Paris",
  de: "Europe/Paris",
  it: "Europe/Paris",
  nl: "Europe/Paris",
  pl: "Europe/Paris",
  "sv-SE": "Europe/Paris",
  da: "Europe/Paris",
  no: "Europe/Paris",
  cs: "Europe/Paris",
  hu: "Europe/Paris",
  hr: "Europe/Paris",
  ro: "Europe/Athens",
  bg: "Europe/Athens",
  el: "Europe/Athens",
  fi: "Europe/Athens",
  lt: "Europe/Athens",
  uk: "Europe/Athens",
  tr: "Europe/Istanbul",
  ru: "Europe/Moscow",
  hi: "Asia/Kolkata",
  th: "Asia/Bangkok",
  vi: "Asia/Bangkok",
  id: "Asia/Bangkok",
  "zh-CN": "Asia/Shanghai",
  "zh-TW": "Asia/Shanghai",
  ja: "Asia/Tokyo",
  ko: "Asia/Seoul",
};

export function guessTimeZone(locale: string | undefined): string {
  return (locale && ZONE_BY_LOCALE[locale]) || "UTC";
}

/**
 * The time zone `id` names, spelled as listed ("america/new_york" → "America/New_York"), or null
 * if this runtime doesn't know it. Listed names are kept as they are: the runtime would rename some
 * ("Asia/Kolkata" → "Asia/Calcutta"), and the picker must recognize them as the ones it showed.
 */
export function findTimeZone(id: string): string | null {
  const wanted = id.trim().toLowerCase();
  if (wanted === "") return null;
  const listed = [...TIME_ZONES.map((zone) => zone.id), ...allTimeZones()].find((zone) => zone.toLowerCase() === wanted);
  if (listed) return listed;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: id.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Every time zone this runtime knows, for /preferences autocomplete. */
export function allTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

const partsFormats = new Map<string, Intl.DateTimeFormat>();

/** The clock in `timeZone` at Unix time `seconds`. */
function clockParts(seconds: number, timeZone: string) {
  let format = partsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(seconds * 1000));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** How far `timeZone` is ahead of UTC at Unix time `seconds`, in minutes (New York in summer: -240). */
export function utcOffsetMinutes(seconds: number, timeZone: string): number {
  const p = clockParts(seconds, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return Math.round((asUtc - Math.floor(seconds)) / 60);
}

/** "UTC−4", "UTC+5:30", "UTC". */
export function describeOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** The day and time on the clock in `timeZone` at Unix time `seconds`. */
export function toLocalTime(seconds: number, timeZone: string): LocalTime {
  const p = clockParts(seconds, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hour: p.hour, minute: p.minute };
}

/**
 * The Unix time when the clock in `timeZone` shows `local`. The offset is found twice, so a time
 * just after a daylight-saving change uses the offset in effect then. A time skipped by the change
 * (2:30 on the night clocks jump to 3:00) comes out an hour later.
 */
export function fromLocalTime(local: LocalTime, timeZone: string): number {
  const [year = 0, month = 1, day = 1] = local.date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, local.hour, local.minute) / 1000;
  const first = wall - utcOffsetMinutes(wall, timeZone) * 60;
  const second = wall - utcOffsetMinutes(first, timeZone) * 60;
  if (second === first) return second;
  // The two differ only next to a daylight-saving change: use the one whose clock shows `local`,
  // or, for a skipped time that neither shows, the later one.
  const shows = (seconds: number) => formatLocalTime(toLocalTime(seconds, timeZone)) === formatLocalTime(local);
  if (shows(second)) return second;
  if (shows(first)) return first;
  return Math.max(first, second);
}

/** "2026-10-14T19:00", as stored in the database. */
export function formatLocalTime({ date, hour, minute }: LocalTime): string {
  return `${date}T${pad(hour)}:${pad(minute)}`;
}

/** The reverse of formatLocalTime(); null if `text` isn't in that form. */
export function parseLocalTime(text: string | null | undefined): LocalTime | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text ?? "");
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  return hour < 24 && minute < 60 ? { date: match[1]!, hour, minute } : null;
}

/** The YYYY-MM-DD date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** "Wed, Oct 14" for "2026-10-14". */
export function describeDate(date: string): string {
  return dayFormat.format(new Date(`${date}T12:00:00Z`));
}

/** "19:00 · 7 PM" */
export function describeHour(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${pad(hour)}:00 · ${twelve} ${hour < 12 ? "AM" : "PM"}`;
}

/** "19:05" */
export function describeClock({ hour, minute }: Pick<LocalTime, "hour" | "minute">): string {
  return `${pad(hour)}:${pad(minute)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
