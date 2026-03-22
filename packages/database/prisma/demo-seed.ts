import { PrismaPg } from "@prisma/adapter-pg";
import {
  CustomerSource,
  DraftStatus,
  DraftType,
  FixPrIterationStatus,
  FixPrRunStatus,
  MessageDirection,
  PrismaClient,
  ThreadStatus,
  WorkspaceRole,
  type Prisma,
} from "@shared/types/prisma";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../../../apps/web/.env") });
}

const workspaceSlug = process.argv[2] ?? "yolo-deployers";
const SEED_PREFIX = "demo-seed-";

interface SeedMessage {
  direction: MessageDirection;
  body: string;
  minutesAgo: number;
  metadata?: Prisma.InputJsonValue;
  senderExternalId?: string;
  replyToMessageIndex?: number;
}

interface SeedAnalysis {
  severity: string | null;
  issueCategory: string | null;
  affectedComponent: string | null;
  summary: string;
  rcaSummary: string | null;
  sufficient: boolean;
  missingContext: string[];
  codexFindings?: Prisma.InputJsonValue;
  sentryFindings?: Prisma.InputJsonValue;
  draftBody?: string;
  draftType?: DraftType;
}

interface SeedFixPrRun {
  status: FixPrRunStatus;
  currentStage: string;
  iterationStatus: FixPrIterationStatus;
  summary: string;
  branchName?: string;
  prUrl?: string;
}

interface SeedThread {
  key: string;
  status: ThreadStatus;
  title: string;
  summary: string;
  customerName: string;
  customerEmail?: string;
  messages: SeedMessage[];
  analysis?: SeedAnalysis;
  fixPrRun?: SeedFixPrRun;
  assignToPrimary?: boolean;
}

