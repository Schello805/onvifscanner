const fs = require('fs');
const os = require('os');

/**
 * Returns optimized ffmpeg hardware acceleration arguments based on platform and environment.
 * Supports: VAAPI (Intel/AMD Linux), QSV (QuickSync), VideoToolbox (macOS Apple Silicon/Intel), CUDA (Nvidia).
 *
 * @returns {string[]} Arguments array to pass before input (-i)
 */
function getFfmpegHwaccelArgs() {
  const configured = (process.env.FFMPEG_HWACCEL || '').trim().toLowerCase();

  if (configured === 'off' || configured === 'cpu' || configured === 'none') {
    return [];
  }
  if (configured === 'vaapi') {
    const dev = fs.existsSync('/dev/dri/renderD128') ? ['-hwaccel_device', '/dev/dri/renderD128'] : [];
    return ['-hwaccel', 'vaapi', ...dev];
  }
  if (configured === 'qsv') {
    return ['-hwaccel', 'qsv'];
  }
  if (configured === 'cuda' || configured === 'nvdec') {
    return ['-hwaccel', 'cuda'];
  }
  if (configured === 'videotoolbox') {
    return ['-hwaccel', 'videotoolbox'];
  }

  // Auto-detection
  if (process.platform === 'darwin') {
    return ['-hwaccel', 'videotoolbox'];
  }

  if (process.platform === 'linux' && fs.existsSync('/dev/dri/renderD128')) {
    try {
      fs.accessSync('/dev/dri/renderD128', fs.constants.R_OK | fs.constants.W_OK);
      return ['-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128'];
    } catch {
      return [];
    }
  }

  return [];
}

module.exports = {
  getFfmpegHwaccelArgs,
};
