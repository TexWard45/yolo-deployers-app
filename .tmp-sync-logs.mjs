import { prisma } from './packages/database/src/index.ts';

async function main() {
  const logs = await prisma.codexSyncLog.findMany({
    where: {
      repositoryId: 'cmn0ij0x4014afzm150xqps7y',
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  console.log(logs);
}

main();
