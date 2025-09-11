// src/lib/db.ts
import { Pool, QueryResultRow } from "pg";

type GlobalWithPg = typeof globalThis & { __PG_POOL__?: Pool };
const g = globalThis as GlobalWithPg;

export function getPool(): Pool {
  if (!g.__PG_POOL__) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing DATABASE_URL");

    g.__PG_POOL__ = new Pool({
      connectionString: url,
      max: 1,
      idleTimeoutMillis: 30_000,
      // Vercel/Supabase ต้องเปิด SSL; Supabase ใช้ cert proxy → ปิด verify
      ssl: { rejectUnauthorized: false },
    });
  }
  return g.__PG_POOL__;
}

/** query หลายแถว */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  // pg ระบุ values: any[] → cast เฉพาะขอบต่อไลบรารี
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await getPool().query<T>(sql, params as any[]);
  return res.rows;
}

/** query แถวเดียว */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await getPool().query<T>(sql, params as any[]);
  return res.rows[0] ?? null;
}
