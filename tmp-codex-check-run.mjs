import { prisma } from './packages/database/src/index.js';

const runId = 'cmn0plvy5004dfhm1qrrt26rw';
const run = await prisma.fixPrRun.findUnique({
  where: { id: runId },
  include: {
    workspace: {
      include: {
        agentConfig: true,
      },
    },
    analysis: true,
  },
});

console.log('run', {
  id: run?.id,
  status: run?.status,
  workspaceId: run?.workspaceId,
  analysisId: run?.analysisId,
  threadId: run?.threadId,
  maxIterations: run?.maxIterations,
  summary: run?.summary?.slice(0, 120),
});
console.log('workspaceConfig', run?.workspace?.agentConfig);

const repos = await prisma.codexRepository.findMany({
  where: { workspaceId: run?.workspaceId },
  select: {
    id: true,
    sourceUrl: true,
    displayName: true,
    defaultBranch: true,
    sourceType: true,
    lastSyncAt: true,
  },
});
console.log('repos', repos);

const fileMatches = await prisma.codexFile.findMany({
  where: {
    repositoryId: { in: repos.map((repo) => repo.id) },
    filePath: { in: ['src/app/customer-demo/page.tsx'] },
  },
  select: {
    repositoryId: true,
    filePath: true,
  },
});
console.log('file matches', fileMatches);

await prisma.$disconnect();
