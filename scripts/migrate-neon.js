import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("请先设置 DATABASE_URL；本脚本不会从项目文件读取密钥。");

const migrationDirectory = resolve("db/migrations");
const migrations = (await readdir(migrationDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort()
  .map((file) => ({ version: file.replace(/\.sql$/, ""), file }));
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const migration of migrations) {
    const registry = await client.query("SELECT to_regclass('public.schema_migrations') AS name");
    const existing = registry.rows[0]?.name
      ? await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [migration.version])
      : { rowCount: 0 };
    if (existing.rowCount) continue;
    const sql = await readFile(resolve(migrationDirectory, migration.file), "utf8");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    console.log(`Neon migration applied: ${migration.version}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
