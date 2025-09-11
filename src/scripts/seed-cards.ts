// scripts/seed-cards.ts
import fs from "fs";
import path from "path";
import { Pool } from "pg";

type CardJson = {
  characters: { char_id: number; code?: string; name?: string }[];
  supports:   { id: number; code: string; name?: string }[];
  events:     { id: number; code: string; name?: string }[];
};

const pool = new Pool({
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER!,
  password: process.env.DB_PASS!,
  database: process.env.DB_NAME!,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  const file = path.resolve(process.cwd(), "src/data/cards.json");
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw) as CardJson;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upsert = `
      INSERT INTO cards(code, name, kind)
      VALUES($1, $2, $3)
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            kind = EXCLUDED.kind
    `;

    for (const c of json.characters) {
      const code = c.code ?? `CHAR_${c.char_id}`;
      await client.query(upsert, [code, c.name ?? code, "character"]);
    }
    for (const s of json.supports) {
      await client.query(upsert, [s.code, s.name ?? s.code, "support"]);
    }
    for (const e of json.events) {
      await client.query(upsert, [e.code, e.name ?? e.code, "event"]);
    }

    await client.query("COMMIT");
    console.log("Seed cards: DONE");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
