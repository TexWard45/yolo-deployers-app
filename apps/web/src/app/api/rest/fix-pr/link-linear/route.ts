import { NextResponse } from "next/server";
import { prisma } from "@shared/database";
import { AttachPRToLinearSchema } from "@shared/types";
import { webEnv } from "@shared/env/web";

export async function POST(req: Request): Promise<NextResponse> {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== webEnv.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const input = AttachPRToLinearSchema.parse(body);

    const action = await prisma.triageAction.create({
      data: {
        threadId: input.threadId,
        workspaceId: input.workspaceId,
        analysisId: input.analysisId,
        action: "UPDATE_TICKET",
        linearIssueId: input.linearIssueId,
        linearIssueUrl: input.linearIssueUrl ?? null,
        prUrl: input.prUrl,
        metadata: {
          source: "fix-pr-pipeline",
          prNumber: input.prNumber ?? null,
          status: input.status ?? null,
        },
        createdById: input.createdById,
      },
    });

    return NextResponse.json({ id: action.id, success: true }, { status: 200 });
  } catch (error) {
    console.error("[fix-pr/link-linear] Error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
