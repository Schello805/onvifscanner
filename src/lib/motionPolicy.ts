import { isMotionScheduleActive } from "@/lib/motionSchedule";

type MotionPolicyCamera = {
  recordMode?: string | null;
  recordEnabled?: boolean | null;
  notificationsEnabled?: boolean | null;
  motionIgnoreRegions?: string | unknown[] | null;
  objectDetectionEnabled?: boolean | null;
  licensePlateRecognitionEnabled?: boolean | null;
  alarmCooldownSeconds?: number | null;
  motionScheduleEnabled?: boolean;
  motionScheduleStart?: string | null;
  motionScheduleEnd?: string | null;
  motionScheduleDays?: string | number[] | null;
};

function parseIgnoreRegions(value: MotionPolicyCamera["motionIgnoreRegions"]): unknown[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((region) => region && typeof region === "object") : [];
  } catch {
    return [];
  }
}

export function motionMonitoringRequested(camera: MotionPolicyCamera): boolean {
  return camera.recordMode === "motion"
    || camera.recordMode === "continuous"
    || (Boolean(camera.recordEnabled) && camera.recordMode !== "off")
    || Boolean(camera.notificationsEnabled);
}

export function requiresServerMotionValidation(camera: MotionPolicyCamera): boolean {
  return parseIgnoreRegions(camera.motionIgnoreRegions).length > 0
    || Boolean(camera.objectDetectionEnabled)
    || Boolean(camera.licensePlateRecognitionEnabled);
}

export function motionCooldownSeconds(camera: MotionPolicyCamera): number {
  return Math.max(5, Math.min(3600, Number(camera.alarmCooldownSeconds) || 30));
}

export function shouldAcceptExternalMotion(camera: MotionPolicyCamera, date = new Date()): boolean {
  return motionMonitoringRequested(camera)
    && isMotionScheduleActive(camera, date)
    && !requiresServerMotionValidation(camera);
}
