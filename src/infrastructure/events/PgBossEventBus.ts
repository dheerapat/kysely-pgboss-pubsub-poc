import type { PgBoss } from "pg-boss";
import type { IDbClient } from "../../domains/shared/IDbClient.ts";
import type { DomainEventMap } from "../../domains/shared/events.ts";
import type { IEventBus } from "../../domains/shared/IEventBus.ts";

/**
 * PgBossEventBus implements IEventBus using pg-boss as the backing store.
 *
 * Key property: publish() accepts an optional { db: IDbClient } option.
 * When provided, pg-boss inserts the job row using that IDbClient's runner
 * (which wraps an active transaction). This makes the event publish atomic
 * with whatever database operation is happening in that transaction.
 */
export class PgBossEventBus implements IEventBus {
  constructor(private readonly boss: PgBoss) {}

  async publish<K extends keyof DomainEventMap>(
    event: K,
    payload: DomainEventMap[K],
    opts?: { db?: IDbClient },
  ): Promise<void> {
    // pg-boss v12: send() routes a job to a named queue
    // The db option routes the INSERT through the provided IDbClient (transaction)
    const sendOpts = opts?.db ? { db: opts.db } : {};
    await this.boss.send(event, payload as object, sendOpts);
  }

  async subscribe<K extends keyof DomainEventMap>(
    event: K,
    handler: (payload: DomainEventMap[K]) => Promise<void>,
  ): Promise<void> {
    // pg-boss v12: work() polls the queue and calls handler with each job
    await this.boss.work(event, async ([job]) => {
      if (!job) throw new Error(`No job received for queue: ${event}`);
      await handler(job.data as DomainEventMap[K]);
    });
  }
}
