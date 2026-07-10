import { requireRole } from "../../../_authz.js";
import { importContent } from "../../../_neon-repository.js";
import { publicDatabaseError } from "../../../_db.js";
import { HttpError, requireObject } from "../../../_validation.js";
import { readJsonBody, sendJson } from "../../../_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { ok: false, message: "只支持 POST。" });
  const context = requireRole(request, response, ["owner"]);
  if (!context) return;
  try {
    const body = requireObject(await readJsonBody(request));
    const content = requireObject(body.content, "content");
    const importId = typeof body.importId === "string" && body.importId.length <= 100 ? body.importId : `import-${Date.now()}`;
    const result = await importContent(content, context.actorId, importId);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { ok: false, message: error instanceof HttpError ? error.message : publicDatabaseError(error) });
  }
}
