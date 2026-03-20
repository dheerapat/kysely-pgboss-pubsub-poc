/**
 * Application entry point.
 * Wires all infrastructure: database, pg-boss, event bus.
 * Domain layers (Phase 2+) will be imported and wired here.
 */
import { setupSchema } from "./infrastructure/db/schema.ts";
import { createBoss } from "./infrastructure/events/boss.ts";
import { PgBossEventBus } from "./infrastructure/events/PgBossEventBus.ts";
import { pool } from "./infrastructure/db/pool.ts";

async function main(): Promise<void> {
  // 1. Set up database schema
  await setupSchema();

  // 2. Start pg-boss singleton (creates all known queues)
  const boss = await createBoss();

  // 3. Create the event bus (implements IEventBus)
  const eventBus = new PgBossEventBus(boss);

  // eventBus is now ready to be injected into domain services (Phase 2+)
  console.log("[app] Infrastructure ready. eventBus:", typeof eventBus);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[app] Shutting down...");
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
