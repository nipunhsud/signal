import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

process.on("SIGINT", async () => {
  await db.$disconnect();
  process.exit(0);
});
