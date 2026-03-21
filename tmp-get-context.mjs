import { getFixRunContext } from './apps/codex/src/activities/generate-fix-pr.activity.ts';

const ctx = await getFixRunContext({
  runId: 'cmn0plvy5004dfhm1qrrt26rw',
  workspaceId: 'cmn0i8m0b0000vwm1tmx69bn5',
  threadId: 'cmn0pi8rd003cfhm1g51ictre',
  analysisId: 'cmn0pkqva0048fhm1hq1j3628',
  debugLogs: false,
});

console.log(ctx);
