const { isMotionScheduleActive } = require('./motion-schedule');

const RECORDING_MODES = new Set([
  'off',
  'continuous',
  'scheduled_continuous',
  // Legacy aliases
  'motion',
  'scheduled_motion',
  'scheduled_motion_else_continuous',
  'scheduled_continuous_else_motion',
]);

function normalizeRecordingMode(camera) {
  const mode = String(camera?.recordMode || '');
  if (mode === 'off') return 'off';
  if (mode === 'scheduled_continuous' || (camera?.motionScheduleEnabled && mode.startsWith('scheduled_'))) {
    return 'scheduled_continuous';
  }
  if (mode === 'continuous' || mode === 'motion' || camera?.recordEnabled) return 'continuous';
  return 'off';
}

function recordingModeUsesSchedule(mode) {
  return String(mode || '') === 'scheduled_continuous';
}

function effectiveRecordingMode(camera, date = new Date()) {
  const mode = normalizeRecordingMode(camera);
  if (mode === 'off') return 'off';
  if (mode === 'scheduled_continuous') {
    const inSchedule = isMotionScheduleActive({ ...camera, motionScheduleEnabled: true }, date);
    return inSchedule ? 'continuous' : 'off';
  }
  return 'continuous';
}

module.exports = {
  RECORDING_MODES,
  normalizeRecordingMode,
  recordingModeUsesSchedule,
  effectiveRecordingMode,
};
