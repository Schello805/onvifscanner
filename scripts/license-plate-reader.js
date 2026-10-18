const { spawn } = require('child_process');
const sharp = require('sharp');
const { findKnownEntity } = require('./known-entities');

function validatePlate(input) {
  let str = String(input || '').toUpperCase().trim();
  str = str.replace(/^[\[\(\{<|]+/, '').trim();
  const preTokens = str.split(/[ \-]/).map((t) => t.replace(/[^A-Z0-9ÄÖÜ]/g, '')).filter(Boolean);
  if (preTokens.length >= 3 && /^(D|A|CH|NL|PL|F|I|BY|EU|E)$/.test(preTokens[0])) {
    str = str.replace(new RegExp(`^[^A-Z0-9ÄÖÜ]*${preTokens[0]}[^A-Z0-9ÄÖÜ]*\\s+`, 'i'), '');
  }

  const clean = str.replace(/[^A-Z0-9ÄÖÜ -]/g, '').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(/[ -]/).filter(Boolean);

  // German plate structure: City (1-3) + Middle (1-2) + Digits (1-4) + optional [EH]
  if (tokens.length >= 2 && tokens.length <= 4) {
    if (/^[A-ZÄÖÜ]{1,3}$/.test(tokens[0])) {
      const city = tokens[0];
      let rest = tokens.slice(1).join('');
      // Strip TÜV / state seal artifact if OCR read it as a single character
      if (/^[0OCQ][A-ZÄÖÜ]{1,2}\d{1,4}[EH]?$/.test(rest)) {
        rest = rest.slice(1);
      }
      const m = rest.match(/^([A-ZÄÖÜ]{1,2})(\d{1,4})([EH])?$/);
      if (m) {
        return { plate: `${city}-${m[1]} ${m[2]}${m[3] || ''}`, type: 'de_standard' };
      }
      const mOfficial = rest.match(/^(\d{1,5})$/);
      if (mOfficial) {
        return { plate: `${city} ${mOfficial[1]}`, type: 'de_official' };
      }
    }
  }

  // Compact pattern (e.g. MXY1234, STAAB1234)
  const compact = clean.replace(/[^A-Z0-9ÄÖÜ]/g, '');
  const mCompact = compact.match(/^([A-ZÄÖÜ]{1,3})([A-ZÄÖÜ]{1,2})(\d{1,4})([EH])?$/);
  if (mCompact) {
    return { plate: `${mCompact[1]}-${mCompact[2]} ${mCompact[3]}${mCompact[4] || ''}`, type: 'de_standard' };
  }

  // Swiss format: ZH 123456
  const swissMatch = compact.match(/^(AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)(\d{1,6})$/);
  if (swissMatch) {
    return { plate: `${swissMatch[1]} ${swissMatch[2]}`, type: 'swiss' };
  }

  // Austrian format: W-12345A or MD-123AB
  const austriaMatch = compact.match(/^([A-Z]{1,2})(\d{3,6})([A-Z]{1,2})$/);
  if (austriaMatch) {
    return { plate: `${austriaMatch[1]}-${austriaMatch[2]} ${austriaMatch[3]}`, type: 'austrian' };
  }

  return null;
}

function parseTsv(tsv) {
  const words = [];
  for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns.length < 12) continue;
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join('\t').trim();
    if (!text || !Number.isFinite(confidence) || confidence < 25) continue;
    words.push({
      text,
      confidence,
      left: Number(columns[6]),
      top: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      lineNum: Number(columns[4]),
    });
  }

  const candidates = [];
  // Evaluate sliding window of 1 to 4 adjacent words
  for (let i = 0; i < words.length; i += 1) {
    for (let len = 1; len <= Math.min(4, words.length - i); len += 1) {
      const slice = words.slice(i, i + len);
      const minTop = Math.min(...slice.map((w) => w.top));
      const maxBottom = Math.max(...slice.map((w) => w.top + w.height));
      const avgHeight = slice.reduce((acc, w) => acc + w.height, 0) / slice.length;
      if (maxBottom - minTop > avgHeight * 2.2) continue;

      const raw = slice.map((w) => w.text).join(' ');
      const avgConf = Math.round(slice.reduce((acc, w) => acc + w.confidence, 0) / slice.length);
      const valid = validatePlate(raw);
      if (valid) {
        let score = avgConf;
        if (valid.type === 'de_standard') score += 12;
        // Prioritize registered known entities
        try {
          const compact = valid.plate.replace(/[^A-Z0-9ÄÖÜ]/g, '');
          if (findKnownEntity(compact, 'plate') || findKnownEntity(valid.plate, 'plate')) {
            score += 80;
          }
        } catch {
          // ignore lookup errors
        }

        candidates.push({
          plate: valid.plate,
          confidence: Math.min(99, Math.max(30, score)),
          rawConfidence: avgConf,
          raw,
        });
      }
    }
  }

  // Deduplicate by plate, keeping highest confidence
  const bestByPlate = new Map();
  for (const item of candidates) {
    const existing = bestByPlate.get(item.plate);
    if (!existing || item.confidence > existing.confidence) {
      bestByPlate.set(item.plate, item);
    }
  }

  return [...bestByPlate.values()].sort((a, b) => b.confidence - a.confidence);
}

function runTesseract(image, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      'stdin',
      'stdout',
      '-l', 'eng',
      'tsv',
    ];
    if (options.psm !== undefined) {
      args.splice(2, 0, '--psm', String(options.psm));
    }

    const process = spawn('tesseract', args, { stdio: ['pipe', 'pipe', 'pipe'] });
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

function buildIgnoreOverlays(x, y, width, height, imageWidth, imageHeight, ignoreRegions) {
  const right = x + width;
  const bottom = y + height;
  return (ignoreRegions || []).flatMap((region) => {
    const regionLeft = Math.floor(Number(region.x) * imageWidth);
    const regionTop = Math.floor(Number(region.y) * imageHeight);
    const regionRight = Math.ceil((Number(region.x) + Number(region.width)) * imageWidth);
    const regionBottom = Math.ceil((Number(region.y) + Number(region.height)) * imageHeight);
    const left = Math.max(x, regionLeft);
    const top = Math.max(y, regionTop);
    const overlayWidth = Math.min(right, regionRight) - left;
    const overlayHeight = Math.min(bottom, regionBottom) - top;
    if (overlayWidth <= 0 || overlayHeight <= 0) return [];
    return [{
      input: {
        create: {
          width: overlayWidth,
          height: overlayHeight,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      },
      left: left - x,
      top: top - y,
    }];
  });
}

async function prepareCrop(image, x, y, width, height, imageWidth, imageHeight, ignoreRegions) {
  if (width < 32 || height < 16) return null;
  const overlays = buildIgnoreOverlays(x, y, width, height, imageWidth, imageHeight, ignoreRegions);
  const croppedImage = await sharp(image, { limitInputPixels: 32_000_000 })
    .extract({ left: x, top: y, width, height })
    .toBuffer();
  const maskedCrop = overlays.length
    ? await sharp(croppedImage, { limitInputPixels: 32_000_000 }).composite(overlays).toBuffer()
    : croppedImage;

  let pipeline = sharp(maskedCrop, { limitInputPixels: 32_000_000 });
  if (width < 450) {
    pipeline = pipeline.resize({ width: Math.min(800, width * 2), withoutEnlargement: false });
  }

  return pipeline
    .greyscale()
    .normalize()
    .png()
    .toBuffer();
}

async function vehiclePlateCrops(image, imageWidth, imageHeight, prediction, ignoreRegions) {
  const [rawX, rawY, rawWidth, rawHeight] = prediction.bbox || [];
  const baseX = Math.max(0, Math.floor(Number(rawX) || 0));
  const baseY = Math.max(0, Math.floor(Number(rawY) || 0));
  const baseW = Math.max(1, Math.floor(Number(rawWidth) || 0));
  const baseH = Math.max(1, Math.floor(Number(rawHeight) || 0));

  const crops = [];

  // Candidate 1: Focused bumper band (middle 70% width, 45% - 88% height)
  {
    const x = Math.max(0, Math.floor(baseX + baseW * 0.15));
    const right = Math.min(imageWidth, Math.ceil(baseX + baseW * 0.85));
    const y = Math.max(0, Math.floor(baseY + baseH * 0.45));
    const bottom = Math.min(imageHeight, Math.ceil(baseY + baseH * 0.88));
    const w = right - x;
    const h = bottom - y;
    if (w >= 32 && h >= 16) {
      const buf = await prepareCrop(image, x, y, w, h, imageWidth, imageHeight, ignoreRegions);
      if (buf) crops.push(buf);
    }
  }

  // Candidate 2: Lower bumper center (middle 60% width, 55% - 94% height)
  {
    const x = Math.max(0, Math.floor(baseX + baseW * 0.20));
    const right = Math.min(imageWidth, Math.ceil(baseX + baseW * 0.80));
    const y = Math.max(0, Math.floor(baseY + baseH * 0.55));
    const bottom = Math.min(imageHeight, Math.ceil(baseY + baseH * 0.94));
    const w = right - x;
    const h = bottom - y;
    if (w >= 32 && h >= 16) {
      const buf = await prepareCrop(image, x, y, w, h, imageWidth, imageHeight, ignoreRegions);
      if (buf) crops.push(buf);
    }
  }

  // Candidate 3: Broad vehicle lower half (entire vehicle width, 35% - 95% height)
  {
    const x = baseX;
    const right = Math.min(imageWidth, Math.ceil(baseX + baseW));
    const y = Math.max(0, Math.floor(baseY + baseH * 0.35));
    const bottom = Math.min(imageHeight, Math.ceil(baseY + baseH * 0.95));
    const w = right - x;
    const h = bottom - y;
    if (w >= 32 && h >= 16) {
      const buf = await prepareCrop(image, x, y, w, h, imageWidth, imageHeight, ignoreRegions);
      if (buf) crops.push(buf);
    }
  }

  return crops;
}

async function readLicensePlates(image, detectionResult, vehicleDetections, ignoreRegions = []) {
  const candidates = [...vehicleDetections]
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 2);

  const results = [];

  for (const vehicle of candidates) {
    const crops = await vehiclePlateCrops(
      image,
      detectionResult.width,
      detectionResult.height,
      vehicle,
      ignoreRegions
    );

    let vehicleBest = null;

    for (const crop of crops) {
      // 1. Run automatic page segmentation (PSM 3 by default)
      let detectedPlates = await runTesseract(crop);
      // 2. If no plate found, try sparse text mode (PSM 11)
      if (!detectedPlates.length) {
        try {
          detectedPlates = await runTesseract(crop, { psm: 11 });
        } catch {
          // ignore
        }
      }

      if (detectedPlates.length) {
        const topCandidate = detectedPlates[0];
        if (!vehicleBest || topCandidate.confidence > vehicleBest.confidence) {
          vehicleBest = topCandidate;
        }
        // If candidate matches a registered entity or has very high confidence, stop trying further crops
        if (topCandidate.confidence >= 90) break;
      }
    }

    if (vehicleBest && !results.some((entry) => entry.plate === vehicleBest.plate)) {
      results.push({
        plate: vehicleBest.plate,
        confidence: vehicleBest.confidence,
        vehicleClass: vehicle.className,
        vehicleScore: vehicle.score,
      });
    }
  }

  return results;
}

module.exports = { readLicensePlates, validatePlate, parseTsv };
