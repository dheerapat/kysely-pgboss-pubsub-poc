import type { Transaction } from "kysely";
import type { Database } from "../db/types.ts";
import type { IUserRepository } from "../../domains/user/IUserRepository.ts";
import type { User } from "../../domains/user/User.ts";
import { kysely } from "../db/kysely.ts";

export class UserRepository implements IUserRepository {
  async save(user: User, tx: Transaction<Database>): Promise<void> {
    await tx
      .insertInto("users")
      .values({
        id: user.id as string,
        email: user.email as string,
        name: user.name,
      })
      .execute();
  }

  async findAll(): Promise<Array<{ id: string; email: string; name: string }>> {
    const rows = await kysely
      .selectFrom("users")
      .select(["id", "email", "name"])
      .execute();
    return rows as Array<{ id: string; email: string; name: string }>;
  }
}
