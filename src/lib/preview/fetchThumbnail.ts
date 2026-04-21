import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { sanitizeUrlString } from "@/lib/util/url";

export async function fetchThumbnailDataUrl(args: {
  url: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<string | undefined> {
  // Avoid huge payloads in API responses.
  const maxBytes = 900_000;

  let res: Response;
  try {
    res = await fetchWithDigestAuth({
      url: sanitizeUrlString(args.url),
      method: "GET",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      headers: {
        accept: "image/*",
        "user-agent": "ONVIFscanner/0.1"
      }
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;

  const rawContentType = res.headers.get("content-type") ?? "";
  let contentType = rawContentType.toLowerCase().trim();
  if (contentType === "" || contentType.includes("application/octet-stream")) {
    contentType = "image/jpeg";
  } else if (!contentType.startsWith("image/")) {
    return undefined; // Real failure
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > maxBytes) {
    return undefined;
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength <= 0 || ab.byteLength > maxBytes) return undefined;

  const b64 = Buffer.from(ab).toString("base64");
  return `data:${contentType.split(";")[0]};base64,${b64}`;
}
