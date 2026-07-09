import { requestHasSession } from "./_session.js";
import { loadJsonBlob, PROGRESS_BLOB_PATH, readJsonBody, saveJsonBlob, sendJson } from "./_storage.js";
import { DATA_VERSION, mergeProgress, nowIso, progressFromState } from "./_workspace.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 保存进度。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const incoming = payload.progress || payload.userState || payload.state || payload;
    const current = await loadJsonBlob(PROGRESS_BLOB_PATH);
    const savedAt = nowIso();
    const merged = mergeProgress(current.exists ? current.data : {}, incoming);
    const nextProgress = {
      ...progressFromState(merged),
      version: DATA_VERSION,
      lastCloudSavedAt: savedAt,
    };
    const blob = await saveJsonBlob(PROGRESS_BLOB_PATH, nextProgress);
    sendJson(response, 200, {
      ok: true,
      savedAt,
      pathname: blob.pathname,
      url: blob.url,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "保存进度失败。",
    });
  }
}
