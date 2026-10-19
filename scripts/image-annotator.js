const sharp = require('sharp');
const { objectClassLabels } = require('./object-detection-policy');

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

    // Map any recognized plates to vehicles if applicable
    let plateIndex = 0;

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

      // If vehicle and plate exists, append plate
      if ((detection.group === 'vehicle' || ['car', 'truck', 'bus'].includes(detection.className)) && plates.length > 0) {
        const plate = plates[plateIndex % plates.length];
        plateIndex += 1;
        if (plate?.knownName) {
          label = `${plate.knownName} (${plate.plate})`;
        } else if (plate?.plate) {
          label += ` · ${plate.plate}`;
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

module.exports = {
  annotateDetectedObjects,
  createAnnotatedThumbnail,
  escapeXml,
};
