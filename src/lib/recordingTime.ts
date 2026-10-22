export function recordingFileTime(filename: string, modifiedMs: number) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})(?:[-_](\d{6}))?/);
  let startMs = modifiedMs;
  if (match) {
    const text = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] || "000000").slice(0, 3)}`;
    const utc = Date.parse(`${text}Z`);
    startMs = Number.isFinite(utc) && Math.abs(modifiedMs - utc) < 40 * 60_000 ? utc : new Date(text).getTime();
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(startMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return {
    startMs, dateStr: `${value("year")}-${value("month")}-${value("day")}`,
    timeStr: `${value("hour")}:${value("minute")}:${value("second")}`,
    timestamp: new Date(startMs).toISOString(),
  };
}
