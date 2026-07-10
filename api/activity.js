import { requireRole } from "./_authz.js";
import { query, publicDatabaseError } from "./_db.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, message: "只支持 GET。" });
  if (!requireRole(request, response, ["owner", "editor", "viewer"])) return;
  try {
    const url = new URL(request.url, "http://localhost");
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const result = await query(`SELECT id, actor_id, action, entity_type, entity_id, changed_fields, created_at
      FROM activity_log WHERE workspace_id=$1 ORDER BY id DESC LIMIT $2`, [process.env.QINGXI_WORKSPACE_ID || "qingxi", limit]);
    sendJson(response, 200, { ok: true, activity: result.rows });
  } catch (error) {
    sendJson(response, 503, { ok: false, message: publicDatabaseError(error) });
  }
}
