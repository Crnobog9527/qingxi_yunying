import { requestHasSession } from "./_session.js";
import { loadWorkbenchBlob, sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "只支持 GET 读取。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const result = await loadWorkbenchBlob();
    if (!result.exists) {
      sendJson(response, 200, { ok: true, exists: false, message: "线上还没有保存数据。" });
      return;
    }
    sendJson(response, 200, {
      ok: true,
      exists: true,
      data: result.data,
      pathname: result.pathname,
      etag: result.etag,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "读取线上数据失败。",
    });
  }
}
