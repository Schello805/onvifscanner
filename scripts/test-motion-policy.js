const assert = require('node:assert/strict');
const { isMotionScheduleActive } = require('./motion-schedule');
const { effectiveRecordingMode } = require('./recording-policy');
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
assert.equal(effectiveRecordingMode({ recordMode: 'off' }, wednesdayAt23), 'off');
assert.equal(effectiveRecordingMode({ recordMode: 'motion' }, wednesdayAt23), 'motion');
assert.equal(effectiveRecordingMode({ recordMode: 'continuous' }, wednesdayAt23), 'continuous');
assert.equal(effectiveRecordingMode({ recordMode: 'continuous', ...overnight }, thursdayAt07), 'continuous');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_motion', ...overnight }, wednesdayAt23), 'motion');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_motion', ...overnight }, thursdayAt07), 'off');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_continuous', ...overnight }, wednesdayAt23), 'continuous');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_continuous', ...overnight }, thursdayAt07), 'off');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_motion_else_continuous', ...overnight }, wednesdayAt23), 'motion');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_motion_else_continuous', ...overnight }, thursdayAt07), 'continuous');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_continuous_else_motion', ...overnight }, wednesdayAt23), 'continuous');
assert.equal(effectiveRecordingMode({ recordMode: 'scheduled_continuous_else_motion', ...overnight }, thursdayAt07), 'motion');
assert.equal(motionMonitoringRequested({ recordMode: 'motion' }), true);
assert.equal(motionMonitoringRequested({ recordMode: 'continuous', notificationsEnabled: false }), true);
process.env.ENABLE_MOTION_ON_CONTINUOUS = 'false';
assert.equal(motionMonitoringRequested({ recordMode: 'continuous', notificationsEnabled: false }), false);
assert.equal(motionMonitoringRequested({ recordMode: 'continuous', notificationsEnabled: true }), true);
delete process.env.ENABLE_MOTION_ON_CONTINUOUS;
assert.equal(motionMonitoringRequested({ recordMode: 'off', notificationsEnabled: false }), false);
assert.equal(motionMonitoringRequested({ recordMode: 'scheduled_motion', notificationsEnabled: true, ...overnight }, thursdayAt07), false);
assert.equal(motionMonitoringRequested({ recordMode: 'scheduled_continuous_else_motion', ...overnight }, thursdayAt07), true);
assert.equal(requiresServerMotionValidation({ motionIgnoreRegions: '[{"x":0,"y":0,"width":0.2,"height":0.2}]' }), true);
assert.equal(requiresServerMotionValidation({ licensePlateRecognitionEnabled: true }), true);
assert.equal(motionCooldownSeconds({ alarmCooldownSeconds: 1 }), 10);
assert.equal(motionCooldownSeconds({ alarmCooldownSeconds: 45 }), 45);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', ...overnight }, wednesdayAt23), true);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', ...overnight }, thursdayAt07), false);
assert.equal(shouldAcceptExternalMotion({ recordMode: 'motion', objectDetectionEnabled: true }, wednesdayAt23), false);

console.log('Motion policy tests passed.');
