import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Uso: npm run user:make-admin -- <email>');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    console.log(`Usuário ${user.email} agora é ADMIN.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
