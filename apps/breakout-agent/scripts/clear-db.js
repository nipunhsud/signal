import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
  try {
    console.log('🗑️  Clearing BreakoutSignal records...');
    const deletedSignals = await prisma.breakoutSignal.deleteMany({});
    console.log(`   Deleted ${deletedSignals.count} BreakoutSignal records`);

    console.log('🗑️  Clearing Signal records...');
    const deletedGeneral = await prisma.signal.deleteMany({});
    console.log(`   Deleted ${deletedGeneral.count} Signal records`);

    console.log('✅ Database cleared successfully');
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

clearDatabase();
