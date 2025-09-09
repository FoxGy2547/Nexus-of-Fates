// src/lib/db.ts
import mysql from "mysql2/promise";

/**
 * Augment globalThis ให้รู้จัก __dbPool โดยไม่ใช้ any
 * - ใช้ intersection type ตอนสร้างตัวแปร g
 * - ไม่ต้องใช้ // eslint-disable หรือ var พิเศษ
 */
type GlobalWithDb = typeof globalThis & { __dbPool?: mysql.Pool };
const g: GlobalWithDb = globalThis as GlobalWithDb;

export function getPool(): mysql.Pool {
  if (!g.__dbPool) {
    g.__dbPool = mysql.createPool({
      host: process.env.DB_HOST!,
      user: process.env.DB_USER!,
      password: process.env.DB_PASS!,
      database: process.env.DB_NAME!,
      waitForConnections: true,
      connectionLimit: 1, // 1 ต่ออินสแตนซ์ กันชน max_user_connections
      maxIdle: 1,
      queueLimit: 0,
    });
  }
  return g.__dbPool;
}

/** ชนิดผลลัพธ์ของ mysql2 แบบปรับแต่งได้ด้วย generic T */
export type QResult<
  T extends
    | mysql.RowDataPacket[]
    | mysql.RowDataPacket[][]
    | mysql.OkPacket
    | mysql.OkPacket[]
    | mysql.ResultSetHeader = mysql.RowDataPacket[]
> = [T, mysql.FieldPacket[]];

/** query helper ที่พิมพ์ type ถูกต้อง */
export async function q<
  T extends
    | mysql.RowDataPacket[]
    | mysql.RowDataPacket[][]
    | mysql.OkPacket
    | mysql.OkPacket[]
    | mysql.ResultSetHeader = mysql.RowDataPacket[]
>(
  conn: mysql.PoolConnection,
  sql: string,
  params: (string | number | null | undefined)[] = [],
): Promise<QResult<T>> {
  return conn.query<T>(sql, params);
}

/** รันโค้ดภายใต้ lock ต่อห้องด้วย MySQL GET_LOCK (serialize ต่อ room) */
export async function withRoomLock<T>(
  roomId: string,
  fn: (conn: mysql.PoolConnection) => Promise<T>,
  timeoutSec = 5,
): Promise<T> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await q<mysql.RowDataPacket[]>(
      conn,
      "SELECT GET_LOCK(?, ?)",
      [`room:${roomId}`, timeoutSec],
    );
    // GET_LOCK → 1 = locked, 0 = timeout, NULL = error
    const first = rows[0] as mysql.RowDataPacket;
    const locked = (first[Object.keys(first)[0]] as number | null) === 1;
    if (!locked) throw new Error("LOCK_TIMEOUT");

    return await fn(conn);
  } finally {
    try {
      await q(conn, "DO RELEASE_LOCK(?)", [`room:${roomId}`]);
    } catch {
      /* noop */
    }
    conn.release();
  }
}
