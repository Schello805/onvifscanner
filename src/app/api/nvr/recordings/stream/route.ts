import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get("clipId");
    const download = searchParams.get("download") === "1";

    if (!clipId) {
      return new Response("Clip ID missing", { status: 400 });
    }

    let decodedPath = "";
    try {
      decodedPath = Buffer.from(clipId, "base64url").toString("utf-8");
    } catch {
      return new Response("Invalid clip ID", { status: 400 });
    }

    const resolved = path.resolve(decodedPath);

    // Verify file is within an approved storage target
    const targets = await prisma.storageTarget.findMany();
    const isAllowed = targets.some((t) => resolved.startsWith(path.resolve(t.path)));

    if (!isAllowed) {
      return new Response("Access denied", { status: 403 });
    }

    if (!fs.existsSync(resolved)) {
      return new Response("File not found", { status: 404 });
    }

    const stat = fs.statSync(resolved);
    const fileSize = stat.size;
    const filename = path.basename(resolved);

    // Range header parsing
    const rangeHeader = req.headers.get("range");

    if (rangeHeader && !download) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const nodeStream = fs.createReadStream(resolved, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": "video/mp4",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Full file streaming
    const nodeStream = fs.createReadStream(resolved);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    const headers: Record<string, string> = {
      "Content-Length": fileSize.toString(),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };

    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    }

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error("GET /api/nvr/recordings/stream error:", error);
    return new Response(error?.message || "Stream error", { status: 500 });
  }
}
