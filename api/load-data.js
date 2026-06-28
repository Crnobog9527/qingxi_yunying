import { loadWorkbenchBlob, sendJson, verifyAdminToken } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, message: "只支持 GET 读取。" });
    return;
  }

  const auth = verifyAdminToken(request);
  if (!auth.ok) {
    sendJson(response, auth.status, { ok: false, message: auth.message });
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
