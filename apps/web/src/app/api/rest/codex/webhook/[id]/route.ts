import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { prisma } from "@shared/database";
import { createHmac, timingSafeEqual } from "node:crypto";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Webhook endpoint for source providers (GitHub, GitLab, Bitbucket, Azure DevOps).
 *
 * Verifies the request signature/token, then triggers a sync workflow.
 *
 * Supported verification methods:
 * - GitHub:       X-Hub-Signature-256 (HMAC-SHA256)
 * - GitLab:       X-Gitlab-Token (plain token comparison)
 * - Bitbucket:    X-Hub-Signature (HMAC-SHA256)
 * - Azure DevOps: Authorization: Basic (password = webhook secret)
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const repo = await prisma.codexRepository.findUnique({
      where: { id },
      select: {
        id: true,
        syncMode: true,
        webhookSecret: true,
        sourceType: true,
        syncStatus: true,
      },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    if (repo.syncMode !== "WEBHOOK") {
      return NextResponse.json(
        { error: "Repository is not configured for webhook sync" },
        { status: 400 },
      );
    }

    if (!repo.webhookSecret) {
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 },
      );
    }

    // Read the raw body for signature verification
    const body = await req.text();

    const verified = verifyWebhook(req, body, repo.webhookSecret, repo.sourceType);
    if (!verified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Skip if already syncing
    if (repo.syncStatus === "SYNCING") {
      return NextResponse.json(
        { message: "Sync already in progress", repositoryId: id },
        { status: 200 },
      );
    }

    // Trigger sync via tRPC
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.codex.repository.sync({ id });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifyWebhook(
  req: Request,
  body: string,
  secret: string,
  _sourceType: string,
): boolean {
  // GitLab: plain token comparison via X-Gitlab-Token
  const gitlabToken = req.headers.get("x-gitlab-token");
  if (gitlabToken) {
    return safeEqual(gitlabToken, secret);
  }

  // GitHub: X-Hub-Signature-256 = sha256=<hex>
  const githubSig = req.headers.get("x-hub-signature-256");
  if (githubSig) {
    return verifyHmacSha256(body, secret, githubSig, "sha256=");
  }

  // Bitbucket: X-Hub-Signature = sha256=<hex>
  const bitbucketSig = req.headers.get("x-hub-signature");
  if (bitbucketSig) {
    return verifyHmacSha256(body, secret, bitbucketSig, "sha256=");
  }

  // Azure DevOps: Authorization: Basic base64(user:secret)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const password = decoded.split(":")[1] ?? "";
    return safeEqual(password, secret);
  }

  // Fallback for unknown providers: check if a custom header matches the secret
  const customToken = req.headers.get("x-webhook-secret");
  if (customToken) {
    return safeEqual(customToken, secret);
  }

  return false;
}

function verifyHmacSha256(
  body: string,
  secret: string,
  signatureHeader: string,
  prefix: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("hex");
  const received = signatureHeader.startsWith(prefix)
    ? signatureHeader.slice(prefix.length)
    : signatureHeader;

  if (expected.length !== received.length) return false;

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
}
