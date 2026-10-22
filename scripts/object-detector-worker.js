const sharp = require('sharp');

sharp.concurrency(1);
sharp.cache({ memory: 8, files: 0, items: 16 });

let tf;
let modelPromise;

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      tf = require('@tensorflow/tfjs-core');
      require('@tensorflow/tfjs-backend-cpu');
      tf.enableProdMode();
      await tf.setBackend('cpu');
      await tf.ready();
      const cocoSsd = require('@tensorflow-models/coco-ssd');
      const modelUrl = String(process.env.OBJECT_DETECTION_MODEL_URL || '').trim() || undefined;
      const configuredBase = String(process.env.OBJECT_DETECTION_MODEL_BASE || 'lite_mobilenet_v2').trim();
      const base = new Set(['lite_mobilenet_v2', 'mobilenet_v1', 'mobilenet_v2']).has(configuredBase)
        ? configuredBase
        : 'mobilenet_v2';
      return cocoSsd.load({ base, ...(modelUrl ? { modelUrl } : {}) });
    })();
  }
  return modelPromise;
}

process.on('disconnect', () => process.exit(0));

void loadModel().then(() => {
  process.send({ type: 'ready', rss: process.memoryUsage().rss });
}).catch(error => {
  process.send({ type: 'init-error', error: error?.message || String(error) });
});

process.on('message', async ({ id, image, minScore }) => {
  let tensor;
  try {
    const model = await loadModel();
    const decoded = await sharp(Buffer.from(image), { limitInputPixels: 32_000_000 })
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    tensor = tf.tensor3d(new Uint8Array(decoded.data), [height, width, channels], 'int32');
    const predictions = await model.detect(tensor, 20, minScore);
    process.send({
      id,
      ok: true,
      width,
      height,
      rss: process.memoryUsage().rss,
      predictions: predictions.map((prediction) => ({
        className: prediction.class,
        score: prediction.score,
        bbox: prediction.bbox,
      })),
    });
  } catch (error) {
    process.send({ id, ok: false, error: error?.message || String(error) });
  } finally {
    tensor?.dispose();
  }
});
