import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: "default" },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to load settings:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Only update fields that exist in schema
    const updateData: any = {};
    if (body.ntfyTopic !== undefined) updateData.ntfyTopic = body.ntfyTopic || null;
    if (body.ntfyServer !== undefined) updateData.ntfyServer = body.ntfyServer || null;
    if (body.columns !== undefined) updateData.columns = body.columns;
    if (body.autoCleanup !== undefined) updateData.autoCleanup = body.autoCleanup;

    const settings = await prisma.settings.upsert({
      where: { id: "default" },
      update: updateData,
      create: { id: "default", ...updateData },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
