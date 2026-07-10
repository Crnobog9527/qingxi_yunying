import { requireRole } from "../../../../_authz.js";
import { patchShot } from "../../../../_neon-repository.js";
import { publicDatabaseError } from "../../../../_db.js";
import { validateDay, validateIndex, validatePatch, HttpError } from "../../../../_validation.js";
import { readJsonBody, sendJson } from "../../../../_storage.js";

export default async function handler(request, response) {
  if (request.method !== "PATCH") return sendJson(response, 405, { ok: false, message: "只支持 PATCH。" });
  const context = requireRole(request, response, ["owner", "editor"]);
  if (!context) return;
  try {
    const parts = new URL(request.url, "http://localhost").pathname.split("/").filter(Boolean);
    const day = validateDay(parts.at(-3));
    const index = validateIndex(parts.at(-1));
    const { version, changes } = validatePatch(await readJsonBody(request));
    if (typeof changes.done !== "boolean") throw new HttpError(400, "done 必须是布尔值。");
    const result = await patchShot({ day, index, version, done: changes.done, actorId: context.actorId });
    if (result.missing) return sendJson(response, 404, { ok: false, message: "目标 Day 不存在。" });
    if (result.conflict) return sendJson(response, 409, { ok: false, message: "图片状态已被其他协作者修改。", current: result.conflict, client: changes });
    return sendJson(response, 200, { ok: true, day, index, shot: result.row });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}
