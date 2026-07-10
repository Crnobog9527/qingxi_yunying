import { getSessionContext } from "./_session.js";
import { isNeonConfigured, query } from "./_db.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, message: "只支持 GET。" });
  if (!getSessionContext(request)) return sendJson(response, 401, { ok: false, message: "请先登录。" });
  if (!isNeonConfigured()) return sendJson(response, 200, { ok: true, backend: "blob", database: "not-configured" });
  try {
    await query("SELECT 1");
    return sendJson(response, 200, { ok: true, backend: "neon", database: "healthy" });
  } catch {
    return sendJson(response, 503, { ok: false, backend: "neon", database: "unavailable", message: "数据库暂时不可用。" });
  }
}
