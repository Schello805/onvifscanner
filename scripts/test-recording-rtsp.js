const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { RECORDING_COMPLETE_COMMAND } = require('./motion-recorder');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(check, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Lokaler RTSP-Test hat das Zeitlimit überschritten.');
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-rtsp-'));
  const port = await freePort();
  const videoDirectory = path.join(directory, 'recordings');
  await fs.mkdir(videoDirectory);
  const config = path.join(directory, 'mediamtx.yml');
  await fs.writeFile(config, [
    'logLevel: warn', 'rtsp: yes', `rtspAddress: 127.0.0.1:${port}`, 'protocols: [tcp]',
    'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'api: no', 'paths:', '  camera:',
    '    source: publisher', '    record: yes', '    recordFormat: fmp4', '    recordPartDuration: 1s',
    '    recordSegmentDuration: 5s', '    recordDeleteAfter: 0s',
    `    recordPath: ${JSON.stringify(path.join(videoDirectory, '%Y-%m-%d_%H-%M-%S-%f'))}`,
    `    runOnRecordSegmentComplete: ${JSON.stringify(RECORDING_COMPLETE_COMMAND)}`, '',
  ].join('\n'));
  const media = spawn(process.env.MEDIAMTX_BIN || path.resolve('mediamtx'), [config], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  media.stdout.on('data', chunk => { log = (log + chunk).slice(-8000); });
  media.stderr.on('data', chunk => { log = (log + chunk).slice(-8000); });
  const closed = new Promise(resolve => media.once('close', resolve));
  let publisher;
  try {
    await until(() => new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    }));
    const publish = () => spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '7', '-c:v', 'libx264',
      '-preset', 'ultrafast', '-threads', '1', '-g', '20', '-bf', '0', '-c:a', 'aac',
      '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${port}/camera`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    publisher = publish();
    const firstClosed = new Promise(resolve => publisher.once('close', resolve));
    const interruption = setTimeout(() => publisher.kill('SIGKILL'), 6300);
    await firstClosed;
    clearTimeout(interruption);
    await until(async () => (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.complete')).length >= 2);
    const firstFiles = (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.mp4'));
    assert.ok(firstFiles.length >= 2);
    publisher = publish();
    let publisherError = '';
    publisher.stderr.on('data', chunk => { publisherError += chunk; });
    const code = await new Promise(resolve => publisher.once('close', resolve));
    assert.equal(code, 0, publisherError);
    await until(async () => (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.complete')).length >= 4);
    const files = (await fs.readdir(videoDirectory)).filter(file => file.endsWith('.mp4'));
    assert.ok(files.length > firstFiles.length);
    let duration = 0;
    for (const file of files) {
      const fullPath = path.join(videoDirectory, file);
      const marker = Number(await fs.readFile(`${fullPath}.complete`, 'utf8'));
      assert.ok(marker > 0);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', fullPath], { encoding: 'utf8' }));
      assert.ok(probe.streams.some(stream => stream.codec_type === 'video'));
      assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
      duration += marker;
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', fullPath, '-f', 'null', '-']);
    }
    assert.ok(duration >= 11, `Nur ${duration}s Aufnahme nach Abbruch und Wiederanlauf.`);
    console.log(`RTSP recording and reconnect tests passed (${files.length} closed A/V segments, ${duration.toFixed(2)}s).`);
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    publisher?.kill('SIGKILL');
    media.kill('SIGINT');
    await closed;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
