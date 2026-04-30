import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const repoUrl =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Schello805/onvifscanner";
const latestPackageUrl =
  process.env.UPDATE_CHECK_PACKAGE_URL ??
  "https://raw.githubusercontent.com/Schello805/onvifscanner/main/package.json";

export async function GET() {
  const currentVersion = pkg.version;

  try {
    const res = await fetch(latestPackageUrl, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "ONVIFscanner/version-check"
      }
    });

    if (!res.ok) {
      return NextResponse.json(
        buildPayload(currentVersion, undefined, `GitHub HTTP ${res.status}`),
        { status: 200 }
      );
    }

    const latest = (await res.json()) as { version?: unknown };
    const latestVersion = typeof latest.version === "string" ? latest.version : undefined;
    return NextResponse.json(buildPayload(currentVersion, latestVersion), {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (e) {
    return NextResponse.json(
      buildPayload(currentVersion, undefined, e instanceof Error ? e.message : "Version check failed"),
      { status: 200 }
    );
  }
}

function buildPayload(currentVersion: string, latestVersion?: string, error?: string) {
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
    repoUrl,
    updateCommand:
      "curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash",
    error
  };
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function normalizeVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
