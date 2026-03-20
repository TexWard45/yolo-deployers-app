import { queueEnv } from "@shared/env/queue";

export const temporalConfig = {
  address: queueEnv.TEMPORAL_ADDRESS,
  namespace: queueEnv.TEMPORAL_NAMESPACE,
  taskQueue: queueEnv.TEMPORAL_TASK_QUEUE,
};
