export function buildRtspCandidates(args: { ip: string; port: number }): string[] {
  const base = `rtsp://${args.ip}:${args.port}`;
  const common = [
    `${base}/`,
    `${base}/live`,
    `${base}/h264`,
    `${base}/h265`,
    `${base}/stream1`,
    `${base}/stream2`,
    `${base}/Streaming/Channels/101`,
    `${base}/Streaming/Channels/102`,
    `${base}/cam/realmonitor?channel=1&subtype=0`,
    `${base}/cam/realmonitor?channel=1&subtype=1`
  ];
  return Array.from(new Set(common));
}

