const { PrismaClient } = require('@prisma/client');

/**
 * Automatischer Sicherheits-Clamp für Bewegungsempfindlichkeit & Alarm-Cooldown.
 * Verhindert Alarm-Stürme, Systemüberlastung und Service-Abstürze durch zu extreme Werte.
 */
async function clampCameraSensitivities(prisma = new PrismaClient()) {
  try {
    const cameras = await prisma.camera.findMany({
      select: {
        id: true,
        name: true,
        motionSensitivity: true,
        motionScheduleSensitivity: true,
        alarmCooldownSeconds: true,
      },
    });

    let updatedCount = 0;
    for (const cam of cameras) {
      const updates = {};
      // Extreme Empfindlichkeiten (> 80 %) auf sichere 75 % begrenzen
      if (typeof cam.motionSensitivity === 'number' && cam.motionSensitivity > 80) {
        updates.motionSensitivity = 75;
      }
      if (typeof cam.motionScheduleSensitivity === 'number' && cam.motionScheduleSensitivity > 80) {
        updates.motionScheduleSensitivity = 75;
      }
      // Zu kurze Cooldowns (< 20s) auf sichere 25s erhöhen
      const currentCooldown = Number(cam.alarmCooldownSeconds) || 0;
      if (currentCooldown < 20) {
        updates.alarmCooldownSeconds = 25;
      }

      if (Object.keys(updates).length > 0) {
        await prisma.camera.update({
          where: { id: cam.id },
          data: updates,
        });
        console.log(`[Safety Clamp] Kamera '${cam.name}' angepasst:`, updates);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[Safety Clamp] ${updatedCount} Kamera(s) erfolgreich auf stabile Werte zurückgesetzt.`);
    } else {
      console.log('[Safety Clamp] Alle Kameras befinden sich bereits in einem sicheren Wertebereich.');
    }
    return updatedCount;
  } catch (error) {
    console.warn('[Safety Clamp] Warnung beim Prüfen der Kamerasensitivität:', error?.message || error);
    return 0;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  clampCameraSensitivities()
    .then((count) => {
      console.log(`Reset abgeschlossen. ${count} Kamera(s) aktualisiert.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fehler beim Reset:', err);
      process.exit(1);
    });
}

module.exports = { clampCameraSensitivities };
