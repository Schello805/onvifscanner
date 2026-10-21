import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

export type SharedLink = {
  token: string;
  clipId: string;
  filePath: string;
  cameraName: string;
  createdAt: string;
  expiresAt: string;
  hasOverlay: boolean;
};

const DATA_DIR = path.join(process.cwd(), "data");
const SHARE_FILE = path.join(DATA_DIR, "shared-links.json");

async function loadLinks(): Promise<Record<string, SharedLink>> {
  try {
    if (!fs.existsSync(SHARE_FILE)) return {};
    const raw = await fsp.readFile(SHARE_FILE, "utf8");
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

async function saveLinks(links: Record<string, SharedLink>): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      await fsp.mkdir(DATA_DIR, { recursive: true });
    }
    await fsp.writeFile(SHARE_FILE, JSON.stringify(links, null, 2), "utf8");
  } catch (err) {
    console.warn("Failed to save shared links:", err);
  }
}

export async function createShareLink(params: {
  clipId: string;
  filePath: string;
  cameraName: string;
  expiresHours?: number;
  hasOverlay?: boolean;
}): Promise<SharedLink> {
  const links = await loadLinks();
  const token = crypto.randomBytes(18).toString("base64url");
  const hours = Math.max(1, Math.min(168, params.expiresHours || 48)); // default 48h, max 7 days
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

  const link: SharedLink = {
    token,
    clipId: params.clipId,
    filePath: params.filePath,
    cameraName: params.cameraName,
    createdAt: now.toISOString(),
    expiresAt,
    hasOverlay: Boolean(params.hasOverlay),
  };

  links[token] = link;
  await saveLinks(links);
  return link;
}

export async function getValidShareLink(token: string): Promise<SharedLink | null> {
  if (!token || typeof token !== "string") return null;
  const links = await loadLinks();
  const item = links[token];
  if (!item) return null;

  // Check expiration
  if (new Date(item.expiresAt).getTime() < Date.now()) {
    delete links[token];
    void saveLinks(links);
    return null;
  }

  // Check if file still exists on disk
  if (!fs.existsSync(item.filePath)) {
    return null;
  }

  return item;
}
