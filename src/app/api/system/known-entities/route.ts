import { NextResponse } from "next/server";
import {
  loadKnownEntities,
  addKnownEntity,
  updateKnownEntity,
  deleteKnownEntity,
  findKnownEntity,
  EntityCategory,
} from "@/lib/knownEntities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entities = loadKnownEntities();
    return NextResponse.json({
      ok: true,
      entities,
      total: entities.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler beim Laden";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body?.action || "add";

    if (action === "add") {
      const { type, identifier, name, category, notes, notify } = body;
      if (!identifier || !name) {
        return NextResponse.json(
          { error: "Kennzeichen/ID und Name müssen angegeben werden." },
          { status: 400 }
        );
      }
      const created = addKnownEntity({
        type: type || "plate",
        identifier,
        name,
        category: (category as EntityCategory) || "family",
        notes: notes || "",
        notify: notify ?? true,
      });
      return NextResponse.json({ ok: true, entity: created });
    }

    if (action === "update") {
      const { id, updates } = body;
      if (!id || !updates) {
        return NextResponse.json({ error: "ID und Updates fehlen." }, { status: 400 });
      }
      const updated = updateKnownEntity(id, updates);
      if (!updated) {
        return NextResponse.json({ error: "Eintrag nicht gefunden." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, entity: updated });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) {
        return NextResponse.json({ error: "ID fehlt." }, { status: 400 });
      }
      const success = deleteKnownEntity(id);
      return NextResponse.json({ ok: true, deleted: success });
    }

    if (action === "match") {
      const { identifier, type } = body;
      const matched = findKnownEntity(identifier, type || "plate");
      return NextResponse.json({ ok: true, matched });
    }

    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler bei der Anfrage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
