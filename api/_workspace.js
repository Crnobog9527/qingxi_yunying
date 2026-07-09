import {
  backupBlobPath,
  CONTENT_BLOB_PATH,
  loadJsonBlob,
  loadWorkbenchBlob,
  PROGRESS_BLOB_PATH,
  saveJsonBlob,
} from "./_storage.js";

export const DATA_VERSION = 5;

export function nowIso() {
  return new Date().toISOString();
}

export function toTimestamp(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

export function emptyProgress() {
  return {
    version: DATA_VERSION,
    startDate: "",
    statuses: {},
    checks: {},
    shotChecks: {},
    todayShootPlan: { date: "", selectedDays: [], updatedAt: new Date(0).toISOString() },
    reviews: {},
    manualNotes: {},
    currentDay: 1,
    importedAt: "",
    lastSavedAt: "",
    lastBackupAt: "",
    lastCloudSavedAt: "",
    lastCloudLoadedAt: "",
  };
}

export function normalizeContentPayload(payload = {}) {
  const source = payload.content || payload.baseData || payload;
  return {
    contentPlan: Array.isArray(source.contentPlan) ? source.contentPlan : [],
    fullContent: Array.isArray(source.fullContent) ? source.fullContent : [],
    products: Array.isArray(source.products) ? source.products : [],
    library: Array.isArray(source.library) ? source.library : [],
  };
}

export function hasContent(payload = {}) {
  const content = normalizeContentPayload(payload);
  return Boolean(content.contentPlan.length || content.fullContent.length || content.products.length || content.library.length);
}

export function normalizeShotRecord(value) {
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

export function normalizeTodayShootPlan(value = {}) {
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

export function normalizeShotChecks(value = {}) {
  const normalized = {};
  Object.entries(value || {}).forEach(([day, shots]) => {
    if (!shots || typeof shots !== "object") return;
    normalized[day] = {};
    Object.entries(shots).forEach(([index, record]) => {
      normalized[day][index] = normalizeShotRecord(record);
    });
  });
  return normalized;
}

export function progressFromState(value = {}) {
  const source = value?.userState || value?.state || value || {};
  return {
    ...emptyProgress(),
    version: DATA_VERSION,
    startDate: source.startDate || "",
    statuses: source.statuses || {},
    checks: source.checks || {},
    shotChecks: normalizeShotChecks(source.shotChecks || {}),
    todayShootPlan: normalizeTodayShootPlan(source.todayShootPlan),
    reviews: source.reviews || {},
    manualNotes: source.manualNotes || {},
    currentDay: source.currentDay || 1,
    importedAt: source.importedAt || "",
    lastSavedAt: source.lastSavedAt || "",
    lastBackupAt: source.lastBackupAt || "",
    lastCloudSavedAt: source.lastCloudSavedAt || "",
    lastCloudLoadedAt: source.lastCloudLoadedAt || "",
  };
}

export function mergeShotChecks(current = {}, incoming = {}) {
  const merged = normalizeShotChecks(current);
  Object.entries(incoming || {}).forEach(([day, shots]) => {
    if (!shots || typeof shots !== "object") return;
    merged[day] = merged[day] || {};
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

export function mergeTodayShootPlan(current, incoming) {
  if (!incoming || typeof incoming !== "object") return normalizeTodayShootPlan(current);
  const prev = normalizeTodayShootPlan(current);
  const next = normalizeTodayShootPlan(incoming);
  return toTimestamp(next.updatedAt) >= toTimestamp(prev.updatedAt) ? next : prev;
}

function preferIncomingObject(current, incoming) {
  return incoming && typeof incoming === "object" && Object.keys(incoming).length ? incoming : current || {};
}

export function mergeProgress(current = {}, incoming = {}) {
  const currentProgress = progressFromState(current);
  const incomingProgress = progressFromState(incoming);
  return {
    ...currentProgress,
    ...incomingProgress,
    startDate: incomingProgress.startDate || currentProgress.startDate,
    currentDay: incomingProgress.currentDay || currentProgress.currentDay,
    importedAt: incomingProgress.importedAt || currentProgress.importedAt,
    lastSavedAt: incomingProgress.lastSavedAt || currentProgress.lastSavedAt,
    lastBackupAt: incomingProgress.lastBackupAt || currentProgress.lastBackupAt,
    lastCloudLoadedAt: incomingProgress.lastCloudLoadedAt || currentProgress.lastCloudLoadedAt,
    lastCloudSavedAt: incomingProgress.lastCloudSavedAt || currentProgress.lastCloudSavedAt,
    statuses: preferIncomingObject(currentProgress.statuses, incomingProgress.statuses),
    checks: preferIncomingObject(currentProgress.checks, incomingProgress.checks),
    reviews: preferIncomingObject(currentProgress.reviews, incomingProgress.reviews),
    manualNotes: preferIncomingObject(currentProgress.manualNotes, incomingProgress.manualNotes),
    shotChecks: mergeShotChecks(currentProgress.shotChecks, incomingProgress.shotChecks),
    todayShootPlan: mergeTodayShootPlan(currentProgress.todayShootPlan, incomingProgress.todayShootPlan),
  };
}

export async function backupIfExists(kind, path, when = new Date()) {
  const current = await loadJsonBlob(path);
  if (!current.exists) return null;
  const backupPath = backupBlobPath(kind, when);
  const blob = await saveJsonBlob(backupPath, {
    backedUpAt: when.toISOString(),
    sourcePath: path,
    data: current.data,
  });
  return { path: backupPath, url: blob.url };
}

export async function loadWorkspaceData({ migrate = true } = {}) {
  const [contentResult, progressResult, legacyResult] = await Promise.all([
    loadJsonBlob(CONTENT_BLOB_PATH),
    loadJsonBlob(PROGRESS_BLOB_PATH),
    loadWorkbenchBlob(),
  ]);
  const migrated = [];
  let content = contentResult.exists ? contentResult.data : null;
  let progress = progressResult.exists ? progressResult.data : null;

  if (migrate && legacyResult.exists) {
    const when = new Date();
    if (!content && hasContent(legacyResult.data?.baseData || legacyResult.data)) {
      content = normalizeContentPayload(legacyResult.data);
      await saveJsonBlob(CONTENT_BLOB_PATH, {
        version: DATA_VERSION,
        migratedAt: when.toISOString(),
        source: "legacy-workbench",
        ...content,
      });
      await saveJsonBlob(backupBlobPath("content", when), { backedUpAt: when.toISOString(), sourcePath: CONTENT_BLOB_PATH, data: content });
      migrated.push("content");
    }
    if (!progress) {
      progress = progressFromState(legacyResult.data);
      await saveJsonBlob(PROGRESS_BLOB_PATH, {
        ...progress,
        migratedAt: when.toISOString(),
        lastCloudSavedAt: when.toISOString(),
      });
      await saveJsonBlob(backupBlobPath("progress", when), { backedUpAt: when.toISOString(), sourcePath: PROGRESS_BLOB_PATH, data: progress });
      migrated.push("progress");
    }
  }

  return {
    content: content ? normalizeContentPayload(content) : null,
    progress: progress ? progressFromState(progress) : null,
    contentExists: Boolean(contentResult.exists || content),
    progressExists: Boolean(progressResult.exists || progress),
    legacyExists: legacyResult.exists,
    migrated,
    contentEtag: contentResult.etag || "",
    progressEtag: progressResult.etag || "",
  };
}
