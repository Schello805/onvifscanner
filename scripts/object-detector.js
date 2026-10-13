const path = require('path');
const { Worker } = require('worker_threads');

class ObjectDetector {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, 'object-detector-worker.js'));
    worker.on('message', (message) => {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message);
      else request.reject(new Error(message.error || 'Objekterkennung fehlgeschlagen'));
    });
    const fail = (error) => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
      this.worker = null;
    };
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (code !== 0) fail(new Error(`Objekterkennungs-Worker beendet (${code}).`));
      else this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  detect(image, minScore = 0.55) {
    const task = () => new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Objekterkennung Timeout'));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      const payload = Buffer.from(image);
      this.ensureWorker().postMessage({ id, image: payload, minScore });
    });
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async stop() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}

module.exports = { ObjectDetector };
