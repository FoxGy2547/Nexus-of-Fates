import { createPool as mysqlCreatePool, Pool, PoolOptions } from "mysql2/promise";

/** กัน HMR/Hot-reload สร้าง pool ใหม่ */
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
    connectionLimit: 5,       // dev พอ 3–5 ก็พอ
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    multipleStatements: false,
  };

  const pool = mysqlCreatePool(opts);
  global.__MYSQL_POOL__ = pool;
  return pool;
}
