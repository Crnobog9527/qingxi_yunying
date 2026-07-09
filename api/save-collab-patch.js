import { requestHasSession } from "./_session.js";
import { loadJsonBlob, PROGRESS_BLOB_PATH, readJsonBody, saveJsonBlob, sendJson } from "./_storage.js";

const DATA_VERSION = 5;

function toTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function normalizeShotRecord(value) {
  if (value && typeof value === "object") {
    return {
      done: Boolean(value.done),
      updatedAt: value.updatedAt || new Date(0).toISOString(),
    };
  }
  return {
    done: Boolean(value),
    updatedAt: new Date(0).toISOString(),
  };
}

function mergeShotChecks(current = {}, incoming = {}) {
  const merged = { ...(current || {}) };
  Object.entries(incoming || {}).forEach(([day, shots]) => {
    if (!shots || typeof shots !== "object") return;
    merged[day] = { ...(merged[day] || {}) };
    Object.entries(shots).forEach(([index, value]) => {
      const next = normalizeShotRecord(value);
      const prev = merged[day][index] ? normalizeShotRecord(merged[day][index]) : null;
      if (!prev || toTimestamp(next.updatedAt) >= toTimestamp(prev.updatedAt)) {
        merged[day][index] = next;
      }
    });
  });
  return merged;
}

function normalizeTodayShootPlan(value) {
  if (!value || typeof value !== "object") {
    return { date: "", selectedDays: [], updatedAt: new Date(0).toISOString() };
  }
  return {
    date: String(value.date || ""),
    selectedDays: Array.isArray(value.selectedDays)
      ? [...new Set(value.selectedDays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30))].sort((a, b) => a - b)
      : [],
    updatedAt: value.updatedAt || new Date(0).toISOString(),
  };
}

function mergeTodayShootPlan(current, incoming) {
  if (!incoming || typeof incoming !== "object") return current;
  const prev = normalizeTodayShootPlan(current);
  const next = normalizeTodayShootPlan(incoming);
  return toTimestamp(next.updatedAt) >= toTimestamp(prev.updatedAt) ? next : prev;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 保存协作更新。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }

  try {
    const patch = await readJsonBody(request);
    if (!patch || typeof patch !== "object") {
      sendJson(response, 400, { ok: false, message: "协作更新不是有效 JSON。" });
      return;
    }

    const currentBlob = await loadJsonBlob(PROGRESS_BLOB_PATH);
    const currentState = currentBlob.exists ? currentBlob.data : {};
    const nextState = {
      ...currentState,
      version: DATA_VERSION,
      shotChecks: mergeShotChecks(currentState.shotChecks || {}, patch.shotChecks || {}),
      todayShootPlan: mergeTodayShootPlan(currentState.todayShootPlan, patch.todayShootPlan),
    };
    const savedAt = new Date().toISOString();
    const blob = await saveJsonBlob(PROGRESS_BLOB_PATH, {
      ...nextState,
      lastCloudSavedAt: savedAt,
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
      message: error?.message || "保存协作更新失败。",
    });
  }
}
