process.on('disconnect', () => process.exit(0));
if (process.env.OBJECT_DETECTOR_TEST_START !== 'hang') {
  setTimeout(() => process.send({ type: 'ready' }), 150);
}
const allocations = [];
let active = 0;
process.on('message', ({ id, image, minScore }) => {
  const command = Buffer.from(image).toString();
  if (command === 'hang') return;
  if (command === 'crash') process.exit(7);
  if (command === 'error') return process.send({ id, ok: false, error: 'model inference failed' });
  if (command === 'allocate') {
    const timer = setInterval(() => {
      allocations.push(Buffer.alloc(16 * 1024 * 1024, 1));
      if (allocations.length >= 12) clearInterval(timer);
    }, 30);
    return;
  }
  active += 1;
  const concurrent = active;
  setTimeout(() => {
    active -= 1;
    process.send({ id, ok: true, pid: process.pid, concurrent, minScore, buffer: Buffer.isBuffer(image), predictions: [] });
  }, command === 'slow' ? 100 : 0);
});
