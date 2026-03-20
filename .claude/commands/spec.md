---
name: spec
description: Generate an engineering spec for a feature or task. Covers job-to-be-done, proposed architecture/flow, task checklist, and testing checklist.
user_invocable: true
---

# Engineering Spec: $ARGUMENTS

Generate a full engineering specification for the feature or task described above. Follow this exact structure:

## 1. Job to Be Done

Write a clear, concise statement of what problem this solves and for whom. Answer:
- **Who** is the user/actor?
- **What** do they need to accomplish?
- **Why** — what's the motivation or pain point?
- **Success criteria** — how do we know this is working?

## 2. Proposed Flow / Architecture

Describe the technical approach:
- **Data model changes** — new Prisma models, fields, or relations needed
- **API layer** — new tRPC routers/procedures, input schemas (Zod), authorization
- **Frontend** — new pages, components, server vs client boundaries
- **Flow diagram** — step-by-step user flow written as a numbered list
- **Dependencies** — any new packages, external services, or env vars needed

Reference the existing architecture from CLAUDE.md (monorepo structure, @shared/* packages, tRPC patterns).

## 3. Task Checklist

Break the work into concrete, shippable tasks. Each task should be small enough to be a single commit. Use this format:

```
- [ ] Task description — brief context on what and where
```

Group tasks by layer:
- **Schema / Data** — Prisma schema changes, migrations, Zod schemas
- **Backend / API** — tRPC routers, procedures, server actions
- **Frontend / UI** — pages, components, layouts
- **Wiring** — connecting frontend to backend, providers, imports
- **Cleanup** — types export, CLAUDE.md updates if architecture changed

## 4. Testing Checklist

List what needs to be verified before this is considered done:

```
- [ ] Test description — what to verify and expected outcome
```

Cover these categories:
- **Happy path** — core flow works end to end
- **Validation** — invalid inputs are rejected with clear errors
- **Edge cases** — empty states, duplicates, max lengths, concurrent access
- **Auth / Permissions** — only authorized users can perform actions
- **UI** — responsive, loading states, error states render correctly
- **Type safety** — `npm run type-check` passes
- **Lint** — `npm run lint` passes
- **Build** — `npm run build` succeeds (no prerender errors)

---

Read the project's CLAUDE.md and current codebase structure before generating the spec. Tailor the spec to this project's conventions (tRPC routers in @shared/rest, Zod schemas in @shared/types, Prisma in @shared/database, shadcn UI components).

**Output:** Save the spec as a markdown file under `docs/` at the project root. Use a slugified filename based on the feature name, e.g. `docs/eng-spec-user-invitation-system.md`. Create the `docs/` directory if it doesn't exist.
