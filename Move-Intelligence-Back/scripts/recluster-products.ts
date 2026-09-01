import { ProductMatchingService } from '../src/modules/product-matching/product-matching.service';
import { PrismaService } from '../src/shared/database/prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const matching = new ProductMatchingService(prisma);
    const result = await matching.reclusterAll();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
