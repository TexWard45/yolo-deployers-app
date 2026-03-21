import { prisma } from "@shared/database";

const repos = await prisma.codexRepository.findMany({
  where: { workspaceId: 'cmn0i8m0b0000vwm1tmx69bn5' },
  select: {
    id: true,
    sourceUrl: true,
    defaultBranch: true,
    sourceType: true,
    displayName: true,
    lastSyncAt: true,
    lastSyncError: true,
  },
});

const filtered = repos.filter((r) => (r.sourceUrl || "").includes("TelemetryTestProj"));
console.log('all repos', repos);
console.log('telemetry repos', filtered);

const runs = await prisma.fixPrRun.findUnique({
  where: { id: 'cmn0plvy5004dfhm1qrrt26rw' },
  select: {
    workspaceId: true,
    codexRepositoryIds: true,
    status: true,
    analysisId: true,
    summary: true,
    iterationCount: true,
    lastError: true,
    metadata: true,
    workspace: {
      select: { agentConfig: true }
    },
  },
});
console.log('run metadata', runs);

await prisma.$disconnect();
