const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

async function loadTypescript(filename, imports = {}) {
  const absolute = path.resolve(filename);
  const source = await fs.readFile(absolute, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
  const loaded = new Module(absolute, module);
  loaded.filename = absolute;
  loaded.paths = module.paths;
  loaded.require = (name) => imports[name] || Module.prototype.require.call(loaded, name);
  loaded._compile(compiled.outputText, absolute);
  return loaded.exports;
}

async function main() {
  const timing = await loadTypescript('src/components/playback/playbackTiming.ts');
  const { chronologicalCameraClips, recordingAt, recordingStart, recordingDayPosition } = timing;
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
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const { recordingFileTime } = await loadTypescript('src/lib/recordingTime.ts');
    const local = recordingFileTime('2026-10-22_10-00-00-782606.mp4', Date.parse('2026-10-22T08:15:00Z'));
    const legacy = recordingFileTime('2026-10-22_08-00-00-782606.mp4', Date.parse('2026-10-22T08:15:00Z'));
    assert.equal(local.timestamp, '2026-10-22T08:00:00.782Z');
    assert.equal(legacy.timestamp, local.timestamp);
    assert.equal(local.timeStr, legacy.timeStr);
    const overnight = { ...first, timestamp: '2026-10-21T21:59:50.245Z' };
    assert.ok(Math.abs(recordingDayPosition(overnight, '2026-10-22') + 9.755) < 0.001);
    const { getMotionEventsForClip } = await loadTypescript('src/components/playback/playbackUtils.ts', { './playbackTiming': timing });
    const events = getMotionEventsForClip(overnight, [{ id: 'midnight', cameraId: 'garage', dateStr: '2026-10-22', timeStr: '00:00:00', timestamp: '2026-10-21T22:00:00Z' }]);
    assert.equal(events.length, 1);
    assert.ok(Math.abs(events[0].offsetSec - 9.755) < 0.001);
    assert.equal(getMotionEventsForClip(overnight, [{ id: 'previous-day', cameraId: 'garage', dateStr: '2026-10-20', timeStr: '23:59:55', timestamp: '2026-10-20T21:59:55Z' }]).length, 0);
    const summer = { ...first, timestamp: '2026-10-25T00:30:00Z' };
    const winter = { ...first, timestamp: '2026-10-25T01:30:00Z' };
    assert.equal(recordingStart(winter) - recordingStart(summer), 3600);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }

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
    const copySource = path.join(directory, 'copy.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=20', '-t', '20', '-c:v', 'libx264', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', copySource]);
    const copyProfile = await hls.recordingProfile(copySource);
    assert.equal(copyProfile.copyVideo, true);
    assert.deepEqual(copyProfile.boundaries, [0, 7.5, 15, 20]);
    const copyManifest = hls.recordingManifest('copy', copyProfile.duration, copyProfile.boundaries);
    assert.ok(copyManifest.includes('#EXT-X-TARGETDURATION:8'));
    assert.ok(copyManifest.includes('#EXTINF:7.500000,'));
    const copied = await hls.recordingSegment(copySource, 1);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts_time,data_hash', '-show_data_hash', 'sha256', '-of', 'json', copied], { encoding: 'utf8' }));
    const original = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts_time', '-of', 'json', copySource], { encoding: 'utf8' }));
    assert.ok(Math.abs(Math.min(...probe.packets.map(packet => Number(packet.pts_time))) - 7.5) < 0.1);
    assert.ok(probe.packets.length > 100);
    assert.ok(original.packets.length > probe.packets.length);
    const frameHashes = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-map', '0:v:0', '-frames:v', '150', '-f', 'framemd5', '-'], { encoding: 'utf8' })
      .split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').pop().trim());
    assert.deepEqual(frameHashes(['-i', copied]), frameHashes(['-ss', '7.5', '-i', copySource]));
    const controller = new AbortController();
    const canceled = hls.recordingSegment(copySource, 0, controller.signal);
    const shared = hls.recordingSegment(copySource, 0);
    controller.abort();
    await assert.rejects(canceled, error => error.name === 'AbortError');
    const sharedFile = await shared;
    assert.ok((await fs.stat(sharedFile)).size > 0);
    assert.equal(await hls.recordingSegment(copySource, 0), sharedFile);
    const fragmented = path.join(directory, 'fragmented.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', copySource, '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', fragmented]);
    const fragmentedProfile = await hls.recordingProfile(fragmented);
    assert.equal(fragmentedProfile.copyVideo, true);
    const fragment = await hls.recordingSegment(fragmented, 1);
    assert.deepEqual(frameHashes(['-i', fragment]), frameHashes(['-ss', String(fragmentedProfile.boundaries[1]), '-i', fragmented]));
    console.log('Playback timing, clip boundaries and FFmpeg compatibility tests passed.');
  } finally {
    if (previousCache === undefined) delete process.env.PLAYBACK_CACHE_DIR;
    else process.env.PLAYBACK_CACHE_DIR = previousCache;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
