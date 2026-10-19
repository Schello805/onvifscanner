const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { objectClassLabels } = require('./object-detection-policy');

const SNAPSHOTS_DIR = path.join(process.cwd(), 'data', 'snapshots');

function ensureSnapshotsDir() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function escapeXml(unsafe) {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Annotates an image buffer with red bounding boxes and badges for detected objects.
 *
 * @param {Buffer} imageBuffer - JPEG/PNG/WebP image buffer
 * @param {Array} detections - Array of { className, score, bbox: [x, y, width, height], group }
 * @param {Object} [options] - Options: sourceWidth, sourceHeight, strokeColor, plates
 * @returns {Promise<Buffer>} - Annotated JPEG buffer
 */
async function annotateDetectedObjects(imageBuffer, detections = [], options = {}) {
  if (!Buffer.isBuffer(imageBuffer) || !Array.isArray(detections) || detections.length === 0) {
    return imageBuffer;
  }

  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return imageBuffer;

    const sourceWidth = Math.max(1, Number(options.sourceWidth) || width);
    const sourceHeight = Math.max(1, Number(options.sourceHeight) || height);
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;

    const strokeColor = options.strokeColor || '#ef4444'; // Red
    const badgeBgColor = options.badgeBgColor || '#dc2626'; // Darker red for text badge
    const strokeWidth = Math.max(2, Math.min(8, Math.round(width / 320)));
    const fontSize = Math.max(12, Math.min(32, Math.round(width / 45)));

    const plates = Array.isArray(options.plates) ? options.plates : [];
    const svgElements = [];

    // Find vehicles in detections
    const vehicleDetections = detections.filter((d) =>
      d.group === 'vehicle' || ['car', 'truck', 'bus', 'motorcycle'].includes(d.className)
    );

    for (const detection of detections) {
      if (!Array.isArray(detection.bbox) || detection.bbox.length < 4) continue;
      const [rawX, rawY, rawW, rawH] = detection.bbox;
      if (typeof rawX !== 'number' || typeof rawY !== 'number') continue;

      let x = Math.max(0, Math.min(width - 2, Math.round(rawX * scaleX)));
      let y = Math.max(0, Math.min(height - 2, Math.round(rawY * scaleY)));
      let w = Math.max(4, Math.min(width - x, Math.round(rawW * scaleX)));
      let h = Math.max(4, Math.min(height - y, Math.round(rawH * scaleY)));

      // Build label
      const baseLabel = objectClassLabels[detection.className] || detection.className || 'Objekt';
      const confidence = typeof detection.score === 'number' ? ` ${Math.round(detection.score * 100)}%` : '';
      let label = `${baseLabel}${confidence}`;

      // If vehicle, match plate precisely by vehicleBbox or fallback if single vehicle
      const isVehicle = detection.group === 'vehicle' || ['car', 'truck', 'bus'].includes(detection.className);
      if (isVehicle && plates.length > 0) {
        const matchingPlate = plates.find((p) => {
          if (p.vehicleBbox && Array.isArray(p.vehicleBbox)) {
            return Math.abs(p.vehicleBbox[0] - rawX) < 5
              && Math.abs(p.vehicleBbox[1] - rawY) < 5
              && Math.abs(p.vehicleBbox[2] - rawW) < 5
              && Math.abs(p.vehicleBbox[3] - rawH) < 5;
          }
          return false;
        }) || (plates.length === 1 && vehicleDetections.length === 1 ? plates[0] : null);

        if (matchingPlate?.knownName) {
          label = `${matchingPlate.knownName} (${matchingPlate.plate})`;
        } else if (matchingPlate?.plate) {
          label += ` · ${matchingPlate.plate}`;
        }
      }

      // Calculate label badge sizing
      const charWidth = fontSize * 0.62;
      const badgePaddingX = Math.round(fontSize * 0.5);
      const badgeWidth = Math.round(label.length * charWidth + badgePaddingX * 2);
      const badgeHeight = Math.round(fontSize * 1.5);

      // Position badge: default above box, or inside top if no room above
      let badgeX = Math.max(2, Math.min(width - badgeWidth - 2, x));
      let badgeY = y - badgeHeight - 2;
      if (badgeY < 2) {
        badgeY = Math.min(height - badgeHeight - 2, y + strokeWidth + 2);
      }

      const textX = badgeX + badgePaddingX;
      const textY = badgeY + Math.round(fontSize * 1.08);

      // SVG Rectangle & Badge
      svgElements.push(`
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" rx="${Math.max(2, strokeWidth / 2)}" />
        <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" fill="${badgeBgColor}" rx="${Math.max(2, strokeWidth / 2)}" />
        <text x="${textX}" y="${textY}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff">${escapeXml(label)}</text>
      `.trim());
    }

    if (svgElements.length === 0) return imageBuffer;

    const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        ${svgElements.join('\n')}
      </svg>
    `.trim();

    return await sharp(imageBuffer)
      .composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0,
      }])
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    console.warn('[Image Annotator] Konnte rote Rahmen nicht einzeichnen:', err?.message || err);
    return imageBuffer;
  }
}

/**
 * Creates a base64 data URL thumbnail from an image buffer (max 640x480).
 * Kept for backwards compatibility if needed.
 *
 * @param {Buffer} imageBuffer
 * @param {number} [maxWidth=640]
 * @param {number} [quality=65]
 * @returns {Promise<string|null>} - Data URL 'data:image/jpeg;base64,...'
 */
async function createAnnotatedThumbnail(imageBuffer, maxWidth = 640, quality = 65) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) return null;
  try {
    const resized = await sharp(imageBuffer)
      .resize(maxWidth, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, progressive: true })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Saves a snapshot file to disk in data/snapshots/<id>.jpg
 * Resizes cleanly to max 1280px with quality 75.
 *
 * @param {Buffer} imageBuffer
 * @param {string} id
 * @returns {Promise<string|null>} - API URL path e.g. '/api/snapshots/<id>'
 */
async function saveSnapshotFile(imageBuffer, id) {
  if (!Buffer.isBuffer(imageBuffer) || !id) return null;
  try {
    ensureSnapshotsDir();
    const safeId = String(id).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeId) return null;
    const destPath = path.join(SNAPSHOTS_DIR, `${safeId}.jpg`);
    await sharp(imageBuffer)
      .resize(1280, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, progressive: true })
      .toFile(destPath);
    return `/api/snapshots/${safeId}`;
  } catch (error) {
    console.warn('[Snapshot] Speichern fehlgeschlagen:', error?.message || error);
    return null;
  }
}

/**
 * Deletes a snapshot file from disk in data/snapshots/<id>.jpg
 *
 * @param {string} idOrUrl
 */
async function deleteSnapshotFile(idOrUrl) {
  if (!idOrUrl) return;
  try {
    const safeId = String(idOrUrl).replace(/^\/api\/snapshots\//, '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeId) return;
    const destPath = path.join(SNAPSHOTS_DIR, `${safeId}.jpg`);
    if (fs.existsSync(destPath)) {
      await fs.promises.unlink(destPath).catch(() => {});
    }
  } catch {
    // quiet
  }
}

module.exports = {
  annotateDetectedObjects,
  createAnnotatedThumbnail,
  saveSnapshotFile,
  deleteSnapshotFile,
  escapeXml,
  SNAPSHOTS_DIR,
};
