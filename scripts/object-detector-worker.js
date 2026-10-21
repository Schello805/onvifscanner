const { parentPort } = require('worker_threads');
const sharp = require('sharp');

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

// Eagerly preload model in the background so it is ready before the first request
void loadModel().catch(() => {});

parentPort.on('message', async ({ id, image, minScore }) => {
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
    parentPort.postMessage({
      id,
      ok: true,
      width,
      height,
      predictions: predictions.map((prediction) => ({
        className: prediction.class,
        score: prediction.score,
        bbox: prediction.bbox,
      })),
    });
  } catch (error) {
    modelPromise = null;
    parentPort.postMessage({ id, ok: false, error: error?.message || String(error) });
  } finally {
    tensor?.dispose();
  }
});
