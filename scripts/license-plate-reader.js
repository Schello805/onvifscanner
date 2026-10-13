const { spawn } = require('child_process');
const sharp = require('sharp');

function normalizePlate(value) {
  const compact = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ -]/g, '')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-');
  const plain = compact.replace(/-/g, '');
  if (plain.length < 4 || plain.length > 10) return null;
  if (!/[A-ZÄÖÜ]/.test(plain) || !/\d/.test(plain)) return null;
  if (!/^[A-ZÄÖÜ]{1,5}\d{1,4}[EH]?$/.test(plain)) return null;
  return compact;
}

function parseTsv(tsv) {
  const words = [];
  let confidenceSum = 0;
  for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12) continue;
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join('\t').trim();
    if (!text || !Number.isFinite(confidence) || confidence < 35) continue;
    words.push(text);
    confidenceSum += confidence;
  }
  const plate = normalizePlate(words.join(''));
  if (!plate) return null;
  return {
    plate,
    confidence: Math.round(confidenceSum / Math.max(1, words.length)),
  };
}

function runTesseract(image) {
  return new Promise((resolve, reject) => {
    const process = spawn('tesseract', [
      'stdin',
      'stdout',
      '--psm',
      '7',
      '-l',
      'eng',
      '-c',
      'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ÄÖÜ- ',
      'tsv',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('Kennzeichen-OCR Timeout'));
    }, 8_000);
    process.stdout.on('data', (chunk) => stdout.push(chunk));
    process.stderr.on('data', (chunk) => stderr.push(chunk));
    process.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Tesseract beendet (${code})`));
        return;
      }
      resolve(parseTsv(Buffer.concat(stdout).toString('utf8')));
    });
    process.stdin.on('error', () => undefined);
    process.stdin.end(image);
  });
}

async function vehiclePlateCrop(image, imageWidth, imageHeight, prediction) {
  const [rawX, rawY, rawWidth, rawHeight] = prediction.bbox || [];
  const x = Math.max(0, Math.floor(Number(rawX) || 0));
  const y = Math.max(0, Math.floor((Number(rawY) || 0) + (Number(rawHeight) || 0) * 0.32));
  const right = Math.min(imageWidth, Math.ceil((Number(rawX) || 0) + (Number(rawWidth) || 0)));
  const bottom = Math.min(imageHeight, Math.ceil((Number(rawY) || 0) + (Number(rawHeight) || 0)));
  const width = right - x;
  const height = bottom - y;
  if (width < 32 || height < 16) return null;
  return sharp(image, { limitInputPixels: 32_000_000 })
    .extract({ left: x, top: y, width, height })
    .resize({ width: Math.max(900, width * 4), withoutEnlargement: false })
    .greyscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function readLicensePlates(image, detectionResult, vehicleDetections) {
  const candidates = [...vehicleDetections]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 2);
  const results = [];
  for (const vehicle of candidates) {
    const crop = await vehiclePlateCrop(image, detectionResult.width, detectionResult.height, vehicle);
    if (!crop) continue;
    const recognized = await runTesseract(crop);
    if (!recognized || results.some((entry) => entry.plate === recognized.plate)) continue;
    results.push({
      ...recognized,
      vehicleClass: vehicle.className,
      vehicleScore: vehicle.score,
    });
  }
  return results;
}

module.exports = { readLicensePlates };
