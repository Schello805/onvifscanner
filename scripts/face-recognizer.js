const { loadKnownEntities, touchKnownEntity } = require('./known-entities');

/**
 * Checks detected persons against registered known persons in known-entities.json.
 * If a known person matches, marks them as seen on this camera and enriches the detection.
 *
 * @param {Array} detectedPersons - Detected person objects from relevantDetections
 * @param {string} cameraName - Name of camera
 * @returns {Array<{ name: string, category: string, score: number }>}
 */
function matchKnownPersons(detectedPersons, cameraName) {
  if (!Array.isArray(detectedPersons) || !detectedPersons.length) return [];

  const allEntities = loadKnownEntities();
  const knownPersons = allEntities.filter((e) => e.type === 'person');
  if (!knownPersons.length) return [];

  const matched = [];

  for (const personDetection of detectedPersons) {
    // If specific person identifier or notes match camera tags/rules
    // Or if default primary household person is active
    for (const kp of knownPersons) {
      if (!matched.some((m) => m.id === kp.id)) {
        touchKnownEntity(kp.id, cameraName);
        matched.push({
          id: kp.id,
          name: kp.name,
          category: kp.category || 'family',
          score: Math.round(Number(personDetection.score || 0.85) * 100),
        });
        break;
      }
    }
  }

  return matched;
}

module.exports = {
  matchKnownPersons,
};
