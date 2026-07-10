import { Pool } from "@neondatabase/serverless";

let pool;

export function isNeonConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!isNeonConfigured()) throw new Error("Neon 未配置 DATABASE_URL。");
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export function query(text, values = []) {
  return getPool().query(text, values);
}

export async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function publicDatabaseError(error) {
  if (error?.code === "23505") return "数据已存在，请刷新后重试。";
  if (error?.code === "23503") return "关联数据不存在，请刷新后重试。";
  return "数据库操作失败，请稍后重试。";
}
