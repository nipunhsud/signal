import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await db.$disconnect();
  process.exit(0);
});
