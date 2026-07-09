import { requestHasSession } from "./_session.js";
import { loadJsonBlob, PROGRESS_BLOB_PATH, readJsonBody, saveJsonBlob, sendJson } from "./_storage.js";
import { DATA_VERSION, mergeProgress, nowIso, progressFromState } from "./_workspace.js";

export function hasUserProgress(state = {}) {
  const progress = progressFromState(state);
  return Boolean(
    Object.keys(progress.statuses || {}).length
      || Object.keys(progress.checks || {}).length
      || Object.keys(progress.reviews || {}).length
      || Object.keys(progress.manualNotes || {}).length
      || Object.keys(progress.shotChecks || {}).length
      || progress.todayShootPlan?.selectedDays?.length
      || progress.startDate,
  );
}

export function mergeObjectProgress(current = {}, incoming = {}) {
  return incoming && typeof incoming === "object" && Object.keys(incoming).length ? incoming : current || {};
}

export function mergeStartDate(current, incoming) {
  return incoming || current || "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 保存。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const incoming = payload.progress || payload.userState || payload.state;
    if (!incoming || typeof incoming !== "object") {
      sendJson(response, 400, { ok: false, message: "保存内容缺少 progress/userState/state。" });
      return;
    }

    const current = await loadJsonBlob(PROGRESS_BLOB_PATH);
    const savedAt = nowIso();
    const nextProgress = {
      ...progressFromState(mergeProgress(current.exists ? current.data : {}, incoming)),
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
      message: error?.message || "保存线上进度失败。",
    });
  }
}
