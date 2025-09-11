// src/lib/db.ts
import { Pool, type PoolClient, type QueryResultRow } from "pg";

/** สร้าง connectionString จาก ENV ที่มี (รองรับทั้ง DATABASE_URL หรือ DB_*) */
function buildConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.DB_HOST!;
  const port = process.env.DB_PORT ?? "5432";
  const db   = process.env.DB_NAME ?? "postgres";
  const user = encodeURIComponent(process.env.DB_USER ?? "");
  const pass = encodeURIComponent(process.env.DB_PASS ?? "");
  // ใช้ sslmode=require ให้เข้ากับ Vercel/Supabase Pooler
  return `postgresql://${user}:${pass}@${host}:${port}/${db}?sslmode=require`;
}

/** กันสร้าง Pool ซ้ำ ๆ บน serverless */
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const pool: Pool =
  global.__pgPool ??
  new Pool({
    connectionString: buildConnectionString(),
    ssl: { rejectUnauthorized: false }, // กัน cert งอแงบนบางเครือข่าย
    max: 1, // ใช้คู่กับ pgbouncer=true/Pooler จะดีมาก
  });

if (!global.__pgPool) global.__pgPool = pool;

export { pool };

/** query หลายแถว (typed) */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(sql, params as any[]);
  return res.rows;
}

/** query แถวเดียว (typed) */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const res = await pool.query<T>(sql, params as any[]);
  return res.rows[0] ?? null;
}

/**
 * withRoomLock: ล็อกห้องแบบ serialize ด้วย advisory lock
 * ใช้ pg_try_advisory_lock(hashtext(roomId), 0) เพื่อไม่ block และมี timeout
 */
export async function withRoomLock<T>(
  roomId: string,
  fn: (client: PoolClient) => Promise<T>,
  timeoutMs = 5000,
  retryEveryMs = 100
): Promise<T> {
  const client = await pool.connect();
  const started = Date.now();

  try {
    // พยายามล็อกจนกว่าจะได้หรือครบ timeout
    while (true) {
      // ใช้ key แบบ (int,int) = (hashtext(roomId), 0)
      const r = await client.query<{ ok: boolean }>(
        "select pg_try_advisory_lock(hashtext($1), 0) as ok",
        [roomId]
      );
      if (r.rows[0]?.ok) break;

      if (Date.now() - started > timeoutMs) {
        throw new Error("LOCK_TIMEOUT");
      }
      await new Promise((res) => setTimeout(res, retryEveryMs));
    }

    // ทำงานภายใต้ล็อก
    return await fn(client);
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1), 0)", [roomId]);
    } catch {
      /* noop */
    }
    client.release();
  }
}
