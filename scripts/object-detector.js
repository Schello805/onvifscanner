const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { fork } = require('node:child_process');

async function residentMemory(pid) {
  if (process.platform !== 'linux') return null;
  const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
  return match ? Number(match[1]) * 1024 : null;
}

class ObjectDetector {
  constructor(options = {}) {
    this.workerPath = options.workerPath || path.join(__dirname, 'object-detector-worker.js');
    this.timeoutMs = options.timeoutMs ?? Math.max(5000, Number(process.env.OBJECT_DETECTION_TIMEOUT_MS) || 25_000);
    this.initTimeoutMs = options.initTimeoutMs ?? Math.max(5000, Number(process.env.OBJECT_DETECTION_INIT_TIMEOUT_MS) || 90_000);
    this.cooldownMs = options.cooldownMs ?? Math.max(1000, Number(process.env.OBJECT_DETECTION_RETRY_MS) || 30_000);
    this.maxPending = options.maxPending ?? 2;
    this.maxRssBytes = (options.maxRssMb ?? Math.max(128, Number(process.env.OBJECT_DETECTION_MAX_RSS_MB) || 512)) * 1024 * 1024;
    this.readMemory = options.readMemory || residentMemory;
    this.memoryIntervalMs = options.memoryIntervalMs ?? 1000;
    this.state = null;
    this.retiring = Promise.resolve();
    this.pendingCount = 0;
    this.nextId = 1;
    this.retryAt = 0;
    this.stopped = false;
    this.queue = Promise.resolve();
  }

  assertAvailable() {
    if (this.stopped) throw new Error('Objekterkennung gestoppt');
    if (Date.now() < this.retryAt) throw new Error('Objekterkennung pausiert nach Analysefehler; erneuter Versuch folgt');
  }

  fail(state, error, cooldown = true) {
    if (state.error) return;
    state.error = error;
    if (cooldown && this.state === state) this.retryAt = Date.now() + this.cooldownMs;
    clearTimeout(state.initTimer);
    clearInterval(state.memoryTimer);
    state.rejectReady(error);
    if (state.request) {
      clearTimeout(state.request.timer);
      state.request.reject(error);
      state.request = null;
    }
    this.retiring = state.closed;
    if (state.child.exitCode === null && state.child.signalCode === null) state.child.kill('SIGKILL');
  }

  checkMemory(state, bytes) {
    if (this.state === state && !state.error && bytes > this.maxRssBytes) {
      this.fail(state, new Error(`Objekterkennung RAM-Limit überschritten (${Math.ceil(bytes / 1024 / 1024)} MiB)`));
    }
  }

  async ensureWorker() {
    await this.retiring;
    this.assertAvailable();
    if (this.state) return this.state.ready;
    const child = fork(this.workerPath, [], {
      execArgv: ['--max-old-space-size=256'],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    if (Number.isInteger(child.pid) && child.pid > 0) {
      try { os.setPriority(child.pid, 5); } catch {}
    }
    const state = { child, request: null, error: null, checkingMemory: false };
    state.ready = new Promise((resolve, reject) => {
      state.resolveReady = resolve;
      state.rejectReady = reject;
    });
    state.ready.catch(() => undefined);
    state.closed = new Promise(resolve => { state.resolveClosed = resolve; });
    this.state = state;
    state.initTimer = setTimeout(() => this.fail(state, new Error('Objekterkennung Modellstart Timeout')), this.initTimeoutMs);
    state.memoryTimer = setInterval(async () => {
      if (state.checkingMemory || state.error) return;
      state.checkingMemory = true;
      try { this.checkMemory(state, await this.readMemory(child.pid)); } catch {}
      finally { state.checkingMemory = false; }
    }, this.memoryIntervalMs);
    state.memoryTimer.unref();
    child.on('message', message => {
      if (this.state !== state || state.error) return;
      this.checkMemory(state, Number(message.rss) || 0);
      if (state.error) return;
      if (message.type === 'ready') {
        clearTimeout(state.initTimer);
        state.resolveReady(state);
        return;
      }
      if (message.type === 'init-error') {
        this.fail(state, new Error(message.error || 'Objekterkennung Modellstart fehlgeschlagen'));
        return;
      }
      const request = state.request;
      if (!request || request.id !== message.id) return;
      state.request = null;
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message);
      else {
        const error = new Error(message.error || 'Objekterkennung fehlgeschlagen');
        request.reject(error);
        this.fail(state, error);
      }
    });
    child.on('error', error => this.fail(state, error));
    child.once('close', (code, signal) => {
      this.fail(state, new Error(`Objekterkennungs-Prozess beendet (${signal || code}).`));
      clearTimeout(state.initTimer);
      clearInterval(state.memoryTimer);
      if (this.state === state) this.state = null;
      state.resolveClosed();
    });
    return state.ready;
  }

  detect(image, minScore = 0.55) {
    try {
      this.assertAvailable();
      if (this.pendingCount >= this.maxPending) throw new Error('Objekterkennung ausgelastet; Warteschlange voll');
      if (!image?.length || image.length > 8 * 1024 * 1024) throw new Error('Ungültige Bildgröße für Objekterkennung');
    } catch (error) {
      return Promise.reject(error);
    }
    const payload = Buffer.from(image);
    const queuedAt = Date.now();
    this.pendingCount += 1;
    const task = async () => {
      this.assertAvailable();
      if (Date.now() - queuedAt > this.timeoutMs) throw new Error('Objekterkennung verwirft veraltetes Bild aus der Warteschlange');
      const state = await this.ensureWorker();
      this.assertAvailable();
      return new Promise((resolve, reject) => {
        const id = this.nextId++;
        const timer = setTimeout(() => this.fail(state, new Error('Objekterkennung Timeout')), this.timeoutMs);
        state.request = { id, timer, resolve, reject };
        try {
          state.child.send({ id, image: payload, minScore }, error => {
            if (error) this.fail(state, error);
          });
        } catch (error) { this.fail(state, error); }
      });
    };
    const result = this.queue.then(task, task).finally(() => { this.pendingCount -= 1; });
    this.queue = result.catch(() => undefined);
    return result;
  }

  async stop() {
    this.stopped = true;
    if (this.state) this.fail(this.state, new Error('Objekterkennung gestoppt'), false);
    await this.retiring;
    await this.queue;
  }
}

module.exports = { ObjectDetector };
