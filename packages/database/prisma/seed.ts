import { PrismaClient } from "@shared/types/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, scrypt } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

function findEnvFile(dir: string): string {
  const envPath = path.join(dir, ".env");
  if (fs.existsSync(envPath)) return envPath;
  const parent = path.dirname(dir);
  if (parent === dir) return envPath;
  return findEnvFile(parent);
}

dotenv.config({ path: findEnvFile(process.cwd()) });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await new Promise<string>((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      resolve(derived.toString("hex"));
    });
  });
  return `${salt}:${hash}`;
}

async function main() {
  const hashedPw = await hashPassword("password123");

  // --- Users ---
  const duc = await prisma.user.upsert({
    where: { username: "duc" },
    update: { password: hashedPw },
    create: {
      username: "duc",
      email: "duc@yolo.dev",
      password: hashedPw,
      name: "Duc Nguyen",
    },
  });

  const sarah = await prisma.user.upsert({
    where: { username: "sarah" },
    update: { password: hashedPw },
    create: {
      username: "sarah",
      email: "sarah@yolo.dev",
      password: hashedPw,
      name: "Sarah Chen",
    },
  });

  // --- Workspace ---
  const workspace = await prisma.workspace.upsert({
    where: { slug: "yolo-deployers" },
    update: {},
    create: { name: "Yolo Deployers", slug: "yolo-deployers" },
  });

  // --- Members ---
  for (const user of [duc, sarah]) {
    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        workspaceId: workspace.id,
        role: user.id === duc.id ? "OWNER" : "MEMBER",
      },
    });
  }

  // --- Customers ---
  const customers = await Promise.all(
    [
      { displayName: "Acme Corp", externalId: "discord-acme-001" },
      { displayName: "Jane Doe", externalId: "discord-jane-002" },
      { displayName: "Globex Inc", externalId: "discord-globex-003" },
      { displayName: "Initech", externalId: "discord-initech-004" },
      { displayName: "Umbrella Labs", externalId: "discord-umbrella-005" },
      { displayName: "Wayne Industries", externalId: "discord-wayne-006" },
      { displayName: "Stark Tech", externalId: "discord-stark-007" },
      { displayName: "Cyberdyne", externalId: "discord-cyberdyne-008" },
      { displayName: "Oscorp", externalId: "discord-oscorp-009" },
      { displayName: "LexCorp", externalId: "discord-lexcorp-010" },
      { displayName: "Weyland-Yutani", externalId: "discord-weyland-011" },
      { displayName: "Soylent Corp", externalId: "discord-soylent-012" },
    ].map((c) =>
      prisma.customer.upsert({
        where: {
          workspaceId_source_externalCustomerId: {
            workspaceId: workspace.id,
            source: "DISCORD",
            externalCustomerId: c.externalId,
          },
        },
        update: {},
        create: {
          workspaceId: workspace.id,
          source: "DISCORD",
          externalCustomerId: c.externalId,
          displayName: c.displayName,
        },
      })
    )
  );

  // --- Threads with messages ---
  const threadData: {
    customer: string;
    title: string;
    status: "NEW" | "WAITING_REVIEW" | "WAITING_CUSTOMER" | "ESCALATED" | "IN_PROGRESS" | "CLOSED";
    assignee?: string;
    messages: { direction: "INBOUND" | "OUTBOUND" | "SYSTEM"; body: string }[];
    ago: number; // minutes ago
  }[] = [
    // NEW
    {
      customer: "Acme Corp",
      title: "Bot not responding in #general",
      status: "NEW",
      messages: [{ direction: "INBOUND", body: "Hey, our bot stopped responding about 10 mins ago. Anyone looking into this?" }],
      ago: 5,
    },
    {
      customer: "Jane Doe",
      title: "Cannot invite team members",
      status: "NEW",
      messages: [{ direction: "INBOUND", body: "I'm getting a 403 when trying to invite team members to our workspace." }],
      ago: 20,
    },
    {
      customer: "Globex Inc",
      title: "Webhook delivery failures",
      status: "NEW",
      messages: [{ direction: "INBOUND", body: "We're seeing webhook delivery failures for the last 2 hours. Our endpoint is up." }],
      ago: 45,
    },
    {
      customer: "Cyberdyne",
      title: "Dashboard shows stale data",
      status: "NEW",
      messages: [{ direction: "INBOUND", body: "The analytics dashboard hasn't updated since yesterday." }],
      ago: 60,
    },

    // WAITING_REVIEW
    {
      customer: "Initech",
      title: "API rate limit too low for our use case",
      status: "WAITING_REVIEW",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "We're hitting the 100 req/min limit. Can this be raised for our plan?" },
        { direction: "OUTBOUND", body: "Let me check with the team on your current plan limits." },
      ],
      ago: 30,
    },
    {
      customer: "Umbrella Labs",
      title: "Custom domain SSL not provisioning",
      status: "WAITING_REVIEW",
      assignee: "sarah",
      messages: [
        { direction: "INBOUND", body: "Added our custom domain 3 days ago but SSL cert still pending." },
        { direction: "OUTBOUND", body: "I see the DNS records. Let me check the cert provisioning logs." },
      ],
      ago: 120,
    },
    {
      customer: "Oscorp",
      title: "Export CSV missing columns",
      status: "WAITING_REVIEW",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "When I export to CSV, the 'created_at' and 'tags' columns are missing." },
      ],
      ago: 180,
    },

    // WAITING_CUSTOMER
    {
      customer: "Wayne Industries",
      title: "SSO integration returning invalid_grant",
      status: "WAITING_CUSTOMER",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "Our Okta SSO integration keeps returning invalid_grant." },
        { direction: "OUTBOUND", body: "Can you share the client ID and redirect URI configured in Okta?" },
      ],
      ago: 1440,
    },
    {
      customer: "Soylent Corp",
      title: "Need help with API pagination",
      status: "WAITING_CUSTOMER",
      assignee: "sarah",
      messages: [
        { direction: "INBOUND", body: "How does cursor-based pagination work with your list endpoints?" },
        { direction: "OUTBOUND", body: "Here's our pagination guide: pass `cursor` param with the last item ID. Does that help?" },
      ],
      ago: 2880,
    },

    // ESCALATED
    {
      customer: "Stark Tech",
      title: "Data loss after migration",
      status: "ESCALATED",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "After the v3 migration, we're missing about 2000 records from our main table." },
        { direction: "OUTBOUND", body: "This is critical — escalating to engineering immediately." },
        { direction: "SYSTEM", body: "Thread escalated by Duc Nguyen" },
      ],
      ago: 60,
    },

    // IN_PROGRESS
    {
      customer: "LexCorp",
      title: "Billing discrepancy on March invoice",
      status: "IN_PROGRESS",
      assignee: "sarah",
      messages: [
        { direction: "INBOUND", body: "Our March invoice shows charges for 50 seats but we only have 30 active." },
        { direction: "OUTBOUND", body: "I've flagged this with billing. Working on a corrected invoice now." },
      ],
      ago: 240,
    },
    {
      customer: "Weyland-Yutani",
      title: "Scheduled reports not sending",
      status: "IN_PROGRESS",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "Our weekly scheduled reports stopped arriving last Monday." },
        { direction: "OUTBOUND", body: "Found the issue — the email worker queue backed up. Flushing now." },
      ],
      ago: 480,
    },

    // CLOSED
    {
      customer: "Acme Corp",
      title: "How to reset API key",
      status: "CLOSED",
      assignee: "duc",
      messages: [
        { direction: "INBOUND", body: "Where do I reset my API key?" },
        { direction: "OUTBOUND", body: "Go to Settings → API → Regenerate Key. Let me know if that works!" },
        { direction: "INBOUND", body: "Got it, thanks!" },
      ],
      ago: 4320,
    },
    {
      customer: "Globex Inc",
      title: "Clarification on data retention policy",
      status: "CLOSED",
      assignee: "sarah",
      messages: [
        { direction: "INBOUND", body: "What's your data retention policy for audit logs?" },
        { direction: "OUTBOUND", body: "Audit logs are retained for 90 days on the Pro plan, 1 year on Enterprise." },
        { direction: "INBOUND", body: "Perfect, that's what we needed." },
      ],
      ago: 10080,
    },
    {
      customer: "Jane Doe",
      title: "Feature request: dark mode",
      status: "CLOSED",
      messages: [
        { direction: "INBOUND", body: "Any plans for dark mode?" },
        { direction: "OUTBOUND", body: "It's on our roadmap for Q2. I'll note your interest!" },
      ],
      ago: 20160,
    },
  ];

  const customerMap = new Map(customers.map((c) => [c.displayName, c]));
  const userMap = new Map([
    ["duc", duc],
    ["sarah", sarah],
  ]);

  let threadCounter = 0;
  for (const t of threadData) {
    threadCounter++;
    const customer = customerMap.get(t.customer)!;
    const assignee = t.assignee ? userMap.get(t.assignee) : undefined;
    const now = Date.now();
    const threadTime = new Date(now - t.ago * 60 * 1000);

    const thread = await prisma.supportThread.upsert({
      where: {
        workspaceId_source_externalThreadId: {
          workspaceId: workspace.id,
          source: "DISCORD",
          externalThreadId: `seed-thread-${String(threadCounter).padStart(3, "0")}`,
        },
      },
      update: { status: t.status, title: t.title, assignedToId: assignee?.id ?? null },
      create: {
        workspaceId: workspace.id,
        customerId: customer.id,
        source: "DISCORD",
        externalThreadId: `seed-thread-${String(threadCounter).padStart(3, "0")}`,
        title: t.title,
        status: t.status,
        assignedToId: assignee?.id ?? null,
        lastMessageAt: threadTime,
        createdAt: threadTime,
      },
    });

    // Delete existing messages for this thread (idempotent re-seed)
    await prisma.threadMessage.deleteMany({ where: { threadId: thread.id } });

    for (let i = 0; i < t.messages.length; i++) {
      const msg = t.messages[i]!;
      await prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          direction: msg.direction,
          body: msg.body,
          externalMessageId: `seed-msg-${thread.id}-${i}`,
          createdAt: new Date(threadTime.getTime() + i * 60 * 1000),
        },
      });
    }
  }

  console.log(`Seeded: 2 users, 1 workspace, ${customers.length} customers, ${threadData.length} threads`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
