export function sanitizeUrlString(input: string): string {
  let s = input.trim();

  // Common XML entity leakage from SOAP values.
  s = s.replaceAll("&amp;", "&");

  // Fix duplicated ports like http://ip:8080:8080/path
  // Keep the first port when duplicated.
  s = s.replace(/^(https?:\/\/[^\/:]+):(\d+):(\d+)(\/|$)/i, (_m, host, p1, p2, rest) => {
    if (p1 === p2) return `${host}:${p1}${rest}`;
    return `${host}:${p1}${rest}`;
  });

  return s;
}

