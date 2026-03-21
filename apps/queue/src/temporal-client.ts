import { Client, Connection } from "@temporalio/client";
import { temporalConfig } from "./config.js";

let _client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;

  const connection = await Connection.connect({
    address: temporalConfig.address,
  });

  _client = new Client({
    connection,
    namespace: temporalConfig.namespace,
  });

  return _client;
}
