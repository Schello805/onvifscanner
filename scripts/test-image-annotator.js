const assert = require('node:assert/strict');
const sharp = require('sharp');
const { annotateDetectedObjects, createAnnotatedThumbnail, escapeXml } = require('./image-annotator');

async function runTests() {
  // Test 1: escapeXml
  assert.equal(escapeXml('<script>alert("xss & fun")</script>'), '&lt;script&gt;alert(&quot;xss &amp; fun&quot;)&lt;/script&gt;');

  // Test 2: Safe handling of empty/null inputs
  assert.equal(await annotateDetectedObjects(null, []), null);
  const dummyBuffer = Buffer.from('not an image');
  assert.deepEqual(await annotateDetectedObjects(dummyBuffer, []), dummyBuffer);

  // Test 3: Annotate real synthetic image
  const baseImage = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 40, b: 40 } }
  }).jpeg().toBuffer();

  const detections = [
    { className: 'person', score: 0.94, bbox: [100, 100, 150, 300], group: 'person' },
    { className: 'car', score: 0.88, bbox: [300, 200, 250, 180], group: 'vehicle' }
  ];

  const plates = [
    { plate: 'B-MW 1234', knownName: 'Michael', category: 'family', confidence: 95 }
  ];

  const annotated = await annotateDetectedObjects(baseImage, detections, { plates });
  assert.ok(Buffer.isBuffer(annotated));
  assert.ok(annotated.length > 0);

  // Check that the annotated image is a valid JPEG
  const meta = await sharp(annotated).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 480);

  // Test 4: Thumbnail generation
  const thumbnail = await createAnnotatedThumbnail(annotated, 320);
  assert.ok(typeof thumbnail === 'string');
  assert.ok(thumbnail.startsWith('data:image/jpeg;base64,'));

  console.log('✅ All image annotator tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
