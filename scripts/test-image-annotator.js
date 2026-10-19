const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
  annotateDetectedObjects,
  createAnnotatedThumbnail,
  saveSnapshotFile,
  deleteSnapshotFile,
  escapeXml,
  SNAPSHOTS_DIR,
} = require('./image-annotator');

async function runTests() {
  // Test 1: escapeXml
  assert.equal(escapeXml('<script>alert("xss & fun")</script>'), '&lt;script&gt;alert(&quot;xss &amp; fun&quot;)&lt;/script&gt;');

  // Test 2: Safe handling of empty/null inputs
  assert.equal(await annotateDetectedObjects(null, []), null);
  const dummyBuffer = Buffer.from('not an image');
  assert.deepEqual(await annotateDetectedObjects(dummyBuffer, []), dummyBuffer);

  // Test 3: Annotate real synthetic image with precise bbox matching
  const baseImage = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 40, b: 40 } }
  }).jpeg().toBuffer();

  const car1Bbox = [50, 100, 200, 150];
  const car2Bbox = [300, 100, 200, 150];

  const detections = [
    { className: 'car', score: 0.90, bbox: car1Bbox, group: 'vehicle' },
    { className: 'car', score: 0.85, bbox: car2Bbox, group: 'vehicle' },
  ];

  const plates = [
    { plate: 'B-MW 1234', knownName: 'Michael', category: 'family', confidence: 95, vehicleBbox: car2Bbox },
  ];

  const annotated = await annotateDetectedObjects(baseImage, detections, { plates });
  assert.ok(Buffer.isBuffer(annotated));
  assert.ok(annotated.length > 0);

  // Check valid JPEG output
  const meta = await sharp(annotated).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 480);

  // Test 4: File snapshot saving and cleanup
  const testId = `test_snap_${Date.now()}`;
  const snapshotUrl = await saveSnapshotFile(annotated, testId);
  assert.equal(snapshotUrl, `/api/snapshots/${testId}`);

  const savedFile = path.join(SNAPSHOTS_DIR, `${testId}.jpg`);
  assert.ok(fs.existsSync(savedFile), 'Snapshot file must exist on disk');

  // Test 5: Delete snapshot file
  await deleteSnapshotFile(testId);
  assert.ok(!fs.existsSync(savedFile), 'Snapshot file must be deleted');

  // Test 6: Delete snapshot by URL format
  const testId2 = `test_snap2_${Date.now()}`;
  await saveSnapshotFile(annotated, testId2);
  const savedFile2 = path.join(SNAPSHOTS_DIR, `${testId2}.jpg`);
  assert.ok(fs.existsSync(savedFile2));
  await deleteSnapshotFile(`/api/snapshots/${testId2}`);
  assert.ok(!fs.existsSync(savedFile2));

  console.log('✅ All image annotator tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
