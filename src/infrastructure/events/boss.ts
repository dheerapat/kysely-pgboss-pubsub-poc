import { PgBoss } from "pg-boss";
import { KyselyAdapter } from "../db/KyselyAdapter.ts";
import { kysely } from "../db/kysely.ts";

/**
 * All known queue names. Queues are created at boot before any publish.
 * Adding a new event type requires adding its queue name here.
 */
export const KNOWN_QUEUES = ["user.registered"] as const;

/**
 * Create and start the single PgBoss instance.
 * Creates all known queues before returning.
 * Call once at application boot — share the returned instance everywhere.
 */
export async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    db: new KyselyAdapter(kysely),
  });

  boss.on("error", console.error);
  await boss.start();
  console.log("[infra] pg-boss started.");

  for (const queue of KNOWN_QUEUES) {
    await boss.createQueue(queue);
    console.log(`[infra] Queue created: ${queue}`);
  }

  return boss;
}
