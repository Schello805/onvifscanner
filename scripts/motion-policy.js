const { isMotionScheduleActive } = require('./motion-schedule');

function parseIgnoreRegions(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((region) => region && typeof region === 'object') : [];
  } catch {
    return [];
  }
}

function motionMonitoringRequested(camera) {
  const recordMode = camera?.recordMode;
  return recordMode === 'motion'
    || recordMode === 'continuous'
    || (Boolean(camera?.recordEnabled) && recordMode !== 'off')
    || Boolean(camera?.notificationsEnabled);
}

function requiresServerMotionValidation(camera) {
  return parseIgnoreRegions(camera?.motionIgnoreRegions).length > 0
    || Boolean(camera?.objectDetectionEnabled)
    || Boolean(camera?.licensePlateRecognitionEnabled);
}

function motionCooldownSeconds(camera) {
  return Math.max(5, Math.min(3600, Number(camera?.alarmCooldownSeconds) || 30));
}

function shouldAcceptExternalMotion(camera, date = new Date()) {
  return motionMonitoringRequested(camera)
    && isMotionScheduleActive(camera, date)
    && !requiresServerMotionValidation(camera);
}

module.exports = {
  motionMonitoringRequested,
  requiresServerMotionValidation,
  motionCooldownSeconds,
  shouldAcceptExternalMotion,
};
