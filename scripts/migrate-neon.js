import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("请先设置 DATABASE_URL；本脚本不会从项目文件读取密钥。");

const version = "0001_collaboration";
const sql = await readFile(resolve("db/migrations/0001_collaboration.sql"), "utf8");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [version]);
  await client.query("COMMIT");
  console.log(`Neon migration applied: ${version}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
