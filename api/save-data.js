import { requestHasSession } from "./_session.js";
import { loadWorkbenchBlob, readJsonBody, saveWorkbenchBlob, sendJson } from "./_storage.js";

function toTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function hasObjectEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
}

function hasSelectedShootDays(value) {
  return Array.isArray(value?.selectedDays) && value.selectedDays.length > 0;
}

function isDefaultStartDate(value) {
  return !value || String(value) === todayIso();
}

export function hasUserProgress(state = {}) {
  if (!state || typeof state !== "object") return false;
  if (["statuses", "checks", "reviews", "manualNotes", "shotChecks"].some((field) => hasObjectEntries(state[field]))) {
    return true;
  }
  if (hasSelectedShootDays(state.todayShootPlan)) return true;
  return Boolean(state.startDate && !isDefaultStartDate(state.startDate));
}

export function mergeObjectProgress(current = {}, incoming = {}) {
  if (hasObjectEntries(incoming)) return incoming;
  if (hasObjectEntries(current)) return current;
  return incoming || current || {};
}

export function mergeStartDate(current, incoming) {
  if (current && !isDefaultStartDate(current) && isDefaultStartDate(incoming)) return current;
  return incoming || current || todayIso();
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
  const prev = normalizeTodayShootPlan(current);
  const next = normalizeTodayShootPlan(incoming);
  return toTimestamp(next.updatedAt) >= toTimestamp(prev.updatedAt) ? next : prev;
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
    if (!payload || typeof payload !== "object") {
      sendJson(response, 400, { ok: false, message: "保存内容不是有效 JSON。" });
      return;
    }
    if (!payload.userState && !payload.state) {
      sendJson(response, 400, { ok: false, message: "保存内容缺少 userState/state。" });
      return;
    }

    const currentBlob = await loadWorkbenchBlob();
    const currentPayload = currentBlob.exists ? currentBlob.data : {};
    const currentState = currentPayload.userState || currentPayload.state || {};
    const incomingState = payload.userState || payload.state || {};

    if (hasUserProgress(currentState) && !hasUserProgress(incomingState)) {
      sendJson(response, 409, {
        ok: false,
        code: "EMPTY_PROGRESS_BLOCKED",
        message: "检测到空进度，已阻止覆盖线上数据。请先读取线上数据后再保存。",
      });
      return;
    }

    const mergedState = {
      ...incomingState,
      startDate: mergeStartDate(currentState.startDate, incomingState.startDate),
      statuses: mergeObjectProgress(currentState.statuses, incomingState.statuses),
      checks: mergeObjectProgress(currentState.checks, incomingState.checks),
      reviews: mergeObjectProgress(currentState.reviews, incomingState.reviews),
      manualNotes: mergeObjectProgress(currentState.manualNotes, incomingState.manualNotes),
      shotChecks: mergeShotChecks(currentState.shotChecks || {}, incomingState.shotChecks || {}),
      todayShootPlan: mergeTodayShootPlan(currentState.todayShootPlan, incomingState.todayShootPlan),
    };
    const savedAt = new Date().toISOString();
    const blob = await saveWorkbenchBlob({
      ...payload,
      userState: {
        ...mergedState,
        lastCloudSavedAt: savedAt,
      },
      state: {
        ...mergedState,
        lastCloudSavedAt: savedAt,
      },
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
