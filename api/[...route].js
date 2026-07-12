import { getSessionContext } from "./_session.js";
import { requireRole } from "./_authz.js";
import { bootstrapNeonSchema, isMissingWorkspaceSchema, isNeonConfigured, query, publicDatabaseError, transaction } from "./_db.js";
import { WORKSPACE_ID, listChanges, loadNeonWorkspace, patchReview, patchShot, patchTaskProgress, importContent } from "./_neon-repository.js";
import { HttpError, requireObject, validateDay, validateIndex, validatePatch } from "./_validation.js";
import { isBlobBackend, readJsonBody, sendJson } from "./_storage.js";

function routePath(request) {
  return new URL(request.url, "http://localhost").pathname.replace(/\/$/, "");
}

function inspectContent(content) {
  requireObject(content, "content");
  for (const key of ["contentPlan", "fullContent", "products", "library"]) {
    if (content[key] !== undefined && !Array.isArray(content[key])) throw new HttpError(400, `${key} 必须是数组。`);
  }
  const days = (content.contentPlan || []).map((item) => Number(item.day));
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 30)) throw new HttpError(400, "内容中的 day 必须在 1 到 30 之间。");
  return {
    contentPlan: content.contentPlan?.length || 0,
    fullContent: content.fullContent?.length || 0,
    products: content.products?.length || 0,
    library: content.library?.length || 0,
    duplicateDays: days.filter((day, index) => days.indexOf(day) !== index),
  };
}

async function handleHealth(request, response) {
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

async function handleChanges(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, message: "只支持 GET。" });
  if (!getSessionContext(request)) return sendJson(response, 401, { ok: false, message: "请先登录。" });
  const cursor = Math.max(0, Number(new URL(request.url, "http://localhost").searchParams.get("cursor") || 0));
  if (!Number.isInteger(cursor)) return sendJson(response, 400, { ok: false, message: "cursor 无效。" });
  try {
    let changes;
    try {
      changes = await listChanges(cursor);
    } catch (error) {
      if (!isMissingWorkspaceSchema(error)) throw error;
      await bootstrapNeonSchema();
      changes = await listChanges(cursor);
    }
    return sendJson(response, 200, { ok: true, changes, cursor: changes.length ? Number(changes.at(-1).id) : cursor });
  } catch {
    return sendJson(response, 503, { ok: false, message: "读取变更失败。" });
  }
}

async function handleActivity(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, message: "只支持 GET。" });
  if (!requireRole(request, response, ["owner", "editor", "viewer"])) return;
  try {
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url, "http://localhost").searchParams.get("limit") || 50)));
    const result = await query(`SELECT id, actor_id, action, entity_type, entity_id, changed_fields, created_at
      FROM activity_log WHERE workspace_id=$1 ORDER BY id DESC LIMIT $2`, [WORKSPACE_ID, limit]);
    sendJson(response, 200, { ok: true, activity: result.rows });
  } catch (error) {
    sendJson(response, 503, { ok: false, message: publicDatabaseError(error) });
  }
}

async function handleImport(request, response, mode) {
  if (request.method !== "POST") return sendJson(response, 405, { ok: false, message: "只支持 POST。" });
  if (!requireRole(request, response, ["owner"])) return;
  try {
    const body = await readJsonBody(request);
    const content = mode === "preview" ? (body.content || body) : requireObject(body.content, "content");
    if (mode === "preview") return sendJson(response, 200, { ok: true, preview: inspectContent(content) });
    const importId = typeof body.importId === "string" && body.importId.length <= 100 ? body.importId : `import-${Date.now()}`;
    const result = await importContent(content, (getSessionContext(request) || {}).actorId, importId);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}

async function handleTask(request, response, parts) {
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, message: "只支持 PATCH。" });
  const context = requireRole(request, response, ["owner", "editor"]);
  if (!context) return;
  try {
    const day = validateDay(parts[2]);
    const body = await readJsonBody(request);
    const { version, changes } = validatePatch(body);
    if (parts[3] === "progress") {
      const allowed = ["status", "checks", "manualNotes", "assignedTo"];
      if (Object.keys(changes).some((key) => !allowed.includes(key))) throw new HttpError(400, "存在不支持的字段。");
      const result = await patchTaskProgress({ day, version, changes, actorId: context.actorId });
      if (result.missing) return sendJson(response, 404, { ok: false, message: "目标 Day 不存在。" });
      if (result.conflict) return sendJson(response, 409, { ok: false, message: "数据已被其他协作者修改。", current: result.conflict, client: changes });
      return sendJson(response, 200, { ok: true, day, progress: result.row });
    }
    if (parts[3] === "shots") {
      const index = validateIndex(parts[4]);
      if (typeof changes.done !== "boolean") throw new HttpError(400, "done 必须是布尔值。");
      const result = await patchShot({ day, index, version, done: changes.done, actorId: context.actorId });
      if (result.missing) return sendJson(response, 404, { ok: false, message: "目标 Day 不存在。" });
      if (result.conflict) return sendJson(response, 409, { ok: false, message: "图片状态已被其他协作者修改。", current: result.conflict, client: changes });
      return sendJson(response, 200, { ok: true, day, index, shot: result.row });
    }
    if (parts[3] === "review") {
      const data = requireObject(changes.data, "data");
      const result = await patchReview({ day, version, data, actorId: context.actorId });
      if (result.missing) return sendJson(response, 404, { ok: false, message: "目标 Day 不存在。" });
      if (result.conflict) return sendJson(response, 409, { ok: false, message: "复盘数据已被其他协作者修改。", current: result.conflict, client: data });
      return sendJson(response, 200, { ok: true, day, review: result.row });
    }
    return sendJson(response, 404, { ok: false, message: "未知任务接口。" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}

async function handleWorkspaceState(request, response) {
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

export default async function handler(request, response) {
  const path = routePath(request);
  const parts = path.split("/").filter(Boolean);
  try {
    if (path === "/api/db-health") return handleHealth(request, response);
    if (path === "/api/changes") return handleChanges(request, response);
    if (path === "/api/activity") return handleActivity(request, response);
    if (path === "/api/content/import/preview") return handleImport(request, response, "preview");
    if (path === "/api/content/import/commit") return handleImport(request, response, "commit");
    if (path === "/api/workspace/state") return handleWorkspaceState(request, response);
    if (parts[1] === "tasks") return handleTask(request, response, parts);
    if (!isBlobBackend()) return sendJson(response, 404, { ok: false, message: "未知 Neon 接口。" });
    return sendJson(response, 404, { ok: false, message: "接口不存在。" });
  } catch (error) {
    sendJson(response, error instanceof HttpError ? error.status : 500, { ok: false, message: error instanceof HttpError ? error.message : "请求处理失败。" });
  }
}
