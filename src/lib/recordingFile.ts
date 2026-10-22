import path from "path";
import { prisma } from "@/lib/db";

export async function recordingFile(clipId: string): Promise<string> {
  const resolved = path.resolve(Buffer.from(clipId, "base64url").toString("utf8"));
  const targets = await prisma.storageTarget.findMany();
  const directories = [
    ...targets.map((target) => path.resolve(target.path)),
    path.resolve("data/recordings"), path.resolve("data/motion-buffer"), path.resolve("data/motion-staging"),
    path.resolve(process.env.PLAYBACK_CACHE_DIR || "data/playback-cache"),
  ];
  const allowed = directories.some((directory) => {
    const relative = path.relative(directory, resolved);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (!allowed && !await prisma.motionRecording.findFirst({ where: { filePath: resolved }, select: { id: true } })) {
    throw new Error("Access denied");
  }
  return resolved;
}
