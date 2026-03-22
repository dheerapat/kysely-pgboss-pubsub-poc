/**
 * workersPlugin: Elysia plugin that registers all event bus subscriptions.
 *
 * Use createWorkersPlugin() — it is async because eventBus.subscribe() is async.
 * MUST be awaited before app.listen() — boot order: subscribe ALL workers before HTTP server starts.
 *
 * Encapsulates: all boss.subscribe() / boss.work() calls for domain event handlers.
 * Zero subscription wiring should live outside this plugin.
 */
import { Elysia } from "elysia";
import type { PgBossEventBus } from "../infrastructure/events/PgBossEventBus.ts";
import type { NotificationService } from "../domains/notification/NotificationService.ts";
import type { AuditService } from "../domains/audit/AuditService.ts";

export async function createWorkersPlugin(
  eventBus: PgBossEventBus,
  notificationService: NotificationService,
  auditService: AuditService,
) {
  // Subscribe ALL workers before server starts — boot order enforces fan-out correctness
  // Each subscribe() call: createQueue → boss.subscribe → boss.work
  // Boot order: start → (createQueue + subscribe + work) × N subscribers → listen
  await eventBus.subscribe(
    "user.registered",
    (payload) => notificationService.handleUserRegistered(payload),
    "notification",
  );
  console.log("[app] NotificationService subscribed to user.registered.");

  await eventBus.subscribe(
    "user.registered",
    (payload) => auditService.handleUserRegistered(payload),
    "audit",
  );
  console.log("[app] AuditService subscribed to user.registered.");

  return new Elysia({ name: "workers" });
}
