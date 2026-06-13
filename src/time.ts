// Time helpers. All courses are in America/Edmonton, which switches between
// MST (-07:00) and MDT (-06:00), so we compute the offset for the given date
// rather than hard-coding it.

/** Minutes since midnight for a "HH:mm" (or "H:mm") string. */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) throw new Error(`bad time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "HH:mm" zero-padded. */
export function pad(hhmm: string): string {
  const mins = minutesOfDay(hhmm);
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** UTC offset like "-06:00" for a timezone on a given date. */
export function zoneOffset(date: string, timeZone: string): string {
  // Use noon to avoid DST-boundary ambiguity for the date.
  const d = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-06:00";
  // name looks like "GMT-06:00"
  const m = /GMT([+-]\d{2}:\d{2})/.exec(name);
  return m ? m[1] : "-06:00";
}

/** Build an ISO 8601 string for a local date+time in a timezone. */
export function toIso(date: string, hhmm: string, timeZone: string): string {
  const t = pad(hhmm);
  return `${date}T${t}:00${zoneOffset(date, timeZone)}`;
}
