import { proxyActivities } from "@temporalio/workflow";
import type {
  SyncDiscordChannelsWorkflowInput,
  SyncDiscordChannelsWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

const {
  discoverAndUpdateChannelsActivity,
  backfillNewChannelsActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "120 seconds",
  retry: { maximumAttempts: 3 },
});

/**
 * Discovers Discord text channels matching a name filter (e.g. "-support"),
 * adds them to the channel connection config, and backfills messages.
 */
export async function syncDiscordChannelsWorkflow(
  input: SyncDiscordChannelsWorkflowInput,
): Promise<SyncDiscordChannelsWorkflowResult> {
  // Step 1: Discover channels and update connection config
  const { discovered, addedIds } = await discoverAndUpdateChannelsActivity({
    channelConnectionId: input.channelConnectionId,
    nameFilter: input.nameFilter,
  });

  if (addedIds.length === 0) {
    return {
      discoveredChannels: discovered,
      addedChannelIds: [],
      backfilledMessageCount: 0,
    };
  }

  // Step 2: Backfill messages from newly added channels
  const backfilledMessageCount = await backfillNewChannelsActivity({
    channelConnectionId: input.channelConnectionId,
    channelIds: addedIds,
  });

  return {
    discoveredChannels: discovered,
    addedChannelIds: addedIds,
    backfilledMessageCount,
  };
}
