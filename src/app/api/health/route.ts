import pkg from "../../../../package.json";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(
    {
      ok: true,
      name: pkg.name,
      version: pkg.version,
      time: new Date().toISOString()
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" }
    }
  );
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}

