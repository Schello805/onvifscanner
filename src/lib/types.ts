export type ScanTargetPreset = "ws-discovery" | "cidr";

export type Credentials = {
  username: string;
  password: string;
};

export type ScanRequest = {
  preset: ScanTargetPreset;
  cidr?: string;
  ports?: number[];
  credentials?: Credentials;
  timeoutMs?: number;
  concurrency?: number;
  acknowledgeAuthorizedNetwork: boolean;
};

export type OnvifResult = {
  ok: boolean;
  xaddrs?: string[];
  deviceServiceUrl?: string;
  mediaServiceUrl?: string;
  rtspUris?: string[];
  snapshotUris?: string[];
  thumbnailDataUrl?: string;
  deviceInformation?: {
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
    serialNumber?: string;
    hardwareId?: string;
  };
  error?: string;
};

export type RtspResult = {
  ok: boolean;
  port: number;
  authTried?: "none" | "basic" | "digest";
  statusLine?: string;
  error?: string;
};

export type ScanResult = {
  ip: string;
  openTcpPorts?: number[];
  onvif?: OnvifResult;
  rtsp?: RtspResult;
};

export type ScanResponse = {
  meta?: {
    mode: string;
    startedAt: string;
    durationMs: number;
  };
  results: ScanResult[];
  warnings?: string[];
  error?: string;
};
