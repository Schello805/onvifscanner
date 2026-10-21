const {
  effectiveRecordingMode,
  normalizeRecordingMode,
  recordingModeUsesSchedule,
} = require('./recording-policy');
const { isMotionScheduleActive } = require('./motion-schedule');

function parseIgnoreRegions(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((region) => region && typeof region === 'object') : [];
  } catch {
    return [];
  }
}

function motionMonitoringRequested(camera, date = new Date()) {
  const mode = effectiveRecordingMode(camera, date);
  if (mode === 'motion') return true;
  if (mode === 'continuous') {
    const continuousAnalysisEnabled = process.env.ENABLE_MOTION_ON_CONTINUOUS !== 'false';
    if (!continuousAnalysisEnabled && !camera?.notificationsEnabled && !camera?.objectDetectionEnabled && !camera?.licensePlateRecognitionEnabled) {
      return false;
    }
    return true;
  }
  if (!camera?.notificationsEnabled) return false;

  const normalized = normalizeRecordingMode(camera);
  return !recordingModeUsesSchedule(normalized)
    || isMotionScheduleActive({ ...camera, motionScheduleEnabled: true }, date);
}

function requiresServerMotionValidation(camera) {
  return parseIgnoreRegions(camera?.motionIgnoreRegions).length > 0
    || Boolean(camera?.objectDetectionEnabled)
    || Boolean(camera?.licensePlateRecognitionEnabled);
}

function motionCooldownSeconds(camera) {
  return Math.max(10, Math.min(3600, Number(camera?.alarmCooldownSeconds) || 30));
}

function shouldAcceptExternalMotion(camera, date = new Date()) {
  return motionMonitoringRequested(camera, date)
    && !requiresServerMotionValidation(camera);
}

module.exports = {
  motionMonitoringRequested,
  requiresServerMotionValidation,
  motionCooldownSeconds,
  shouldAcceptExternalMotion,
};
