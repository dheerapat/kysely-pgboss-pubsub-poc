import { CompiledQuery } from "kysely";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "./types.ts";

export class KyselyAdapter {
  constructor(
    private readonly runner: Kysely<Database> | Transaction<Database>,
  ) {}

  async executeSql(text: string, values: any[] = []): Promise<{ rows: any[] }> {
    const result = await this.runner.executeQuery(
      CompiledQuery.raw(text, values),
    );
    return { rows: result.rows };
  }
}
