import { Pool, neon } from "@neondatabase/serverless";
import { COLLABORATION_SCHEMA_SQL, COLLABORATION_SCHEMA_VERSIONS } from "./_preview-schema.js";

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

export function canBootstrapNeonSchema() {
  return ["preview", "production"].includes(process.env.VERCEL_ENV)
    && process.env.QINGXI_STORAGE_BACKEND === "neon";
}

export function isMissingCollaborationSchema(error) {
  if (error?.code !== "42P01") return false;
  return /\b(workspaces|content_versions|tasks|task_progress|shot_progress|reviews|workspace_state|activity_log|import_runs|members|schema_migrations)\b/i
    .test(String(error?.message || ""));
}

export async function bootstrapNeonSchema() {
  if (!canBootstrapNeonSchema()) throw new Error("仅允许在已启用 Neon 的 Vercel 环境初始化数据库结构。");
  return transaction(async (client) => {
    // 多个页面同时首次打开时，确保只有一个请求执行迁移。
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026071201]);
    await client.query(COLLABORATION_SCHEMA_SQL);
    for (const version of COLLABORATION_SCHEMA_VERSIONS) {
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [version]);
    }
  });
}

export function publicDatabaseError(error) {
  if (error?.code === "23505") return "数据已存在，请刷新后重试。";
  if (error?.code === "23503") return "关联数据不存在，请刷新后重试。";
  return "数据库操作失败，请稍后重试。";
}
