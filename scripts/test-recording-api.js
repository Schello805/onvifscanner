const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');

async function load(filename, imports) {
  const modulePath = path.resolve(filename);
  const loaded = new Module(modulePath, module);
  loaded.filename = modulePath; loaded.paths = module.paths;
  loaded.require = name => imports[name] || Module.prototype.require.call(loaded, name);
  loaded._compile(ts.transpileModule(await fs.readFile(modulePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, modulePath);
  return loaded.exports;
}

async function main() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-api-')));
  const previousDirectory = process.cwd();
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const root = path.join(directory, 'data', 'recordings', 'camera');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, '2026-10-22_10-00-00-245000_motion_ready.mp4');
    await fs.writeFile(file, 'test fixture');
    await fs.utimes(file, new Date('2026-10-22T08:00:15Z'), new Date('2026-10-22T08:00:15Z'));
    await fs.writeFile(path.join(root, '.2026-10-22_10-00-00.partial.mp4'), 'unfinished');
    const saved = { filePath: file, cameraId: 'camera', startedAt: new Date('2026-10-22T08:00:00.245Z'), endedAt: new Date('2026-10-22T08:00:14.745Z') };
    const prisma = {
      camera: { findMany: async () => [{ id: 'camera', name: 'Testkamera', recordSegmentMinutes: 15 }] },
      storageTarget: { findMany: async () => [] },
      motionRecording: { findMany: async () => [saved], findFirst: async ({ where }) => where.filePath === file ? saved : null },
    };
    const imports = { '@/lib/db': { prisma } };
    imports['@/lib/recordingTime'] = await load('src/lib/recordingTime.ts', {});
    imports['@/lib/recordingFile'] = await load('src/lib/recordingFile.ts', imports);
    const { GET } = await load('src/app/api/nvr/recordings/route.ts', imports);
    process.chdir(directory);
    const list = await GET(new Request('http://localhost/api/nvr/recordings?date=2026-10-22'));
    assert.equal(list.status, 200);
    const data = await list.json();
    assert.equal(data.clips.length, 1);
    assert.equal(data.clips[0].timestamp, saved.startedAt.toISOString());
    assert.equal(data.clips[0].durationSeconds, 14.5);
    const clipId = Buffer.from(file).toString('base64url');
    const single = await GET(new Request(`http://localhost/api/nvr/recordings?clipId=${clipId}`));
    const singleData = await single.json();
    assert.equal(singleData.clips[0].timestamp, data.clips[0].timestamp);
    assert.equal(singleData.clips[0].durationSeconds, 14.5);
    const missing = Buffer.from(path.join(root, 'missing.mp4')).toString('base64url');
    assert.equal((await GET(new Request(`http://localhost/api/nvr/recordings?clipId=${missing}`))).status, 404);
    const outside = Buffer.from(path.join(directory, 'unapproved.mp4')).toString('base64url');
    await fs.writeFile(path.join(directory, 'unapproved.mp4'), 'outside');
    assert.equal((await GET(new Request(`http://localhost/api/nvr/recordings?clipId=${outside}`))).status, 403);
    console.log('Recording API tests passed: verified metadata, hidden partial files, missing clips and storage boundaries.');
  } finally {
    process.chdir(previousDirectory);
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
