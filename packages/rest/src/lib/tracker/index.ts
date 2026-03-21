import type { PrismaClient } from "@shared/database";
import type { TrackerService } from "./types";
import { linearService } from "./linear.service";

export type { TrackerService, TrackerProject, TrackerIssueResult, CreateTrackerIssueParams } from "./types";

export function getTrackerService(type: string): TrackerService {
  switch (type) {
    case "LINEAR":
      return linearService;
    default:
      throw new Error(`Unsupported tracker type: ${type}`);
  }
}

/**
 * Try to create a tracker issue for a thread that just transitioned to IN_PROGRESS.
 * Fails silently (logs error) so the status update is never blocked.
 */
export async function maybeCreateTrackerIssueForThread(
  prisma: PrismaClient,
  threadId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const connection = await prisma.trackerConnection.findFirst({
      where: { workspaceId, isDefault: true, enabled: true },
    });

    if (!connection) return;

    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        trackerIssueId: true,
        title: true,
        summary: true,
        customer: { select: { displayName: true } },
      },
    });

    if (!thread || thread.trackerIssueId) return;

    const service = getTrackerService(connection.type);
    const issueTitle =
      thread.title ?? `Support thread from ${thread.customer.displayName}`;

    const issue = await service.createIssue({
      apiToken: connection.apiToken,
      siteUrl: connection.siteUrl,
      projectKey: connection.projectKey,
      title: issueTitle,
      description: thread.summary,
      configJson: connection.configJson as Record<string, unknown> | null,
    });

    await prisma.supportThread.update({
      where: { id: threadId },
      data: {
        trackerIssueId: issue.id,
        trackerIssueIdentifier: issue.identifier,
        trackerIssueUrl: issue.url,
        trackerConnectionId: connection.id,
      },
    });
  } catch (error) {
    console.error(
      `[tracker] Failed to create issue for thread ${threadId}:`,
      error,
    );
  }
}
