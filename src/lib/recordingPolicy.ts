import { isMotionScheduleActive } from "@/lib/motionSchedule";

export const RECORDING_MODES = [
  "off",
  "motion",
  "continuous",
  "scheduled_motion",
  "scheduled_continuous",
  "scheduled_motion_else_continuous",
  "scheduled_continuous_else_motion",
] as const;

export type RecordingMode = typeof RECORDING_MODES[number];
export type EffectiveRecordingMode = "off" | "motion" | "continuous";

export const RECORDING_MODE_OPTIONS: Array<{ value: RecordingMode; label: string; description: string }> = [
  { value: "off", label: "Aus", description: "Es wird nichts aufgezeichnet." },
  { value: "motion", label: "Nur Bewegung – immer", description: "Rund um die Uhr nur erkannte Bewegungen speichern." },
  { value: "continuous", label: "Daueraufnahme – immer", description: "Rund um die Uhr ohne Unterbrechung aufzeichnen." },
  { value: "scheduled_motion", label: "Nur Bewegung – im Zeitfenster", description: "Im Zeitfenster Bewegungen speichern, außerhalb nichts." },
  { value: "scheduled_continuous", label: "Daueraufnahme – im Zeitfenster", description: "Im Zeitfenster dauerhaft aufzeichnen, außerhalb nichts." },
  { value: "scheduled_motion_else_continuous", label: "Im Zeitfenster Bewegung, sonst dauerhaft", description: "Im Zeitfenster Speicher sparen, außerhalb lückenlos aufzeichnen." },
  { value: "scheduled_continuous_else_motion", label: "Im Zeitfenster dauerhaft, sonst Bewegung", description: "Im Zeitfenster lückenlos aufzeichnen, außerhalb nur Bewegungen." },
];

export function recordingModeLabel(mode: string | null | undefined): string {
  return RECORDING_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Aus";
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
  if (RECORDING_MODES.includes(mode as RecordingMode)) {
    if (camera.motionScheduleEnabled && mode === "motion") return "scheduled_motion";
    return mode as RecordingMode;
  }
  return camera.recordEnabled ? "motion" : "off";
}

export function recordingModeUsesSchedule(mode: string | null | undefined): boolean {
  return String(mode || "").startsWith("scheduled_");
}

export function recordingModeUsesMotion(mode: string | null | undefined): boolean {
  return normalizeRecordingMode({ recordMode: mode }).includes("motion");
}

export function recordingModeUsesContinuous(mode: string | null | undefined): boolean {
  return normalizeRecordingMode({ recordMode: mode }).includes("continuous");
}

export function effectiveRecordingMode(camera: RecordingPolicyCamera, date = new Date()): EffectiveRecordingMode {
  const mode = normalizeRecordingMode(camera);
  if (mode === "off" || mode === "motion" || mode === "continuous") return mode;
  const inSchedule = isMotionScheduleActive({ ...camera, motionScheduleEnabled: true }, date);
  if (mode === "scheduled_motion") return inSchedule ? "motion" : "off";
  if (mode === "scheduled_continuous") return inSchedule ? "continuous" : "off";
  if (mode === "scheduled_motion_else_continuous") return inSchedule ? "motion" : "continuous";
  return inSchedule ? "continuous" : "motion";
}
