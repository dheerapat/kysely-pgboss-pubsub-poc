import { Pool } from "pg";

export const pool = new Pool({
  connectionString: "postgres://admin:pass@localhost:15432/postgres",
});
