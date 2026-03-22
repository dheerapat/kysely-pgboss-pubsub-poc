/**
 * Application composition root.
 * Imports and composes the three Elysia plugins, enforces boot order, starts the server.
 * Zero service instantiation or subscription wiring lives here.
 */
import { setupSchema } from "./infrastructure/db/schema.ts";
import { createServicesPlugin } from "./plugins/servicesPlugin.ts";
import { createWorkersPlugin } from "./plugins/workersPlugin.ts";
import { createUserRoutesPlugin } from "./plugins/userRoutesPlugin.ts";
import { Elysia } from "elysia";

const PORT = parseInt(process.env["PORT"] ?? "3000");

async function main(): Promise<void> {
  // 1. Set up database schema
  await setupSchema();

  // 2. Boot all infrastructure and domain services
  const services = await createServicesPlugin();

  // 3. Subscribe ALL workers BEFORE server starts — boot order: subscribe → listen
  const workers = await createWorkersPlugin(
    services.decorator.eventBus,
    services.decorator.notificationService,
    services.decorator.auditService,
  );

  // 4. Build route plugin (uses services for typed context injection)
  const routes = createUserRoutesPlugin(services);

  // 5. Compose plugins and start HTTP server
  const app = new Elysia()
    .use(services)
    .use(workers)
    .use(routes)
    .listen(PORT);

  console.log(`[app] Elysia server running on port ${app.server?.port}`);
  console.log("[app] Infrastructure ready. Awaiting requests.");

  // 6. Graceful shutdown — stop boss and pool via decorated context
  //    Handles both SIGINT (Ctrl+C) and SIGTERM (docker stop)
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[app] Received ${signal}, shutting down...`);
    app.server?.stop();
    await services.decorator.boss.stop();   // drains pg-boss workers (default: graceful=true, timeout=30s)
    await services.decorator.pool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
