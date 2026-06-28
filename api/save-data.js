import { readJsonBody, saveWorkbenchBlob, sendJson, verifyAdminToken } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 保存。" });
    return;
  }

  const auth = verifyAdminToken(request);
  if (!auth.ok) {
    sendJson(response, auth.status, { ok: false, message: auth.message });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { ok: false, message: "保存内容不是有效 JSON。" });
      return;
    }
    if (!payload.userState && !payload.state) {
      sendJson(response, 400, { ok: false, message: "保存内容缺少 userState/state。" });
      return;
    }

    const savedAt = new Date().toISOString();
    const blob = await saveWorkbenchBlob({
      ...payload,
      cloudSavedAt: savedAt,
    });

    sendJson(response, 200, {
      ok: true,
      savedAt,
      pathname: blob.pathname,
      url: blob.url,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "保存线上数据失败。",
    });
  }
}
