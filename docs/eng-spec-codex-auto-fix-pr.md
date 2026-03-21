# Engineering Spec: Codex Auto-Fix PR

## 1. Job to Be Done

- **Who**: Support engineers and workspace admins using the inbox/triage UI.
- **What**: After AI analyzes a customer issue and identifies root cause + relevant code via Codex, automatically generate a multi-file code fix and open a GitHub PR — all from the inbox panel.
- **Why**: Today the pipeline stops at "here's what's broken and where." The human still has to context-switch to an IDE, find the code, write the fix, and open a PR. This closes the loop: customer symptom → code understanding → code change → PR — zero context-switching.
- **Success criteria**:
  - User clicks "Generate Fix PR" on a completed ThreadAnalysis with codexFindings.
  - A Temporal workflow generates code changes via LLM (using Codex chunks as context) and opens a GitHub PR via Octokit.
  - PR URL is saved to `TriageAction` and displayed in the UI.
  - The PR body includes: issue summary, RCA, files changed, and a link back to the support thread.

---

## 2. Proposed Flow / Architecture

### 2.1 Data Model Changes

**`support.schema.prisma`** — Add new enum value + fields:

```prisma
enum TriageActionType {
  CREATE_TICKET
  UPDATE_TICKET
  GENERATE_SPEC
  GENERATE_FIX_PR    // NEW
}
```

No new models needed. `TriageAction` already has `prUrl` and `metadata` (Json) fields which will store the PR details.

**`workspace.schema.prisma`** — Add GitHub config to `WorkspaceAgentConfig`:

```prisma
model WorkspaceAgentConfig {
  // ... existing fields ...

  // GitHub integration (per-workspace)
  githubToken         String?   // GitHub PAT with repo + PR write scope
  githubDefaultOwner  String?   // e.g. "TexWard45"
  githubDefaultRepo   String?   // e.g. "yolo-deployers-app"
  githubBaseBranch    String?   // e.g. "main" (default)
}
```

### 2.2 API Layer

**New Zod schema** in `packages/types/src/schemas/index.ts`:

```ts
export const GenerateFixPRSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  analysisId: z.string(),
});
export type GenerateFixPRInput = z.infer<typeof GenerateFixPRSchema>;

export const GenerateFixPRWorkflowInputSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  analysisId: z.string(),
  userId: z.string(),
});
export type GenerateFixPRWorkflowInput = z.infer<typeof GenerateFixPRWorkflowInputSchema>;
```

**New tRPC mutation** in `packages/rest/src/routers/agent.ts`:

```ts
generateFixPR: publicProcedure
  .input(GenerateFixPRSchema)
  .mutation(async ({ ctx, input }) => {
    // 1. Auth check (workspace membership)
    // 2. Validate analysis exists + has codexFindings
    // 3. Validate workspace has githubToken configured
    // 4. Dispatch Temporal workflow
    // 5. Return { dispatched: true }
  })
```

**New dispatch function** in `packages/rest/src/temporal.ts`:

```ts
export async function dispatchGenerateFixPRWorkflow(
  input: GenerateFixPRWorkflowInput,
): Promise<void> {
  // workflowId: `generate-fix-pr-${input.analysisId}`
  // idempotent — one PR attempt per analysis
}
```

**New REST endpoint** for queue → web persistence:

```
POST /api/rest/fix-pr/save
Body: { analysisId, threadId, workspaceId, userId, prUrl, prNumber, branchName, filesChanged, metadata }
```

This endpoint creates a `TriageAction` with `action: GENERATE_FIX_PR` and saves the PR URL.

### 2.3 New Files

| File | Purpose |
|------|---------|
| `packages/rest/src/routers/helpers/github-client.ts` | Octokit wrapper: createBranch, commitFiles, createPR |
| `packages/rest/src/routers/helpers/code-fix.prompt.ts` | LLM prompt: analysis + code chunks → file changes |
| `apps/queue/src/workflows/generate-fix-pr.workflow.ts` | Temporal workflow orchestration |
| `apps/queue/src/activities/generate-fix-pr.activity.ts` | Activity functions for each step |
| `apps/web/src/app/api/rest/fix-pr/save/route.ts` | REST endpoint for queue to persist PR result |

### 2.4 Flow Diagram

