import { Email } from "./Email.ts";
import { User } from "./User.ts";
import type { IUserRepository } from "./IUserRepository.ts";
import type { IEventBus } from "../shared/IEventBus.ts";
import { kysely } from "../../infrastructure/db/kysely.ts";
import { KyselyAdapter } from "../../infrastructure/db/KyselyAdapter.ts";

export class UserService {
  constructor(
    private readonly repo: IUserRepository,
    private readonly eventBus: IEventBus,
  ) {}

  async register(emailStr: string, name: string): Promise<{ userId: string }> {
    const email = Email.create(emailStr);  // throws if invalid
    const user = User.create(email, name);

    await kysely.transaction().execute(async (tx) => {
      console.log("[UserService] tx opened");

      // 1. INSERT user row (within tx)
      await this.repo.save(user, tx);
      console.log("[UserService] user INSERT done");

      // 2. Publish domain event — routed through same tx via KyselyAdapter(tx)
      await this.eventBus.publish(
        "user.registered",
        { userId: user.id as string, email: user.email as string, name: user.name },
        { db: new KyselyAdapter(tx) },
      );
      console.log("[UserService] user.registered job queued (same tx)");
    });

    console.log("[UserService] tx committed");
    return { userId: user.id as string };
  }
}
