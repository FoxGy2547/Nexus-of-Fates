import { createPool as mysqlCreatePool, type Pool, type PoolOptions } from "mysql2/promise";

/** กันสร้าง Pool ซ้ำตอน hot-reload */
declare global {
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
