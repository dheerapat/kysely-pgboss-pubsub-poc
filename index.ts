import {
  Kysely,
  Transaction,
  CompiledQuery,
  PostgresDialect,
  type Generated,
  type ColumnType,
} from "kysely";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";

interface User {
  id: Generated<number>;
  email: string;
  created_at: ColumnType<Date, string | undefined, never>;
}

interface Database {
  users: User;
}

const pool = new Pool({
  connectionString: "postgres://admin:pass@localhost:15432/postgres",
});

const dialect = new PostgresDialect({
  pool: pool,
});

const kysely = new Kysely<Database>({ dialect });

export class KyselyBossAdapter {
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

async function setupSchema() {
  await kysely.schema
    .createTable("users")
    .ifNotExists()
    .addColumn("id", "serial", (cb) => cb.primaryKey())
    .addColumn("email", "varchar(255)", (cb) => cb.unique().notNull())
    .addColumn("created_at", "timestamp", (cb) =>
      cb.notNull().defaultTo("now()"),
    )
    .execute();
  console.log("Users table is ready.");
}

async function registerUser() {
  const boss = new PgBoss({
    db: new KyselyBossAdapter(kysely),
  });

  boss.on("error", console.error);

  await boss.start();

  const queue = "userQueue";
  await boss.createQueue(queue);

  await kysely.transaction().execute(async (tx) => {
    await tx
      .insertInto("users")
      .values({ email: "john@example.com" })
      .onConflict((oc) => oc.column("email").doNothing())
      .execute();

    console.log("User inserted inside transaction");

    const txAdapter = new KyselyBossAdapter(tx);

    await boss.publish(
      "welcome-email",
      { email: "john@example.com" },
      { db: txAdapter },
    );

    console.log("Job staged inside transaction");
  });
  console.log("Transaction committed. Job is now visible to workers.");

  await boss.subscribe("welcome-email", queue);
  await boss.work(queue, async ([job]) => {
    if (!job) {
      throw new Error();
    }
    console.log(`received job ${job.id} with data ${JSON.stringify(job.data)}`);
  });
}

async function main() {
  await setupSchema();
  await registerUser();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
