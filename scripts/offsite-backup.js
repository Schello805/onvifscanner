const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { decryptSecret } = require('./security');

let cachedSettings = null;
let lastSettingsFetch = 0;

async function getBackupSettings(prisma) {
  const now = Date.now();
  if (cachedSettings && now - lastSettingsFetch < 30_000) {
    return cachedSettings;
  }
  try {
    cachedSettings = await prisma.settings.findUnique({ where: { id: 'default' } });
    lastSettingsFetch = now;
  } catch {
    // quiet
  }
  return cachedSettings;
}

/**
 * Uploads a finalized recording clip to an offsite WebDAV/Nextcloud or HTTP target.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} filePath - Absolute path to the MP4 file
 * @param {string} filename - Base filename (e.g. cam_2026-10-21.mp4)
 * @param {string} cameraName - Display name of camera
 */
async function uploadClipToOffsite(prisma, filePath, filename, cameraName) {
  if (!prisma || !filePath || !fs.existsSync(filePath)) return;

  try {
    const settings = await getBackupSettings(prisma);
    if (!settings || !settings.offsiteBackupEnabled || !settings.offsiteBackupUrl) {
      return;
    }

    const rawUrl = String(settings.offsiteBackupUrl).trim();
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) return;

    const baseDest = rawUrl.replace(/\/+$/, '');
    const safeFilename = encodeURIComponent(filename || path.basename(filePath));
    const destUrl = `${baseDest}/${safeFilename}`;

    const username = settings.offsiteBackupUsername || '';
    const rawPass = settings.offsiteBackupPassword ? decryptSecret(settings.offsiteBackupPassword) : '';

    const headers = {
      'Content-Type': 'video/mp4',
      'User-Agent': 'ONVIFscanner-Offsite-Backup/1.0',
    };

    if (username || rawPass) {
      const authStr = Buffer.from(`${username}:${rawPass}`).toString('base64');
      headers['Authorization'] = `Basic ${authStr}`;
    }

    const fileBuffer = await fsp.readFile(filePath);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    const res = await fetch(destUrl, {
      method: 'PUT',
      headers,
      body: fileBuffer,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok || res.status === 201 || res.status === 204) {
      console.log(`[Offsite Backup] ✅ ${cameraName}: ${filename} erfolgreich auf Offsite-Speicher gesichert (${destUrl}).`);
    } else {
      console.warn(`[Offsite Backup] ⚠️ ${cameraName}: Upload fehlgeschlagen mit Status HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Offsite Backup] ⚠️ Upload-Fehler für ${filename}:`, err?.message || err);
  }
}

module.exports = {
  uploadClipToOffsite,
};
