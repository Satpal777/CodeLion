import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase(databaseUrl: string) {
  return drizzle(neon(databaseUrl), { schema });
}

let cachedDatabase: Database | undefined;

export function getDatabase(databaseUrl = process.env.DATABASE_URL): Database {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  cachedDatabase ??= createDatabase(databaseUrl);
  return cachedDatabase;
}
