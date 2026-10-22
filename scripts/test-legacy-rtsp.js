const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { isLegacyRtspSource, sourceFingerprint, mediaSourceConfig, relayArguments } = require('./legacy-rtsp-source');

const uri = 'rtsp://192.0.2.10:554/user=demo_password=test-only-secret_channel=0_stream=1.sdp?real_stream';
const camera = { id: 'camera-with spaces\'and-quotes', username: 'demo', password: 'encrypted-test-password' };
assert.equal(isLegacyRtspSource(uri), true);
assert.equal(isLegacyRtspSource(uri.replaceAll('_', '&')), true);
assert.equal(isLegacyRtspSource('rtsp://192.0.2.10/Streaming/Channels/101'), false);
assert.equal(isLegacyRtspSource('http://192.0.2.10/user=demo_password=test_channel=0_stream=1.sdp'), false);
assert.equal(isLegacyRtspSource('invalid'), false);

const continuous = mediaSourceConfig({ camera, uri, alwaysOn: true, directory: '/tmp/project with \'quotes\'' });
assert.equal(continuous.source, 'publisher');
assert.equal(continuous.sourceOnDemand, false);
assert.equal(continuous.runOnInitRestart, true);
assert.equal(continuous.runOnDemand, '');
assert.ok(!continuous.runOnInit.includes('test-only-secret'));
assert.ok(!continuous.runOnInit.includes(camera.password));
const command = execFileSync('/bin/bash', ['-c', `set -- ${continuous.runOnInit}; printf '%s\\n' "$@"`], { encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(command, [
  '/bin/bash', '/tmp/project with \'quotes\'/scripts/legacy-rtsp-relay.sh', process.execPath,
  Buffer.from(camera.id).toString('base64url'), sourceFingerprint(uri, camera),
]);
const changed = mediaSourceConfig({ camera: { ...camera, password: 'changed-encrypted-password' }, uri, alwaysOn: true, directory: '/tmp/project with \'quotes\'' });
assert.notEqual(changed.runOnInit, continuous.runOnInit);
assert.notEqual(sourceFingerprint(uri, camera), sourceFingerprint(uri, { ...camera, password: 'changed-encrypted-password' }));

const onDemand = mediaSourceConfig({ camera, uri });
assert.equal(onDemand.runOnInit, '');
assert.equal(onDemand.runOnInitRestart, false);
assert.ok(onDemand.runOnDemand);
assert.equal(onDemand.runOnDemandRestart, true);
const normal = mediaSourceConfig({ camera, uri: 'rtsp://192.0.2.10/main', source: 'rtsp://demo:secret@192.0.2.10/main' });
assert.equal(normal.source, 'rtsp://demo:secret@192.0.2.10/main');
assert.equal(normal.sourceOnDemand, true);
assert.equal(normal.runOnInit, '');
assert.equal(normal.runOnDemand, '');
assert.equal(normal.runOnInitRestart, false);
assert.equal(normal.runOnDemandRestart, false);

const args = relayArguments(uri, 'rtsp://127.0.0.1:18554/camera');
assert.equal(args[args.indexOf('-i') + 1], uri);
assert.equal(args[args.indexOf('-c') + 1], 'copy');
assert.equal(args[args.indexOf('-loglevel') + 1], 'quiet');
assert.ok(args.includes('0:a:0?'));
assert.ok(!args.includes('-vf'));
assert.ok(!args.includes('libx264'));
assert.throws(() => relayArguments('file:///etc/passwd', 'rtsp://127.0.0.1:8554/camera'), /Quelle/);
assert.throws(() => relayArguments(uri, 'rtsp://192.0.2.10:8554/camera'), /lokales RTSP/);
console.log('Legacy RTSP tests passed: format detection, secret-free hooks, credential invalidation, shell quoting, on-demand lifecycle and stream-copy-only arguments.');
