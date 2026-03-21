import { PgBoss } from "pg-boss";
import { KyselyAdapter } from "../db/KyselyAdapter.ts";
import { kysely } from "../db/kysely.ts";

/**
 * Create and start the single PgBoss instance.
 * Queue lifecycle (createQueue, subscribe, work) is handled by PgBossEventBus.subscribe().
 * Call once at application boot — share the returned instance everywhere.
 */
export async function createBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    db: new KyselyAdapter(kysely),
  });

  boss.on("error", console.error);
  await boss.start();
  console.log("[infra] pg-boss started.");

  return boss;
}
