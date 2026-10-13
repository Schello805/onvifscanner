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

export function isMotionScheduleActive(camera: MotionSchedule, date = new Date()): boolean {
  if (!camera.motionScheduleEnabled) return true;
  const days = parseDays(camera.motionScheduleDays);
  if (!days.length) return false;
  const start = minutesFromTime(camera.motionScheduleStart, 22 * 60);
  const end = minutesFromTime(camera.motionScheduleEnd, 6 * 60);
  const current = date.getHours() * 60 + date.getMinutes();
  if (start === end) return days.includes(date.getDay());
  if (start < end) return days.includes(date.getDay()) && current >= start && current < end;
  if (current >= start) return days.includes(date.getDay());
  return current < end && days.includes((date.getDay() + 6) % 7);
}
