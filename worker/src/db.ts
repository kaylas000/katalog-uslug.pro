import { Client } from "pg";
import type { Env } from "./types";

export function getDbConnectionString(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
}

export async function withDbClient<T>(
  env: Env,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const cs = getDbConnectionString(env);
  if (!cs) throw new Error("Database URL missing");
  const client = new Client({ connectionString: cs });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
