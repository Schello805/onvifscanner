import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_MTX_WEBRTC = process.env.MEDIAMTX_WEBRTC_URL ?? "http://127.0.0.1:8889";

type RouteContext = { params: { path: string[] } };

async function proxy(request: Request, context: RouteContext) {
  const requestUrl = new URL(request.url);
  const suffix = requestUrl.pathname.endsWith("/") ? "/" : "";
  const upstreamUrl = `${MEDIA_MTX_WEBRTC}/${context.params.path.map(encodeURIComponent).join("/")}${suffix}${requestUrl.search}`;
  const headers = new Headers();
  for (const name of ["accept", "authorization", "content-type", "if-match"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual"
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "etag", "link", "accept-patch"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const location = response.headers.get("location");
    if (location) {
      const parsed = new URL(location, MEDIA_MTX_WEBRTC);
      responseHeaders.set("location", `/api/webrtc${parsed.pathname}${parsed.search}`);
    }
    if (request.method === "DELETE" && response.status === 404) {
      return new NextResponse(null, { status: 204 });
    }

    if (!response.ok && response.status >= 400 && response.status !== 404) {
      const cloned = response.clone();
      const text = await cloned.text().catch(() => "");
      if (text) {
        console.warn(`[WebRTC Proxy] Upstream ${request.method} ${upstreamUrl} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    return NextResponse.json(
      { error: `WebRTC-Dienst nicht erreichbar: ${error instanceof Error ? error.message : "unbekannter Fehler"}` },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
