import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// PostgreSQL can terminate idle connections during network interruptions or restarts.
// Without a listener, pg emits an unhandled error event and Node exits with status 1.
// The pool discards the failed idle client and reconnects on demand.
pool.on("error", (error) => {
  console.error("PostgreSQL idle connection lost; reconnecting on demand:", error.message);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
