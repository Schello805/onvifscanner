import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "wall.json");

export async function GET() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const content = await fs.readFile(FILE_PATH, "utf-8");
    return NextResponse.json(JSON.parse(content));
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return NextResponse.json({ cameras: [], columns: null, refresh: null });
    }
    return NextResponse.json({ error: "Failed to read wall data" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to write wall data" }, { status: 500 });
  }
}
