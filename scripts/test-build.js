const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('./build');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'onvif-build-'));
  const dist = path.join(directory, '.next');
  const backup = `${dist}-build-backup`;
  const lock = `${dist}.build-lock`;
  const options = { directory, isServiceActive: () => false };
  const publish = value => {
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'BUILD_ID'), value);
  };
  const current = () => fs.readFileSync(path.join(dist, 'BUILD_ID'), 'utf8');
  try {
    publish('previous');
    await assert.rejects(build({ ...options, isServiceActive: () => true }), /läuft noch/);
    assert.equal(current(), 'previous');

    const originalError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(build({ ...options, run: async () => { publish('partial'); return 1; } }), /fehlgeschlagen/);
      assert.equal(current(), 'previous');
      assert.equal(fs.existsSync(backup), false);
      await assert.rejects(build({ ...options, run: async () => { throw new Error('interrupted'); } }), /interrupted/);
      assert.equal(current(), 'previous');
    } finally { console.error = originalError; }

    await build({ ...options, run: async () => { publish('new'); return 0; } });
    assert.equal(current(), 'new');
    assert.equal(fs.existsSync(backup), false);
    assert.equal(fs.existsSync(lock), false);

    fs.writeFileSync(lock, String(process.pid));
    await assert.rejects(build({ ...options }), /läuft bereits/);
    assert.equal(current(), 'new');
    fs.writeFileSync(lock, 'invalid-stale-lock');
    await build({ ...options, run: async () => { publish('after-stale-lock'); return 0; } });
    assert.equal(current(), 'after-stale-lock');

    fs.renameSync(dist, backup);
    fs.mkdirSync(dist);
    let restored = false;
    await build({ ...options, run: async () => {
      restored = fs.readFileSync(path.join(backup, 'BUILD_ID'), 'utf8') === 'after-stale-lock';
      publish('after-interruption');
      return 0;
    } });
    assert.ok(restored);
    assert.equal(current(), 'after-interruption');

    fs.rmSync(dist, { recursive: true });
    await assert.rejects(build({ ...options, run: async () => { fs.mkdirSync(dist); return 0; } }), /kein neuer Produktionsbuild/);
    assert.equal(fs.existsSync(dist), false);
    assert.equal(fs.existsSync(lock), false);
    console.log('Build safety tests passed: active service guard, single build lock, failed/incomplete build recovery and interrupted build backup.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
