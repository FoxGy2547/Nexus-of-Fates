import mysql, { Pool } from "mysql2/promise";

let _pool: Pool | null = null;

export async function createPool(): Promise<Pool> {
  if (_pool) return _pool;

  const {
    DB_HOST,
    DB_PORT,
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    DATABASE_URL,
  } = process.env;

  if (DATABASE_URL) {
    _pool = mysql.createPool(DATABASE_URL);
    return _pool;
  }

  if (!DB_HOST || !DB_USER || !DB_NAME) {
    throw new Error("Database config is missing (env)");
  }

  _pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT ? Number(DB_PORT) : 3306,
    user: DB_USER,
    password: DB_PASSWORD ?? "",
    database: DB_NAME,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
  });

  return _pool;
}

export async function getPool(): Promise<Pool> {
  return createPool();
}