const THREADS: SeedThread[] = [
  {
    key: "hero-checkout-crash",
    status: ThreadStatus.WAITING_REVIEW,
    title: "Checkout crashes after clicking Trigger Crash",
    summary:
      "Crash reproduced in customer-demo flow. Evidence is correlated from Discord report, Sentry trace, and session replay.",
    customerName: "DrGuru",
    customerEmail: "drguru@acme.io",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "After this morning deploy, checkout fails. In /customer-demo, clicking trigger crash breaks the page.",
        minutesAgo: 95,
        senderExternalId: "discord:drguru",
        metadata: {
          channelName: "yolo-deployer-support",
          telemetrySessionId: "demo-session-002",
          telemetrySessionUrl: "http://localhost:3000/admin/replays?sessionId=demo-session-002",
          sentryIssueUrl: "https://sentry.io/organizations/demo/issues/5102441201/",
        },
      },
      {
        direction: MessageDirection.INBOUND,
        body: "Can someone fix this before our investor demo today?",
        minutesAgo: 92,
        senderExternalId: "discord:drguru",
      },
    ],
    analysis: {
      severity: "high",
      issueCategory: "bug",
      affectedComponent: "customer-demo page",
      summary:
        "The crash button path throws an unhandled client error. The replay and stack show a missing guard around undefined telemetry payload.",
      rcaSummary:
        "Null payload in `handleTriggerCrash` is dereferenced without validation, causing a runtime exception and broken checkout state.",
      sufficient: true,
      missingContext: [],
      codexFindings: {
        chunks: [
          {
            filePath:
              "/Users/ducng/Desktop/workspace/LotusHacks/OfficialHacks/TelemetryTestProj/src/app/customer-demo/page.tsx",
            symbolName: "handleTriggerCrash",
            score: 0.96,
          },
          {
            filePath:
              "/Users/ducng/Desktop/workspace/LotusHacks/OfficialHacks/TelemetryTestProj/src/lib/checkout/session.ts",
            symbolName: "buildCheckoutPayload",
            score: 0.81,
          },
        ],
      },
      sentryFindings: [
        {
          issueId: "5102441201",
          title: "TypeError: Cannot read properties of undefined (reading 'items')",
          culprit: "customer-demo/page.tsx in handleTriggerCrash",
          count: 183,
          firstSeen: "2026-03-22T03:10:00.000Z",
          lastSeen: "2026-03-22T06:40:00.000Z",
          level: "error",
          stackTrace:
            "TypeError: Cannot read properties of undefined (reading 'items')\n  at handleTriggerCrash (customer-demo/page.tsx:146:19)\n  at onClick (customer-demo/page.tsx:290:7)",
        },
      ],
      draftBody:
        "Thanks for reporting this. We reproduced the issue and traced it to a null payload in checkout crash handling. We are preparing a patch and will update once PR is ready.",
      draftType: DraftType.RESOLUTION,
    },
  },
  {
    key: "missing-linear-key",
    status: ThreadStatus.WAITING_REVIEW,
    title: "Linear ticket creation fails with unauthorized",
    summary: "Likely missing or invalid Linear API key in workspace config.",
    customerName: "TexWard",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "When I click triage to Linear, it fails with unauthorized. Could be our integration.",
        minutesAgo: 80,
        senderExternalId: "discord:texward",
      },
    ],
    analysis: {
      severity: "medium",
      issueCategory: "integration",
      affectedComponent: "triage pipeline",
      summary:
        "Linear integration call returns 401. Workspace configuration appears incomplete for the API key.",
      rcaSummary: "No valid `linearApiKey` found in workspace agent config.",
      sufficient: true,
      missingContext: [],
      draftBody:
        "We found that the workspace Linear API key appears missing or invalid. Please rotate the key and retry; we can validate after update.",
      draftType: DraftType.CLARIFICATION,
    },
  },
  {
    key: "webhook-signature-mismatch",
    status: ThreadStatus.WAITING_REVIEW,
    title: "Stripe webhook signature mismatch after rotate",
    summary: "Webhook verification is failing after secret rotation.",
    customerName: "Platform Team",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "Payment webhooks started failing right after we rotated Stripe secrets. Every request returns signature mismatch.",
        minutesAgo: 72,
        senderExternalId: "discord:platform-team",
      },
      {
        direction: MessageDirection.INBOUND,
        body: "Impact is medium, checkout still works but post-payment steps fail.",
        minutesAgo: 70,
        senderExternalId: "discord:platform-team",
      },
    ],
  },
  {
    key: "waiting-customer-browser-info",
    status: ThreadStatus.WAITING_CUSTOMER,
    title: "Customer-demo page is blank for one user",
    summary: "Need browser/version info and full console trace from customer.",
    customerName: "Duc Ng",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "The customer demo page is blank after login. I only see a white screen.",
        minutesAgo: 60,
        senderExternalId: "discord:ducng",
      },
      {
        direction: MessageDirection.OUTBOUND,
        body:
          "Thanks, can you share browser version, timezone, and exact time it happened? A screenshot of devtools console will help.",
        minutesAgo: 56,
        senderExternalId: "agent:resolveai",
        replyToMessageIndex: 0,
      },
    ],
    analysis: {
      severity: "medium",
      issueCategory: "bug",
      affectedComponent: "workspace dashboard",
      summary: "Insufficient evidence to identify deterministic root cause.",
      rcaSummary: null,
      sufficient: false,
      missingContext: ["browser version", "console error", "exact timestamp"],
      draftBody:
        "Could you share browser/version and a screenshot of the console errors? That will let us isolate this quickly.",
      draftType: DraftType.CLARIFICATION,
    },
  },
  {
    key: "escalated-payment-risk",
    status: ThreadStatus.ESCALATED,
    title: "Duplicate charge reported after retry flow",
    summary: "Escalated due to payment impact and low confidence auto-fix safety.",
    customerName: "Acme Finance",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "One customer was charged twice when retrying payment after timeout. Need urgent review.",
        minutesAgo: 45,
        senderExternalId: "discord:acme-finance",
      },
    ],
    analysis: {
      severity: "critical",
      issueCategory: "payment",
      affectedComponent: "checkout retry",
      summary:
        "Potential idempotency regression in retry flow. Impact is high and requires immediate human escalation.",
      rcaSummary:
        "Duplicate charge risk likely from missing idempotency-key persistence across retry boundary.",
      sufficient: false,
      missingContext: ["provider transaction ids", "gateway logs", "customer order ids"],
    },
  },
  {
    key: "escalated-sso-outage",
    status: ThreadStatus.ESCALATED,
    title: "Enterprise SSO login fails for all users",
    summary: "Escalated due to blast radius and authentication impact.",
    customerName: "Enterprise IT",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body: "SAML SSO fails for every user after your latest release.",
        minutesAgo: 40,
        senderExternalId: "discord:enterprise-it",
      },
    ],
    analysis: {
      severity: "critical",
      issueCategory: "auth",
      affectedComponent: "sso callback",
      summary: "Auth outage affecting all enterprise seats in one tenant.",
      rcaSummary: "Suspected certificate mismatch between metadata and callback validation.",
      sufficient: false,
      missingContext: ["updated metadata XML", "tenant callback logs"],
    },
  },
  {
    key: "in-progress-worker-restart",
    status: ThreadStatus.IN_PROGRESS,
    title: "Queue worker drops events after restart",
    summary: "Engineer assigned and validating retry/dead-letter handling.",
    customerName: "Ops Team",
    assignToPrimary: true,
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body:
          "After worker restart, some Discord inbound events never appear in inbox.",
        minutesAgo: 35,
        senderExternalId: "discord:ops-team",
      },
      {
        direction: MessageDirection.OUTBOUND,
        body:
          "We confirmed partial event loss and are patching worker startup sequencing now.",
        minutesAgo: 28,
        senderExternalId: "agent:oncall",
        replyToMessageIndex: 0,
      },
    ],
    analysis: {
      severity: "high",
      issueCategory: "infra",
      affectedComponent: "queue worker startup",
      summary:
        "Events can be missed during reconnect window when channel sync and bot listener race.",
      rcaSummary: "Ordering issue between channel seeding and bot subscription initialization.",
      sufficient: true,
      missingContext: [],
    },
    fixPrRun: {
      status: FixPrRunStatus.RUNNING,
      currentStage: "REVIEWING",
      iterationStatus: FixPrIterationStatus.RUNNING,
      summary: "Applying startup ordering fix and validating replay against synthetic events.",
      branchName: "codex/fix-worker-startup-ordering",
    },
  },
  {
    key: "closed-demo-crash-fixed",
    status: ThreadStatus.CLOSED,
    title: "Customer demo crash fixed and deployed",
    summary: "Patched null guard, validated in staging, and confirmed with customer.",
    customerName: "Sales Engineering",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body: "Customer demo page crashed during trial call.",
        minutesAgo: 26,
        senderExternalId: "discord:sales-eng",
      },
      {
        direction: MessageDirection.OUTBOUND,
        body: "Fix deployed in patch release. Can you verify on your side?",
        minutesAgo: 18,
        senderExternalId: "agent:oncall",
        replyToMessageIndex: 0,
      },
      {
        direction: MessageDirection.INBOUND,
        body: "Confirmed. Works now, thank you.",
        minutesAgo: 14,
        senderExternalId: "discord:sales-eng",
        replyToMessageIndex: 1,
      },
    ],
    analysis: {
      severity: "high",
      issueCategory: "bug",
      affectedComponent: "customer-demo page",
      summary: "Root cause fixed in PR #128 and released to production.",
      rcaSummary: "Missing null guard in demo payload handling.",
      sufficient: true,
      missingContext: [],
    },
    fixPrRun: {
      status: FixPrRunStatus.PASSED,
      currentStage: "COMPLETED",
      iterationStatus: FixPrIterationStatus.PASSED,
      summary: "PR merged with regression checks passing.",
      branchName: "codex/fix-demo-crash-guard",
      prUrl: "https://github.com/example/yolo-deployers-app/pull/128",
    },
  },
  {
    key: "closed-rollback-complete",
    status: ThreadStatus.CLOSED,
    title: "Webhook 502 spike resolved via rollback",
    summary: "Issue mitigated and customer confirmed recovery.",
    customerName: "Growth Ops",
    messages: [
      {
        direction: MessageDirection.INBOUND,
        body: "Webhook endpoint returns intermittent 502 for campaign events.",
        minutesAgo: 22,
        senderExternalId: "discord:growth-ops",
      },
      {
        direction: MessageDirection.OUTBOUND,
        body:
          "We rolled back the latest deployment and error rate returned to baseline.",
        minutesAgo: 16,
        senderExternalId: "agent:oncall",
      },
    ],
  },
];

