export type CameraRankingItem = {
  cameraId: string;
  cameraName: string;
  cameraIp: string;
  recordEnabled: boolean;
  count: number;
  percentage: number;
  lastEventAt: string | null;
  hourly: number[];
  peakHour: string | null;
  isHighActivity: boolean;
};

export type ActivityStatsResponse = {
  ok: boolean;
  period: string;
  totalEvents: number;
  activeCamerasCount: number;
  totalCamerasCount: number;
  peakHour: string | null;
  peakHourCount: number;
  overallHourly: number[];
  ranking: CameraRankingItem[];
};

export type CameraSimple = {
  id: string;
  name: string;
  ip: string;
  recordEnabled?: boolean;
  recordSegmentMinutes?: number;
};

export type RecordingClip = {
  id: string;
  cameraId: string;
  cameraName: string;
  filename: string;
  dateStr: string;
  timeStr: string;
  timestamp: string;
  sizeBytes: number;
  storageTargetName: string;
  streamUrl: string;
  downloadUrl: string;
};

export type RecordingCalendarDay = {
  date: string;
  count: number;
  cameras: Array<{ id: string; name: string; count: number }>;
};

export type ClipSortBy =
  | "newest"
  | "oldest"
  | "camera-asc"
  | "camera-desc"
  | "motion-most"
  | "motion-least"
  | "largest"
  | "smallest"
  | "storage-asc"
  | "storage-desc"
  | "filename-asc"
  | "filename-desc";

export type ClipSizeFilter = "all" | "under-25" | "25-100" | "100-500" | "over-500";

export const TIMELINE_WINDOWS = [
  { minutes: 1440, label: "24h" },
  { minutes: 720, label: "12h" },
  { minutes: 360, label: "6h" },
  { minutes: 120, label: "2h" },
  { minutes: 60, label: "1h" },
  { minutes: 30, label: "30m" },
  { minutes: 15, label: "15m" },
  { minutes: 5, label: "5m" },
] as const;

export type TimelineWindowMinutes = (typeof TIMELINE_WINDOWS)[number]["minutes"];

export const cameraNameCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export const objectClassLabels: Record<string, string> = {
  person: "Person",
  bicycle: "Fahrrad",
  car: "Auto",
  motorcycle: "Motorrad",
  bus: "Bus",
  truck: "Lkw",
  train: "Zug",
  boat: "Boot",
  bird: "Vogel",
  cat: "Katze",
  dog: "Hund",
  horse: "Pferd",
};

export type MotionEvent = {
  id: string;
  cameraId: string;
  cameraName: string;
  timestamp: string;
  dateStr?: string;
  timeStr: string;
  totalMinutes: number;
  message: string;
  objectClasses?: string[];
  objectDetections?: Array<{ className?: string; group?: string; score?: number }>;
  motionRecordingId?: string | null;
  motionRecordingStatus?: string | null;
  motionRecordingError?: string | null;
  clipId?: string | null;
  streamUrl?: string | null;
};

export type DailySummary = {
  totalEvents: number;
  counts: { person: number; vehicle: number; animal: number; unclassified: number };
  cameras: Array<{ cameraId: string; cameraName: string; events: number; objects: number }>;
  firstEventAt: string | null;
  lastEventAt: string | null;
};

export type ClipMotionEvent = {
  id: string;
  timeStr: string;
  offsetSec: number;
  message: string;
  pct: number;
};
