import { codexConfig } from './apps/codex/src/config.ts';
import { runCodeContextAgent, getFixRunContext } from './apps/codex/src/activities/generate-fix-pr.activity.ts';

console.log('webAppUrl', codexConfig.webAppUrl);
console.log('cloneBasePath', codexConfig.cloneBasePath);
console.log('internalApiSecret exists', Boolean(codexConfig.internalApiSecret));

const context = await getFixRunContext({
  runId: 'cmn0mcomw00254bm1cfglst4x',
  threadId: 'cmn0mb82k001x4bm16kjo72hr',
  workspaceId: 'cmn0i8m0b0000vwm1tmx69bn5',
  analysisId: 'cmn0mbyy100234bm1img3vn8w',
});

const ctx = await runCodeContextAgent({
  workspaceId: context?.workspaceId,
  summary: context?.summary,
  rcaSummary: context?.rcaSummary,
  repositoryIds: context?.codexRepositoryIds,
  messages: context?.messages,
  codexFindings: context?.codexFindings,
});

console.log('editScope size', ctx.editScope.length);
