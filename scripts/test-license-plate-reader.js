const assert = require('assert');
const { validatePlate, parseTsv } = require('./license-plate-reader');

console.log('Testing license plate reader validation and parsing...');

// German standard plates
const de1 = validatePlate('M-XY 1234');
assert.strictEqual(de1?.plate, 'M-XY 1234');
assert.strictEqual(de1?.type, 'de_standard');

const de2 = validatePlate('B MW 1234');
assert.strictEqual(de2?.plate, 'B-MW 1234');

const deElectric = validatePlate('STA-AB 123E');
assert.strictEqual(deElectric?.plate, 'STA-AB 123E');

const deHistoric = validatePlate('HH-X 999H');
assert.strictEqual(deHistoric?.plate, 'HH-X 999H');

// EU badge artifact removal
const eu1 = validatePlate('[D] M-XY 1234');
assert.strictEqual(eu1?.plate, 'M-XY 1234');

const eu2 = validatePlate('by) M-XY 1234');
assert.strictEqual(eu2?.plate, 'M-XY 1234');

// State seal artifact removal between city and middle code
const seal1 = validatePlate('STA 0 AB 1234');
assert.strictEqual(seal1?.plate, 'STA-AB 1234');

// Swiss format
const swiss = validatePlate('ZH 123456');
assert.strictEqual(swiss?.plate, 'ZH 123456');
assert.strictEqual(swiss?.type, 'swiss');

// Austrian format
const austria = validatePlate('W-12345A');
assert.strictEqual(austria?.plate, 'W-12345 A');
assert.strictEqual(austria?.type, 'austrian');

// TSV parsing with noise
const dummyTsv = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
1\t1\t0\t0\t0\t0\t0\t0\t800\t300\t-1\t
5\t1\t1\t1\t1\t1\t50\t100\t80\t30\t92.5\tM-XY
5\t1\t1\t1\t1\t2\t140\t100\t90\t30\t96.2\t1234
`;
const parsed = parseTsv(dummyTsv);
assert(parsed.length > 0, 'Should find at least 1 plate candidate in TSV');
assert.strictEqual(parsed[0].plate, 'M-XY 1234');

console.log('License plate reader tests passed successfully.');
