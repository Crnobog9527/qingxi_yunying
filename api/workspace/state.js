import { requireRole } from "../../_authz.js";
import { query, transaction, publicDatabaseError } from "../../_db.js";
import { WORKSPACE_ID } from "../../_neon-repository.js";
import { validatePatch, HttpError } from "../../_validation.js";
import { readJsonBody, sendJson } from "../../_storage.js";

export default async function handler(request, response) {
  const context = requireRole(request, response, ["owner", "editor"]);
  if (!context) return;
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, message: "只支持 PATCH。" });
  try {
    const { version, changes } = validatePatch(await readJsonBody(request));
    if (!changes.todayShootPlan || typeof changes.todayShootPlan !== "object") throw new HttpError(400, "todayShootPlan 格式无效。");
    const result = await transaction(async (client) => {
      const updated = await client.query(`UPDATE workspace_state SET today_shoot_plan=$2::jsonb, version=version+1, updated_at=now(), updated_by=$3
        WHERE workspace_id=$1 AND version=$4 RETURNING today_shoot_plan, version`, [WORKSPACE_ID, JSON.stringify(changes.todayShootPlan), context.actorId, version]);
      if (!updated.rowCount) return { conflict: await client.query("SELECT today_shoot_plan, version FROM workspace_state WHERE workspace_id=$1", [WORKSPACE_ID]).then((r) => r.rows[0]) };
      await client.query("INSERT INTO activity_log (workspace_id,actor_id,action,entity_type,entity_id,changed_fields) VALUES ($1,$2,'update','workspace_state',$3,$4::jsonb)", [WORKSPACE_ID, context.actorId, WORKSPACE_ID, JSON.stringify(changes)]);
      return { row: updated.rows[0] };
    });
    if (result.conflict) return sendJson(response, 409, { ok: false, message: "拍摄计划已被修改。", current: result.conflict, client: changes });
    sendJson(response, 200, { ok: true, state: result.row });
  } catch (error) {
    sendJson(response, error instanceof HttpError ? error.status : 503, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}
