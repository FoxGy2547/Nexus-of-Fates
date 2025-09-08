import {
  createPool as mysqlCreatePool,
  type Pool,
  type PoolOptions,
  type RowDataPacket,
  type OkPacket,
  type ResultSetHeader,
} from "mysql2/promise";

/** กันสร้าง Pool ซ้ำตอน hot-reload */
declare global {
  // ให้ type ปลอดภัยขึ้น
  // eslint-disable-next-line no-var
  var __MYSQL_POOL__: Pool | undefined;
}

export function getPool(): Pool {
  if (global.__MYSQL_POOL__) return global.__MYSQL_POOL__;

  const opts: PoolOptions = {
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: process.env.DB_NAME!,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONN_LIMIT ?? 5),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    multipleStatements: false,
  };

  const pool = mysqlCreatePool(opts);
  global.__MYSQL_POOL__ = pool;
  return pool;
}

/** query ที่มี type ชัด */
export async function dbQuery<
  T extends RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[] | ResultSetHeader
>(sql: string, params: unknown[] = []): Promise<T> {
  const pool = getPool();
  const [rows] = await pool.query<T>(sql, params);
  return rows;
}
