import { NextResponse } from "next/server";
import {
  getVapidPublicKey,
  loadSubscriptions,
  addSubscription,
  removeSubscription,
  sendWebPushNotification,
} from "@/lib/webpush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vapidPublicKey = getVapidPublicKey();
    const subs = loadSubscriptions();
    return NextResponse.json({
      vapidPublicKey,
      activeCount: subs.length,
      subscriptions: subs.map((s) => ({
        endpoint: s.endpoint,
        userAgent: s.userAgent,
        subscribedAt: s.subscribedAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler beim Laden der Push-Konfiguration";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "subscribe") {
      const { subscription, userAgent } = body;
      if (!subscription?.endpoint || !subscription?.keys) {
        return NextResponse.json(
          { error: "Ungültiges Subscription-Objekt (endpoint oder keys fehlen)." },
          { status: 400 }
        );
      }
      const res = addSubscription(subscription, userAgent || req.headers.get("user-agent") || "");
      return NextResponse.json({ ok: true, activeCount: res.total });
    }

    if (action === "unsubscribe") {
      const { endpoint } = body;
      if (!endpoint) {
        return NextResponse.json({ error: "Endpoint fehlt." }, { status: 400 });
      }
      const removed = removeSubscription(endpoint);
      return NextResponse.json({ ok: true, removed });
    }

    if (action === "test") {
      const res = await sendWebPushNotification({
        title: "✅ ONVIFscanner Web-Push Test",
        body: "Die Browser-Push-Benachrichtigungen funktionieren auf diesem Gerät einwandfrei!",
        url: "/",
        tag: "test-notification",
      });
      return NextResponse.json({
        ok: true,
        sentCount: res.sentCount,
        failedCount: res.failedCount,
        total: res.total,
      });
    }

    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fehler bei der Push-Anfrage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
