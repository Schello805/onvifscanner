import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "wall.json");

export async function GET() {
  try {
    const dbCameras = await prisma.camera.findMany({
      include: { status: true },
      orderBy: { savedAt: "asc" }
    });

    const settings = await prisma.settings.findUnique({
      where: { id: "default" }
    });

    if (dbCameras.length === 0) {
      try {
        const content = await fs.readFile(FILE_PATH, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed.cameras && Array.isArray(parsed.cameras) && parsed.cameras.length > 0) {
          for (const cam of parsed.cameras) {
            await prisma.camera.create({
              data: {
                id: cam.id,
                ip: cam.ip,
                name: cam.name,
                hostname: cam.hostname,
                manufacturer: cam.manufacturer,
                model: cam.model,
                snapshotUris: JSON.stringify(cam.snapshotUris || []),
                streamUris: JSON.stringify(cam.streamUris || []),
                username: cam.credentials?.username,
                password: cam.credentials?.password,
                overlayPosition: cam.overlayPosition,
                savedAt: cam.savedAt ? new Date(cam.savedAt) : new Date(),
                status: {
                  create: {
                    isOnline: true
                  }
                }
              }
            });
          }
          await prisma.settings.upsert({
            where: { id: "default" },
            update: { columns: parsed.columns ?? null, refresh: parsed.refresh ?? null },
            create: { id: "default", columns: parsed.columns ?? null, refresh: parsed.refresh ?? null }
          });
          
          return NextResponse.json({
            cameras: parsed.cameras,
            columns: parsed.columns ?? null,
            refresh: parsed.refresh ?? null
          });
        }
      } catch (e) {
        // wall.json migration failed or not found, proceed normally
      }
    }

    const cameras = dbCameras.map(cam => ({
      id: cam.id,
      ip: cam.ip,
      name: cam.name,
      hostname: cam.hostname ?? undefined,
      manufacturer: cam.manufacturer ?? undefined,
      model: cam.model ?? undefined,
      snapshotUris: JSON.parse(cam.snapshotUris),
      streamUris: JSON.parse(cam.streamUris),
      credentials: cam.username ? { username: cam.username, password: cam.password ?? "" } : undefined,
      overlayPosition: cam.overlayPosition ?? undefined,
      savedAt: cam.savedAt.toISOString(),
      status: cam.status ? { isOnline: cam.status.isOnline, lastSeen: cam.status.lastSeen.toISOString() } : undefined
    }));

    return NextResponse.json({ 
      cameras, 
      columns: settings?.columns ?? null, 
      refresh: settings?.refresh ?? null 
    });
  } catch (error: any) {
    console.error("API Error GET /api/wall", error);
    return NextResponse.json({ error: "Failed to read wall data" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // First save settings
    await prisma.settings.upsert({
      where: { id: "default" },
      update: { columns: body.columns ?? null, refresh: body.refresh ?? null },
      create: { id: "default", columns: body.columns ?? null, refresh: body.refresh ?? null }
    });

    // Then save cameras
    if (body.cameras && Array.isArray(body.cameras)) {
      // For simplicity, we'll sync the database to match the incoming list
      // 1. Get existing cameras to avoid losing status
      const existing = await prisma.camera.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map(e => e.id));
      const incomingIds = new Set(body.cameras.map((c: any) => c.id));

      // 2. Delete ones that are no longer in the wall
      const toDelete = Array.from(existingIds).filter(id => !incomingIds.has(id));
      if (toDelete.length > 0) {
        await prisma.camera.deleteMany({
          where: { id: { in: toDelete } }
        });
      }

      // 3. Upsert incoming cameras
      for (const cam of body.cameras) {
        await prisma.camera.upsert({
          where: { id: cam.id },
          update: {
            ip: cam.ip,
            name: cam.name,
            hostname: cam.hostname,
            manufacturer: cam.manufacturer,
            model: cam.model,
            snapshotUris: JSON.stringify(cam.snapshotUris || []),
            streamUris: JSON.stringify(cam.streamUris || []),
            username: cam.credentials?.username,
            password: cam.credentials?.password,
            overlayPosition: cam.overlayPosition,
          },
          create: {
            id: cam.id,
            ip: cam.ip,
            name: cam.name,
            hostname: cam.hostname,
            manufacturer: cam.manufacturer,
            model: cam.model,
            snapshotUris: JSON.stringify(cam.snapshotUris || []),
            streamUris: JSON.stringify(cam.streamUris || []),
            username: cam.credentials?.username,
            password: cam.credentials?.password,
            overlayPosition: cam.overlayPosition,
            savedAt: cam.savedAt ? new Date(cam.savedAt) : new Date(),
            status: {
              create: {
                isOnline: true
              }
            }
          }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API Error POST /api/wall", error);
    return NextResponse.json({ error: "Failed to write wall data" }, { status: 500 });
  }
}