function minutesAgoToDate(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000);
}

function byRolePriority(a: WorkspaceRole, b: WorkspaceRole): number {
  const rank: Record<WorkspaceRole, number> = {
    OWNER: 0,
    ADMIN: 1,
    MEMBER: 2,
  };
  return rank[a] - rank[b];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured. Check .env or apps/web/.env.");
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!workspace) {
      throw new Error(`Workspace '${workspaceSlug}' was not found.`);
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: workspace.id },
      include: { user: true },
    });

    if (members.length === 0) {
      throw new Error(`Workspace '${workspaceSlug}' has no members.`);
    }

    const orderedMembers = [...members].sort((a, b) => byRolePriority(a.role, b.role));
    const primaryActor = orderedMembers[0]!.user;

    const deletedThreads = await prisma.supportThread.deleteMany({
      where: {
        workspaceId: workspace.id,
        externalThreadId: { startsWith: SEED_PREFIX },
      },
    });

    await prisma.customer.deleteMany({
      where: {
        workspaceId: workspace.id,
        externalCustomerId: { startsWith: `${SEED_PREFIX}customer-` },
      },
    });

    console.log(
      `[demo-seed] Workspace '${workspace.slug}' (${workspace.name}) ready. Cleared ${deletedThreads.count} previous demo threads.`,
    );

    for (const threadSeed of THREADS) {
      const externalCustomerId = `${SEED_PREFIX}customer-${threadSeed.key}`;
      const externalThreadId = `${SEED_PREFIX}${threadSeed.key}`;

      const customer = await prisma.customer.create({
        data: {
          workspaceId: workspace.id,
          source: CustomerSource.DISCORD,
          externalCustomerId,
          displayName: threadSeed.customerName,
          email: threadSeed.customerEmail,
        },
      });

      const messageTimes = threadSeed.messages.map((message) => minutesAgoToDate(message.minutesAgo));
      const sortedTimes = [...messageTimes].sort((a, b) => a.getTime() - b.getTime());
      const newestMessageAt = sortedTimes[sortedTimes.length - 1] ?? new Date();
      const newestInboundAt = threadSeed.messages
        .filter((message) => message.direction === MessageDirection.INBOUND)
        .map((message) => minutesAgoToDate(message.minutesAgo))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const newestOutboundAt = threadSeed.messages
        .filter((message) => message.direction === MessageDirection.OUTBOUND)
        .map((message) => minutesAgoToDate(message.minutesAgo))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      const thread = await prisma.supportThread.create({
        data: {
          workspaceId: workspace.id,
          customerId: customer.id,
          source: CustomerSource.DISCORD,
          externalThreadId,
          title: threadSeed.title,
          summary: threadSeed.summary,
          summaryUpdatedAt: new Date(),
          status: threadSeed.status,
          assignedToId: threadSeed.assignToPrimary ? primaryActor.id : null,
          issueFingerprint: `${SEED_PREFIX}fingerprint-${threadSeed.key}`,
          lastMessageAt: newestMessageAt,
          lastInboundAt: newestInboundAt,
          lastOutboundAt: newestOutboundAt,
          createdAt: sortedTimes[0] ?? new Date(),
        },
      });

      const createdMessages: Array<{ id: string; direction: MessageDirection }> = [];

      for (let index = 0; index < threadSeed.messages.length; index += 1) {
        const message = threadSeed.messages[index]!;
        const externalMessageId = `${externalThreadId}-m${index + 1}`;
        const inReplyToExternalMessageId = typeof message.replyToMessageIndex === "number"
          ? `${externalThreadId}-m${message.replyToMessageIndex + 1}`
          : null;
        const createdMessage = await prisma.threadMessage.create({
          data: {
            threadId: thread.id,
            direction: message.direction,
            body: message.body,
            externalMessageId,
            inReplyToExternalMessageId,
            senderExternalId: message.senderExternalId,
            metadata: message.metadata,
            createdAt: minutesAgoToDate(message.minutesAgo),
          },
        });
        createdMessages.push({ id: createdMessage.id, direction: message.direction });
      }

      let analysisId: string | null = null;
      if (threadSeed.analysis) {
        const analysis = await prisma.threadAnalysis.create({
          data: {
            threadId: thread.id,
            workspaceId: workspace.id,
            severity: threadSeed.analysis.severity,
            issueCategory: threadSeed.analysis.issueCategory,
            affectedComponent: threadSeed.analysis.affectedComponent,
            summary: threadSeed.analysis.summary,
            rcaSummary: threadSeed.analysis.rcaSummary,
            sufficient: threadSeed.analysis.sufficient,
            missingContext: threadSeed.analysis.missingContext,
            codexFindings: threadSeed.analysis.codexFindings,
            sentryFindings: threadSeed.analysis.sentryFindings,
            model: "gpt-5.4-mini",
            promptVersion: "demo-seed-v1",
            totalTokens: 742,
            durationMs: 1840,
          },
        });
        analysisId = analysis.id;

        await prisma.supportThread.update({
          where: { id: thread.id },
          data: {
            lastAnalysisId: analysis.id,
            summary: threadSeed.analysis.summary,
            summaryUpdatedAt: new Date(),
          },
        });

        if (threadSeed.analysis.draftBody) {
          const basedOnMessageId = [...createdMessages].reverse().find((message) => message.direction === MessageDirection.INBOUND)?.id;
          await prisma.replyDraft.create({
            data: {
              threadId: thread.id,
              status: DraftStatus.GENERATED,
              draftType: threadSeed.analysis.draftType ?? DraftType.RESOLUTION,
              body: threadSeed.analysis.draftBody,
              model: "gpt-5.4-mini",
              promptVersion: "demo-seed-v1",
              analysisId: analysis.id,
              basedOnMessageId,
              createdByUserId: primaryActor.id,
            },
          });
        }
      }

      if (threadSeed.fixPrRun && analysisId) {
        const run = await prisma.fixPrRun.create({
          data: {
            workspaceId: workspace.id,
            threadId: thread.id,
            analysisId,
            createdById: primaryActor.id,
            status: threadSeed.fixPrRun.status,
            currentStage: threadSeed.fixPrRun.currentStage,
            iterationCount: 1,
            maxIterations: 3,
            summary: threadSeed.fixPrRun.summary,
            prUrl: threadSeed.fixPrRun.prUrl,
            branchName: threadSeed.fixPrRun.branchName,
            rcaSummary: threadSeed.analysis?.rcaSummary ?? null,
            rcaConfidence: threadSeed.analysis?.sufficient ? 0.89 : 0.52,
          },
        });

        const now = new Date();
        await prisma.fixPrIteration.create({
          data: {
            runId: run.id,
            iteration: 1,
            status: threadSeed.fixPrRun.iterationStatus,
            fixPlan: {
              summary: threadSeed.fixPrRun.summary,
              focus: ["stabilize", "validate", "ship"],
            },
            reviewFindings: [],
            checkResults: {
              status:
                threadSeed.fixPrRun.iterationStatus === FixPrIterationStatus.PASSED
                  ? "passed"
                  : "running",
            },
            appliedFiles: [],
            startedAt: new Date(now.getTime() - 2 * 60_000),
            completedAt:
              threadSeed.fixPrRun.iterationStatus === FixPrIterationStatus.PASSED
                ? now
                : null,
          },
        });
      }
    }

    const seeded = await prisma.supportThread.findMany({
      where: {
        workspaceId: workspace.id,
        externalThreadId: { startsWith: SEED_PREFIX },
      },
      select: { status: true },
    });

    const statusCount: Record<ThreadStatus, number> = {
      NEW: 0,
      WAITING_REVIEW: 0,
      WAITING_CUSTOMER: 0,
      ESCALATED: 0,
      IN_PROGRESS: 0,
      CLOSED: 0,
    };
    for (const item of seeded) {
      statusCount[item.status] += 1;
    }

    console.log("[demo-seed] Done.");
    console.log(`[demo-seed] Seeded ${seeded.length} demo threads in workspace '${workspace.slug}'.`);
    console.log("[demo-seed] Status distribution:");
    for (const status of Object.keys(statusCount) as ThreadStatus[]) {
      console.log(`  - ${status}: ${statusCount[status]}`);
    }
    console.log("[demo-seed] Hero thread external id: demo-seed-hero-checkout-crash");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[demo-seed] Failed:", error);
  process.exit(1);
});
