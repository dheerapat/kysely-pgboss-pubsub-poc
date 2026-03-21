/**
 * servicesPlugin: Elysia plugin that wires all infrastructure and domain
 * services, then decorates each onto context for downstream plugins and routes.
 *
 * Use createServicesPlugin() — it is async because pg-boss requires await.
 * Compose into the app BEFORE workersPlugin and userRoutesPlugin.
 */
import { Elysia } from "elysia";
import { pool } from "../infrastructure/db/pool.ts";
import { createBoss } from "../infrastructure/events/boss.ts";
import { PgBossEventBus } from "../infrastructure/events/PgBossEventBus.ts";
import { UserRepository } from "../infrastructure/user/UserRepository.ts";
import { UserService } from "../domains/user/UserService.ts";
import { NotificationService } from "../domains/notification/NotificationService.ts";
import { AuditService } from "../domains/audit/AuditService.ts";

export async function createServicesPlugin() {
  // 1. Set up pg-boss (async — must start before any subscribe/publish)
  const boss = await createBoss();

  // 2. Create event bus wrapping the started boss instance
  const eventBus = new PgBossEventBus(boss);

  // 3. Wire domain services
  const userRepo = new UserRepository();
  const userService = new UserService(userRepo, eventBus);

  // 4. Instantiate subscriber services
  const notificationService = new NotificationService();
  const auditService = new AuditService();

  // 5. Return Elysia plugin with all services decorated onto context.
  //    Chained .decorate() calls — TypeScript infers each property type exactly.
  //    { name: "services" } enables Elysia's plugin deduplication — if accidentally
  //    .use()-d twice, it won't double-register.
  return new Elysia({ name: "services" })
    .decorate("pool", pool)
    .decorate("boss", boss)
    .decorate("eventBus", eventBus)
    .decorate("userRepo", userRepo)
    .decorate("userService", userService)
    .decorate("notificationService", notificationService)
    .decorate("auditService", auditService);
}
