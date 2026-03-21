/**
 * Application entry point.
 * Wires all infrastructure: database, pg-boss, event bus.
 * Registers notification domain worker.
 * Starts Elysia HTTP server.
 */
import { Elysia } from "elysia";
import { setupSchema } from "./infrastructure/db/schema.ts";
import { createBoss } from "./infrastructure/events/boss.ts";
import { PgBossEventBus } from "./infrastructure/events/PgBossEventBus.ts";
import { pool } from "./infrastructure/db/pool.ts";
import { UserRepository } from "./infrastructure/user/UserRepository.ts";
import { UserService } from "./domains/user/UserService.ts";
import { NotificationService } from "./domains/notification/NotificationService.ts";

const PORT = parseInt(process.env["PORT"] ?? "3000");

async function main(): Promise<void> {
  // 1. Set up database schema
  await setupSchema();

  // 2. Start pg-boss singleton (queue lifecycle managed in PgBossEventBus.subscribe())
  const boss = await createBoss();

  // 3. Create the event bus (implements IEventBus)
  const eventBus = new PgBossEventBus(boss);

  // 4. Wire domain services
  const userRepo = new UserRepository();
  const userService = new UserService(userRepo, eventBus);

  // 5. Subscribe notification worker — createQueue + work happen inside subscribe(), BEFORE listen()
  //    Boot order: start → createQueue → work → listen (no HTTP until all subscriptions ready)
  const notificationService = new NotificationService();
  await eventBus.subscribe(
    "user.registered",
    (payload) => notificationService.handleUserRegistered(payload),
    "notification",
  );
  console.log("[app] user.registered worker registered.");

  // 6. Start HTTP server
  const app = new Elysia()
    .get("/users", async () => {
      return userRepo.findAll();
    })
    .post("/users", async ({ body, set }) => {
      const { email, name } = body as { email: string; name: string };
      try {
        const result = await userService.register(email, name);
        set.status = 201;
        return result;
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          set.status = 409;
          return { error: "Email already registered" };
        }
        throw err;
      }
    })
    .listen(PORT);

  console.log(`[app] Elysia server running on port ${app.server?.port}`);
  console.log("[app] Infrastructure ready. Awaiting requests.");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[app] Shutting down...");
    app.server?.stop();
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
