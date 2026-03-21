import { resolveFixTargetRepository } from './apps/codex/src/activities/generate-fix-pr.activity.ts';

const repositoryIds = ['cmn0ij0x4014afzm150xqps7y'];
const target = await resolveFixTargetRepository({
  repositoryIds,
  filePaths: ['src/app/customer-demo/page.tsx'],
  configuredBaseBranch: 'main',
});
console.log(target);
