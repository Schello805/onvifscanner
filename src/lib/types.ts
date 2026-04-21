export type ScanTargetPreset = "ws-discovery" | "cidr";

export type Credentials = {
  username: string;
  password: string;
};

export type OnvifUri = {
  profileToken?: string;
  profileName?: string;
  uri: string;
};

export type ScanRequest = {
  preset: ScanTargetPreset;
  cidr?: string;
  ports?: number[];
  credentials?: Credentials;
  timeoutMs?: number;
  concurrency?: number;
  includeThumbnails?: boolean;
  acknowledgeAuthorizedNetwork: boolean;
};

export type OnvifResult = {
  ok: boolean;
  xaddrs?: string[];
  deviceServiceUrl?: string;
  mediaServiceUrl?: string;
  mediaServiceUrl2?: string;
  rtspUris?: OnvifUri[];
  snapshotUris?: OnvifUri[];
  thumbnailDataUrl?: string;
  log?: string[];
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
  uriTried?: string;
  uris?: string[];
  candidates?: string[];
  log?: string[];
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
