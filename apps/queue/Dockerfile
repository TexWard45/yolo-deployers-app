FROM node:20-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json turbo.json ./
COPY apps/queue/package.json apps/queue/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/rest/package.json packages/rest/package.json

RUN npm ci

COPY apps/queue apps/queue
COPY packages/tsconfig packages/tsconfig
COPY packages/env packages/env
COPY packages/types packages/types
COPY packages/database packages/database
COPY packages/rest packages/rest

RUN npm run db:generate
RUN npm run build --workspace @app/queue

CMD ["npm", "run", "start", "--workspace", "@app/queue"]
