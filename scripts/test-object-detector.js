const assert = require('node:assert/strict');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { ObjectDetector } = require('./object-detector');

const detectors = [];
function detector(options = {}) {
  const instance = new ObjectDetector({
    workerPath: path.join(__dirname, 'fixtures/object-detector-child.js'),
    timeoutMs: 2000,
    initTimeoutMs: 5000,
    cooldownMs: 40,
    ...options,
  });
  detectors.push(instance);
  return instance;
}

function assertDead(pid) {
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
}

async function main() {
  try {
    const serial = detector();
    const first = serial.detect(Buffer.from('slow'), 0.7);
    const second = serial.detect(Buffer.from('ok'));
    await assert.rejects(serial.detect(Buffer.from('ok')), /Warteschlange voll/);
    const results = await Promise.all([first, second]);
    assert.equal(results[0].pid, results[1].pid);
    assert.equal(results[0].minScore, 0.7);
    assert.ok(results.every(result => result.buffer && result.concurrent === 1));
    assert.equal(serial.pendingCount, 0);
    await assert.rejects(serial.detect(Buffer.alloc(0)), /Bildgröße/);
    await assert.rejects(serial.detect(Buffer.alloc(8 * 1024 * 1024 + 1)), /Bildgröße/);
    await serial.stop();
    assertDead(results[0].pid);
    await assert.rejects(serial.detect(Buffer.from('ok')), /gestoppt/);

    const timeout = detector({ timeoutMs: 80 });
    const timed = timeout.detect(Buffer.from('hang'));
    const queued = timeout.detect(Buffer.from('ok'));
    const assertions = [assert.rejects(timed, /Timeout/), assert.rejects(queued, /pausiert/)];
    await Promise.all(assertions);
    const oldState = timeout.state;
    await timeout.retiring;
    assertDead(oldState.child.pid);
    await delay(50);
    const recovered = await timeout.detect(Buffer.from('ok'));
    assert.notEqual(recovered.pid, oldState.child.pid);
    oldState.child.emit('close', 1, null);
    const afterLateExit = await timeout.detect(Buffer.from('ok'));
    assert.equal(afterLateExit.pid, recovered.pid);
    await timeout.stop();

    for (const command of ['crash', 'error']) {
      const failed = detector();
      await assert.rejects(failed.detect(Buffer.from(command)), /beendet|inference failed/);
      await assert.rejects(failed.detect(Buffer.from('ok')), /pausiert/);
      await failed.retiring;
      await delay(50);
      assert.equal((await failed.detect(Buffer.from('ok'))).ok, true);
      await failed.stop();
    }

    const pressured = detector({ readMemory: async () => 700 * 1024 * 1024, memoryIntervalMs: 20 });
    await assert.rejects(pressured.detect(Buffer.from('hang')), /RAM-Limit/);
    await pressured.stop();

    if (process.platform === 'linux') {
      const growing = detector({ maxRssMb: 128, memoryIntervalMs: 20 });
      await assert.rejects(growing.detect(Buffer.from('allocate')), /RAM-Limit/);
      await growing.stop();
    }

    process.env.OBJECT_DETECTOR_TEST_START = 'hang';
    const starting = detector({ initTimeoutMs: 500 });
    await assert.rejects(starting.detect(Buffer.from('ok')), /Modellstart Timeout/);
    await starting.stop();
    delete process.env.OBJECT_DETECTOR_TEST_START;

    const stopping = detector();
    const stopped = assert.rejects(stopping.detect(Buffer.from('hang')), /gestoppt/);
    await delay(20);
    const pid = stopping.state.child.pid;
    await stopping.stop();
    await stopped;
    assertDead(pid);
    console.log('Object detector tests passed: bounded serial queue, cold start, timeout isolation, late exit, crash recovery, RAM watchdog and shutdown.');
  } finally {
    delete process.env.OBJECT_DETECTOR_TEST_START;
    await Promise.all(detectors.map(instance => instance.stop()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
