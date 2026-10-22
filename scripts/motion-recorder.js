const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { effectiveRecordingMode } = require('./recording-policy');
const { uploadClipToOffsite } = require('./offsite-backup');
const { getFfmpegHwaccelArgs } = require('./ffmpeg-hwaccel');

const execFileAsync = promisify(execFile);
const BUFFER_SEGMENT_SECONDS = Math.max(3, Number(process.env.MOTION_BUFFER_SEGMENT_SECONDS) || 5);
const PROCESS_INTERVAL_MS = Math.max(2_000, Number(process.env.MOTION_RECORDER_INTERVAL_MS) || 4_000);
const FINALIZE_GRACE_MS = 1_500;
const MERGE_GRACE_MS = (BUFFER_SEGMENT_SECONDS + 5) * 1000;
const RECORDING_COMPLETE_COMMAND = `sh -c 'printf "%s" "$MTX_SEGMENT_DURATION" > "$MTX_SEGMENT_PATH.complete"'`;

function segmentStartedAt(filename) {
  const match = path.basename(filename).match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})(?:[-_](\d{6}))?/);
  if (!match) return null;
  const value = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] || '000000').slice(0, 3)}`).getTime();
  return Number.isFinite(value) ? value : null;
}

class MotionRecorder {
  constructor(prisma) {
    this.prisma = prisma;
    this.timer = null;
    this.running = false;
    this.processing = false;
    this.lastEventAt = new Date(Date.now() - 10 * 60_000);
    this.seenEventIds = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.process();
    this.timer = setInterval(() => void this.process(), PROCESS_INTERVAL_MS);
    console.log(`[Motion Recorder] Persistenter Ringpuffer aktiv (${BUFFER_SEGMENT_SECONDS}s Segmente).`);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async process() {
    if (!this.running || this.processing) return;
    this.processing = true;
    try {
      const queryStartedAt = new Date();
      const [motionCameras, unfinishedRecordings, defaultStorage, events] = await Promise.all([
        this.prisma.camera.findMany({
          include: { storageTarget: true },
        }),
        this.prisma.motionRecording.findMany({
          where: { status: { in: ['buffering', 'merging'] } },
          include: { camera: { include: { storageTarget: true } } },
          orderBy: { startedAt: 'asc' },
        }),
        this.prisma.storageTarget.findFirst({
          where: { isDefault: true, enabled: true },
          select: { path: true },
        }),
        this.prisma.alarmLog.findMany({
          where: { timestamp: { gte: new Date(this.lastEventAt.getTime() - 30_000) } },
          orderBy: { timestamp: 'asc' },
          take: 500,
        }),
      ]);

      const camerasById = new Map(motionCameras
        .filter((camera) => effectiveRecordingMode(camera) === 'motion')
        .map((camera) => [camera.id, camera]));
      for (const recording of unfinishedRecordings) {
        if (!camerasById.has(recording.cameraId)) camerasById.set(recording.cameraId, recording.camera);
      }

      for (const event of events) {
        if (this.seenEventIds.has(event.id) || event.motionRecordingId) continue;
        const camera = camerasById.get(event.cameraId);
        if (!camera || effectiveRecordingMode(camera, event.timestamp) !== 'motion') continue;
        await this.registerEvent(camera, event);
        this.seenEventIds.add(event.id);
      }

      this.lastEventAt = queryStartedAt;
      if (this.seenEventIds.size > 2_000) this.seenEventIds.clear();

      const activeRecordings = await this.prisma.motionRecording.findMany({
        where: { status: { in: ['buffering', 'merging'] } },
        orderBy: { startedAt: 'asc' },
      });
      const recordingsByCamera = new Map();
      for (const recording of activeRecordings) {
        const items = recordingsByCamera.get(recording.cameraId) || [];
        items.push(recording);
        recordingsByCamera.set(recording.cameraId, items);
      }

      for (const camera of camerasById.values()) {
        await this.processCamera(camera, defaultStorage?.path, recordingsByCamera.get(camera.id) || []);
      }
      await this.cleanupInactiveBuffers(new Set(camerasById.keys()));
    } catch (error) {
      console.error('[Motion Recorder] Verarbeitung fehlgeschlagen:', error);
    } finally {
      this.processing = false;
    }
  }

  async registerEvent(camera, event) {
    const eventMs = event.timestamp.getTime();
    const preRollMs = Math.max(0, camera.motionPreRollSeconds ?? 10) * 1000;
    const postRollMs = Math.max(5, camera.motionPostRollSeconds ?? 30) * 1000;
    const startedAt = new Date(eventMs - preRollMs);
    const endedAt = new Date(eventMs + postRollMs);
    let recording = await this.prisma.motionRecording.findFirst({
      where: {
        cameraId: camera.id,
        status: 'buffering',
        endedAt: { gte: new Date(startedAt.getTime() - BUFFER_SEGMENT_SECONDS * 1000) },
      },
      orderBy: { endedAt: 'desc' },
    });

    if (recording) {
      recording = await this.prisma.motionRecording.update({
        where: { id: recording.id },
        data: {
          startedAt: recording.startedAt > startedAt ? startedAt : recording.startedAt,
          endedAt: recording.endedAt < endedAt ? endedAt : recording.endedAt,
        },
      });
    } else {
      recording = await this.prisma.motionRecording.create({
        data: { cameraId: camera.id, startedAt, endedAt, status: 'buffering' },
      });
    }

    await this.prisma.alarmLog.update({
      where: { id: event.id },
      data: { motionRecordingId: recording.id },
    });
  }

  async processCamera(camera, defaultStoragePath, recordings) {
    const bufferDir = motionBufferDirectory(camera.id);
    const files = fs.existsSync(bufferDir) ? await this.listVideoFiles(bufferDir) : [];
    const now = Date.now();
    const preRollMs = Math.max(0, camera.motionPreRollSeconds ?? 10) * 1000;
    const pendingRecordings = new Set();

    for (const file of files) {
      let stat;
      try { stat = await fsp.stat(file); } catch { continue; }
      const stable = now - stat.mtimeMs >= FINALIZE_GRACE_MS;

      const duration = Number(await fsp.readFile(`${file}.complete`, 'utf8').catch(() => ''));
      const completedDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const segmentStart = segmentStartedAt(file) ?? stat.mtimeMs - BUFFER_SEGMENT_SECONDS * 1000;
      const successor = files.map(segmentStartedAt).filter((start) => start !== null && start > segmentStart).sort((first, second) => first - second)[0];
      const complete = completedDuration > 0 || (successor !== undefined && stable);
      const segmentEnd = completedDuration > 0 ? segmentStart + completedDuration * 1000 : stat.mtimeMs;
      const recording = recordings.find((item) =>
        segmentEnd >= item.startedAt.getTime() && segmentStart <= item.endedAt.getTime()
      );

      if (recording) {
        if (!complete) {
          pendingRecordings.add(recording.id);
          continue;
        }
        const stageDir = motionStagingDirectory(recording.id);
        await fsp.mkdir(stageDir, { recursive: true });
        if (completedDuration > 0) await fsp.writeFile(path.join(stageDir, `${path.basename(file)}.complete`), String(completedDuration));
        await this.moveFile(file, path.join(stageDir, path.basename(file)));
        await fsp.unlink(`${file}.complete`).catch(() => undefined);
      } else if (complete && segmentEnd < now - preRollMs - (BUFFER_SEGMENT_SECONDS + 3) * 1000) {
        await fsp.unlink(file).catch(() => undefined);
        await fsp.unlink(`${file}.complete`).catch(() => undefined);
      }
    }

    for (const recording of recordings) {
      if (pendingRecordings.has(recording.id)) continue;
      if (now <= recording.endedAt.getTime() + MERGE_GRACE_MS) continue;
      await this.finalizeRecording(camera, defaultStoragePath, recording);
    }
  }

  async finalizeRecording(camera, defaultStoragePath, recording) {
    const claimed = await this.prisma.motionRecording.updateMany({
      where: { id: recording.id, status: { in: ['buffering', 'merging'] } },
      data: { status: 'merging', error: null },
    });
    if (!claimed.count) return;

    const stageDir = motionStagingDirectory(recording.id);
    const segments = (await this.listVideoFiles(stageDir)).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    if (!segments.length) {
      await this.prisma.motionRecording.update({
        where: { id: recording.id },
        data: { status: 'failed', error: 'Keine Ringpuffer-Segmente für dieses Ereignis gefunden.' },
      });
      return;
    }

    const storageRoot = camera.storageTarget?.enabled
      ? camera.storageTarget.path
      : (defaultStoragePath || path.join(process.cwd(), 'data', 'recordings'));
    const finalDir = path.join(storageRoot, camera.id);
    await fsp.mkdir(finalDir, { recursive: true });
    const actualStart = new Date(segmentStartedAt(segments[0]) ?? recording.startedAt.getTime());
    const filename = `${formatLocalTimestamp(actualStart)}-${String(actualStart.getMilliseconds()).padStart(3, '0')}000_motion_${recording.id.slice(-8)}.mp4`;
    const output = path.join(finalDir, filename);
    const partial = path.join(finalDir, `.${filename}.partial.mp4`);

    try {
      let videoCodec = '';
      try {
        const probe = await execFileAsync('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=codec_name',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          segments[0],
        ], { timeout: 15_000, maxBuffer: 256 * 1024 });
        videoCodec = String(probe.stdout || '').trim().toLowerCase();
      } catch (error) {
        console.warn(`[Motion Recorder] Codec von ${camera.name} konnte nicht ermittelt werden; H.264-Konvertierung wird verwendet.`, error?.message || error);
      }

      let listFile = null;
      if (segments.length > 1) {
        listFile = path.join(stageDir, 'segments.txt');
        const list = (await Promise.all(segments.map(async (segment) => {
          const duration = Number(await fsp.readFile(`${segment}.complete`, 'utf8').catch(() => ''));
          const file = `file '${segment.replaceAll("'", "'\\''")}'`;
          return duration > 0 && Number.isFinite(duration) ? `${file}\nduration ${duration}` : file;
        }))).join('\n');
        await fsp.writeFile(listFile, `${list}\n`, 'utf8');
      }

      const runFfmpeg = async (useHwaccel) => {
        const args = ['-y', '-hide_banner', '-loglevel', 'error'];
        // Only attempt hwaccel if transcoding is needed; stream copy must never use hwaccel
        if (useHwaccel && videoCodec !== 'h264') {
          args.push(...getFfmpegHwaccelArgs());
        }

        if (segments.length === 1) {
          args.push('-i', segments[0]);
        } else {
          args.push('-f', 'concat', '-safe', '0', '-i', listFile);
        }

        args.push('-map', '0:v:0', '-map', '0:a:0?');
        if (videoCodec === 'h264') {
          args.push('-c:v', 'copy');
        } else {
          args.push(
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
            '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-level', '4.0',
            '-threads', '2',
          );
        }
        args.push('-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', partial);
        await execFileAsync('ffmpeg', args, { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 });
      };

      try {
        await runFfmpeg(true);
      } catch (errHw) {
        if (videoCodec !== 'h264') {
          console.warn(`[Motion Recorder] Transcoding mit Hardware-Beschleunigung fehlgeschlagen, versuche CPU-Software-Fallback:`, errHw?.message || errHw);
          await fsp.unlink(partial).catch(() => undefined);
          await runFfmpeg(false);
        } else {
          throw errHw;
        }
      }

      const stat = await fsp.stat(partial);
      if (!stat.isFile() || stat.size === 0) throw new Error('FFmpeg hat keine gültige Ausgabedatei erzeugt.');
      const verified = await execFileAsync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', partial,
      ], { timeout: 15_000, maxBuffer: 256 * 1024 });
      const video = JSON.parse(verified.stdout);
      const duration = Number(video.format?.duration);
      if (!video.streams?.length || !Number.isFinite(duration) || duration <= 0) throw new Error('Die Ausgabedatei enthält keine abspielbare Videospur.');
      await fsp.rename(partial, output);
      await this.prisma.motionRecording.update({
        where: { id: recording.id },
        data: { status: 'ready', filePath: output, segmentCount: segments.length, startedAt: actualStart, endedAt: new Date(actualStart.getTime() + duration * 1000), error: null },
      });
      await fsp.rm(stageDir, { recursive: true, force: true });
      console.log(`[Motion Recorder] ${camera.name}: ${segments.length} Segment(e) zu ${filename} zusammengeführt (${videoCodec === 'h264' ? 'H.264 übernommen' : `${videoCodec || 'unbekannt'} → H.264`}).`);
      void uploadClipToOffsite(this.prisma, output, filename, camera.name);
    } catch (error) {
      await fsp.unlink(partial).catch(() => undefined);
      await this.prisma.motionRecording.update({
        where: { id: recording.id },
        data: { status: 'failed', segmentCount: segments.length, error: String(error?.message || error).slice(0, 500) },
      });
      console.error(`[Motion Recorder] Zusammenführen für ${camera.name} fehlgeschlagen:`, error);
    }
  }

  async listVideoFiles(directory) {
    const result = [];
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await this.listVideoFiles(fullPath));
      else if (entry.isFile() && /\.(?:mp4|m4s|ts)$/i.test(entry.name)) result.push(fullPath);
    }
    return result;
  }

  async cleanupInactiveBuffers(activeCameraIds) {
    const root = motionBufferRoot();
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - 15_000;
    for (const entry of entries) {
      if (!entry.isDirectory() || activeCameraIds.has(entry.name)) continue;
      const directory = path.join(root, entry.name);
      const files = await this.listVideoFiles(directory);
      for (const file of files) {
        const stat = await fsp.stat(file).catch(() => null);
        const hasMarker = await fsp.access(`${file}.complete`).then(() => true, () => false);
        const start = segmentStartedAt(file);
        const hasSuccessor = start !== null && files.some((candidate) => (segmentStartedAt(candidate) ?? -Infinity) > start);
        if (stat && stat.mtimeMs < cutoff && (hasMarker || hasSuccessor)) {
          await fsp.unlink(file).catch(() => undefined);
          await fsp.unlink(`${file}.complete`).catch(() => undefined);
        }
      }
      const remaining = await fsp.readdir(directory).catch(() => []);
      if (remaining.length === 0) await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async moveFile(source, destination) {
    try {
      await fsp.rename(source, destination);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await fsp.copyFile(source, destination);
      await fsp.unlink(source);
    }
  }
}

function formatLocalTimestamp(date) {
  const tz = process.env.TZ || 'Europe/Berlin';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}_${g('hour')}-${g('minute')}-${g('second')}`;
}

function motionBufferRoot() {
  return process.env.MOTION_BUFFER_DIR || path.join(process.cwd(), 'data', 'motion-buffer');
}

function motionBufferDirectory(cameraId) {
  return path.join(motionBufferRoot(), cameraId);
}

function motionStagingDirectory(recordingId) {
  const root = process.env.MOTION_STAGING_DIR || path.join(process.cwd(), 'data', 'motion-staging');
  return path.join(root, recordingId);
}

function motionBufferRecordPattern(cameraId) {
  return path.join(motionBufferDirectory(cameraId), '%Y-%m-%d_%H-%M-%S-%f');
}

module.exports = {
  MotionRecorder,
  BUFFER_SEGMENT_SECONDS,
  RECORDING_COMPLETE_COMMAND,
  segmentStartedAt,
  motionBufferDirectory,
  motionBufferRecordPattern,
};