```
User clicks "Generate Fix PR" on AnalysisPanel
  │
  ├─ 1. tRPC mutation `agent.generateFixPR` validates:
  │      - workspace membership
  │      - analysis has codexFindings
  │      - workspace has githubToken, githubDefaultOwner, githubDefaultRepo
  │
  ├─ 2. Dispatches Temporal workflow `generateFixPRWorkflow`
  │      workflowId: `generate-fix-pr-${analysisId}` (idempotent)
  │
  └─ Temporal Workflow (apps/queue):
       │
       ├─ 3. fetchContextActivity (10s timeout)
       │      GET analysis, codexFindings, messages, agent config from DB
       │
       ├─ 4. expandCodeContextActivity (15s timeout)
       │      For each codex chunk in findings:
       │        - GET /api/rest/codex/chunk/{id} for full content
       │        - GET surrounding chunks for broader context
       │      Returns: Map<filePath, { fullContent, relevantChunks, symbols }>
       │
       ├─ 5. generateCodeFixActivity (30s timeout)
       │      LLM call (code-fix.prompt.ts):
       │        Input: analysis summary + RCA + expanded code context + sentry errors
       │        Output: Array<{ filePath, original, fixed, explanation }>
       │      Uses GPT-4.1 with structured JSON output
       │
       ├─ 6. createGitHubPRActivity (20s timeout)
       │      Via github-client.ts (Octokit):
       │        a. Get base branch SHA
       │        b. Create branch: `fix/{threadId}-{short-summary}`
       │        c. For each file change: create/update via Contents API
       │        d. Create PR with body (summary, RCA, files changed, thread link)
       │      Returns: { prUrl, prNumber, branchName }
       │
       └─ 7. savePRResultActivity (10s timeout)
              POST /api/rest/fix-pr/save
              Creates TriageAction { action: GENERATE_FIX_PR, prUrl, metadata }
```

### 2.5 LLM Prompt Design (`code-fix.prompt.ts`)

**System prompt structure**:
```
You are a senior software engineer generating a code fix for a customer-reported bug.

# Context
You have:
- AI analysis with root cause and severity
- Relevant code chunks from the codebase (AST-parsed with symbols, types, imports)
- Error tracking data (stack traces, error counts)

# Task
Generate minimal, targeted code changes to fix the identified issue.

# Output Format (JSON)
{
  "changes": [
    {
      "filePath": "src/utils/auth.ts",
      "original": "// exact original code block",
      "fixed": "// fixed code block",
      "explanation": "Why this change fixes the issue"
    }
  ],
  "prTitle": "fix: short description",
  "prBody": "markdown PR description",
  "confidence": 0.0-1.0,
  "risks": ["potential risk 1"]
}

# Rules
- Make MINIMAL changes — do not refactor surrounding code
- Preserve existing code style and patterns
- If confidence < 0.5, set changes to [] and explain in risks
- Each change must include enough original context for exact matching
- Never remove error handling or safety checks
- Maximum 5 file changes per PR
```

### 2.6 GitHub Client (`github-client.ts`)

Follows the same pattern as `linear-client.ts` — thin wrapper around SDK:

```ts
import { Octokit } from "@octokit/rest";

export function createGitHubClient(token: string) {
  return new Octokit({ auth: token });
}

export async function createFixPR(client: Octokit, opts: {
  owner: string;
  repo: string;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ prUrl: string; prNumber: number }> {
  // 1. Get base branch ref → SHA
  // 2. Create new branch from base SHA
  // 3. For each file: get current content SHA, update via Contents API
  // 4. Create PR (head: branchName, base: baseBranch)
  // Returns PR URL + number
}
```

### 2.7 Frontend

**TriageSection.tsx** — Add "Generate Fix PR" button alongside existing "Triage to Linear" and "Generate Spec" buttons. Same pattern: server action → transition → display result.

**New server action** in `apps/web/src/actions/inbox.ts`:

```ts
export async function generateFixPRAction(input: {
  threadId: string;
  workspaceId: string;
  analysisId: string;
}): Promise<{ success: boolean; error?: string }> {
  // Calls tRPC agent.generateFixPR
}
```

**New status action** — poll for PR result (same pattern as `getTriageStatusAction`). The existing `getTriageStatusAction` already returns `TriageAction[]` with `prUrl`, so it may already work if we add the `GENERATE_FIX_PR` action type to the history rendering.

### 2.8 Dependencies

| Package | Where | Why |
|---------|-------|-----|
| `@octokit/rest` | `packages/rest` | GitHub API (create branches, commits, PRs) |

**Env vars**: None new globally. GitHub credentials are per-workspace on `WorkspaceAgentConfig` (same as Linear/Sentry pattern).

---

## 3. Task Checklist

### Schema / Data

- [ ] Add `GENERATE_FIX_PR` to `TriageActionType` enum in `support.schema.prisma`
- [ ] Add GitHub fields to `WorkspaceAgentConfig` in `workspace.schema.prisma`: `githubToken`, `githubDefaultOwner`, `githubDefaultRepo`, `githubBaseBranch`
- [ ] Run `npm run db:generate` + `npm run db:push`

### Shared Types

- [ ] Add `GenerateFixPRSchema` and `GenerateFixPRWorkflowInputSchema` to `packages/types/src/schemas/index.ts`

### Backend — GitHub Client

