import { prisma } from './packages/database/src/index.ts';

async function main() {
  const run = await prisma.fixPrRun.findUnique({
    where: { id: 'cmn0mcomw00254bm1cfglst4x' },
    include: {
      analysis: {
        include: {
          thread: {
            include: {
              messages: { orderBy: { createdAt: 'asc' }, take: 20 },
            },
          },
        },
      },
      workspace: {
        include: {
          agentConfig: true,
        },
      },
    },
  });

  if (!run) {
    console.log('run not found');
    return;
  }

  const threadId = run.threadId;
  const workspaceId = run.workspaceId;
  console.log('run', run.id, 'thread', threadId, 'workspace', workspaceId, 'status', run.status);
  const analysis = run.analysis;
  console.log('current analysis', analysis?.id, 'sufficient', analysis?.sufficient, 'chunks', Array.isArray(analysis?.codexFindings?.chunks) ? analysis.codexFindings.chunks.length : 0);

  const candidates = await prisma.threadAnalysis.findMany({
    where: { threadId, workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, sufficient: true, summary: true, rcaSummary: true, createdAt: true },
    take: 10,
  });
  console.log('analysis candidates', candidates);

  const repos = await prisma.codexRepository.findMany({
    where: { workspaceId },
    select: {
      id: true,
      displayName: true,
      sourceUrl: true,
      sourceType: true,
      defaultBranch: true,
      syncStatus: true,
    },
  });
  console.log('repositories', repos);

  const files = await prisma.codexFile.count({ where: { repository: { workspaceId } } });
  const chunks = await prisma.codexChunk.count({ where: { file: { repository: { workspaceId } } } });
  const embedded = await prisma.codexChunk.count({ where: { file: { repository: { workspaceId } }, embeddingStatus: 'EMBEDDED' } });
  console.log('workspace stats', { files, chunks, embedded });

  const sampleRepo = repos[0];
  if (sampleRepo) {
    const fileCount = await prisma.codexFile.count({ where: { repositoryId: sampleRepo.id } });
    const chunkCount = await prisma.codexChunk.count({ where: { file: { repositoryId: sampleRepo.id } } });
    console.log('first repo counts', sampleRepo.id, { fileCount, chunkCount });
  }

  const search = await prisma.codexChunk.findFirst({
    where: { file: { repository: { workspaceId } } },
    select: { id: true, file: { select: { filePath: true } } },
  });
  console.log('sample chunk', search);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
