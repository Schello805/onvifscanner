const sharp = require('sharp');
async function test() {
  try {
    const img = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const out = await sharp(img).resize({ width: 512 }).toBuffer();
    console.log("Success, size:", out.length);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