- [ ] Install `@octokit/rest` in `packages/rest` — `npm install @octokit/rest --workspace packages/rest`
- [ ] Create `packages/rest/src/routers/helpers/github-client.ts` — `createGitHubClient`, `createFixPR` (branch + commit + PR)

### Backend — LLM Prompt

- [ ] Create `packages/rest/src/routers/helpers/code-fix.prompt.ts` — system prompt, `buildUserMessage()`, `generateCodeFix()` export

### Backend — tRPC + Temporal Dispatch

- [ ] Add `generateFixPR` mutation to `packages/rest/src/routers/agent.ts` (validate analysis, config, dispatch workflow)
- [ ] Add `dispatchGenerateFixPRWorkflow()` to `packages/rest/src/temporal.ts`

### Backend — REST Endpoint (queue → web)

- [ ] Create `apps/web/src/app/api/rest/fix-pr/save/route.ts` — POST handler that creates `TriageAction` with `GENERATE_FIX_PR`

### Queue — Workflow + Activities

- [ ] Create `apps/queue/src/activities/generate-fix-pr.activity.ts` — 5 activities: `fetchFixPRContext`, `expandCodeContext`, `generateCodeFix`, `createGitHubPR`, `saveFixPRResult`
- [ ] Create `apps/queue/src/workflows/generate-fix-pr.workflow.ts` — orchestrates activities in sequence
- [ ] Register `generateFixPR: "generateFixPRWorkflow"` in `apps/queue/src/workflows/registry.ts`
- [ ] Export workflow from `apps/queue/src/workflows/index.ts`
- [ ] Export activities from `apps/queue/src/activities/index.ts`
- [ ] Rebuild queue worker: `npm run build --workspace @app/queue`

### Frontend / UI

- [ ] Add `generateFixPRAction` server action in `apps/web/src/actions/inbox.ts`
- [ ] Add "Generate Fix PR" button to `apps/web/src/components/inbox/TriageSection.tsx` (same pattern as "Triage to Linear")
- [ ] Render `GENERATE_FIX_PR` actions in triage history with PR link
- [ ] Add GitHub config fields to workspace settings page (token, owner, repo, base branch)

### Cleanup

- [ ] Verify `npm run type-check` passes
- [ ] Verify `npm run build` passes for web + queue
- [ ] Update `CLAUDE.md` if architecture section needs the new workflow documented

---

## 4. Testing Checklist

### Happy Path

- [ ] Click "Generate Fix PR" on an analysis with codexFindings → workflow dispatches, PR is created on GitHub, PR URL appears in triage history
- [ ] PR branch name follows convention: `fix/{threadId}-{slug}`
- [ ] PR body contains: issue summary, RCA, files changed, link to support thread
- [ ] PR contains correct file changes matching LLM output
- [ ] `TriageAction` record created with `action: GENERATE_FIX_PR`, `prUrl` populated

### Validation

- [ ] "Generate Fix PR" button is disabled/hidden when analysis has no codexFindings
- [ ] Mutation rejects if workspace has no `githubToken` configured → clear error message
- [ ] Mutation rejects if workspace has no `githubDefaultOwner`/`githubDefaultRepo` → clear error
- [ ] Mutation rejects for non-workspace-members → FORBIDDEN error

### Edge Cases

- [ ] Double-click / re-dispatch: workflow ID is idempotent (`generate-fix-pr-${analysisId}`), second click is a no-op
- [ ] LLM returns empty changes (low confidence) → workflow completes gracefully, no PR created, user notified
- [ ] LLM returns changes for files that don't exist in the repo → skip those files, create PR with valid changes only
- [ ] GitHub token has insufficient permissions → activity fails with clear error, workflow doesn't retry infinitely
- [ ] Analysis with only sentryFindings (no codexFindings) → still attempts fix using error context, but code context is limited

### Auth / Permissions

- [ ] Only workspace members can trigger `generateFixPR` mutation
- [ ] GitHub token is never exposed to the frontend (stored on `WorkspaceAgentConfig`, read server-side only)
- [ ] `x-internal-secret` header validated on `POST /api/rest/fix-pr/save`

### UI

- [ ] Button shows loading state ("Generating PR...") while workflow runs
- [ ] PR URL renders as clickable link in triage history
- [ ] History entry shows "Generated PR #123" with correct formatting
- [ ] Button disabled when no GitHub config is set (with tooltip explaining why)

### Type Safety

- [ ] `npm run type-check` passes across all packages
- [ ] `npm run build` succeeds for `@app/web` and `@app/queue`
- [ ] New Zod schemas correctly infer types used in tRPC + workflow inputs

### Infrastructure

- [ ] Queue worker rebuilds successfully after adding new workflow + activities
- [ ] Temporal registers `generateFixPRWorkflow` without errors
- [ ] Activities export correctly from `apps/queue/src/activities/index.ts`
