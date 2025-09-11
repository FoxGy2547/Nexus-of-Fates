import { Pool } from "pg";
import type { QueryResultRow } from "pg";

/** เก็บ pool ไว้ระดับ global กันสร้างซ้ำทุก request */
type GlobalWithPg = typeof globalThis & { __PG_POOL__?: Pool };
const g = globalThis as GlobalWithPg;

function buildPool(): Pool {
  const { DATABASE_URL } = process.env;
  if (DATABASE_URL) {
    return new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase ส่วนใหญ่ต้อง SSL
      max: 10,
    });
  }

  // รองรับตั้งค่าแบบแยกตัวแปร
  const host = process.env.PGHOST ?? process.env.DB_HOST;
  const user = process.env.PGUSER ?? process.env.DB_USER;
  const password = process.env.PGPASSWORD ?? process.env.DB_PASS;
  const database = process.env.PGDATABASE ?? process.env.DB_NAME;
  const port = Number(process.env.PGPORT ?? process.env.DB_PORT ?? 5432);

  if (!host || !user || !database) {
    throw new Error("Missing PG connection envs");
  }

  return new Pool({
    host,
    user,
    password,
    database,
    port,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

export function getPool(): Pool {
  if (!g.__PG_POOL__) g.__PG_POOL__ = buildPool();
  return g.__PG_POOL__!;
}

/** query หลายแถว */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const res = await getPool().query<T>(sql, [...params]);
  return res.rows;
}

/** query แถวเดียว */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const res = await getPool().query<T>(sql, [...params]);
  return res.rows[0] ?? null;
}