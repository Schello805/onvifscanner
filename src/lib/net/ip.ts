function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4) throw new Error("Invalid IPv4");
  for (const p of parts) {
    if (!Number.isInteger(p) || p < 0 || p > 255) throw new Error("Invalid IPv4");
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  ) >>> 0;
}

function intToIpv4(n: number): string {
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  const d = n & 255;
  return `${a}.${b}.${c}.${d}`;
}

export function parseCidr(cidr: string): { baseIp: string; prefix: number } {
  const trimmed = cidr.trim();
  const [ip, prefixStr] = trimmed.split("/");
  if (!ip || prefixStr === undefined) throw new Error("Invalid CIDR");
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error("Invalid CIDR");
  ipv4ToInt(ip); // validate
  return { baseIp: ip, prefix };
}

export function countHostsInCidr(cidr: string): number {
  const { prefix } = parseCidr(cidr);
  if (prefix === 32) return 1;
  const hostBits = 32 - prefix;
  return Math.max(0, Math.pow(2, hostBits) - 2);
}

export function expandCidr(cidr: string): string[] {
  const { baseIp, prefix } = parseCidr(cidr);
  const baseInt = ipv4ToInt(baseIp);
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1) >>> 0) >>> 0;
  const network = (baseInt & mask) >>> 0;
  const broadcast = (network + (Math.pow(2, 32 - prefix) - 1)) >>> 0;

  // For /32, include that single host.
  if (prefix === 32) return [baseIp];

  const firstHost = (network + 1) >>> 0;
  const lastHost = (broadcast - 1) >>> 0;
  const out: string[] = [];
  for (let n = firstHost; n <= lastHost; n = (n + 1) >>> 0) {
    out.push(intToIpv4(n));
  }
  return out;
}

function isInRange(ipInt: number, rangeCidr: string): boolean {
  const { baseIp, prefix } = parseCidr(rangeCidr);
  const baseInt = ipv4ToInt(baseIp);
  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1) >>> 0) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

export function isPrivateOnly(cidr: string): boolean {
  const { baseIp } = parseCidr(cidr);
  const ipInt = ipv4ToInt(baseIp);
  return (
    isInRange(ipInt, "10.0.0.0/8") ||
    isInRange(ipInt, "172.16.0.0/12") ||
    isInRange(ipInt, "192.168.0.0/16") ||
    isInRange(ipInt, "169.254.0.0/16")
  );
}

export function isPrivateIpv4(ip: string): boolean {
  try {
    const ipInt = ipv4ToInt(ip);
    return (
      isInRange(ipInt, "10.0.0.0/8") ||
      isInRange(ipInt, "172.16.0.0/12") ||
      isInRange(ipInt, "192.168.0.0/16") ||
      isInRange(ipInt, "169.254.0.0/16") ||
      isInRange(ipInt, "127.0.0.0/8")
    );
  } catch {
    return false;
  }
}
