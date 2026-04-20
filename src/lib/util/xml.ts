export function extractText(xml: string, tagName: string): string | undefined {
  // Matches <ns:Tag>value</ns:Tag> and <Tag>value</Tag>
  const re = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(tagName)}\\b[^>]*>([^<]*)</(?:[A-Za-z0-9_]+:)?${escapeRegExp(
      tagName
    )}>`,
    "i"
  );
  const m = re.exec(xml);
  const value = m?.[1]?.trim();
  if (!value) return undefined;
  return decodeXmlEntities(value);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeXmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
