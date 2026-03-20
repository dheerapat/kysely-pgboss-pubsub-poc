import type { User } from "./User.ts";
import type { Transaction } from "kysely";
import type { Database } from "../../infrastructure/db/types.ts";

export interface IUserRepository {
  /**
   * Persist a user within the provided Kysely transaction.
   * The caller (UserService) controls the transaction lifetime.
   */
  save(user: User, tx: Transaction<Database>): Promise<void>;

  /**
   * Return all persisted users. Reads from the live database (no tx).
   */
  findAll(): Promise<Array<{ id: string; email: string; name: string }>>;
}
