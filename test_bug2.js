const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.camera.deleteMany();
  
  const d1 = new Date(Date.now());
  const d2 = new Date(Date.now() + 1000);
  
  await prisma.camera.create({ data: { id: "cam1", ip: "1.1.1.1", name: "Cam 1", snapshotUris: "[]", streamUris: "[]", savedAt: d1 } });
  await prisma.camera.create({ data: { id: "cam2", ip: "2.2.2.2", name: "Cam 2", snapshotUris: "[]", streamUris: "[]", savedAt: d2 } });

  let cams = await prisma.camera.findMany({ orderBy: { savedAt: 'asc' } });
  console.log("Order 1:", cams.map(c => c.id));

  // Swap
  let order = [cams[1], cams[0]];
  for (let i = 0; i < order.length; i++) {
    const cam = order[i];
    const sortDate = new Date(Date.now() + i * 1000);
    await prisma.camera.upsert({
      where: { id: cam.id },
      update: { savedAt: sortDate },
      create: { id: cam.id, ip: cam.ip, name: cam.name, snapshotUris: "[]", streamUris: "[]", savedAt: sortDate }
    });
  }

  cams = await prisma.camera.findMany({ orderBy: { savedAt: 'asc' } });
  console.log("Order 2:", cams.map(c => c.id));
}

run().catch(console.error).finally(() => prisma.$disconnect());
