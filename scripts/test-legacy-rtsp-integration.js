const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { mediaSourceConfig, internalRtspEnvironment } = require('./legacy-rtsp-source');
const { RECORDING_COMPLETE_COMMAND } = require('./motion-recorder');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Legacy-RTSP-Test hat das Zeitlimit überschritten.');
}

function forwardMessages(input, output, transform) {
  let pending = Buffer.alloc(0);
  input.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length) {
      if (pending[0] === 36) {
        if (pending.length < 4) return;
        const size = pending.readUInt16BE(2) + 4;
        if (pending.length < size) return;
        output.write(pending.subarray(0, size));
        pending = pending.subarray(size);
        continue;
      }
      const boundary = pending.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const header = pending.subarray(0, boundary + 4).toString();
      const size = boundary + 4 + Number(header.match(/Content-Length:\s*(\d+)/i)?.[1] || 0);
      if (pending.length < size) return;
      output.write(Buffer.concat([Buffer.from(transform(header)), pending.subarray(boundary + 4, size)]));
      pending = pending.subarray(size);
    }
  });
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "onvif legacy 'test' "));
  const databaseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-legacy-db-'));
  const root = process.cwd();
  const apiPort = await freePort();
  const upstreamApiPort = await freePort();
  const upstreamPort = await freePort();
  const sockets = new Set();
  const processes = [];
  const closed = new Map();
  let log = '';
  const launch = (command, args, options = {}) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    processes.push(child);
    closed.set(child, new Promise(resolve => child.once('close', resolve)));
    child.stdout.on('data', chunk => { log = (log + chunk).slice(-60_000); });
    child.stderr.on('data', chunk => { log = (log + chunk).slice(-60_000); });
    return child;
  };
  const proxy = net.createServer(client => {
    const upstream = net.connect(upstreamPort, '127.0.0.1');
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.once('close', () => { sockets.delete(socket); client.destroy(); upstream.destroy(); });
      socket.on('error', () => { client.destroy(); upstream.destroy(); });
    }
    forwardMessages(client, upstream, header => header.replace(/\/user=[^\s?]+\.sdp(?:\?real_stream)?/g, '/camera'));
    forwardMessages(upstream, client, header => header.replace(/^Content-Type:\s*application\/sdp\r\n/im, ''));
  });
  let prisma;
  try {
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyPort = proxy.address().port;
    const uri = `rtsp://127.0.0.1:${proxyPort}/user=demo_password=test-only-secret_channel=0_stream=1.sdp?real_stream`;
    const databaseUrl = `file:${path.join(databaseDirectory, 'test.db')}`;
    await fs.writeFile(path.join(databaseDirectory, 'test.db'), '');
    const schema = (await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8')).replace('"file:../data/onvifscanner.db"', 'env("DATABASE_URL")');
    assert.ok(schema.includes('env("DATABASE_URL")'));
    const schemaPath = path.join(databaseDirectory, 'schema.prisma');
    await fs.writeFile(schemaPath, schema);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', schemaPath], {
      cwd: databaseDirectory, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', encoding: 'utf8',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const camera = await prisma.camera.create({ data: {
      id: 'legacy-camera', ip: '192.0.2.10', name: 'Testkamera', snapshotUris: '[]', streamUris: JSON.stringify([uri]),
    } });
    await fs.symlink(path.join(root, 'scripts'), path.join(directory, 'scripts'), 'dir');
    const videoDirectory = path.join(databaseDirectory, 'recordings');
    await fs.mkdir(videoDirectory);
    const binary = process.env.MEDIAMTX_BIN || path.join(root, 'mediamtx');
    const upstreamConfig = path.join(directory, 'upstream.yml');
    await fs.writeFile(upstreamConfig, [
      'logLevel: info', 'api: yes', `apiAddress: 127.0.0.1:${upstreamApiPort}`, 'rtsp: yes',
      `rtspAddress: 127.0.0.1:${upstreamPort}`, 'protocols: [tcp]', 'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no',
      'paths:', '  camera:', '    source: publisher', '',
    ].join('\n'));
    const cleanEnvironment = { ...process.env };
    for (const key of Object.keys(cleanEnvironment)) if (key.startsWith('MTX_')) delete cleanEnvironment[key];
    launch(binary, [upstreamConfig], { env: cleanEnvironment });
    await until(async () => fetch(`http://127.0.0.1:${upstreamApiPort}/v3/paths/list`).then(response => response.ok).catch(() => false));
    const produce = () => launch('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000', '-c:v', 'libx265',
      '-x265-params', 'pools=none:frame-threads=1:log-level=error:keyint=10:bframes=0:open-gop=0:repeat-headers=1',
      '-threads', '1', '-c:a', 'pcm_alaw', '-f', 'rtsp', '-rtsp_transport', 'tcp',
      `rtsp://127.0.0.1:${upstreamPort}/camera`,
    ]);
    let producer = produce();
    await until(async () => {
      const data = await fetch(`http://127.0.0.1:${upstreamApiPort}/v3/paths/list`).then(response => response.json());
      return data.items?.some(item => item.name === 'camera' && item.ready);
    });

    const settings = mediaSourceConfig({ camera, uri, alwaysOn: true, directory });
    const destinationConfig = path.join(directory, 'destination.yml');
    await fs.writeFile(destinationConfig, [
      'logLevel: info', 'rtsp: no', 'api: yes', `apiAddress: 127.0.0.1:${apiPort}`,
      'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'paths:', '  legacy-camera:',
      ...Object.entries({
        ...settings, record: true, recordFormat: 'fmp4', recordPartDuration: '1s', recordSegmentDuration: '3s', recordDeleteAfter: '0s',
        recordPath: path.join(videoDirectory, '%Y-%m-%d_%H-%M-%S-%f'), runOnRecordSegmentComplete: RECORDING_COMPLETE_COMMAND,
      }).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`),
      '  broken-direct:', `    source: ${JSON.stringify(uri)}`, '    sourceOnDemand: false', '    rtspTransport: tcp',
      '  normal-direct:', `    source: rtsp://127.0.0.1:${upstreamPort}/camera`, '    sourceOnDemand: false', '    rtspTransport: tcp',
      '  legacy-camera_live:',
      ...Object.entries({ ...mediaSourceConfig({ camera, uri, directory }), runOnDemandCloseAfter: '1s' })
        .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`), '',
    ].join('\n'));
    const environment = await internalRtspEnvironment();
    assert.ok(environment.MTX_RTSPADDRESS.startsWith('127.0.0.1:'));
    assert.equal(environment.MTX_PROTOCOLS, 'tcp');
    const media = launch(binary, [destinationConfig], { cwd: directory, env: { ...environment, DATABASE_URL: databaseUrl } });
    const listPaths = () => fetch(`http://127.0.0.1:${apiPort}/v3/paths/list`).then(response => response.json());
    const completed = async () => (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.complete'));
    await until(() => log.includes('Content-Type header is missing'));
    await until(async () => (await completed()).length >= 1, 30_000);
    const paths = await listPaths();
    assert.equal(paths.items.find(item => item.name === camera.id).ready, true);
    assert.equal(paths.items.find(item => item.name === 'broken-direct').ready, false);
    assert.equal(paths.items.find(item => item.name === 'normal-direct').ready, true);
    assert.equal(paths.items.find(item => item.name === 'legacy-camera_live').ready, false);

    const output = `rtsp://${environment.MTX_RTSPADDRESS}/legacy-camera_live`;
    const reader = launch('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '20000000', '-i', output, '-t', '1', '-f', 'null', '-']);
    assert.equal(await closed.get(reader), 0, log);
    await until(async () => !(await listPaths()).items.find(item => item.name === 'legacy-camera_live').ready);

    producer.kill('SIGKILL');
    await closed.get(producer);
    await until(async () => !(await listPaths()).items.find(item => item.name === camera.id).ready);
    const reconnectCount = (await completed()).length;
    producer = produce();
    await until(async () => (await completed()).length > reconnectCount + 1, 30_000);
    producer.kill('SIGINT');
    await closed.get(producer);
    media.kill('SIGINT');
    await closed.get(media);

    const files = (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.mp4'));
    let duration = 0;
    for (const file of files) {
      const fullPath = path.join(videoDirectory, file);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', fullPath], { encoding: 'utf8' }));
      assert.ok(probe.streams.some(stream => stream.codec_name === 'hevc'));
      assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
      duration += Number(probe.format.duration);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', fullPath, '-f', 'null', '-']);
    }
    assert.ok(duration >= 6);
    assert.ok(log.includes('[Legacy RTSP] FFmpeg-Relay startet'));
    assert.ok(!log.includes('test-only-secret'));
    const relayPids = [...log.matchAll(/\[Legacy RTSP\] FFmpeg-Relay startet \(PID (\d+)\)/g)].map(match => Number(match[1]));
    assert.ok(relayPids.length >= 3);
    for (const pid of relayPids) assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
    console.log(`Legacy RTSP integration passed: missing SDP header reproduced, H.265/G.711 relayed without encoding, ${files.length} decodable recordings, on-demand stop and automatic reconnect (${duration.toFixed(2)}s).`);
  } catch (error) {
    console.error(log.replace(/test-only-secret/g, '[redacted]'));
    throw error;
  } finally {
    await prisma?.$disconnect();
    for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
    const force = setTimeout(() => { for (const child of processes) child.kill('SIGKILL'); }, 5000);
    await Promise.all(closed.values());
    clearTimeout(force);
    for (const match of log.matchAll(/\[Legacy RTSP\] FFmpeg-Relay startet \(PID (\d+)\)/g)) {
      try { process.kill(Number(match[1]), 'SIGKILL'); } catch {}
    }
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(databaseDirectory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
