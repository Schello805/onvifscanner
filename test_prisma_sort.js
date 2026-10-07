const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const c1 = await prisma.camera.findFirst();
  if (!c1) { console.log("No cameras"); return; }
  
  console.log("Before: ", c1.savedAt.getTime());
  const sortDate = new Date(Date.now() + 5000);
  
  await prisma.camera.upsert({
    where: { id: c1.id },
    update: { savedAt: sortDate },
    create: {
      id: c1.id,
      ip: c1.ip,
      name: c1.name,
      snapshotUris: '[]',
      streamUris: '[]',
      savedAt: sortDate
    }
  });
  
  const c2 = await prisma.camera.findUnique({ where: { id: c1.id } });
  console.log("After: ", c2.savedAt.getTime(), "Expected: ", sortDate.getTime());
}

run().catch(console.error).finally(() => prisma.$disconnect());
