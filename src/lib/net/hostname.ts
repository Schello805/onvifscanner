import dns from "node:dns/promises";

export async function reverseHostname(ip: string, timeoutMs = 450): Promise<string | undefined> {
  try {
    const names = await withTimeout(dns.reverse(ip), timeoutMs);
    return names.find(Boolean);
  } catch {
    return undefined;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("hostname timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
