const assert = require('node:assert/strict');
const {
  detectionMotionRatio,
  relevantDetections,
  objectDetectionMessage,
} = require('./object-detection-policy');

const result = {
  width: 100,
  height: 100,
  predictions: [{ className: 'bicycle', score: 0.82, bbox: [0, 0, 100, 100] }],
};
const camera = { objectDetectionClasses: ['vehicle'] };

const sparseMotion = { width: 10, height: 10, changedPixels: new Uint8Array(100) };
sparseMotion.changedPixels.set([1, 1], 0);
assert.equal(detectionMotionRatio(result.predictions[0], result, sparseMotion), 0.02);
assert.deepEqual(relevantDetections(result, camera, [], sparseMotion), []);

const relevantMotion = { width: 10, height: 10, changedPixels: new Uint8Array(100) };
relevantMotion.changedPixels.set([1, 1, 1, 1], 0);
const detections = relevantDetections(result, camera, [], relevantMotion);
assert.equal(detections.length, 1);
assert.equal(detections[0].group, 'vehicle');
assert.equal(detections[0].motionRatio, 0.04);
assert.equal(objectDetectionMessage(detections), 'Fahrrad (82 %) erkannt (lokale KI)');

assert.deepEqual(
  relevantDetections(result, camera, [{ x: 0, y: 0, width: 1, height: 1 }], relevantMotion),
  [],
);
assert.equal(
  relevantDetections(result, { objectDetectionClasses: ['person'] }, [], relevantMotion).length,
  0,
);

const excludedVehicleClasses = {
  width: 100,
  height: 100,
  predictions: [
    { className: 'train', score: 0.91, bbox: [0, 0, 100, 100] },
    { className: 'boat', score: 0.88, bbox: [0, 0, 100, 100] },
  ],
};
assert.deepEqual(relevantDetections(excludedVehicleClasses, camera, [], relevantMotion), []);
assert.deepEqual(relevantDetections(excludedVehicleClasses, camera, [], relevantMotion, { vehicleOnly: true }), []);

console.log('Object detection policy tests passed.');
