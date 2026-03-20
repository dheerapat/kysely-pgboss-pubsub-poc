import type { KyselyAdapter } from "../../infrastructure/db/KyselyAdapter.ts";
import type { DomainEventMap } from "./events.ts";

/**
 * IEventBus is the domain's contract for event publishing and subscription.
 * Domain code (UserService, NotificationService) depends ONLY on this interface.
 * The concrete implementation (PgBossEventBus) lives in infrastructure.
 */
export interface IEventBus {
  /**
   * Publish an event. If opts.db is provided, the publish is routed through
   * that KyselyAdapter's transaction — making it atomic with the surrounding
   * database operation.
   */
  publish<K extends keyof DomainEventMap>(
    event: K,
    payload: DomainEventMap[K],
    opts?: { db?: KyselyAdapter },
  ): Promise<void>;

  /**
   * Subscribe a handler to an event. The handler receives a typed payload.
   */
  subscribe<K extends keyof DomainEventMap>(
    event: K,
    handler: (payload: DomainEventMap[K]) => Promise<void>,
  ): Promise<void>;
}
