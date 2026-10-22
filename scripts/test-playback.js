const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

async function loadTypescript(filename) {
  const absolute = path.resolve(filename);
  const source = await fs.readFile(absolute, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  const loaded = new Module(absolute, module);
  loaded.filename = absolute;
  loaded.paths = module.paths;
  loaded._compile(compiled.outputText, absolute);
  return loaded.exports;
}

async function main() {
  const { chronologicalCameraClips, recordingAt, recordingStart } = await loadTypescript('src/components/playback/playbackTiming.ts');
  const first = { id: 'first', cameraId: 'garage', dateStr: '2026-10-21', timeStr: '23:59:50', durationSeconds: 10 };
  const second = { id: 'second', cameraId: 'garage', dateStr: '2026-10-22', timeStr: '00:00:00', durationSeconds: 15 };
  const later = { id: 'later', cameraId: 'garage', dateStr: '2026-10-22', timeStr: '00:00:30', durationSeconds: 12 };
  const clips = chronologicalCameraClips([later, { ...second, cameraId: 'garden' }, second, first], 'garage');
  assert.deepEqual(clips.map((clip) => clip.id), ['first', 'second', 'later']);
  const click = recordingStart(first) + 7.375;
  assert.equal(recordingAt(clips, click, 900).id, 'first');
  assert.equal(click - recordingStart(first), 7.375);
  assert.equal(recordingAt(clips, recordingStart(first) + 10, 900).id, 'second');
  assert.equal(recordingAt(clips, recordingStart(second) + 20, 900), undefined);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-playback-'));
  const previousCache = process.env.PLAYBACK_CACHE_DIR;
  try {
    process.env.PLAYBACK_CACHE_DIR = path.join(directory, 'cache');
    const source = path.join(directory, 'source.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=20', '-t', '3', '-c:v', 'mpeg4', source]);
    const { compatiblePlaybackVideo } = await loadTypescript('src/lib/playbackVideo.ts');
    const [converted, duplicate] = await Promise.all([compatiblePlaybackVideo(source), compatiblePlaybackVideo(source)]);
    assert.equal(converted, duplicate);
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', converted], { encoding: 'utf8' }));
    assert.equal(metadata.streams[0].codec_name, 'h264');
    assert.equal(metadata.streams[0].pix_fmt, 'yuv420p');
    assert.ok(Math.abs(Number(metadata.format.duration) - 3) < 0.1);
    const before = await fs.stat(converted);
    assert.equal(await compatiblePlaybackVideo(source), converted);
    assert.equal((await fs.stat(converted)).mtimeMs, before.mtimeMs);
    const data = await fs.readFile(converted);
    assert.ok(data.indexOf(Buffer.from('moov')) < data.indexOf(Buffer.from('mdat')));
    const hls = await loadTypescript('src/lib/recordingHls.ts');
    const longSource = path.join(directory, 'long.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '14.5', '-c:v', 'mpeg4', '-c:a', 'aac', longSource]);
    const duration = await hls.recordingDuration(longSource);
    const manifest = hls.recordingManifest('test-id', duration);
    assert.equal((manifest.match(/#EXTINF:/g) || []).length, 3);
    assert.ok(manifest.includes('#EXT-X-ENDLIST'));
    assert.ok(manifest.includes('segment=2'));
    const segments = await Promise.all([0, 1, 2].map((index) => hls.recordingSegment(longSource, index)));
    for (let index = 0; index < segments.length; index += 1) {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', segments[index]], { encoding: 'utf8' }));
      const video = probe.streams.find((stream) => stream.codec_type === 'video');
      assert.equal(video.codec_name, 'h264');
      assert.ok(Math.abs(Number(video.start_time) - index * 6) < 0.1);
      assert.ok(Math.abs(Number(video.duration) - Math.min(6, 14.5 - index * 6)) < 0.1);
    }
    await assert.rejects(hls.recordingSegment(longSource, 3));
    assert.equal(await hls.recordingSegment(longSource, 1), segments[1]);
    console.log('Playback timing, clip boundaries and FFmpeg compatibility tests passed.');
  } finally {
    if (previousCache === undefined) delete process.env.PLAYBACK_CACHE_DIR;
    else process.env.PLAYBACK_CACHE_DIR = previousCache;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
