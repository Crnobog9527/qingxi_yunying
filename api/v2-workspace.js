
import { requestHasSession } from "./_session.js";
import { readJsonBody, sendJson } from "./_http.js";
import { loadOrSeedV2, saveV2 } from "./_v2.js";
export default async function handler(request, response) {
  if (!requestHasSession(request)) { sendJson(response, 401, { ok: false, message: "请先输入访问密码。" }); return; }
  try {
    if (request.method === "GET") { sendJson(response, 200, { ok: true, ...(await loadOrSeedV2()) }); return; }
    if (request.method !== "POST") { sendJson(response, 405, { ok: false, message: "只支持 GET / POST。" }); return; }
    const payload = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...(await saveV2(payload.expectedRevision, payload.data)) });
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") { sendJson(response, 409, { ok: false, message: error.message, current: error.current }); return; }
    sendJson(response, /V2 数据结构/.test(String(error?.message || "")) ? 400 : 500, { ok: false, message: error?.message || "V2 工作台请求失败。" });
  }
}

