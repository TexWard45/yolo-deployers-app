# @app/queue

Template Temporal queue worker app.

## What it includes

- `src/worker.ts`: Temporal worker bound to `TEMPORAL_TASK_QUEUE`
- `src/workflows/`: workflow implementations
- `src/workflows/index.ts`: centralized workflow registration entrypoint for worker bundling
- `src/workflows/registry.ts`: centralized workflow name registry for clients/triggers
- `src/activities/`: activity implementations
- `src/activities/index.ts`: centralized activity registration entrypoint
- `src/client.ts`: helper to enqueue a workflow execution

## Environment variables

- Env parsing/validation is centralized in `@shared/env` (`packages/env`).
- `TEMPORAL_ADDRESS` (default: `localhost:7233`)
- `TEMPORAL_NAMESPACE` (default: `default`)
- `TEMPORAL_TASK_QUEUE` (default: `template-task-queue`)

For team-shared env management, use Doppler. See:

- `docs/doppler-setup.md`

## Run locally

```bash
npm run dev --workspace @app/queue
```

## Run with Doppler env injection

```bash
npm run dev:doppler --workspace @app/queue
# or
doppler run -- npm run dev --workspace @app/queue
```

## Start a sample workflow

```bash
npm run workflow:start --workspace @app/queue -- "Your Name"
```

With Doppler:

```bash
npm run workflow:start:doppler --workspace @app/queue -- "Your Name"
```
