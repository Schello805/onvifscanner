import { isMotionScheduleActive } from "@/lib/motionSchedule";

export const RECORDING_MODES = [
  "off",
  "continuous",
  "scheduled_continuous",
  "motion",
  "scheduled_motion",
  "scheduled_motion_else_continuous",
  "scheduled_continuous_else_motion",
] as const;

export type RecordingMode = typeof RECORDING_MODES[number];
export type EffectiveRecordingMode = "off" | "continuous";

export const RECORDING_MODE_OPTIONS: Array<{ value: RecordingMode; label: string; description: string }> = [
  { value: "continuous", label: "Daueraufnahme – 24/7", description: "Rund um die Uhr ohne Unterbrechung lückenlos aufzeichnen." },
  { value: "scheduled_continuous", label: "Daueraufnahme – im Zeitplan", description: "Im Zeitfenster dauerhaft aufzeichnen, außerhalb pausieren." },
  { value: "off", label: "Aus", description: "Es wird nichts aufgezeichnet." },
];

export function recordingModeLabel(mode: string | null | undefined): string {
  if (mode === "off") return "Aus";
  if (mode === "scheduled_continuous") return "Daueraufnahme (Zeitplan)";
  return "Daueraufnahme (24/7)";
}

type RecordingPolicyCamera = {
  recordMode?: string | null;
  recordEnabled?: boolean | null;
  motionScheduleEnabled?: boolean;
  motionScheduleStart?: string | null;
  motionScheduleEnd?: string | null;
  motionScheduleDays?: string | number[] | null;
};

export function normalizeRecordingMode(camera: RecordingPolicyCamera): RecordingMode {
  const mode = String(camera.recordMode || "");
  if (mode === "off") return "off";
  if (mode === "scheduled_continuous" || (camera.motionScheduleEnabled && mode.startsWith("scheduled_"))) {
    return "scheduled_continuous";
  }
  if (mode === "continuous" || mode === "motion" || camera.recordEnabled) return "continuous";
  return "off";
}

export function recordingModeUsesSchedule(mode: string | null | undefined): boolean {
  return mode === "scheduled_continuous";
}

export function recordingModeUsesMotion(_mode: string | null | undefined): boolean {
  return false;
}

export function recordingModeUsesContinuous(mode: string | null | undefined): boolean {
  return mode !== "off";
}

export function effectiveRecordingMode(camera: RecordingPolicyCamera, date = new Date()): EffectiveRecordingMode {
  const mode = normalizeRecordingMode(camera);
  if (mode === "off") return "off";
  if (mode === "scheduled_continuous") {
    const inSchedule = isMotionScheduleActive({ ...camera, motionScheduleEnabled: true }, date);
    return inSchedule ? "continuous" : "off";
  }
  return "continuous";
}
