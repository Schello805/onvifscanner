const assert = require('node:assert/strict');
const { isMotionScheduleActive } = require('./motion-schedule');
const {
  motionMonitoringRequested,
  requiresServerMotionValidation,
  motionCooldownSeconds,
  shouldAcceptExternalMotion,
} = require('./motion-policy');

const wednesdayAt23 = new Date(2026, 9, 14, 23, 0, 0);
const thursdayAt01 = new Date(2026, 9, 15, 1, 0, 0);
const thursdayAt07 = new Date(2026, 9, 15, 7, 0, 0);
const overnight = {
  motionScheduleEnabled: true,
  motionScheduleStart: '22:00',
  motionScheduleEnd: '06:00',
  motionScheduleDays: JSON.stringify([3]),
};

assert.equal(isMotionScheduleActive(overnight, wednesdayAt23), true);
assert.equal(isMotionScheduleActive(overnight, thursdayAt01), true);
assert.equal(isMotionScheduleActive(overnight, thursdayAt07), false);
assert.equal(motionMonitoringRequested({ recordMode: 'motion' }), true);
assert.equal(motionMonitoringRequested({ recordMode: 'off', notificationsEnabled: false }), false);
assert.equal(requiresServerMotionValidation({ motionIgnoreRegions: '[{"x":0,"y":0,"width":0.2,"height":0.2}]' }), true);
assert.equal(requiresServerMotionValidation({ licensePlateRecognitionEnabled: true }), true);
assert.equal(motionCooldownSeconds({ alarmCooldownSeconds: 1 }), 5);
assert.equal(motionCooldownSeconds({ alarmCooldownSeconds: 45 }), 45);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', ...overnight }, wednesdayAt23), true);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', ...overnight }, thursdayAt07), false);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', objectDetectionEnabled: true }, wednesdayAt23), false);

console.log('Motion policy tests passed.');
