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
import { PrismaClient } from "@shared/types/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ── Users ─────────────────────────────────────────────────────────
  const alice = await prisma.user.upsert({
    where: { username: "alice" },
    update: {},
    create: {
      username: "alice",
      email: "alice@demo.local",
      password: "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewCjT3J5s5z5Q8Gy", // "password123"
      name: "Alice Demo",
      isSystemAdmin: true,
    },
  });

  const bob = await prisma.user.upsert({
    where: { username: "bob" },
    update: {},
    create: {
      username: "bob",
      email: "bob@demo.local",
      password: "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewCjT3J5s5z5Q8Gy", // "password123"
      name: "Bob Demo",
    },
  });

  const carol = await prisma.user.upsert({
    where: { username: "carol" },
    update: {},
    create: {
      username: "carol",
      email: "carol@demo.local",
      password: "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewCjT3J5s5z5Q8Gy", // "password123"
      name: "Carol Demo",
    },
  });

  console.log("✓ Users:", alice.username, bob.username, carol.username);

  // ── Workspaces ────────────────────────────────────────────────────
  const acme = await prisma.workspace.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Corp",
      slug: "acme",
      members: {
        create: [
          { userId: alice.id, role: "OWNER" },
          { userId: bob.id, role: "ADMIN" },
          { userId: carol.id, role: "MEMBER" },
        ],
      },
    },
  });

  const devtools = await prisma.workspace.upsert({
    where: { slug: "devtools" },
    update: {},
    create: {
      name: "DevTools Team",
      slug: "devtools",
      members: {
        create: [
          { userId: bob.id, role: "OWNER" },
          { userId: alice.id, role: "MEMBER" },
        ],
      },
    },
  });

  console.log("✓ Workspaces:", acme.slug, devtools.slug);

  // ── Posts ─────────────────────────────────────────────────────────
  await prisma.post.createMany({
    skipDuplicates: true,
    data: [
      {
        title: "Welcome to Acme Corp",
        content: "This is our first post. Excited to get started!",
        published: true,
        authorId: alice.id,
        workspaceId: acme.id,
      },
      {
        title: "Q2 Roadmap",
        content: "Key focus areas this quarter: reliability, performance, and new integrations.",
        published: true,
        authorId: bob.id,
        workspaceId: acme.id,
      },
      {
        title: "Draft: API Guidelines",
        content: "Internal draft — not yet published.",
        published: false,
        authorId: carol.id,
        workspaceId: acme.id,
      },
      {
        title: "DevTools v2 Launch",
        content: "We shipped the new DevTools dashboard today. Check it out!",
        published: true,
        authorId: bob.id,
        workspaceId: devtools.id,
      },
    ],
  });

  console.log("✓ Posts created");

  // ── Telemetry: Sessions + Events ──────────────────────────────────
  const traceId1 = "4bf92f3577b34da6a3ce929d0e0e4736";
  const traceId2 = "abc123def456789012345678901234ab";

  const session1 = await prisma.session.upsert({
    where: { id: "demo-session-001" },
    update: {},
    create: {
      id: "demo-session-001",
      userId: alice.id,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120",
    },
  });

  const session2 = await prisma.session.upsert({
    where: { id: "demo-session-002" },
    update: {},
    create: {
      id: "demo-session-002",
      userId: bob.id,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121",
    },
  });

  console.log("✓ Sessions:", session1.id, session2.id);

  // Clear existing replay events so re-seeding is idempotent
  await prisma.replayEvent.deleteMany({ where: { sessionId: { in: [session1.id, session2.id] } } });

  const baseTime1 = new Date("2026-03-20T10:00:00Z");
  const t1 = baseTime1.getTime(); // ms

  // Shared dashboard DOM (node IDs 0-22)
  const dashboardSnapshot = {
    type: 0, // Document
    childNodes: [
      { type: 1, name: "html", publicId: "", systemId: "", id: 1 },
      {
        type: 2, tagName: "html", attributes: { lang: "en" }, id: 2,
        childNodes: [
          {
            type: 2, tagName: "head", attributes: {}, id: 3,
            childNodes: [
              { type: 2, tagName: "title", attributes: {}, id: 4,
                childNodes: [{ type: 3, textContent: "Dashboard — Acme Corp", id: 5 }] },
            ],
          },
          {
            type: 2, tagName: "body",
            attributes: { style: "margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a" },
            id: 6,
            childNodes: [
              {
                type: 2, tagName: "nav",
                attributes: { style: "background:#1e293b;padding:16px 24px;display:flex;align-items:center;justify-content:space-between" },
                id: 7,
                childNodes: [
                  { type: 2, tagName: "span",
                    attributes: { style: "color:#f1f5f9;font-weight:700;font-size:18px" }, id: 8,
                    childNodes: [{ type: 3, textContent: "Acme Corp", id: 9 }] },
                  { type: 2, tagName: "span",
                    attributes: { style: "color:#94a3b8;font-size:14px" }, id: 10,
                    childNodes: [{ type: 3, textContent: "alice", id: 11 }] },
                ],
              },
              {
                type: 2, tagName: "main",
                attributes: { style: "padding:32px 24px;max-width:860px;margin:0 auto" }, id: 12,
                childNodes: [
                  {
                    type: 2, tagName: "div",
                    attributes: { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:24px" },
                    id: 13,
                    childNodes: [
                      { type: 2, tagName: "h1",
                        attributes: { style: "font-size:24px;font-weight:700;margin:0" }, id: 14,
                        childNodes: [{ type: 3, textContent: "Posts", id: 15 }] },
                      { type: 2, tagName: "button",
                        attributes: { "data-testid": "new-post-btn", style: "background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer" },
                        id: 16,
                        childNodes: [{ type: 3, textContent: "New Post", id: 17 }] },
                    ],
                  },
                  {
                    type: 2, tagName: "div",
                    attributes: { style: "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px" },
                    id: 18,
                    childNodes: [
                      { type: 2, tagName: "h2",
                        attributes: { style: "font-size:18px;font-weight:600;margin:0 0 8px" }, id: 19,
                        childNodes: [{ type: 3, textContent: "Welcome to Acme Corp", id: 20 }] },
                      { type: 2, tagName: "p",
                        attributes: { style: "color:#64748b;font-size:14px;margin:0" }, id: 21,
                        childNodes: [{ type: 3, textContent: "This is our first post. Excited to get started!", id: 22 }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    id: 0,
  };

  // New Post form DOM (node IDs 30-55)
  const newPostSnapshot = {
    type: 0,
    childNodes: [
      { type: 1, name: "html", publicId: "", systemId: "", id: 30 },
      {
        type: 2, tagName: "html", attributes: { lang: "en" }, id: 31,
        childNodes: [
          { type: 2, tagName: "head", attributes: {}, id: 32,
            childNodes: [{ type: 2, tagName: "title", attributes: {}, id: 33,
              childNodes: [{ type: 3, textContent: "New Post — Acme Corp", id: 34 }] }] },
          {
            type: 2, tagName: "body",
            attributes: { style: "margin:0;font-family:system-ui,sans-serif;background:#f8fafc" },
            id: 35,
            childNodes: [
              { type: 2, tagName: "nav",
                attributes: { style: "background:#1e293b;padding:16px 24px" }, id: 36,
                childNodes: [
                  { type: 2, tagName: "span", attributes: { style: "color:#f1f5f9;font-weight:700;font-size:18px" }, id: 37,
                    childNodes: [{ type: 3, textContent: "Acme Corp", id: 38 }] },
                ],
              },
              {
                type: 2, tagName: "main",
                attributes: { style: "padding:32px 24px;max-width:640px;margin:0 auto" }, id: 39,
                childNodes: [
                  { type: 2, tagName: "h1", attributes: { style: "font-size:24px;font-weight:700;margin:0 0 24px" }, id: 40,
                    childNodes: [{ type: 3, textContent: "New Post", id: 41 }] },
                  {
                    type: 2, tagName: "form", attributes: {}, id: 42,
                    childNodes: [
                      { type: 2, tagName: "div", attributes: { style: "margin-bottom:16px" }, id: 43,
                        childNodes: [
                          { type: 2, tagName: "label", attributes: { style: "display:block;font-size:14px;font-weight:600;margin-bottom:6px" }, id: 44,
                            childNodes: [{ type: 3, textContent: "Title", id: 45 }] },
                          { type: 2, tagName: "input",
                            attributes: { type: "text", value: "Q2 Planning Notes", style: "width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;box-sizing:border-box" },
                            id: 46, childNodes: [] },
                        ],
                      },
                      { type: 2, tagName: "div", attributes: { style: "margin-bottom:24px" }, id: 47,
                        childNodes: [
                          { type: 2, tagName: "label", attributes: { style: "display:block;font-size:14px;font-weight:600;margin-bottom:6px" }, id: 48,
                            childNodes: [{ type: 3, textContent: "Content", id: 49 }] },
                          { type: 2, tagName: "textarea",
                            attributes: { style: "width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;height:160px;box-sizing:border-box", value: "" },
                            id: 50, childNodes: [{ type: 3, textContent: "Planning session notes for Q2...", id: 51 }] },
                        ],
                      },
                      { type: 2, tagName: "button",
                        attributes: { type: "submit", style: "background:#3b82f6;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer" },
                        id: 52,
                        childNodes: [{ type: 3, textContent: "Publish", id: 53 }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    id: 29,
  };

  await prisma.replayEvent.createMany({
    data: [
      // Meta: viewport + URL
      { sessionId: session1.id, type: "rrweb", sequence: 0, route: "/dashboard",
        timestamp: new Date(t1),
        payload: { type: 4, data: { href: "http://localhost:3000/dashboard", width: 1280, height: 800 }, timestamp: t1 } },
      // FullSnapshot: dashboard page
      { sessionId: session1.id, type: "rrweb", sequence: 1, route: "/dashboard",
        timestamp: new Date(t1 + 100),
        payload: { type: 2, data: { node: dashboardSnapshot, initialOffset: { top: 0, left: 0 } }, timestamp: t1 + 100 } },
      // MouseMove: toward "New Post" button
      { sessionId: session1.id, type: "rrweb", sequence: 2, route: "/dashboard",
        timestamp: new Date(t1 + 1800),
        payload: { type: 3, data: { source: 1, positions: [{ x: 180, y: 70, id: 16, timeOffset: -120 }, { x: 210, y: 82, id: 16, timeOffset: -60 }, { x: 240, y: 88, id: 16, timeOffset: 0 }] }, timestamp: t1 + 1800 } },
      // Click: "New Post" button
      { sessionId: session1.id, type: "rrweb", sequence: 3, route: "/dashboard", traceId: traceId1,
        timestamp: new Date(t1 + 2000),
        payload: { type: 3, data: { source: 2, type: 2, id: 16, x: 240, y: 88 }, timestamp: t1 + 2000 } },
      // Meta: navigate to /posts/new
      { sessionId: session1.id, type: "rrweb", sequence: 4, route: "/posts/new",
        timestamp: new Date(t1 + 2200),
        payload: { type: 4, data: { href: "http://localhost:3000/posts/new", width: 1280, height: 800 }, timestamp: t1 + 2200 } },
      // FullSnapshot: new post form
      { sessionId: session1.id, type: "rrweb", sequence: 5, route: "/posts/new",
        timestamp: new Date(t1 + 2350),
        payload: { type: 2, data: { node: newPostSnapshot, initialOffset: { top: 0, left: 0 } }, timestamp: t1 + 2350 } },
      // MouseMove: toward "Publish" button
      { sessionId: session1.id, type: "rrweb", sequence: 6, route: "/posts/new",
        timestamp: new Date(t1 + 8300),
        payload: { type: 3, data: { source: 1, positions: [{ x: 260, y: 610, id: 52, timeOffset: -150 }, { x: 295, y: 632, id: 52, timeOffset: -60 }, { x: 320, y: 640, id: 52, timeOffset: 0 }] }, timestamp: t1 + 8300 } },
      // Click: "Publish" button
      { sessionId: session1.id, type: "rrweb", sequence: 7, route: "/posts/new", traceId: traceId1,
        timestamp: new Date(t1 + 8500),
        payload: { type: 3, data: { source: 2, type: 2, id: 52, x: 320, y: 640 }, timestamp: t1 + 8500 } },
      // DOM mutation: button becomes "Publishing..."
      { sessionId: session1.id, type: "rrweb", sequence: 8, route: "/posts/new", traceId: traceId1,
        timestamp: new Date(t1 + 8520),
        payload: { type: 3, data: { source: 0, texts: [{ id: 53, value: "Publishing..." }], attributes: [{ id: 52, attributes: { disabled: true, style: "background:#93c5fd;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:not-allowed" } }], removes: [], adds: [] }, timestamp: t1 + 8520 } },
    ],
  });

  // Session 2: bob hitting a workspace load error
  const baseTime2 = new Date("2026-03-20T14:30:00Z");
  const t2 = baseTime2.getTime();

  const workspacesSnapshot = {
    type: 0,
    childNodes: [
      { type: 1, name: "html", publicId: "", systemId: "", id: 60 },
      {
        type: 2, tagName: "html", attributes: { lang: "en" }, id: 61,
        childNodes: [
          { type: 2, tagName: "head", attributes: {}, id: 62,
            childNodes: [{ type: 2, tagName: "title", attributes: {}, id: 63,
              childNodes: [{ type: 3, textContent: "Workspaces", id: 64 }] }] },
          {
            type: 2, tagName: "body",
            attributes: { style: "margin:0;font-family:system-ui,sans-serif;background:#f8fafc" },
            id: 65,
            childNodes: [
              { type: 2, tagName: "nav",
                attributes: { style: "background:#1e293b;padding:16px 24px;display:flex;align-items:center;justify-content:space-between" }, id: 66,
                childNodes: [
                  { type: 2, tagName: "span", attributes: { style: "color:#f1f5f9;font-weight:700;font-size:18px" }, id: 67,
                    childNodes: [{ type: 3, textContent: "App", id: 68 }] },
                  { type: 2, tagName: "span", attributes: { style: "color:#94a3b8;font-size:14px" }, id: 69,
                    childNodes: [{ type: 3, textContent: "bob", id: 70 }] },
                ],
              },
              {
                type: 2, tagName: "main", attributes: { style: "padding:32px 24px;max-width:860px;margin:0 auto" }, id: 71,
                childNodes: [
                  { type: 2, tagName: "h1", attributes: { style: "font-size:24px;font-weight:700;margin:0 0 24px" }, id: 72,
                    childNodes: [{ type: 3, textContent: "Your Workspaces", id: 73 }] },
                  {
                    type: 2, tagName: "div", attributes: { style: "display:grid;grid-template-columns:repeat(2,1fr);gap:16px" }, id: 74,
                    childNodes: [
                      { type: 2, tagName: "div",
                        attributes: { class: "workspace-card", style: "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;cursor:pointer;transition:box-shadow 0.2s" },
                        id: 75,
                        childNodes: [
                          { type: 2, tagName: "h2", attributes: { style: "font-size:18px;font-weight:700;margin:0 0 8px;color:#0f172a" }, id: 76,
                            childNodes: [{ type: 3, textContent: "Acme Corp", id: 77 }] },
                          { type: 2, tagName: "p", attributes: { style: "color:#64748b;font-size:13px;margin:0" }, id: 78,
                            childNodes: [{ type: 3, textContent: "5 members · 4 posts", id: 79 }] },
                        ],
                      },
                      { type: 2, tagName: "div",
                        attributes: { class: "workspace-card", style: "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;cursor:pointer" },
                        id: 80,
                        childNodes: [
                          { type: 2, tagName: "h2", attributes: { style: "font-size:18px;font-weight:700;margin:0 0 8px;color:#0f172a" }, id: 81,
                            childNodes: [{ type: 3, textContent: "DevTools Team", id: 82 }] },
                          { type: 2, tagName: "p", attributes: { style: "color:#64748b;font-size:13px;margin:0" }, id: 83,
                            childNodes: [{ type: 3, textContent: "2 members · 1 post", id: 84 }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    id: 59,
  };

  await prisma.replayEvent.createMany({
    data: [
      // Meta: viewport + URL
      { sessionId: session2.id, type: "rrweb", sequence: 0, route: "/workspaces",
        timestamp: new Date(t2),
        payload: { type: 4, data: { href: "http://localhost:3000/workspaces", width: 1440, height: 900 }, timestamp: t2 } },
      // FullSnapshot: workspaces list
      { sessionId: session2.id, type: "rrweb", sequence: 1, route: "/workspaces",
        timestamp: new Date(t2 + 100),
        payload: { type: 2, data: { node: workspacesSnapshot, initialOffset: { top: 0, left: 0 } }, timestamp: t2 + 100 } },
      // MouseMove: toward "Acme Corp" card
      { sessionId: session2.id, type: "rrweb", sequence: 2, route: "/workspaces",
        timestamp: new Date(t2 + 3000),
        payload: { type: 3, data: { source: 1, positions: [{ x: 120, y: 190, id: 75, timeOffset: -150 }, { x: 155, y: 210, id: 75, timeOffset: -70 }, { x: 180, y: 220, id: 75, timeOffset: 0 }] }, timestamp: t2 + 3000 } },
      // Click: "Acme Corp" workspace card
      { sessionId: session2.id, type: "rrweb", sequence: 3, route: "/workspaces", traceId: traceId2,
        timestamp: new Date(t2 + 3200),
        payload: { type: 3, data: { source: 2, type: 2, id: 75, x: 180, y: 220 }, timestamp: t2 + 3200 } },
      // DOM mutation: error banner appears
      { sessionId: session2.id, type: "rrweb", sequence: 4, route: "/workspaces", traceId: traceId2,
        timestamp: new Date(t2 + 3400),
        payload: { type: 3, data: {
          source: 0,
          texts: [],
          attributes: [],
          removes: [],
          adds: [{
            parentId: 71, nextId: 72,
            node: { type: 2, tagName: "div",
              attributes: { id: "error-banner", style: "background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;color:#dc2626;font-size:14px" },
              id: 90, childNodes: [{ type: 3, textContent: "⚠ Failed to load workspace data (500 Internal Server Error)", id: 91 }] },
          }],
        }, timestamp: t2 + 3400 } },
    ],
  });

  console.log("✓ Replay events created");

  // ── SessionTimeline ───────────────────────────────────────────────
  await prisma.sessionTimeline.createMany({
    skipDuplicates: true,
    data: [
      {
        sessionId: session1.id,
        type: "session_summary",
        content: "Session lasted 11s with 5 events captured.",
        metadata: { eventCount: 5, durationMs: 10600 },
        timestamp: baseTime1,
      },
      {
        sessionId: session1.id,
        type: "click",
        content: 'Click #1 on "New Post" ([data-testid=\'new-post-btn\'])',
        metadata: { selector: "[data-testid='new-post-btn']", text: "New Post", x: 240, y: 88, route: "/dashboard", traceId: traceId1 },
        timestamp: new Date(baseTime1.getTime() + 2000),
      },
      {
        sessionId: session1.id,
        type: "click",
        content: 'Click #2 on "Publish" (button[type=\'submit\'])',
        metadata: { selector: "button[type='submit']", text: "Publish", x: 320, y: 640, route: "/posts/new", traceId: traceId1 },
        timestamp: new Date(baseTime1.getTime() + 8500),
      },
      {
        sessionId: session2.id,
        type: "session_summary",
        content: "Session lasted 4s with 4 events captured.",
        metadata: { eventCount: 4, durationMs: 3410 },
        timestamp: baseTime2,
      },
      {
        sessionId: session2.id,
        type: "click",
        content: 'Click #1 on "Acme Corp" (.workspace-card)',
        metadata: { selector: ".workspace-card", text: "Acme Corp", x: 180, y: 220, route: "/workspaces", traceId: traceId2 },
        timestamp: new Date(baseTime2.getTime() + 3200),
      },
      {
        sessionId: session2.id,
        type: "error",
        content: "Network error: GET /api/rest/workspace returned 500 (2100ms)",
        metadata: { url: "/api/rest/workspace?userId=bob", status_code: 500, duration_ms: 2100, traceId: traceId2 },
        timestamp: new Date(baseTime2.getTime() + 3400),
      },
    ],
  });

  // ── SessionClick ──────────────────────────────────────────────────
  await prisma.sessionClick.createMany({
    skipDuplicates: true,
    data: [
      {
        sessionId: session1.id,
        selector: "[data-testid='new-post-btn']",
        tagName: "button",
        text: "New Post",
        x: 240,
        y: 88,
        traceId: traceId1,
        route: "/dashboard",
        timestamp: new Date(baseTime1.getTime() + 2000),
      },
      {
        sessionId: session1.id,
        selector: "button[type='submit']",
        tagName: "button",
        text: "Publish",
        x: 320,
        y: 640,
        traceId: traceId1,
        route: "/posts/new",
        timestamp: new Date(baseTime1.getTime() + 8500),
      },
      {
        sessionId: session2.id,
        selector: ".workspace-card",
        tagName: "div",
        text: "Acme Corp",
        x: 180,
        y: 220,
        traceId: traceId2,
        route: "/workspaces",
        timestamp: new Date(baseTime2.getTime() + 3200),
      },
    ],
  });

  // ── SessionTraceLink ──────────────────────────────────────────────
  await prisma.sessionTraceLink.createMany({
    skipDuplicates: true,
    data: [
      { sessionId: session1.id, traceId: traceId1 },
      { sessionId: session2.id, traceId: traceId2 },
    ],
  });

  console.log("✓ Timeline, clicks, and trace links created");
  console.log("\nSeed complete!");
  console.log("  Demo credentials: username=alice / bob / carol, password=password123");
  console.log("  Workspaces: acme, devtools");
  console.log("  Sessions: demo-session-001 (alice), demo-session-002 (bob)");
  console.log(`  TraceId examples: ${traceId1}, ${traceId2}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
