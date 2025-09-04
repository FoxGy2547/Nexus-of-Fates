import mysql from "mysql2/promise";

let _pool: mysql.Pool | null = null;

/** คืน Pool แบบ lazy; ถ้า ENV ไม่ครบจะคืน null (เพื่อให้โหมด fallback ทำงานต่อได้) */
export function getPool(): mysql.Pool | null {
  if (_pool) return _pool;

  const { DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) return null;

  _pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    port: DB_PORT ? Number(DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4_general_ci",
  });
  return _pool;
}

/** เวอร์ชันที่ต้องการ DB แน่ ๆ (แต่ถ้าไม่มีจะ throw) */
export async function createPool(): Promise<mysql.Pool> {
  const p = getPool();
  if (!p) throw new Error("DB ENV not set");
  return p;
}
