export type ScanTargetPreset = "auto" | "ws-discovery" | "cidr";

export type Credentials = {
  username: string;
  password: string;
};

export type CameraResolution = {
  width: number;
  height: number;
  label?: string;
  encoding?: string;
  fps?: number;
};

export type OnvifUri = {
  profileToken?: string;
  profileName?: string;
  uri: string;
  resolution?: string;
  width?: number;
  height?: number;
  encoding?: string;
  fps?: number;
};

export type ScanRequest = {
  preset: ScanTargetPreset;
  cidr?: string;
  ports?: number[];
  credentials?: Credentials;
  credentialsList?: Credentials[];
  timeoutMs?: number;
  concurrency?: number;
  deepProbe?: boolean;
  includeThumbnails?: boolean;
  acknowledgeAuthorizedNetwork: boolean;
};

export type OnvifResult = {
  ok: boolean;
  discoveryOnly?: boolean;
  xaddrs?: string[];
  deviceServiceUrl?: string;
  mediaServiceUrl?: string;
  mediaServiceUrl2?: string;
  ptzServiceUrl?: string;
  ptz?: boolean;
  rtspUris?: OnvifUri[];
  snapshotUris?: OnvifUri[];
  log?: string[];
  deviceInformation?: {
    manufacturer?: string;
    model?: string;
    hostname?: string;
    firmwareVersion?: string;
    serialNumber?: string;
    hardwareId?: string;
  };
  error?: string;
};

export type RtspResult = {
  ok: boolean;
  discoveryOnly?: boolean;
  port: number;
  uriTried?: string;
  uris?: string[];
  candidates?: string[];
  log?: string[];
  authTried?: "none" | "basic" | "digest";
  statusLine?: string;
  error?: string;
};

export type VendorUrlResult = {
  profile: string;
  deviceInformation?: {
    manufacturer?: string;
    model?: string;
    hostname?: string;
  };
  rtspUris?: string[];
  httpStreamUris?: string[];
  snapshotUris?: string[];
  log?: string[];
};

export type ScanResult = {
  ip: string;
  mac?: string;
  hostname?: string;
  manufacturer?: string;
  model?: string;
  resolutions?: CameraResolution[];
  primaryResolution?: string;
  streamUris?: string[];
  snapshotUris?: string[];
  openTcpPorts?: number[];
  ptz?: boolean;
  onvif?: OnvifResult;
  rtsp?: RtspResult;
  vendor?: VendorUrlResult;
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
