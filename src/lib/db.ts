// src/lib/db.ts
import mysql from "mysql2/promise";

declare global {
  // ให้ pool อยู่ข้าม hot-reload / module reload ได้
  // eslint-disable-next-line no-var
  var __dbPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!global.__dbPool) {
    global.__dbPool = mysql.createPool({
      host: process.env.DB_HOST!,
      user: process.env.DB_USER!,
      password: process.env.DB_PASS!,
      database: process.env.DB_NAME!,
      waitForConnections: true,
      connectionLimit: 1,   // 1 ต่ออินสแตนซ์ กันชน max_user_connections
      maxIdle: 1,
      queueLimit: 0,
    });
  }
  return global.__dbPool;
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

/** query helper ที่พิมพ์ type ถูกต้อง ไม่ต้องใช้ any */
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
  params: unknown[] = []
): Promise<QResult<T>> {
  return conn.query<T>(sql, params as (string | number | null | undefined)[]);
}

/** รันโค้ดภายใต้ lock ต่อห้องด้วย MySQL GET_LOCK (serialize ต่อ room) */
export async function withRoomLock<T>(
  roomId: string,
  fn: (conn: mysql.PoolConnection) => Promise<T>,
  timeoutSec = 5
): Promise<T> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await q<mysql.RowDataPacket[]>(conn, "SELECT GET_LOCK(?, ?)", [
      `room:${roomId}`,
      timeoutSec,
    ]);
    const first = rows[0] as mysql.RowDataPacket;
    // GET_LOCK คืน 1 = ได้ล็อก, 0 = timeout, NULL = error
    const locked = (first[Object.keys(first)[0]] as number | null) === 1;
    if (!locked) throw new Error("LOCK_TIMEOUT");

    const res = await fn(conn);
    return res;
  } finally {
    try {
      await q(conn, "DO RELEASE_LOCK(?)", [`room:${roomId}`]);
    } catch {
      // noop
    }
    conn.release();
  }
}
