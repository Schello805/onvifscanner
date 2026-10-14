const objectClassGroups = {
  person: new Set(['person']),
  vehicle: new Set(['bicycle', 'car', 'motorcycle', 'bus', 'truck', 'train', 'boat']),
  animal: new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']),
};

const objectClassLabels = {
  person: 'Person',
  bicycle: 'Fahrrad',
  car: 'Auto',
  motorcycle: 'Motorrad',
  bus: 'Bus',
  truck: 'Lkw',
  train: 'Zug',
  boat: 'Boot',
  bird: 'Vogel',
  cat: 'Katze',
  dog: 'Hund',
  horse: 'Pferd',
  sheep: 'Schaf',
  cow: 'Kuh',
  elephant: 'Elefant',
  bear: 'Bär',
  zebra: 'Zebra',
  giraffe: 'Giraffe',
};

function parseObjectGroups(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((group) => objectClassGroups[group]) : [];
  } catch {
    return [];
  }
}

function pointIsIgnored(x, y, ignoreRegions) {
  return ignoreRegions.some((region) =>
    x >= region.x && x <= region.x + region.width
    && y >= region.y && y <= region.y + region.height
  );
}

function detectionMotionRatio(prediction, result, motionEvidence) {
  if (!motionEvidence?.changedPixels?.length) return 1;
  const [x, y, width, height] = prediction.bbox || [];
  const left = Math.max(0, Math.floor((Number(x) / Math.max(1, result.width)) * motionEvidence.width));
  const right = Math.min(motionEvidence.width, Math.ceil(((Number(x) + Number(width)) / Math.max(1, result.width)) * motionEvidence.width));
  const top = Math.max(0, Math.floor((Number(y) / Math.max(1, result.height)) * motionEvidence.height));
  const bottom = Math.min(motionEvidence.height, Math.ceil(((Number(y) + Number(height)) / Math.max(1, result.height)) * motionEvidence.height));
  let boxPixels = 0;
  let changedPixels = 0;
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      boxPixels += 1;
      if (motionEvidence.changedPixels[row * motionEvidence.width + column]) changedPixels += 1;
    }
  }
  return boxPixels > 0 ? changedPixels / boxPixels : 0;
}

function requiredMotionRatio(prediction) {
  if (prediction.className === 'person') return 0.025;
  if (objectClassGroups.vehicle.has(prediction.className)) return 0.035;
  return 0.03;
}

function relevantDetections(result, camera, ignoreRegions, motionEvidence, options = {}) {
  const selectedGroups = options.vehicleOnly
    ? new Set(['vehicle'])
    : new Set(parseObjectGroups(camera.objectDetectionClasses));
  if (!selectedGroups.size) return [];

  return (result.predictions || []).flatMap((prediction) => {
    const group = Object.keys(objectClassGroups).find((key) =>
      selectedGroups.has(key) && objectClassGroups[key].has(prediction.className)
    );
    if (!group) return [];
    const [x, y, width, height] = prediction.bbox || [];
    const centerX = (Number(x) + Number(width) / 2) / Math.max(1, result.width);
    const centerY = (Number(y) + Number(height) / 2) / Math.max(1, result.height);
    if (pointIsIgnored(centerX, centerY, ignoreRegions)) return [];
    const motionRatio = detectionMotionRatio(prediction, result, motionEvidence);
    if (motionRatio < requiredMotionRatio(prediction)) return [];
    return [{ ...prediction, group, motionRatio }];
  });
}

function objectDetectionMessage(detections) {
  const strongestByClass = new Map();
  for (const detection of detections) {
    const current = strongestByClass.get(detection.className);
    if (!current || Number(detection.score) > Number(current.score)) {
      strongestByClass.set(detection.className, detection);
    }
  }
  const labels = [...strongestByClass.values()].map((detection) => {
    const label = objectClassLabels[detection.className] || detection.className || 'Objekt';
    const confidence = Math.round(Number(detection.score || 0) * 100);
    return `${label} (${confidence} %)`;
  });
  return `${labels.join(', ')} erkannt (lokale KI)`;
}

module.exports = {
  objectClassGroups,
  objectClassLabels,
  parseObjectGroups,
  detectionMotionRatio,
  relevantDetections,
  objectDetectionMessage,
};
