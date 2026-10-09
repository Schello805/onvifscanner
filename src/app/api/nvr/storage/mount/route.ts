import { NextResponse } from "next/server";
import { mountNetworkShare, testStoragePath } from "@/lib/nvr/storage";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      type,
      server,
      share,
      mountpoint,
      username,
      password,
      domain,
      persist = true,
      name,
      isDefault = false,
      maxDays = 14,
      minFreeSpaceGb = 10,
    } = body;

    if (!type || !["cifs", "nfs"].includes(type)) {
      return NextResponse.json({ ok: false, error: "Ungültiger Freigabetyp ('cifs' oder 'nfs')." }, { status: 400 });
    }

    if (!server || !share || !mountpoint) {
      return NextResponse.json({ ok: false, error: "Server, Freigabename und Mountpunkt sind erforderlich." }, { status: 400 });
    }

    // 1. Mount network share
    const mountResult = await mountNetworkShare({
      type,
      server: server.trim(),
      share: share.trim(),
      mountpoint: mountpoint.trim(),
      username: username ? username.trim() : undefined,
      password: password ? password : undefined,
      domain: domain ? domain.trim() : undefined,
      persist: Boolean(persist),
    });

    if (!mountResult.ok) {
      return NextResponse.json({ ok: false, error: mountResult.error || mountResult.message }, { status: 400 });
    }

    // 2. Test write permission on the mount
    const testResult = await testStoragePath(mountpoint.trim(), false);

    // 3. Save as StorageTarget in database
    const targetName = name?.trim() || `${type.toUpperCase()}: ${server}/${share}`;

    if (isDefault) {
      await prisma.storageTarget.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const createdTarget = await prisma.storageTarget.create({
      data: {
        name: targetName,
        path: mountpoint.trim(),
        isDefault: Boolean(isDefault),
        enabled: true,
        maxDays: Number(maxDays) || 14,
        minFreeSpaceGb: Number(minFreeSpaceGb) || 10,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `${type.toUpperCase()}-Freigabe '${targetName}' erfolgreich eingehängt und als NVR-Speicherziel eingerichtet!`,
      target: createdTarget,
      stats: testResult,
    });
  } catch (error: any) {
    console.error("API Error POST /api/nvr/storage/mount", error);
    return NextResponse.json({ ok: false, error: error?.message || "Fehler beim Einhängen der Freigabe." }, { status: 500 });
  }
}
