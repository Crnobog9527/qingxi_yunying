import { requireRole } from "../../../_authz.js";
import { patchTaskProgress } from "../../../_neon-repository.js";
import { publicDatabaseError } from "../../../_db.js";
import { validateDay, validatePatch, HttpError } from "../../../_validation.js";
import { readJsonBody, sendJson } from "../../../_storage.js";

export default async function handler(request, response) {
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, message: "只支持 PATCH。" });
  const context = requireRole(request, response, ["owner", "editor"]);
  if (!context) return;
  try {
    const url = new URL(request.url, "http://localhost");
    const day = validateDay(url.pathname.split("/").filter(Boolean).at(-2));
    const { version, changes } = validatePatch(await readJsonBody(request));
    const allowed = ["status", "checks", "manualNotes", "assignedTo"];
    if (Object.keys(changes).some((key) => !allowed.includes(key))) throw new HttpError(400, "存在不支持的字段。");
    const result = await patchTaskProgress({ day, version, changes, actorId: context.actorId });
    if (result.missing) return sendJson(response, 404, { ok: false, message: "目标 Day 不存在。" });
    if (result.conflict) return sendJson(response, 409, { ok: false, message: "数据已被其他协作者修改。", current: result.conflict, client: changes });
    return sendJson(response, 200, { ok: true, day, progress: result.row });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}
