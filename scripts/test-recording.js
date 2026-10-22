const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { MotionRecorder, segmentStartedAt, RECORDING_COMPLETE_COMMAND } = require('./motion-recorder');

function filename(date) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}000.mp4`;
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-recording-'));
  const previousBuffer = process.env.MOTION_BUFFER_DIR;
  const previousStage = process.env.MOTION_STAGING_DIR;
  process.env.MOTION_BUFFER_DIR = path.join(directory, 'buffer');
  process.env.MOTION_STAGING_DIR = path.join(directory, 'stage');
  try {
    const source = path.join(directory, 'source.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-threads', '1', '-g', '20', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', source]);
    const start = new Date(Date.now() - 60_000);
    start.setMilliseconds(245);
    assert.equal(segmentStartedAt(filename(start)), start.getTime());
    const record = { id: 'recording-good', cameraId: 'camera', startedAt: new Date(start.getTime() + 2000), endedAt: new Date(start.getTime() + 13_000), status: 'buffering' };
    const prisma = {
      motionRecording: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }) => { Object.assign(record, data); return record; },
        findFirst: async ({ where }) => {
          assert.equal(where.endedAt.gte.getTime(), start.getTime() + 25_000);
          return record;
        },
      },
      alarmLog: { update: async () => undefined },
      settings: { findUnique: async () => null },
    };
    const recorder = new MotionRecorder(prisma);
    const camera = { id: 'camera', name: 'Testkamera', motionPreRollSeconds: 10, motionPostRollSeconds: 30 };
    await recorder.registerEvent(camera, { id: 'event', timestamp: new Date(start.getTime() + 40_000) });
    record.startedAt = new Date(start.getTime() + 2000);
    record.endedAt = new Date(start.getTime() + 13_000);
    const buffer = path.join(process.env.MOTION_BUFFER_DIR, camera.id);
    await fs.mkdir(buffer, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      const file = path.join(buffer, filename(new Date(start.getTime() + index * 5000)));
      await fs.copyFile(source, file);
      await fs.utimes(file, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
      execFileSync('sh', ['-c', RECORDING_COMPLETE_COMMAND], { env: { ...process.env, MTX_SEGMENT_DURATION: '5', MTX_SEGMENT_PATH: file } });
    }
    const open = path.join(buffer, filename(new Date(start.getTime() + 15_000)));
    await fs.copyFile(source, open);
    await fs.utimes(open, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000));
    await recorder.processCamera(camera, path.join(directory, 'archive'), [record]);
    assert.equal(record.status, 'ready');
    assert.equal(record.startedAt.getTime(), start.getTime());
    assert.ok(Math.abs((record.endedAt - record.startedAt) / 1000 - 15) < 0.2, `Aufnahmedauer: ${(record.endedAt - record.startedAt) / 1000}`);
    assert.equal(record.segmentCount, 3);
    assert.ok((await fs.stat(open)).isFile());
    assert.equal((await fs.readdir(path.dirname(record.filePath))).filter(file => file.includes('partial')).length, 0);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', record.filePath, '-f', 'null', '-']);
    const counted = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', record.filePath], { encoding: 'utf8' }));
    assert.equal(Number(counted.streams[0].nb_read_frames), 300);
    const pending = { ...record, id: 'pending', status: 'buffering', startedAt: new Date(start.getTime() + 15_000), endedAt: new Date(start.getTime() + 20_000) };
    await recorder.processCamera(camera, path.join(directory, 'archive'), [pending]);
    assert.equal(pending.status, 'buffering');
    assert.ok((await fs.stat(open)).isFile());
    await recorder.cleanupInactiveBuffers(new Set());
    assert.ok((await fs.stat(open)).isFile());
    const badStage = path.join(process.env.MOTION_STAGING_DIR, 'broken');
    await fs.mkdir(badStage, { recursive: true });
    const broken = path.join(badStage, filename(start));
    await fs.writeFile(broken, 'unfinished video');
    const failures = [];
    const warn = console.warn;
    const error = console.error;
    console.warn = (...messages) => failures.push(messages.map(String).join(' '));
    console.error = (...messages) => failures.push(messages.map(String).join(' '));
    try { await recorder.finalizeRecording(camera, path.join(directory, 'archive'), { ...pending, id: 'broken' }); }
    finally { console.warn = warn; console.error = error; }
    assert.equal(record.status, 'failed');
    assert.ok(failures.some(message => message.includes('fehlgeschlagen')));
    assert.ok((await fs.stat(broken)).isFile());
    console.log('Recording completion, pre/post-roll merging, timestamps and video integrity tests passed.');
  } finally {
    if (previousBuffer === undefined) delete process.env.MOTION_BUFFER_DIR;
    else process.env.MOTION_BUFFER_DIR = previousBuffer;
    if (previousStage === undefined) delete process.env.MOTION_STAGING_DIR;
    else process.env.MOTION_STAGING_DIR = previousStage;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
