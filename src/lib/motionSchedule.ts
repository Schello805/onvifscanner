type MotionSchedule = {
  motionScheduleEnabled?: boolean;
  motionScheduleStart?: string | null;
  motionScheduleEnd?: string | null;
  motionScheduleDays?: string | number[] | null;
};

function parseDays(value: MotionSchedule["motionScheduleDays"]): number[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [];
  } catch {
    return [];
  }
}

function minutesFromTime(value: string | null | undefined, fallback: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

function getLocalTimeInfo(date: Date) {
  const tz = process.env.TZ || "Europe/Berlin";
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? date.getHours());
  const minute = Number(p.find((x) => x.type === "minute")?.value ?? date.getMinutes());
  const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const dayStr = dayFormatter.format(date);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[dayStr] !== undefined ? dayMap[dayStr] : date.getDay();
  return { current: hour * 60 + minute, day };
}

export function isMotionScheduleActive(camera: MotionSchedule, date = new Date()): boolean {
  if (!camera.motionScheduleEnabled) return true;
  const days = parseDays(camera.motionScheduleDays);
  if (!days.length) return false;
  const start = minutesFromTime(camera.motionScheduleStart, 22 * 60);
  const end = minutesFromTime(camera.motionScheduleEnd, 6 * 60);
  const { current, day } = getLocalTimeInfo(date);
  if (start === end) return days.includes(day);
  if (start < end) return days.includes(day) && current >= start && current < end;
  if (current >= start) return days.includes(day);
  return current < end && days.includes((day + 6) % 7);
}
