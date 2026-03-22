# Doppler Setup for Web + Queue

Use Doppler as the single source of truth for environment variables across:

- `apps/web`
- `apps/queue`

## Prerequisites

- Install Doppler CLI: <https://docs.doppler.com/docs/install-cli>
- Authenticate once on your machine:

```bash
doppler login
```

## One-Time Project Setup (Per Developer)

From the repo root:

```bash
cd /Users/ducng/Desktop/workspace/LotusHacks/TemplateProject
doppler setup
```

`doppler setup` writes `.doppler.yaml` with your selected project + config so `doppler run -- ...` can be used without retyping project/config flags.

## Shared Secrets to Configure in Doppler

Minimum secrets used by current web/queue stack:

- `DATABASE_URL`
- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`
- `TEMPORAL_TASK_QUEUE`

Example (from repo root):

```bash
doppler secrets set DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public"
doppler secrets set TEMPORAL_ADDRESS="localhost:7233"
doppler secrets set TEMPORAL_NAMESPACE="default"
doppler secrets set TEMPORAL_TASK_QUEUE="resolveai-support-queue"
```

## Run with Injected Env Vars

Use either the npm wrappers or raw Doppler commands.

### Web only

```bash
# wrapper
npm run dev:web:doppler

# raw
doppler run -- npm run dev --workspace @app/web
```

### Queue only

```bash
# wrapper
npm run dev:queue:doppler

# raw
doppler run -- npm run dev --workspace @app/queue
```

### Web + Queue together (turbo)

```bash
# wrapper
npm run dev:doppler

# raw
doppler run -- npm run dev
```

### Start queue workflow client with Doppler env

```bash
npm run workflow:start:doppler --workspace @app/queue -- "Your Name"
```

## CI / Non-Interactive Usage

Use a Doppler service token and run commands via `doppler run`:

```bash
export DOPPLER_TOKEN=dp.st.xxxxx
doppler run -- npm run build --workspace @app/web
doppler run -- npm run build --workspace @app/queue
```

## Fallback for Local Development

If Doppler is unavailable, `.env.example` contains the baseline keys to mirror locally.
