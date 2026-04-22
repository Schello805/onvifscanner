import type { ScanRequest } from "@/lib/types";
import { clampInt } from "@/lib/util/number";
import { countHostsInCidr, isPrivateOnly } from "@/lib/net/ip";

const DEFAULT_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS ?? "1200");
const DEFAULT_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? "128");
const MAX_HOSTS = Number(process.env.SCAN_MAX_HOSTS ?? "4096");
const ALLOW_PUBLIC_SCAN = (process.env.ALLOW_PUBLIC_SCAN ?? "false") === "true";

export type ParsedScanRequest = Required<
  Pick<ScanRequest, "preset" | "acknowledgeAuthorizedNetwork">
> & {
  cidr?: string;
  ports?: number[];
  credentials?: ScanRequest["credentials"];
  timeoutMs: number;
  concurrency: number;
  deepProbe: boolean;
  includeThumbnails: boolean;
};

export function parseScanRequest(input: unknown): ParsedScanRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Ungültiger Request-Body.");
  }
  const body = input as Partial<ScanRequest>;

  if (!body.acknowledgeAuthorizedNetwork) {
    throw new Error("Bitte bestätige, dass du im autorisierten Netzwerk scannst.");
  }

  const preset = body.preset;
  if (preset !== "ws-discovery" && preset !== "cidr") {
    throw new Error("Ungültiger Scan-Modus.");
  }

  const timeoutMs = clampInt(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, 200, 10000);
  const concurrency = clampInt(
    body.concurrency ?? DEFAULT_CONCURRENCY,
    1,
    1024
  );
  const deepProbe =
    typeof body.deepProbe === "boolean" ? body.deepProbe : true;
  const includeThumbnails = Boolean(body.includeThumbnails);

  if (preset === "ws-discovery") {
    return {
      preset,
      timeoutMs,
      concurrency,
      deepProbe,
      includeThumbnails,
      acknowledgeAuthorizedNetwork: true,
      credentials: sanitizeCredentials(body.credentials)
    };
  }

  const cidr = typeof body.cidr === "string" ? body.cidr.trim() : "";
  if (!cidr) throw new Error("CIDR fehlt.");

  if (!ALLOW_PUBLIC_SCAN) {
    if (!isPrivateOnly(cidr)) {
      throw new Error(
        "CIDR-Scan ist standardmäßig nur für private IP-Ranges erlaubt. Setze ALLOW_PUBLIC_SCAN=true, wenn du das wirklich willst."
      );
    }
  }

  const ports = Array.isArray(body.ports) ? body.ports : [];
  const cleanPorts = Array.from(
    new Set(
      ports
        .filter((p) => Number.isInteger(p))
        .map((p) => Number(p))
        .filter((p) => p > 0 && p <= 65535)
    )
  ).slice(0, 64);
  if (!cleanPorts.length) throw new Error("Bitte Ports angeben.");

  const hostCount = countHostsInCidr(cidr);
  if (hostCount > MAX_HOSTS) {
    throw new Error(
      `Zu viele Hosts (${hostCount}). Limit ist ${MAX_HOSTS}. Passe SCAN_MAX_HOSTS an.`
    );
  }

  return {
    preset,
    cidr,
    ports: cleanPorts,
    timeoutMs,
    concurrency,
    deepProbe,
    includeThumbnails,
    acknowledgeAuthorizedNetwork: true,
    credentials: sanitizeCredentials(body.credentials)
  };
}

function sanitizeCredentials(
  credentials: ScanRequest["credentials"]
): ScanRequest["credentials"] | undefined {
  if (!credentials) return undefined;
  if (typeof credentials !== "object") return undefined;
  const c = credentials as { username?: unknown; password?: unknown };
  const username = typeof c.username === "string" ? c.username.trim() : "";
  const password = typeof c.password === "string" ? c.password : "";
  if (!username && !password) return undefined;
  if (!username) return undefined;
  return { username, password };
}
