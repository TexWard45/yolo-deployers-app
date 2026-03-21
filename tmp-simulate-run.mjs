import { getFixRunContext, resolveFixTargetRepository } from './apps/codex/src/activities/generate-fix-pr.activity.ts';
import { runCodeContextAgent } from './apps/codex/src/activities/generate-fix-pr.activity.ts';

const input = {
  runId: 'cmn0plvy5004dfhm1qrrt26rw',
  workspaceId: 'cmn0i8m0b0000vwm1tmx69bn5',
  threadId: 'cmn0pi8rd003cfhm1g51ictre',
  analysisId: 'cmn0pkqva0048fhm1hq1j3628',
  debugLogs: false,
};

const context = await getFixRunContext(input);
console.log('context.repoIds', context?.codexRepositoryIds);

const fileContext = {
  editScope: ['src/app/customer-demo/page.tsx'],
  symbols: [],
  relatedChunks: [],
  files: [],
};

const target = await resolveFixTargetRepository({
  repositoryIds: context?.codexRepositoryIds ?? [],
  filePaths: fileContext.editScope,
  preferredOwner: context?.github.owner,
  preferredRepo: context?.github.repo,
  configuredBaseBranch: context?.github.baseBranch ?? 'main',
});

console.log('target', target);

const runContext = await runCodeContextAgent({
  workspaceId: context?.workspaceId,
  summary: context?.summary,
  codexFindings: context?.codexFindings,
  repositoryIds: context?.codexRepositoryIds,
});
console.log('codeContext lengths', runContext.editScope.length);
