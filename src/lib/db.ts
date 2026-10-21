import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient; prismaPragmasInit?: boolean };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

if (!globalForPrisma.prismaPragmasInit) {
  globalForPrisma.prismaPragmasInit = true;
  void (async () => {
    try {
      await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
      await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;");
    } catch {
      // quiet SQLite setup fallback
    }
  })();
}
