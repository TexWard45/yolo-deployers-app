import { prisma } from './packages/database/src/index.ts';

async function main() {
  const run = await prisma.fixPrRun.findUnique({
    where: { id: 'cmn0mcomw00254bm1cfglst4x' },
    include: { iterations: { orderBy: { iteration: 'asc' } } },
  });

  if (!run) return;
  console.log('status', run.status, 'currentStage', run.currentStage, 'maxIter', run.maxIterations);
  console.log('summary', run.summary);
  console.log('lastError', run.lastError);
  console.log('metadata', run.metadata);
  for (const it of run.iterations) {
    console.log('iteration', it.iteration, it.status, 'applied', it.appliedFiles);
    console.log('  fixPlan', it.fixPlan ? Object.keys(it.fixPlan) : null);
    console.log('  reviewFindings', it.reviewFindings ? Object.keys(it.reviewFindings) : null);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
