import { getSessionContext } from "./_session.js";
import { listChanges } from "./_neon-repository.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { ok: false, message: "只支持 GET。" });
  if (!getSessionContext(request)) return sendJson(response, 401, { ok: false, message: "请先登录。" });
  const cursor = Math.max(0, Number(new URL(request.url, "http://localhost").searchParams.get("cursor") || 0));
  if (!Number.isInteger(cursor)) return sendJson(response, 400, { ok: false, message: "cursor 无效。" });
  try {
    const changes = await listChanges(cursor);
    return sendJson(response, 200, { ok: true, changes, cursor: changes.length ? Number(changes.at(-1).id) : cursor });
  } catch {
    return sendJson(response, 503, { ok: false, message: "读取变更失败。" });
  }
}
