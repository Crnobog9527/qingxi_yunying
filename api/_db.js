import { Pool, neon } from "@neondatabase/serverless";

export function isNeonConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function createPool() {
  if (!isNeonConfigured()) throw new Error("Neon 未配置 DATABASE_URL。");
  // Neon 的 WebSocket 连接不能跨 Vercel Serverless 请求复用。
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
}

function createHttpQuery() {
  if (!isNeonConfigured()) throw new Error("Neon 未配置 DATABASE_URL。");
  // 单条查询使用 HTTPS，不建立跨请求的 WebSocket 连接。
  return neon(process.env.DATABASE_URL, { fullResults: true });
}

function safeErrorSummary(error) {
  const message = String(error?.message || "unknown database error")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]")
    .replace(/(password|token)=([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 500);
  return { name: error?.name || "Error", code: error?.code || "unknown", message };
}

function logDatabaseFailure(operation, error) {
  // 只记录已脱敏的诊断信息，绝不记录连接串或密钥。
  console.error("[qingxi-db] operation failed", { operation, ...safeErrorSummary(error) });
}

export async function query(text, values = []) {
  try {
    return await createHttpQuery().query(text, values);
  } catch (error) {
    logDatabaseFailure("query", error);
    throw error;
  }
}

export async function transaction(callback) {
  const pool = createPool();
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    logDatabaseFailure("transaction", error);
    throw error;
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

export function publicDatabaseError(error) {
  if (error?.code === "23505") return "数据已存在，请刷新后重试。";
  if (error?.code === "23503") return "关联数据不存在，请刷新后重试。";
  return "数据库操作失败，请稍后重试。";
}
