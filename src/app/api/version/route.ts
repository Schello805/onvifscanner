import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const repoUrl =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Schello805/onvifscanner";
const latestPackageUrl =
  process.env.UPDATE_CHECK_PACKAGE_URL ??
  "https://raw.githubusercontent.com/Schello805/onvifscanner/main/package.json";

async function fetchAvailableTags(): Promise<string[]> {
  try {
    const res = await fetch("https://api.github.com/repos/Schello805/onvifscanner/tags?per_page=15", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      headers: {
        accept: "application/vnd.github.v3+json",
        "user-agent": "ONVIFscanner/version-check",
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        const remoteTags = data.map((item: { name?: unknown }) => String(item.name || "")).filter(Boolean);
        if (remoteTags.length > 0) return remoteTags;
      }
    }
  } catch {
    // Ignore GitHub API failures / rate-limiting
  }

  // Fallback: read local git tags
  try {
    const { execSync } = await import("child_process");
    const output = execSync("git tag -l --sort=-v:refname", {
      encoding: "utf8",
      timeout: 1500,
    });
    return output.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 15);
  } catch {
    return [];
  }
}

export async function GET() {
  const currentVersion = pkg.version;
  const availableVersions = await fetchAvailableTags();

  try {
    const url = new URL(latestPackageUrl);
    url.searchParams.set("ts", Date.now().toString());
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
      headers: {
        accept: "application/json",
        "user-agent": "ONVIFscanner/version-check",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        buildPayload(currentVersion, undefined, availableVersions, `GitHub HTTP ${res.status}`),
        { status: 200, headers: noCacheHeaders() }
      );
    }

    const latest = (await res.json()) as { version?: unknown };
    const latestVersion = typeof latest.version === "string" ? latest.version : undefined;
    return NextResponse.json(buildPayload(currentVersion, latestVersion, availableVersions), {
      status: 200,
      headers: noCacheHeaders(),
    });
  } catch (e) {
    return NextResponse.json(
      buildPayload(
        currentVersion,
        undefined,
        availableVersions,
        e instanceof Error ? e.message : "Version check failed"
      ),
      { status: 200, headers: noCacheHeaders() }
    );
  }
}

function noCacheHeaders() {
  return {
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    pragma: "no-cache",
    expires: "0",
  };
}

function buildPayload(
  currentVersion: string,
  latestVersion?: string,
  availableVersions: string[] = [],
  error?: string
) {
  return {
    currentVersion,
    latestVersion,
    availableVersions,
    updateAvailable: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
    repoUrl,
    updateCommand:
      "curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash",
    error,
    checkedAt: new Date().toISOString(),
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
