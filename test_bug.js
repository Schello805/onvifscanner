const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.camera.deleteMany();
  
  // Create 3 cameras
  const sortDate1 = new Date(Date.now() + 0 * 1000);
  await prisma.camera.create({ data: { id: "cam1", ip: "1.1.1.1", name: "Cam 1", snapshotUris: "[]", streamUris: "[]", savedAt: sortDate1 } });
  
  const sortDate2 = new Date(Date.now() + 1 * 1000);
  await prisma.camera.create({ data: { id: "cam2", ip: "2.2.2.2", name: "Cam 2", snapshotUris: "[]", streamUris: "[]", savedAt: sortDate2 } });

  // Get them
  let cams = await prisma.camera.findMany({ orderBy: { savedAt: 'asc' } });
  console.log("Initial order:", cams.map(c => c.id));

  // Swap them
  let bodyCameras = [cams[1], cams[0]];
  for (let i = 0; i < bodyCameras.length; i++) {
    const cam = bodyCameras[i];
    const sortDate = new Date(Date.now() + i * 1000);
    await prisma.camera.upsert({
      where: { id: cam.id },
      update: { savedAt: sortDate },
      create: { id: cam.id, ip: cam.ip, name: cam.name, snapshotUris: "[]", streamUris: "[]", savedAt: sortDate }
    });
  }

  // Get them again
  cams = await prisma.camera.findMany({ orderBy: { savedAt: 'asc' } });
  console.log("New order:", cams.map(c => c.id));
}

run().catch(console.error).finally(() => prisma.$disconnect());
