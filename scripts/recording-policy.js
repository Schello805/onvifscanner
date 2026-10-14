const { isMotionScheduleActive } = require('./motion-schedule');

const RECORDING_MODES = new Set([
  'off',
  'motion',
  'continuous',
  'scheduled_motion',
  'scheduled_continuous',
  'scheduled_motion_else_continuous',
  'scheduled_continuous_else_motion',
]);

function normalizeRecordingMode(camera) {
  const mode = String(camera?.recordMode || '');
  if (RECORDING_MODES.has(mode)) {
    if (camera?.motionScheduleEnabled && mode === 'motion') return 'scheduled_motion';
    return mode;
  }
  return camera?.recordEnabled ? 'motion' : 'off';
}

function recordingModeUsesSchedule(mode) {
  return String(mode || '').startsWith('scheduled_');
}

function effectiveRecordingMode(camera, date = new Date()) {
  const mode = normalizeRecordingMode(camera);
  if (mode === 'off' || mode === 'motion' || mode === 'continuous') return mode;
  const inSchedule = isMotionScheduleActive({ ...camera, motionScheduleEnabled: true }, date);
  if (mode === 'scheduled_motion') return inSchedule ? 'motion' : 'off';
  if (mode === 'scheduled_continuous') return inSchedule ? 'continuous' : 'off';
  if (mode === 'scheduled_motion_else_continuous') return inSchedule ? 'motion' : 'continuous';
  return inSchedule ? 'continuous' : 'motion';
}

module.exports = {
  RECORDING_MODES,
  normalizeRecordingMode,
  recordingModeUsesSchedule,
  effectiveRecordingMode,
};
