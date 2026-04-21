export function buildRtspCandidates(args: { ip: string; port: number }): string[] {
  const base = `rtsp://${args.ip}:${args.port}`;
  const common = [
    // Hikvision / Dahua style (very common)
    `${base}/Streaming/Channels/101`,
    `${base}/Streaming/Channels/102`,
    `${base}/cam/realmonitor?channel=1&subtype=0`,
    `${base}/cam/realmonitor?channel=1&subtype=1`,
    // Generic fallbacks
    `${base}/`,
    `${base}/live`,
    `${base}/stream1`,
    `${base}/stream2`,
    `${base}/h264`,
    `${base}/h265`
  ];
  return Array.from(new Set(common));
}
