const crypto = require('node:crypto');
const path = require('node:path');
const net = require('node:net');

function isLegacyRtspSource(uri) {
  try {
    const parsed = new URL(uri);
    return ['rtsp:', 'rtsps:'].includes(parsed.protocol)
      && /^\/user=[^/]+(?:_|&)password=[^/]*(?:_|&)channel=\d+(?:_|&)stream=\d+\.sdp$/i.test(parsed.pathname);
  } catch { return false; }
}

function sourceFingerprint(uri, camera) {
  return crypto.createHash('sha256').update(JSON.stringify([uri, camera.username ?? null, camera.password ?? null])).digest('hex');
}

function quoteArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function mediaSourceConfig({ camera, uri, source = uri, alwaysOn = false, directory = process.cwd() }) {
  const config = {
    source,
    sourceOnDemand: !alwaysOn,
    sourceOnDemandCloseAfter: '30s',
    rtspTransport: 'tcp',
    runOnInit: '',
    runOnInitRestart: false,
    runOnDemand: '',
    runOnDemandRestart: false,
  };
  if (!isLegacyRtspSource(uri)) return config;
  const command = [
    '/bin/bash',
    path.join(directory, 'scripts', 'legacy-rtsp-relay.sh'),
    process.execPath,
    Buffer.from(camera.id).toString('base64url'),
    sourceFingerprint(uri, camera),
  ].map(quoteArgument).join(' ');
  return {
    ...config,
    source: 'publisher',
    sourceOnDemand: false,
    runOnInit: alwaysOn ? command : '',
    runOnInitRestart: alwaysOn,
    runOnDemand: alwaysOn ? '' : command,
    runOnDemandRestart: !alwaysOn,
    runOnDemandStartTimeout: '20s',
    runOnDemandCloseAfter: '30s',
  };
}

async function internalRtspEnvironment() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return {
    ...process.env,
    MTX_RTSP: 'yes',
    MTX_RTSPADDRESS: `127.0.0.1:${port}`,
    MTX_PROTOCOLS: 'tcp',
    MTX_ENCRYPTION: 'no',
  };
}

function relayArguments(source, destination) {
  const parsed = new URL(source);
  if (!['rtsp:', 'rtsps:'].includes(parsed.protocol)) throw new Error('Ungültige RTSP-Quelle');
  const output = new URL(destination);
  if (output.protocol !== 'rtsp:' || output.hostname !== '127.0.0.1') throw new Error('Relay-Ziel muss lokales RTSP sein');
  return [
    '-hide_banner', '-loglevel', 'quiet', '-nostdin',
    '-rtsp_transport', 'tcp', '-timeout', '8000000',
    '-analyzeduration', '2000000', '-probesize', '2000000', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', destination,
  ];
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const { decryptSecret } = require('./security');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'data', 'onvifscanner.db')}` } } });
  try {
    const cameraId = Buffer.from(process.argv[2] || '', 'base64url').toString('utf8');
    const fingerprint = process.argv[3];
    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) throw new Error('Kamera nicht mehr vorhanden');
    const uris = JSON.parse(camera.streamUris);
    const uri = Array.isArray(uris) && uris.find(candidate => typeof candidate === 'string'
      && isLegacyRtspSource(candidate) && sourceFingerprint(candidate, camera) === fingerprint);
    if (!uri) throw new Error('Stream-Konfiguration wurde geändert; nächste Synchronisierung abwarten');
    const parsed = new URL(uri);
    if (camera.username) {
      parsed.username = camera.username;
      const password = decryptSecret(camera.password);
      if (password) parsed.password = password;
    }
    const port = Number(process.env.RTSP_PORT);
    const streamPath = process.env.MTX_PATH;
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !streamPath) throw new Error('Lokales Relay-Ziel fehlt');
    const destination = `rtsp://127.0.0.1:${port}/${streamPath.split('/').map(encodeURIComponent).join('/')}`;
    const args = ['ffmpeg', ...relayArguments(parsed.toString(), destination)];
    await prisma.$disconnect();
    process.stdout.write(args.map(argument => `${argument}\0`).join(''));
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('[Legacy RTSP] Kamera/Stream-Konfiguration konnte nicht geladen werden. Zugangsdaten und URL in der Kamera-Bearbeitung prüfen.');
    process.exitCode = 1;
  });
}

module.exports = { isLegacyRtspSource, sourceFingerprint, mediaSourceConfig, internalRtspEnvironment, relayArguments };
