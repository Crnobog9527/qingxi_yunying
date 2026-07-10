(() => {
  const DATA = window.QINGXI_DATA;
  const FULL_CONTENT = window.QINGXI_FULL_CONTENT || [];
  const DEFAULT_CONTENT = {
    contentPlan: DATA.contentPlan || [],
    fullContent: FULL_CONTENT,
    products: DATA.products || [],
    library: DATA.library || [],
  };
  const STORE_KEY = "qingxi_xhs_workbench_v1";
  const LEGACY_STORE_KEY = "qingxi-xhs-workbench-v1";
  const DATA_VERSION = 5;
  const COLLAB_POLL_MS = 5000;
  const TODAY = new Date();
  const NAV = [
    ["dashboard", "首页 Dashboard"],
    ["shoot", "今日拍摄计划"],
    ["calendar", "30 天日历"],
    ["kanban", "任务看板"],
    ["products", "产品库"],
    ["analytics", "复盘分析"],
    ["weekly", "本周复盘"],
    ["library", "资料库"],
  ];

  const REVIEW_FIELDS = [
    ["publishTime", "发布时间", "datetime-local"],
    ["impressions", "曝光", "number"],
    ["reads", "阅读", "number"],
    ["likes", "点赞", "number"],
    ["saves", "收藏", "number"],
    ["comments", "评论", "number"],
    ["shares", "分享", "number"],
    ["profileViews", "主页访问", "number"],
    ["messages", "私信数", "number"],
    ["bookings", "预约数", "number"],
    ["visits", "实际到店桌数", "number"],
  ];

  const app = document.getElementById("app");
  let activeView = "dashboard";
  let shootStep = "select";
  let filters = {
    week: "全部周",
    category: "全部内容",
    status: "全部状态",
    product: "全部茶饮",
  };
  let storageLoadError = null;
  let cloudSaveTimer = null;
  let cloudStatus = {
    mode: "idle",
    message: "",
  };
  let collabPollTimer = null;
  let lastRemoteRevision = "";
  let backendMode = "blob";
  let changeCursor = 0;
  const neonVersions = { progress: {}, shots: {}, reviews: {}, workspace: 0 };
  let isPollingCollab = false;
  let contentStore = loadLocalContent();
  let state = loadState();

  function todayIso() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function zeroIso() {
    return new Date(0).toISOString();
  }

  function toTimestamp(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function normalizeShotRecord(value) {
    if (value && typeof value === "object") {
      return {
        done: Boolean(value.done),
        updatedAt: value.updatedAt || zeroIso(),
      };
    }
    return {
      done: Boolean(value),
      updatedAt: zeroIso(),
    };
  }

  function normalizeShotChecks(value = {}) {
    const normalized = {};
    Object.entries(value || {}).forEach(([day, shots]) => {
      if (!shots || typeof shots !== "object") return;
      Object.entries(shots).forEach(([index, record]) => {
        normalized[day] = normalized[day] || {};
        normalized[day][index] = normalizeShotRecord(record);
      });
    });
    return normalized;
  }

  function normalizeTodayShootPlan(value = {}) {
    const planDate = value?.date === todayIso() ? value.date : todayIso();
    const selectedDays = value?.date === todayIso() && Array.isArray(value.selectedDays)
      ? [...new Set(value.selectedDays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30))].sort((a, b) => a - b)
      : [];
    return {
      date: planDate,
      selectedDays,
      updatedAt: value?.updatedAt || zeroIso(),
    };
  }

  function createDefaultState() {
    return {
      version: DATA_VERSION,
      startDate: todayIso(),
      statuses: {},
      checks: {},
      shotChecks: {},
      todayShootPlan: normalizeTodayShootPlan(),
      reviews: {},
      manualNotes: {},
      currentDay: currentDayFromDate(todayIso()),
      importedAt: "",
      lastSavedAt: "",
      lastBackupAt: "",
      lastCloudSavedAt: "",
      lastCloudLoadedAt: "",
      edits: {
        tasks: {},
        products: {},
        library: {},
      },
    };
  }

  function normalizeContent(value = {}) {
    return {
      contentPlan: Array.isArray(value.contentPlan) && value.contentPlan.length ? value.contentPlan : DEFAULT_CONTENT.contentPlan,
      fullContent: Array.isArray(value.fullContent) && value.fullContent.length ? value.fullContent : DEFAULT_CONTENT.fullContent,
      products: Array.isArray(value.products) && value.products.length ? value.products : DEFAULT_CONTENT.products,
      library: Array.isArray(value.library) && value.library.length ? value.library : DEFAULT_CONTENT.library,
    };
  }

  function loadLocalContent() {
    try {
      const raw = localStorage.getItem(`${STORE_KEY}_content`);
      if (!raw) return normalizeContent(DEFAULT_CONTENT);
      return normalizeContent(JSON.parse(raw));
    } catch {
      return normalizeContent(DEFAULT_CONTENT);
    }
  }

  function persistContentLocalOnly() {
    localStorage.setItem(`${STORE_KEY}_content`, JSON.stringify(contentStore));
  }

  function applyContentPayload(content) {
    contentStore = normalizeContent(content || DEFAULT_CONTENT);
    persistContentLocalOnly();
  }

  function loadState() {
    const fallback = createDefaultState();
    try {
      let raw = localStorage.getItem(STORE_KEY);
      let sourceKey = STORE_KEY;
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORE_KEY);
        sourceKey = LEGACY_STORE_KEY;
      }
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return normalizeState(parsed.state || parsed, sourceKey);
    } catch (error) {
      storageLoadError = {
        message: error?.message || "无法读取本地数据",
        raw: localStorage.getItem(STORE_KEY),
      };
      return fallback;
    }
  }

  function normalizeState(parsed, sourceKey = STORE_KEY) {
    const fallback = createDefaultState();
    return {
      ...fallback,
      ...parsed,
      version: parsed.version || 1,
      sourceKey,
      statuses: parsed.statuses || {},
      checks: parsed.checks || {},
      shotChecks: normalizeShotChecks(parsed.shotChecks || {}),
      todayShootPlan: normalizeTodayShootPlan(parsed.todayShootPlan || {}),
      reviews: parsed.reviews || {},
      manualNotes: parsed.manualNotes || {},
      currentDay: parsed.currentDay || fallback.currentDay,
      importedAt: parsed.importedAt || "",
      lastSavedAt: parsed.lastSavedAt || "",
      lastBackupAt: parsed.lastBackupAt || "",
      lastCloudSavedAt: parsed.lastCloudSavedAt || "",
      lastCloudLoadedAt: parsed.lastCloudLoadedAt || "",
      edits: {
        tasks: parsed.edits?.tasks || {},
        products: parsed.edits?.products || {},
        library: parsed.edits?.library || {},
      },
    };
  }

  function editableTaskFromBaseData(task = {}, full = {}) {
    return {
      ...task,
      contentType: full.category || task.contentType || task.rawType,
      topic: full.topic || task.topic || task.theme,
      mainProduct: full.mainProduct || task.mainProduct || task.product,
      highClickTitle: full.highClickTitle || task.highClickTitle || task.title,
      titleDirection: full.titleDirection || task.titleDirection || task.copyFocus,
      titleReason: full.titleReason || task.titleReason || "",
      coverText: full.coverText || task.coverText || "",
      altTitles: Array.isArray(full.altTitles) ? full.altTitles : arrayField(task.altTitles, []),
      bodyCopy: full.bodyCopy || task.bodyCopy || "",
      imagePlan: Array.isArray(full.imagePlan) ? full.imagePlan : arrayField(task.imagePlan, []),
      tags: Array.isArray(full.tags) ? full.tags : arrayField(task.tags, []),
      seoReason: full.seoReason || task.seoReason || "",
      copyReason: full.copyReason || task.copyReason || "",
      operationJudge: full.operationJudge || task.operationJudge || task.conversion,
      rawType: full.category || task.rawType || task.contentType,
      theme: full.topic || task.theme || task.topic,
      title: full.highClickTitle || task.title || task.highClickTitle,
      product: full.mainProduct || task.product || task.mainProduct,
      shootingTask: Array.isArray(full.imagePlan) && full.imagePlan.length
        ? full.imagePlan.join("；")
        : task.shootingTask,
      copyFocus: full.titleDirection || task.copyFocus || task.titleDirection,
      conversion: full.operationJudge || task.conversion || task.operationJudge,
    };
  }

  function editsFromBaseData(baseData = {}) {
    const edits = {
      tasks: {},
      products: {},
      library: {},
    };
    const contentPlan = Array.isArray(baseData.contentPlan) ? baseData.contentPlan : [];
    const fullContent = Array.isArray(baseData.fullContent) ? baseData.fullContent : [];
    contentPlan.forEach((task) => {
      if (!task || task.day === undefined) return;
      const full = fullContent.find((item) => Number(item?.day) === Number(task.day)) || {};
      edits.tasks[task.day] = editableTaskFromBaseData(task, full);
    });
    fullContent.forEach((full) => {
      if (!full || full.day === undefined || edits.tasks[full.day]) return;
      edits.tasks[full.day] = editableTaskFromBaseData({ day: full.day }, full);
    });
    if (Array.isArray(baseData.products)) {
      baseData.products.forEach((product, index) => {
        if (product && typeof product === "object") edits.products[index] = product;
      });
    }
    if (Array.isArray(baseData.library)) {
      baseData.library.forEach((item, index) => {
        if (item && typeof item === "object") edits.library[index] = item;
      });
    }
    return edits;
  }

  function hasBaseDataOverrides(baseData = {}) {
    if (!baseData || typeof baseData !== "object") return false;
    const pairs = [
      [baseData.contentPlan, contentStore.contentPlan],
      [baseData.fullContent, contentStore.fullContent],
      [baseData.products, contentStore.products],
      [baseData.library, contentStore.library],
    ];
    return pairs.some(([incoming, current]) => Array.isArray(incoming)
      && JSON.stringify(incoming) !== JSON.stringify(current));
  }

  function stateFromDataPayload(payload, metadata = {}, options = {}) {
    const { applyBaseData = true } = options;
    const next = payload?.userState || payload?.state || payload;
    if (!next || typeof next !== "object") throw new Error("备份文件缺少用户进度数据。");
    const normalized = normalizeState({
      ...next,
      ...metadata,
      version: DATA_VERSION,
    });
    const baseEdits = applyBaseData ? editsFromBaseData(payload?.baseData) : { tasks: {}, products: {}, library: {} };
    const preferBaseData = applyBaseData && hasBaseDataOverrides(payload?.baseData);
    return normalizeState({
      ...normalized,
      edits: {
        tasks: preferBaseData
          ? { ...(normalized.edits?.tasks || {}), ...baseEdits.tasks }
          : { ...baseEdits.tasks, ...(normalized.edits?.tasks || {}) },
        products: preferBaseData
          ? { ...(normalized.edits?.products || {}), ...baseEdits.products }
          : { ...baseEdits.products, ...(normalized.edits?.products || {}) },
        library: preferBaseData
          ? { ...(normalized.edits?.library || {}), ...baseEdits.library }
          : { ...baseEdits.library, ...(normalized.edits?.library || {}) },
      },
    });
  }

  function serializableState(extra = {}) {
    const {
      sourceKey,
      ...cleanState
    } = state;
    return {
      ...cleanState,
      version: DATA_VERSION,
      ...extra,
    };
  }

  function saveState(extra = {}) {
    const { allowOverwriteAfterError = false, skipCloudSave = false, ...metadata } = extra;
    if (storageLoadError && !allowOverwriteAfterError) {
      alert("本地数据读取失败。为避免覆盖原始数据，请先在“本地说明”里导出原始数据或重置损坏数据。");
      return false;
    }
    state = {
      ...serializableState(metadata),
      lastSavedAt: nowIso(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (!skipCloudSave) scheduleCloudSave();
    return true;
  }

  function persistStateLocalOnly() {
    localStorage.setItem(STORE_KEY, JSON.stringify(serializableState()));
  }

  function canUseCloudApi() {
    return window.location.protocol !== "file:";
  }

  function isCloudReady() {
    return canUseCloudApi();
  }

  function setCloudStatus(mode, message) {
    cloudStatus = { mode, message };
    renderCloudStatusOnly();
  }

  function renderCloudStatusOnly() {
    const nodes = document.querySelectorAll("[data-cloud-status]");
    nodes.forEach((node) => {
      node.innerHTML = cloudStatusMarkup();
    });
  }

  function scheduleCloudSave() {
    if (!isCloudReady()) return;
    if (backendMode === "neon") return;
    setCloudStatus("saving", "已记录更改，正在自动保存到线上...");
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = window.setTimeout(() => {
      saveCloudNow({ silent: true });
    }, 500);
  }

  async function cloudRequest(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.message || `请求失败：${response.status}`);
      error.status = response.status;
      error.code = payload.code || "";
      throw error;
    }
    return payload;
  }

  function remoteRevision(result) {
    return result?.etag || result?.progressEtag || result?.data?.cloudSavedAt || result?.data?.userState?.lastCloudSavedAt || result?.data?.state?.lastCloudSavedAt || "";
  }

  function mergeShotChecks(current = {}, incoming = {}) {
    let changed = false;
    const merged = normalizeShotChecks(current);
    Object.entries(incoming || {}).forEach(([day, shots]) => {
      if (!shots || typeof shots !== "object") return;
      merged[day] = merged[day] || {};
      Object.entries(shots).forEach(([index, value]) => {
        const next = normalizeShotRecord(value);
        const prev = merged[day][index] ? normalizeShotRecord(merged[day][index]) : null;
        if (!prev || toTimestamp(next.updatedAt) > toTimestamp(prev.updatedAt)) {
          merged[day][index] = next;
          changed = true;
        }
      });
    });
    return { value: merged, changed };
  }

  function mergeTodayShootPlan(current, incoming) {
    const prev = normalizeTodayShootPlan(current);
    const next = normalizeTodayShootPlan(incoming);
    if (toTimestamp(next.updatedAt) > toTimestamp(prev.updatedAt)) {
      return { value: next, changed: true };
    }
    return { value: prev, changed: false };
  }

  function mergeRemoteCollab(remoteState = {}) {
    const shots = mergeShotChecks(state.shotChecks || {}, remoteState.shotChecks || {});
    const plan = mergeTodayShootPlan(state.todayShootPlan, remoteState.todayShootPlan);
    const changed = shots.changed || plan.changed;
    if (changed) {
      state = {
        ...state,
        shotChecks: shots.value,
        todayShootPlan: plan.value,
      };
      if (!plan.value.selectedDays.length) shootStep = "select";
      persistStateLocalOnly();
    }
    return changed;
  }

  async function pollCollabUpdates({ silent = true, rerender = true } = {}) {
    if (!isCloudReady() || isPollingCollab || document.visibilityState === "hidden") return false;
    isPollingCollab = true;
    try {
      if (backendMode === "neon") {
        const result = await cloudRequest(`/api/changes?cursor=${encodeURIComponent(changeCursor)}`);
        let changed = false;
        (result.changes || []).forEach((event) => {
          const fields = event.changed_fields || {};
          if (event.entity_type === "task_progress") {
            const day = Number(event.entity_id);
            if (fields.status !== undefined) state.statuses[day] = fields.status;
            if (fields.checks !== undefined) state.checks[day] = fields.checks;
            if (fields.manualNotes !== undefined) state.manualNotes[day] = fields.manualNotes;
            changed = true;
          } else if (event.entity_type === "shot_progress") {
            const [day, index] = String(event.entity_id).split(":").map(Number);
            state.shotChecks[day] = state.shotChecks[day] || {};
            state.shotChecks[day][index] = { done: Boolean(fields.done), updatedAt: event.created_at };
            changed = true;
          } else if (event.entity_type === "review") {
            state.reviews[Number(event.entity_id)] = fields.data || fields;
            changed = true;
          }
          changeCursor = Math.max(changeCursor, Number(event.id) || changeCursor);
        });
        if (changed) {
          persistStateLocalOnly();
          if (rerender) render();
          setCloudStatus("ok", "已同步同事的最新修改");
        }
        return changed;
      }
      const result = await cloudRequest("/api/load-workspace");
      if (!result.exists) return false;
      const revision = remoteRevision(result);
      if (revision && revision === lastRemoteRevision) return false;
      const remoteState = stateFromDataPayload(result.progress || result.data?.userState || result.data?.state || {});
      const changed = mergeRemoteCollab(remoteState);
      lastRemoteRevision = revision || lastRemoteRevision;
      if (changed) {
        setCloudStatus("ok", "已同步同事的拍摄进度");
        if (rerender) render();
      }
      return changed;
    } catch (error) {
      if (!silent) setCloudStatus("error", error?.message || "同步协作进度失败。");
      return false;
    } finally {
      isPollingCollab = false;
    }
  }

  async function saveCollabPatch(patch) {
    if (!isCloudReady()) return false;
    try {
      if (backendMode === "neon") {
        for (const [day, shots] of Object.entries(patch.shotChecks || {})) {
          for (const [index, record] of Object.entries(shots || {})) {
            const key = `${day}:${index}`;
            const result = await cloudRequest(`/api/tasks/${day}/shots/${index}`, {
              method: "PATCH",
              body: JSON.stringify({ version: neonVersions.shots[key] || 1, changes: { done: Boolean(record.done) } }),
            });
            neonVersions.shots[key] = result.shot.version;
          }
        }
        if (patch.todayShootPlan) {
          const result = await cloudRequest("/api/workspace/state", {
            method: "PATCH",
            body: JSON.stringify({ version: neonVersions.workspace || 1, changes: { todayShootPlan: patch.todayShootPlan } }),
          });
          neonVersions.workspace = result.state.version;
        }
        return true;
      }
      setCloudStatus("saving", "正在同步拍摄进度...");
      const result = await cloudRequest("/api/save-collab-patch", {
        method: "POST",
        body: JSON.stringify({
          dataVersion: DATA_VERSION,
          storageKey: STORE_KEY,
          ...patch,
        }),
      });
      state.lastCloudSavedAt = result.savedAt || nowIso();
      persistStateLocalOnly();
      setCloudStatus("ok", `拍摄进度已同步：${formatDateTime(state.lastCloudSavedAt)}`);
      return true;
    } catch (error) {
      setCloudStatus("error", error?.message || "拍摄进度同步失败。");
      return false;
    }
  }

  async function saveNeonTaskProgress(day, changes) {
    if (backendMode !== "neon" || !isCloudReady()) return false;
    try {
      const result = await cloudRequest(`/api/tasks/${day}/progress`, {
        method: "PATCH",
        body: JSON.stringify({ version: neonVersions.progress[day] || 1, changes }),
      });
      neonVersions.progress[day] = result.progress.version;
      setCloudStatus("ok", `Day ${day} 已同步`);
      return true;
    } catch (error) {
      const message = error.status === 409 ? `Day ${day} 发生冲突：请先读取同事的最新修改。` : (error.message || "协作保存失败。");
      setCloudStatus("error", message);
      alert(message);
      return false;
    }
  }

  async function saveNeonReview(day, data) {
    if (backendMode !== "neon" || !isCloudReady()) return false;
    try {
      const result = await cloudRequest(`/api/tasks/${day}/review`, {
        method: "PATCH",
        body: JSON.stringify({ version: neonVersions.reviews[day] || 1, changes: { data } }),
      });
      neonVersions.reviews[day] = result.review.version;
      setCloudStatus("ok", `Day ${day} 复盘已同步`);
      return true;
    } catch (error) {
      const message = error.status === 409 ? `Day ${day} 复盘发生冲突，请先读取最新数据。` : (error.message || "复盘保存失败。");
      setCloudStatus("error", message);
      alert(message);
      return false;
    }
  }

  function progressPayload(metadata = {}) {
    const { edits, ...progress } = serializableState(metadata);
    return progress;
  }

  async function saveCloudNow({ silent = false } = {}) {
    if (!isCloudReady()) {
      if (!silent) alert("当前环境不能调用线上 API。");
      return false;
    }
    try {
      if (backendMode === "neon") {
        setCloudStatus("ok", "Neon 已启用字段级保存，无需整份覆盖。");
        return true;
      }
      setCloudStatus("saving", "正在保存到线上...");
      await pollCollabUpdates({ silent: true, rerender: false });
      const savedAt = nowIso();
      const result = await cloudRequest("/api/save-progress", {
        method: "POST",
        body: JSON.stringify({ progress: progressPayload({ lastCloudSavedAt: savedAt }) }),
      });
      state.lastCloudSavedAt = result.savedAt || savedAt;
      persistStateLocalOnly();
      setCloudStatus("ok", `线上已保存：${formatDateTime(state.lastCloudSavedAt)}`);
      if (!silent) alert(`线上保存成功：${formatDateTime(state.lastCloudSavedAt)}`);
      return true;
    } catch (error) {
      const message = error?.status === 409
        ? "线上已有进度，当前页面还没读取成功，已阻止覆盖。请刷新或点击读取线上数据。"
        : error?.message || "线上保存失败。";
      setCloudStatus("error", message);
      if (!silent) alert(`线上保存失败：${message}`);
      return false;
    }
  }

  async function saveContentNow({ silent = true } = {}) {
    persistContentLocalOnly();
    if (!isCloudReady()) return false;
    try {
      setCloudStatus("saving", "正在保存内容到线上...");
      const result = await cloudRequest(backendMode === "neon" ? "/api/content/import/commit" : "/api/import-content", {
        method: "POST",
        body: JSON.stringify({ content: contentStore, importId: `ui-${Date.now()}` }),
      });
      setCloudStatus("ok", `内容已保存：${formatDateTime(result.importedAt || nowIso())}`);
      if (!silent) alert("内容保存成功。");
      return true;
    } catch (error) {
      setCloudStatus("error", error?.message || "内容保存失败。");
      if (!silent) alert(`内容保存失败：${error?.message || "请稍后重试。"}`);
      return false;
    }
  }

  async function backupCloudNow() {
    if (!isCloudReady()) {
      alert("当前环境不能调用线上 API。");
      return false;
    }
    try {
      setCloudStatus("saving", "正在生成线上备份...");
      const result = await cloudRequest("/api/backup-now", { method: "POST", body: JSON.stringify({}) });
      state.lastBackupAt = result.backedUpAt || nowIso();
      saveState({ lastBackupAt: state.lastBackupAt, skipCloudSave: true });
      setCloudStatus("ok", `线上备份完成：${formatDateTime(state.lastBackupAt)}`);
      alert(`线上备份完成：${formatDateTime(state.lastBackupAt)}`);
      return true;
    } catch (error) {
      setCloudStatus("error", error?.message || "线上备份失败。");
      alert(`线上备份失败：${error?.message || "请稍后重试。"}`);
      return false;
    }
  }

  async function loadCloudNow({ silent = false, auto = false } = {}) {
    if (!isCloudReady()) {
      if (!silent) alert("当前环境不能调用线上 API。");
      return false;
    }
    if (!auto && !confirm("这会用线上数据覆盖当前浏览器缓存。建议先导出当前 JSON 备份。是否继续？")) {
      return false;
    }
    try {
      setCloudStatus("loading", "正在读取线上数据...");
      const result = await cloudRequest("/api/load-workspace");
      backendMode = result.backend || "blob";
      if (backendMode === "neon") {
        if (!result.exists) {
          setCloudStatus("error", "Neon 尚未完成数据库迁移。");
          return false;
        }
        if (!result.content) {
          if (!auto) {
            setCloudStatus("error", "Neon 内容库尚未初始化，请先使用自动初始化或导入内容。");
            return false;
          }
          await cloudRequest("/api/content/import/commit", {
            method: "POST",
            body: JSON.stringify({ content: contentStore, importId: `bootstrap-${Date.now()}` }),
          });
          const initialized = await cloudRequest("/api/load-workspace");
          if (!initialized.content) throw new Error("Neon 内容初始化后仍未返回内容。");
          result.content = initialized.content;
          result.tasks = initialized.tasks;
          result.state = initialized.state;
          result.cursor = initialized.cursor;
        }
        const content = result.content.data || {};
        applyContentPayload(content);
        const next = createDefaultState();
        (result.tasks || []).forEach((task) => {
          const day = Number(task.day);
          next.statuses[day] = task.status || "未开始";
          next.checks[day] = task.checks || {};
          next.manualNotes[day] = task.manual_notes || {};
          next.reviews[day] = task.review || {};
          next.shotChecks[day] = {};
          (task.shots || []).forEach((shot) => {
            next.shotChecks[day][shot.index] = { done: Boolean(shot.done), updatedAt: nowIso() };
            neonVersions.shots[`${day}:${shot.index}`] = Number(shot.version || 1);
          });
          neonVersions.progress[day] = Number(task.progress_version || 1);
          neonVersions.reviews[day] = Number(task.review_version || 1);
        });
        state = normalizeState({ ...next, lastCloudLoadedAt: nowIso() });
        if (result.state) {
          state.todayShootPlan = normalizeTodayShootPlan(result.state.today_shoot_plan || {});
          neonVersions.workspace = Number(result.state.version || 1);
        }
        changeCursor = Number(result.cursor || 0);
        persistStateLocalOnly();
        setCloudStatus("ok", "已读取 Neon 共享工作区");
        render();
        return true;
      }
      if (!result.exists) {
        setCloudStatus("idle", "线上还没有保存数据。");
        if (auto) {
          await cloudRequest("/api/import-content", {
            method: "POST",
            body: JSON.stringify({ content: contentStore }),
          });
          setCloudStatus("ok", "已用当前默认内容初始化线上内容库。");
        }
        if (!silent && confirm("线上还没有数据。是否把当前本地进度保存到线上？")) {
          await saveCloudNow({ silent: false });
        }
        return false;
      }

      const loadedAt = nowIso();
      if (!result.content) {
        await cloudRequest("/api/import-content", {
          method: "POST",
          body: JSON.stringify({ content: contentStore }),
        });
      }
      if (result.content) applyContentPayload(result.content);
      state = stateFromDataPayload(result.progress || result.data?.userState || result.data?.state || {}, {
        lastCloudLoadedAt: loadedAt,
      });
      lastRemoteRevision = remoteRevision(result);
      storageLoadError = null;
      saveState({ lastCloudLoadedAt: loadedAt, allowOverwriteAfterError: true, skipCloudSave: true });
      setCloudStatus("ok", `已自动读取线上数据：${formatDateTime(loadedAt)}`);
      render();
      if (!silent) alert(`线上读取成功：${formatDateTime(loadedAt)}`);
      return true;
    } catch (error) {
      setCloudStatus("error", error?.message || "读取线上数据失败。");
      if (!silent) alert(`读取线上数据失败：${error?.message || "请稍后重试。"}`);
      return false;
    }
  }

  function redirectToLogin() {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login.html?next=${encodeURIComponent(next)}`;
  }

  function currentDayFromDate(startDate) {
    const start = new Date(`${startDate || todayIso()}T00:00:00`);
    const today = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
    const diff = Number.isNaN(start.getTime()) ? 1 : Math.floor((today - start) / 86400000) + 1;
    return Math.min(30, Math.max(1, diff));
  }

  function restoreRawStorage() {
    if (!storageLoadError?.raw) return;
    const blob = new Blob([storageLoadError.raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qingxi-xhs-raw-localstorage-${backupStamp()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function forceResetBrokenStorage() {
    if (!confirm("这会重置当前损坏的本地数据。建议先导出原始数据。是否继续？")) return;
    const typed = prompt("请输入 RESET 确认重置。");
    if (typed !== "RESET") return;
    storageLoadError = null;
    state = createDefaultState();
    saveState({ allowOverwriteAfterError: true });
    render();
  }

  function backupStamp(date = new Date()) {
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function getStatus(day) {
    return state.statuses[day] || "未开始";
  }

  function isAtLeastShotCompleteStatus(status) {
    const shotStatusIndex = statusIndex("已拍摄");
    const currentIndex = statusIndex(status);
    return shotStatusIndex >= 0 && currentIndex >= shotStatusIndex;
  }

  function markAllShotsDoneForDay(day, updatedAt = nowIso()) {
    const task = getTask(day);
    const patch = {};
    state.shotChecks[day] = state.shotChecks[day] || {};
    (task.imagePlan || []).forEach((_, index) => {
      const current = normalizeShotRecord(state.shotChecks[day][index]);
      if (current.done) return;
      const next = { done: true, updatedAt };
      state.shotChecks[day][index] = next;
      patch[index] = next;
    });
    return Object.keys(patch).length ? { [day]: patch } : null;
  }

  function markAllShotsDoneForStatus(day, status) {
    if (!isAtLeastShotCompleteStatus(status)) return null;
    return markAllShotsDoneForDay(day);
  }

  function promoteStatusWhenAllShotsDone(day) {
    const progress = shotProgress(day);
    if (!progress.total || progress.done !== progress.total) return false;
    if (isAtLeastShotCompleteStatus(getStatus(day))) return false;
    state.statuses[day] = "已拍摄";
    return true;
  }

  function setStatus(day, status, keepModal = false) {
    state.statuses[day] = status;
    const shotPatch = markAllShotsDoneForStatus(day, status);
    saveState({ skipCloudSave: backendMode === "neon" });
    if (backendMode === "neon") saveNeonTaskProgress(day, { status });
    if (shotPatch) saveCollabPatch({ shotChecks: shotPatch });
    render();
    if (keepModal) openDetail(day);
  }

  function getReview(day) {
    return state.reviews[day] || {};
  }

  function taskSource() {
    return contentStore.contentPlan.map((task) => getTask(task.day));
  }

  function getTask(day) {
    const base = contentStore.contentPlan.find((item) => item.day === Number(day)) || DEFAULT_CONTENT.contentPlan.find((item) => item.day === Number(day)) || {};
    const full = contentStore.fullContent.find((item) => item.day === Number(day)) || {};
    const enhanced = {
      contentType: full.category || base.rawType,
      topic: full.topic || base.theme,
      mainProduct: full.mainProduct || base.product,
      highClickTitle: full.highClickTitle || base.title,
      titleDirection: full.titleDirection || "",
      titleReason: full.titleReason || "",
      coverText: full.coverText || "",
      altTitles: full.altTitles || [],
      bodyCopy: full.bodyCopy || "",
      imagePlan: full.imagePlan || [],
      tags: full.tags || base.tags,
      seoReason: full.seoReason || "",
      copyReason: full.copyReason || "",
      operationJudge: full.operationJudge || "",
      rawType: full.category || base.rawType,
      theme: full.topic || base.theme,
      title: full.highClickTitle || base.title,
      product: full.mainProduct || base.product,
      shootingTask: full.imagePlan?.join("；") || base.shootingTask,
      copyFocus: full.titleDirection || base.copyFocus,
      conversion: full.operationJudge || base.conversion,
    };
    const merged = {
      ...base,
      ...enhanced,
    };
    return {
      ...merged,
      day: base.day,
      week: base.week,
      keywords: arrayField(merged.keywords, base.keywords),
      tags: arrayField(merged.tags, enhanced.tags || base.tags),
      altTitles: arrayField(merged.altTitles, enhanced.altTitles),
      imagePlan: arrayField(merged.imagePlan, enhanced.imagePlan),
    };
  }

  function productSource() {
    return contentStore.products.map((product, index) => getProduct(index));
  }

  function getProduct(index) {
    const base = contentStore.products[index] || DEFAULT_CONTENT.products[index] || {};
    return {
      ...base,
      imageKeywords: arrayField(base.imageKeywords, []),
      themes: arrayField(base.themes, []),
    };
  }

  function librarySource() {
    return contentStore.library.map((item, index) => getLibraryItem(index));
  }

  function getLibraryItem(index) {
    const base = contentStore.library[index] || DEFAULT_CONTENT.library[index] || {};
    return { ...base };
  }

  function arrayField(value, fallback) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return splitLines(value);
    return fallback;
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\n|,|，|\/|#/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (value.includes("#") && !item.startsWith("#") ? `#${item}` : item));
  }

  function splitRows(value) {
    return String(value || "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function editText(value) {
    return Array.isArray(value) ? value.join("\n") : String(value ?? "");
  }

  function saveTaskEdit(day, values) {
    const index = contentStore.contentPlan.findIndex((item) => item.day === Number(day));
    if (index >= 0) {
      contentStore.contentPlan[index] = {
        ...contentStore.contentPlan[index],
        rawType: values.contentType || contentStore.contentPlan[index].rawType,
        category: values.contentType || contentStore.contentPlan[index].category,
        theme: values.topic || contentStore.contentPlan[index].theme,
        title: values.highClickTitle || contentStore.contentPlan[index].title,
        product: values.mainProduct || contentStore.contentPlan[index].product,
        shootingTask: values.imagePlan?.join("；") || contentStore.contentPlan[index].shootingTask,
        copyFocus: values.titleDirection || contentStore.contentPlan[index].copyFocus,
        conversion: values.operationJudge || contentStore.contentPlan[index].conversion,
        tags: arrayField(values.tags, contentStore.contentPlan[index].tags),
      };
    }
    const fullIndex = contentStore.fullContent.findIndex((item) => item.day === Number(day));
    const nextFull = {
      ...(fullIndex >= 0 ? contentStore.fullContent[fullIndex] : { day: Number(day) }),
      category: values.contentType,
      topic: values.topic,
      mainProduct: values.mainProduct,
      highClickTitle: values.highClickTitle,
      titleDirection: values.titleDirection,
      titleReason: values.titleReason,
      coverText: values.coverText,
      altTitles: values.altTitles,
      bodyCopy: values.bodyCopy,
      imagePlan: values.imagePlan,
      tags: values.tags,
      seoReason: values.seoReason,
      copyReason: values.copyReason,
      operationJudge: values.operationJudge,
    };
    if (fullIndex >= 0) contentStore.fullContent[fullIndex] = nextFull;
    else contentStore.fullContent.push(nextFull);
    saveContentNow();
    render();
    openDetail(day);
  }

  function resetTaskEdit(day) {
    const defaultBase = DEFAULT_CONTENT.contentPlan.find((item) => item.day === Number(day));
    const defaultFull = DEFAULT_CONTENT.fullContent.find((item) => item.day === Number(day));
    const index = contentStore.contentPlan.findIndex((item) => item.day === Number(day));
    const fullIndex = contentStore.fullContent.findIndex((item) => item.day === Number(day));
    if (defaultBase && index >= 0) contentStore.contentPlan[index] = defaultBase;
    if (defaultFull && fullIndex >= 0) contentStore.fullContent[fullIndex] = defaultFull;
    saveContentNow();
    render();
    openDetail(day);
  }

  function saveProductEdit(index, values) {
    contentStore.products[index] = {
      ...(contentStore.products[index] || {}),
      ...values,
    };
    saveContentNow();
    render();
    openProductEditor(index);
  }

  function resetProductEdit(index) {
    if (DEFAULT_CONTENT.products[index]) contentStore.products[index] = DEFAULT_CONTENT.products[index];
    saveContentNow();
    render();
    openProductEditor(index);
  }

  function saveLibraryEdit(index, values) {
    contentStore.library[index] = {
      ...(contentStore.library[index] || {}),
      ...values,
    };
    saveContentNow();
    render();
    openLibraryEditor(index);
  }

  function resetLibraryEdit(index) {
    if (DEFAULT_CONTENT.library[index]) contentStore.library[index] = DEFAULT_CONTENT.library[index];
    saveContentNow();
    render();
    openLibraryEditor(index);
  }

  function setReview(day, field, value, type) {
    state.reviews[day] = state.reviews[day] || {};
    state.reviews[day][field] = type === "number" ? toNumber(value) : value;
    saveState({ skipCloudSave: backendMode === "neon" });
    if (backendMode === "neon") saveNeonReview(day, state.reviews[day]);
    renderDashboardCounters();
  }

  function setCheck(day, label, checked) {
    state.checks[day] = state.checks[day] || {};
    state.checks[day][label] = checked;
    saveState({ skipCloudSave: backendMode === "neon" });
    if (backendMode === "neon") saveNeonTaskProgress(day, { checks: state.checks[day] });
  }

  function setShotCheck(day, index, checked) {
    const updatedAt = nowIso();
    state.shotChecks[day] = state.shotChecks[day] || {};
    state.shotChecks[day][index] = { done: checked, updatedAt };
    const statusChanged = promoteStatusWhenAllShotsDone(day);
    saveState({ skipCloudSave: true });
    if (backendMode === "neon" && statusChanged) saveNeonTaskProgress(day, { status: state.statuses[day] });
    saveCollabPatch({
      shotChecks: {
        [day]: {
          [index]: state.shotChecks[day][index],
        },
      },
    });
    refreshAfterShotChange(day, index);
  }

  function restoreModalScroll(day, index, previousScrollTop, previousTargetTop) {
    window.requestAnimationFrame(() => {
      const modal = document.querySelector("[data-modal-panel]");
      if (!modal) return;
      const target = Number.isInteger(index)
        ? modal.querySelector(`[data-shot-toggle][data-day="${day}"][data-shot-index="${index}"]`)
        : null;
      if (target && Number.isFinite(previousTargetTop)) {
        const nextTargetTop = target.getBoundingClientRect().top;
        modal.scrollTop += nextTargetTop - previousTargetTop;
        return;
      }
      modal.scrollTop = previousScrollTop;
    });
  }

  function refreshAfterShotChange(day, index) {
    const modal = document.querySelector("[data-modal-panel]");
    if (modal) {
      const target = Number.isInteger(index)
        ? modal.querySelector(`[data-shot-toggle][data-day="${day}"][data-shot-index="${index}"]`)
        : null;
      const previousScrollTop = modal.scrollTop;
      const previousTargetTop = target?.getBoundingClientRect().top;
      render();
      openDetail(day);
      restoreModalScroll(day, index, previousScrollTop, previousTargetTop);
      return;
    }
    render();
  }

  function shotRecord(day, index) {
    return normalizeShotRecord(state.shotChecks?.[day]?.[index]);
  }

  function isShotDone(day, index) {
    return shotRecord(day, index).done;
  }

  function shotProgress(day) {
    const task = getTask(day);
    const total = task.imagePlan?.length || 0;
    const done = (task.imagePlan || []).filter((_, index) => isShotDone(day, index)).length;
    return {
      done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  }

  function currentTodayShootPlan() {
    return normalizeTodayShootPlan(state.todayShootPlan);
  }

  function selectedShootTasks() {
    return currentTodayShootPlan().selectedDays.map(getTask).filter(Boolean);
  }

  function selectedShootProducts(tasks = selectedShootTasks()) {
    const groups = {};
    tasks.forEach((task) => {
      const product = String(task.mainProduct || task.product || "未设置产品").trim();
      groups[product] = groups[product] || { product, days: [] };
      groups[product].days.push(task.day);
    });
    return Object.values(groups).sort((a, b) => a.days[0] - b.days[0]);
  }

  function setTodayShootPlanDays(selectedDays) {
    const normalizedDays = [...new Set(selectedDays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30))].sort((a, b) => a - b);
    const plan = {
      date: todayIso(),
      selectedDays: normalizedDays,
      updatedAt: nowIso(),
    };
    state.todayShootPlan = plan;
    if (!normalizedDays.length) shootStep = "select";
    saveState({ skipCloudSave: true });
    saveCollabPatch({ todayShootPlan: plan });
    render();
  }

  function toggleTodayShootDay(day, checked) {
    const plan = currentTodayShootPlan();
    const selected = new Set(plan.selectedDays);
    if (checked) selected.add(day);
    else selected.delete(day);
    setTodayShootPlanDays([...selected]);
  }

  function confirmShootPlan() {
    const selectedTasks = selectedShootTasks();
    const totalShots = selectedTasks.reduce((sum, task) => sum + (task.imagePlan?.length || 0), 0);
    if (!selectedTasks.length) {
      alert("请先勾选今天要拍摄的选题。");
      return;
    }
    const confirmed = confirm(`已选择 ${selectedTasks.length} 个选题，共 ${totalShots} 张配图建议。确认后进入按选题拍摄页面。`);
    if (!confirmed) return;
    shootStep = "plan";
    render();
  }

  function backToShootSelect() {
    shootStep = "select";
    render();
  }

  function classifyShot(text, task = {}) {
    const source = String(text || "");
    const productContext = `${task.mainProduct || ""} ${task.product || ""}`;
    const groups = [
      { label: "信息说明图", tone: "blue", priority: 58, keywords: ["信息图", "说明", "提醒", "汇总", "清单", "预约", "人数", "文字图", "时间表", "指南", "小卡", "对比", "收尾"] },
      { label: "小院入口/路线", tone: "blue", priority: 88, keywords: ["入口", "门头", "门帘", "路线", "动线", "过渡", "到店", "公园", "车窗", "停车", "位置"] },
      { label: "茶席桌面", tone: "tea", priority: 92, keywords: ["茶席", "茶桌", "桌面", "桌上", "俯拍", "摆桌", "全桌", "套餐", "座位", "同框"] },
      { label: "茶饮特写", tone: "tea", priority: 84, keywords: ["茶饮", "茶汤", "茶杯", "拿杯", "倒茶", "特写", "冰块", "果肉", "薄荷", "柠檬", "胭脂", "竹涧", "松窗", "古木", "百香果", "朱栏", "陈仓", "石髓"] },
      { label: "点心盒/食物", tone: "tea", priority: 76, keywords: ["点心", "点心盒", "水果", "干果", "茶点", "食物"] },
      { label: "人物体验", tone: "warm", priority: 90, keywords: ["女生", "朋友", "聊天", "主理人", "背影", "人物", "客人", "手部", "合影", "动作", "模特", "发呆", "翻书", "坐下", "低头", "喝茶", "小聚", "体验"] },
      { label: "花园/户外氛围", tone: "green", priority: 78, keywords: ["花园", "花", "户外", "院子", "空院", "空镜", "光线", "暖光", "雨", "屋檐", "傍晚", "上午", "中午", "氛围"] },
      { label: "竹林/小院环境", tone: "green", priority: 96, keywords: ["竹林", "竹影", "小院全景", "环境", "远景"] },
    ];
    const match = groups.find((group) => group.keywords.some((keyword) => source.includes(keyword)));
    if (!match && /本篇|主推|茶饮|产品/.test(source) && productContext) {
      return groups.find((group) => group.label === "茶饮特写");
    }
    return match || { label: "特殊补拍", tone: "gray", priority: 40, keywords: [] };
  }

  function packageActionTitle(label) {
    const titles = {
      "竹林/小院环境": "先拍竹林小院通用环境",
      "小院入口/路线": "集中拍入口和路线动线",
      "茶席桌面": "合并拍茶席桌面素材",
      "茶饮特写": "集中补茶饮近景特写",
      "点心盒/食物": "一次拍完整点心桌面",
      "人物体验": "安排人物体验和聊天动作",
      "花园/户外氛围": "补花园户外氛围空镜",
      "信息说明图": "最后做路线和说明图",
      "特殊补拍": "单独检查特殊补拍项",
    };
    return titles[label] || `集中拍${label}`;
  }

  function packageInstruction(label) {
    const instructions = {
      "竹林/小院环境": "先拍一张能交代小院和竹林关系的竖图，再补 2-3 张竹影、远景和环境细节。",
      "小院入口/路线": "从公园入口、过渡路段、小院门头按动线拍，方便后续攻略类选题共用。",
      "茶席桌面": "把茶席、茶杯、桌面、环境放在同一画面里，先拍全景，再拍俯拍和局部。",
      "茶饮特写": "同一轮把主推茶饮拍齐：杯身、茶汤透光、手拿杯、环境背景各补一张。",
      "点心盒/食物": "点心盒和茶饮同框先拍完整桌面，再补食物近景，避免每个选题重复摆盘。",
      "人物体验": "安排人物自然坐下、聊天、拿杯、背影和手部动作，优先抓松弛状态。",
      "花园/户外氛围": "拍花园、院子、户外座位和空镜，用来补足氛围类选题的过渡画面。",
      "信息说明图": "等实拍素材完成后再做路线、预约、动作清单等信息图，不占现场拍摄节奏。",
      "特殊补拍": "这些画面复用度低，放在通用素材拍完后逐条核对补拍。",
    };
    return instructions[label] || "把同类画面集中拍完，再回到按选题清单核对遗漏。";
  }

  function shotSummaryText(text) {
    return String(text || "")
      .replace(/^图\s*\d+\s*[：:、.]?\s*/i, "")
      .replace(/^封面\s*[：:、.]?\s*/i, "封面：")
      .split(/[。；;]/)[0]
      .trim()
      .slice(0, 42);
  }

  function isCoverShot(text, index) {
    return Number(index) === 0 || /^封面\s*[：:]/.test(String(text || "").trim());
  }

  function highValueShot(text) {
    return /封面|环境|茶席|小院|竹林|人物|茶饮|桌面/.test(text || "") ? 1 : 0;
  }

  function shootingPackages() {
    const groups = {};
    selectedShootTasks().forEach((task) => {
      (task.imagePlan || []).forEach((text, index) => {
        if (isShotDone(task.day, index)) return;
        const shotType = classifyShot(text, task);
        groups[shotType.label] = groups[shotType.label] || {
          ...shotType,
          items: [],
        };
        groups[shotType.label].items.push({
          task,
          index,
          text,
          summary: shotSummaryText(text),
          highValue: highValueShot(text),
        });
      });
    });
    return Object.entries(groups)
      .map(([label, group]) => {
        const dayCount = new Set(group.items.map((item) => item.task.day)).size;
        const shotCount = group.items.length;
        const highValueCount = group.items.reduce((sum, item) => sum + item.highValue, 0);
        const byDay = group.items.reduce((acc, item) => {
          acc[item.task.day] = acc[item.task.day] || { task: item.task, items: [] };
          acc[item.task.day].items.push(item);
          return acc;
        }, {});
        const packageDaySet = new Set(group.items.map((item) => item.task.day));
        const supplemental = selectedShootTasks()
          .filter((task) => packageDaySet.has(task.day))
          .flatMap((task) => (task.imagePlan || [])
            .map((text, index) => ({ task, index, text, type: classifyShot(text, task) }))
            .filter((item) => !isShotDone(item.task.day, item.index) && item.type.label !== label)
            .slice(0, 2));
        return {
          ...group,
          label,
          actionTitle: packageActionTitle(label),
          instruction: packageInstruction(label),
          dayCount,
          shotCount,
          highValueCount,
          byDay: Object.values(byDay).sort((a, b) => a.task.day - b.task.day),
          supplemental,
          score: dayCount * 100 + shotCount * 10 + highValueCount * 8 + group.priority,
        };
      })
      .filter((group) => group.dayCount >= 2)
      .sort((a, b) => b.score - a.score);
  }

  function sideQuestInstruction(label) {
    const instructions = {
      "竹林/小院环境": "顺手多拍 1 张竖图环境、1 张远景和 1 张竹影细节，后面环境类选题可以备用。",
      "小院入口/路线": "同一位置补 1 张门头/入口、1 张路过动线、1 张带方向感的横图。",
      "茶席桌面": "茶席不要只拍一张，顺手补全景、俯拍和茶杯近景，后面桌面类图可复用。",
      "茶饮特写": "顺手补杯身、茶汤透光、手拿杯和带环境背景各一张。",
      "点心盒/食物": "同一摆盘先拍完整桌面，再补点心盒和茶饮同框近景。",
      "人物体验": "同一动作多留 2-3 张：聊天、拿杯、背影或手部，方便后面人物类选题备用。",
      "花园/户外氛围": "顺手补一张空镜、一张带座位关系、一张有光影的氛围图。",
      "信息说明图": "先把路线、位置或说明所需的实拍底图拍清楚，信息文字后面再补。",
      "特殊补拍": "这类图复用度不稳定，建议只补一个相近角度作为备用，不自动算其它图完成。",
    };
    return instructions[label] || "在当前场景多补 1-2 个相似角度，后面可能用得上。";
  }

  function sideQuestSuggestions(task, index, text) {
    if (isCoverShot(text, index)) return [];
    const currentType = classifyShot(text, task);
    return selectedShootTasks()
      .filter((candidateTask) => candidateTask.day > task.day)
      .flatMap((candidateTask) => (candidateTask.imagePlan || []).map((candidateText, candidateIndex) => ({
        task: candidateTask,
        index: candidateIndex,
        text: candidateText,
        type: classifyShot(candidateText, candidateTask),
      })))
      .filter((candidate) => !isCoverShot(candidate.text, candidate.index)
        && !isShotDone(candidate.task.day, candidate.index)
        && candidate.type.label === currentType.label)
      .slice(0, 4)
      .map((candidate) => ({
        day: candidate.task.day,
        theme: candidate.task.theme,
        index: candidate.index,
        summary: shotSummaryText(candidate.text),
      }));
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function startDateObj() {
    const date = new Date(`${state.startDate || todayIso()}T00:00:00`);
    return Number.isNaN(date.getTime()) ? new Date(`${todayIso()}T00:00:00`) : date;
  }

  function dateForDay(day) {
    const date = startDateObj();
    date.setDate(date.getDate() + day - 1);
    return date;
  }

  function formatDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function isoForDay(day) {
    const date = dateForDay(day);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function currentDay() {
    return currentDayFromDate(state.startDate);
  }

  function campaignWeek(day) {
    if (day <= 7) return 1;
    if (day <= 14) return 2;
    if (day <= 21) return 3;
    return 4;
  }

  function statusIndex(status) {
    return DATA.STATUSES.indexOf(status);
  }

  function isPublished(status) {
    return statusIndex(status) >= statusIndex("已发布");
  }

  function isReviewed(status) {
    return status === "已复盘";
  }

  function isUnpublished(status) {
    return statusIndex(status) < statusIndex("已发布");
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => alert("已复制到剪贴板。"));
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    alert("已复制到剪贴板。");
  }

  function metrics() {
    const statusCounts = Object.fromEntries(DATA.STATUSES.map((status) => [status, 0]));
    let published = 0;
    let reviewed = 0;
    let weekDone = 0;
    const day = currentDay();
    const week = campaignWeek(day);

    taskSource().forEach((task) => {
      const status = getStatus(task.day);
      statusCounts[status] += 1;
      if (isPublished(status)) published += 1;
      if (isReviewed(status)) reviewed += 1;
      if (campaignWeek(task.day) === week && isPublished(status)) weekDone += 1;
    });

    const totals = sumReviews();
    return {
      day,
      week,
      statusCounts,
      published,
      reviewed,
      weekDone,
      progress: Math.round((published / taskSource().length) * 100),
      totals,
    };
  }

  function sumReviews() {
    return taskSource().reduce(
      (acc, task) => {
        const review = getReview(task.day);
        REVIEW_FIELDS.forEach(([key, , type]) => {
          if (type === "number") acc[key] = (acc[key] || 0) + toNumber(review[key]);
        });
        return acc;
      },
      {
        impressions: 0,
        reads: 0,
        likes: 0,
        saves: 0,
        comments: 0,
        shares: 0,
        profileViews: 0,
        messages: 0,
        bookings: 0,
        visits: 0,
      },
    );
  }

  function render() {
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          <div class="brand">
            <h1>清熙小院<br />30 天起号工作台</h1>
            <p>拍摄、发布、复盘、预约转化一处管理。</p>
          </div>
          <nav class="nav">
            ${NAV.map(([id, label]) => `<button class="${activeView === id ? "active" : ""}" data-nav="${id}">${label}</button>`).join("")}
          </nav>
        </aside>
        <main class="main" data-view="${activeView}">
          ${renderTopbar()}
          <section class="section ${activeView === "dashboard" ? "active" : ""}" id="dashboard">${renderDashboard()}</section>
          <section class="section ${activeView === "shoot" ? "active" : ""}" id="shoot">${renderShootPlan()}</section>
          <section class="section ${activeView === "calendar" ? "active" : ""}" id="calendar">${renderCalendar()}</section>
          <section class="section ${activeView === "kanban" ? "active" : ""}" id="kanban">${renderKanban()}</section>
          <section class="section ${activeView === "products" ? "active" : ""}" id="products">${renderProducts()}</section>
          <section class="section ${activeView === "analytics" ? "active" : ""}" id="analytics">${renderAnalytics()}</section>
          <section class="section ${activeView === "weekly" ? "active" : ""}" id="weekly">${renderWeekly()}</section>
          <section class="section ${activeView === "library" ? "active" : ""}" id="library">${renderLibrary()}</section>
        </main>
      </div>
      ${renderMobileBottomNav()}
      <input class="hide" id="import-file" type="file" accept="application/json" />
      <div id="modal-root"></div>
    `;
    bindEvents();
  }

  function renderMobileBottomNav() {
    return `
      <nav class="mobile-bottom-nav" aria-label="移动端主导航">
        ${NAV.map(([id, label]) => `<button class="${activeView === id ? "active" : ""}" data-nav="${id}">${mobileNavLabel(label)}</button>`).join("")}
      </nav>
    `;
  }

  function mobileNavLabel(label) {
    return label
      .replace("首页 Dashboard", "首页")
      .replace("今日拍摄计划", "拍摄")
      .replace("30 天日历", "日历")
      .replace("任务看板", "看板")
      .replace("复盘分析", "复盘")
      .replace("本周复盘", "本周");
  }

  function renderTopbar() {
    const m = metrics();
    const titles = {
      dashboard: "小红书 30 天起号运营工作台",
      shoot: "今日拍摄计划",
      calendar: "30 天内容日历",
      kanban: "任务状态看板",
      products: "茶饮产品库",
      analytics: "复盘分析",
      weekly: "本周复盘",
      library: "运营资料库",
    };
    return `
      <div class="topbar">
        <div>
          <p class="eyebrow">清熙小院 · 新津斑竹林 · 宋式田园小院茶馆</p>
          <h2 class="page-title">${titles[activeView]}</h2>
          <p class="page-subtitle">拍摄、发布、复盘、预约转化一处管理。</p>
        </div>
        <div class="toolbar">
          <label class="mini-title">Day 1 日期</label>
          <input class="field" type="date" value="${state.startDate}" data-action="start-date" />
          <span class="status-pill" data-status="已发布">今日 Day ${m.day} / 第 ${m.week} 周</span>
          <span data-cloud-status>${cloudStatusMarkup()}</span>
        </div>
      </div>
    `;
  }

  function renderDashboard() {
    const m = metrics();
    const todayTask = getTask(m.day);
    const todayStatus = getStatus(m.day);
    const tomorrowTask = getTask(Math.min(30, m.day + 1));
    return `
      ${renderStorageError()}
      <div class="dashboard-today">
        ${renderTodayExecutionCard(todayTask, todayStatus)}
      </div>
      <div class="dashboard-alerts">
        ${renderRiskAlerts()}
      </div>
      <div class="quick-task-grid dashboard-quick" style="margin-top:16px">
        ${quickTaskPanel("今日", todayTask)}
        ${quickTaskPanel("明日", tomorrowTask)}
        ${weeklyTaskPanel(m.week)}
      </div>

      <div class="grid cols-4" id="dashboard-counters">
        ${statCard("30 天总进度", `${m.progress}%`, "已发布或已复盘计入发文完成", m.progress)}
        ${statCard("本周已完成", `${m.weekDone}`, `第 ${m.week} 周已发布/复盘数量`)}
        ${statCard("本月累计私信", `${m.totals.messages}`, "来自每日复盘手动填写")}
        ${statCard("本月累计预约", `${m.totals.bookings}`, "来自每日复盘手动填写")}
      </div>

      <div class="grid cols-3" style="margin-top:16px">
        ${miniStatus("待拍摄", m.statusCounts["待拍摄"])}
        ${miniStatus("待修图", m.statusCounts["待修图"])}
        ${miniStatus("待发布", m.statusCounts["待发布"])}
        ${miniStatus("已发布", m.statusCounts["已发布"])}
        ${miniStatus("已复盘", m.statusCounts["已复盘"])}
        ${miniStatus("累计到店桌数", m.totals.visits)}
      </div>

      <div class="grid cols-2" style="margin-top:16px">
        ${renderTodayExecutionCard(todayTask, todayStatus, "desktop")}
        ${renderChecklistCard()}
      </div>
    `;
  }

  function renderTodayExecutionCard(todayTask, todayStatus, variant = "mobile") {
    return `
      <article class="card today-card ${variant === "desktop" ? "desktop-today-card" : "mobile-first-today-card"}">
        <div class="today-hero">
          <span class="status-pill" data-status="${todayStatus}">${todayStatus}</span>
          <h2>Day ${todayTask.day} · ${escapeHtml(todayTask.theme)}</h2>
          <p class="task-copy">${escapeHtml(todayTask.highClickTitle || todayTask.title)}</p>
        </div>
        <div class="today-body grid">
          <div class="pill-row">
            <span class="pill">第 ${campaignWeek(todayTask.day)} 周</span>
            <span class="pill">${todayTask.contentType || todayTask.category}</span>
            <span class="pill">${todayTask.mainProduct || todayTask.product}</span>
            <span class="pill">${isoForDay(todayTask.day)}</span>
          </div>
          ${infoBlock("今日主推产品", todayTask.mainProduct || todayTask.product)}
          ${infoBlock("今日封面短文案", todayTask.coverText || "未设置")}
          ${infoBlock("今日运营判断点", todayTask.operationJudge || todayTask.conversion)}
          ${infoBlock("今日拍摄任务", todayTask.shootingTask)}
          <div class="mobile-collapsible-info">
            ${infoBlock("文案重点", todayTask.copyFocus)}
            ${infoBlock("转化动作", todayTask.conversion)}
          </div>
          <div>
            <p class="mini-title">当前状态</p>
            ${statusButtons(todayTask.day)}
          </div>
          <button class="btn" data-open-day="${todayTask.day}">打开今日详情</button>
        </div>
      </article>
    `;
  }

  function renderChecklistCard() {
    return `
      <article class="card pad checklist-card">
        <h3 style="margin-top:0">发布前检查清单</h3>
        <ul class="quick-list">
          ${DATA.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    `;
  }

  function renderStorageError() {
    if (!storageLoadError) return "";
    return `
      <article class="risk-card local-notice">
        <strong>本地数据读取失败</strong>
        <p>当前浏览器里的保存数据无法解析。为了避免覆盖原始数据，系统已暂停自动覆盖保存。你可以先导出原始数据，再决定是否重置。</p>
        <div class="pill-row">
          <button class="status-btn" data-action="export-raw-storage">导出原始数据</button>
          <button class="status-btn" data-action="reset-broken-storage">重置损坏数据</button>
        </div>
      </article>
    `;
  }

  function cloudStatusMarkup() {
    if (!canUseCloudApi()) {
      return `<div class="backup-reminder">当前是 file:// 直接打开，不能调用 Vercel API。部署到 Vercel 或使用 <code>vercel dev</code> 后可线上保存。</div>`;
    }
    const labels = {
      idle: "已连接",
      saving: "保存中",
      loading: "读取中",
      ok: "正常",
      error: "异常",
    };
    return `<div class="cloud-status ${cloudStatus.mode}">${labels[cloudStatus.mode] || "已连接"}：${escapeHtml(cloudStatus.message || "已通过访问密码保护，并启用自动读取和自动保存。")}</div>`;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function quickTaskPanel(label, task) {
    if (!task) return `<article class="card pad"><h3>${label}</h3><div class="empty">30 天计划已结束。</div></article>`;
    const status = getStatus(task.day);
    return `
      <article class="card pad quick-task" data-status="${status}">
        <div class="task-meta">
          <span>${label} · Day ${task.day} · ${isoForDay(task.day)}</span>
          <span class="status-pill" data-status="${status}">${status}</span>
        </div>
        <h3>${escapeHtml(task.theme)}</h3>
        <p class="task-copy">${escapeHtml(task.highClickTitle || task.title)}</p>
        <div class="pill-row">
          <span class="pill">${task.contentType || task.category}</span>
          <span class="pill">${task.mainProduct || task.product}</span>
        </div>
        <div class="mobile-status-control">
          <select class="status-select" data-status-select="${task.day}" data-status="${status}">
            ${DATA.STATUSES.map((statusName) => `<option value="${statusName}" ${statusName === status ? "selected" : ""}>${statusName}</option>`).join("")}
          </select>
          <button class="ghost-btn" data-open-day="${task.day}">详情</button>
        </div>
      </article>
    `;
  }

  function weeklyTaskPanel(week) {
    const tasks = taskSource().filter((task) => campaignWeek(task.day) === week);
    const done = tasks.filter((task) => isPublished(getStatus(task.day))).length;
    const next = tasks.find((task) => isUnpublished(getStatus(task.day))) || tasks[tasks.length - 1];
    return `
      <article class="card pad quick-task">
        <div class="task-meta">
          <span>本周 · 第 ${week} 周</span>
          <span class="status-pill">${done}/${tasks.length} 已发布</span>
        </div>
        <h3>${next ? `下一步：Day ${next.day} · ${escapeHtml(next.theme)}` : "本周无任务"}</h3>
        <p class="task-copy">${next ? escapeHtml(next.shootingTask) : "30 天计划已结束。"}</p>
        <div class="progress-track"><div class="progress-bar" style="--progress:${Math.round((done / Math.max(1, tasks.length)) * 100)}%"></div></div>
        ${next ? `<button class="ghost-btn" data-open-day="${next.day}">打开本周下一步</button>` : ""}
      </article>
    `;
  }

  function renderRiskAlerts() {
    const alerts = riskAlerts();
    if (!alerts.length) return "";
    return `
      <div class="risk-alerts">
        ${alerts.map((alert) => `
          <article class="risk-card">
            <strong>${escapeHtml(alert.title)}</strong>
            <p>${escapeHtml(alert.body)}</p>
          </article>
        `).join("")}
      </div>
    `;
  }

  function riskAlerts() {
    const alerts = [];
    const current = currentDay();
    const recent = taskSource()
      .filter((task) => task.day <= current)
      .slice(-3);
    if (recent.length === 3 && recent.every((task) => isUnpublished(getStatus(task.day)))) {
      alerts.push({
        title: "连续 3 天未发布",
        body: `Day ${recent[0].day}-${recent[2].day} 均未进入已发布/已复盘，请优先补齐发布节奏。`,
      });
    }
    const unreviewed = taskSource().filter((task) => getStatus(task.day) === "已发布");
    if (unreviewed.length) {
      alerts.push({
        title: "有已发布但未复盘的任务",
        body: `${unreviewed.length} 篇已发布内容还未复盘，建议当天或次日补曝光、收藏、私信和预约数据。`,
      });
    }
    return alerts;
  }

  function statCard(label, value, note, progress) {
    return `
      <article class="stat-card card">
        <span>${label}</span>
        <strong>${value}</strong>
        ${progress !== undefined ? `<div class="progress-track"><div class="progress-bar" style="--progress:${progress}%"></div></div>` : ""}
        <span>${note || ""}</span>
      </article>
    `;
  }

  function miniStatus(label, value) {
    return `
      <article class="card pad">
        <p class="mini-title">${label}</p>
        <strong style="font-size:28px">${value}</strong>
      </article>
    `;
  }

  function infoBlock(title, body) {
    return `
      <div>
        <p class="mini-title">${title}</p>
        <p class="task-copy">${escapeHtml(body)}</p>
      </div>
    `;
  }

  function statusButtons(day) {
    return `
      <div class="pill-row">
        ${DATA.STATUSES.map((status) => `<button class="status-btn" data-status-set="${status}" data-day="${day}" data-status="${status}">${status}</button>`).join("")}
      </div>
    `;
  }

  function renderShootProductBar(tasks) {
    const products = selectedShootProducts(tasks);
    if (!products.length) return "";
    return `
      <article class="card pad shoot-product-bar" aria-label="今日要拍产品">
        <div class="shoot-product-head">
          <p class="mini-title">今日拍摄物料总览</p>
          <h3>今日要拍产品</h3>
          <p class="task-copy">开拍前核对今天要准备的茶饮/套餐。</p>
        </div>
        <div class="shoot-product-chips">
          ${products.map((item) => `
            <span class="shoot-product-chip">
              <strong>${escapeHtml(item.product)}</strong>
              <em>${item.days.map((day) => `Day ${day}`).join(" / ")}</em>
            </span>
          `).join("")}
        </div>
      </article>
    `;
  }

  function renderShootPlan() {
    const plan = currentTodayShootPlan();
    const selected = new Set(plan.selectedDays);
    const selectedTasks = selectedShootTasks();
    const totalShots = selectedTasks.reduce((sum, task) => sum + (task.imagePlan?.length || 0), 0);
    const doneShots = selectedTasks.reduce((sum, task) => sum + shotProgress(task.day).done, 0);
    const summary = `
      <article class="card pad shoot-summary">
        <div>
          <p class="mini-title">团队共享 · ${escapeHtml(plan.date)}</p>
          <h3>今日共 ${selectedTasks.length} 个选题，${doneShots}/${totalShots} 张已拍</h3>
          <div class="progress-track"><div class="progress-bar" style="--progress:${totalShots ? Math.round((doneShots / totalShots) * 100) : 0}%"></div></div>
        </div>
        <div class="pill-row">
          <span class="pill">5 秒近实时同步</span>
          <span class="pill">${shootStep === "select" ? "第 1 步：选择选题" : "第 2 步：执行拍摄"}</span>
        </div>
      </article>
    `;
    const selectionPanel = `
      <article class="card pad">
        <div class="section-head">
          <div>
            <h3>选择今日选题</h3>
            <p class="task-copy">勾选今天准备一起拍的日历选题，同事登录后会看到同一份计划。</p>
          </div>
        </div>
        <div class="shoot-day-grid">
          ${taskSource().map((task) => {
            const progress = shotProgress(task.day);
            return `
              <label class="shoot-day-option ${selected.has(task.day) ? "selected" : ""}">
                <input type="checkbox" data-shoot-day="${task.day}" ${selected.has(task.day) ? "checked" : ""} />
                <span>
                  <strong>Day ${task.day} · ${escapeHtml(task.theme)}</strong>
                  <small>${escapeHtml(task.highClickTitle || task.title)}</small>
                  <small>产品：${escapeHtml(task.mainProduct || task.product)}</small>
                  <em>${progress.done}/${progress.total} 已拍</em>
                </span>
              </label>
            `;
          }).join("")}
        </div>
      </article>
    `;
    if (shootStep === "select") {
      return `
        <div class="shoot-dashboard">
          ${summary}
          ${renderShootProductBar(selectedTasks)}
          ${selectionPanel}
          <article class="card pad shoot-step-actions">
            <div>
              <h3>生成今日拍摄执行页</h3>
              <p class="task-copy">确认后按选题顺序拍摄；如果当前图片和后续选题相似，会在图片下方提醒顺手补拍。</p>
            </div>
            <button class="btn" data-action="confirm-shoot-plan">下一步开始拍摄</button>
            <span class="task-copy">已选 ${selectedTasks.length} 个选题 · ${totalShots} 张配图建议</span>
          </article>
        </div>
      `;
    }

    return `
      <div class="shoot-dashboard">
        ${summary}
        ${renderShootProductBar(selectedTasks)}
        <article class="card pad shoot-step-nav">
          <div>
            <h3>今日拍摄执行页</h3>
            <p class="task-copy">按选题顺序拍摄；每类顺手补拍只提醒一次，避免重复干扰判断。</p>
          </div>
          <button class="ghost-btn" data-action="back-shoot-select">返回修改选题</button>
        </article>

        <article class="card pad">
          <div class="section-head">
            <div>
              <h3>按选题拍摄</h3>
              <p class="task-copy">未拍图片优先显示；相似场景只作为顺手补拍提醒，不会自动标记后续图片已拍，同类提醒在每个选题内只显示一次。</p>
            </div>
          </div>
          <div class="shoot-task-list">
            ${selectedTasks.length ? selectedTasks.map(renderShootTaskGroup).join("") : `<div class="empty">先勾选今日要拍摄的选题。</div>`}
          </div>
        </article>
      </div>
    `;
  }

  function renderShootingPackageCard(pack, index) {
    return `
      <section class="shoot-package-card" data-tone="${pack.tone}">
        <div class="package-head">
          <span class="package-rank">优先拍 ${index + 1}</span>
          <div>
            <p class="mini-title">${escapeHtml(pack.label)}</p>
            <h3>${escapeHtml(pack.actionTitle)}</h3>
          </div>
          <span class="status-pill">覆盖 ${pack.dayCount} 个选题 / ${pack.shotCount} 张图</span>
        </div>
        <p class="package-instruction">${escapeHtml(pack.instruction)}</p>
        <div class="package-cover-list">
          ${pack.byDay.map((dayGroup) => `
            <div class="package-day-block">
              <strong>Day ${dayGroup.task.day}｜${escapeHtml(dayGroup.task.theme)}</strong>
              <ul>
                ${dayGroup.items.map((item) => `
                  <li>
                    <span>图 ${item.index + 1}</span>
                    <em>${escapeHtml(item.summary)}</em>
                  </li>
                `).join("")}
              </ul>
            </div>
          `).join("")}
        </div>
        ${pack.supplemental.length ? `
          <div class="package-extra">
            <strong>仍需单独补拍</strong>
            <p>${pack.supplemental.slice(0, 4).map((item) => `Day ${item.task.day} 图 ${item.index + 1}：${shotSummaryText(item.text)}`).join(" / ")}</p>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderShootTaskGroup(task) {
    const progress = shotProgress(task.day);
    const entries = (task.imagePlan || []).map((item, index) => ({ item, index, done: isShotDone(task.day, index) }));
    const pending = entries.filter((entry) => !entry.done);
    const done = entries.filter((entry) => entry.done);
    const shownSuggestionTypes = new Set();
    const pendingHtml = pending.map(({ item, index }) => {
      const typeLabel = classifyShot(item, task).label;
      const showSideQuest = !shownSuggestionTypes.has(typeLabel);
      if (showSideQuest) shownSuggestionTypes.add(typeLabel);
      return renderShootShotCard(task, item, index, { showSideQuest });
    }).join("");
    return `
      <section class="shoot-task-group" data-day="${task.day}">
        <div class="shoot-task-head">
          <div>
            <div class="shoot-task-kicker">
              <span>Day ${task.day}</span>
              <em>${escapeHtml(task.contentType || task.category)}</em>
            </div>
            <h3>${escapeHtml(task.theme)}</h3>
            <p class="task-copy">${escapeHtml(task.highClickTitle || task.title)}</p>
            <div class="pill-row shoot-task-products">
              <span class="pill">产品：${escapeHtml(task.mainProduct || task.product)}</span>
            </div>
          </div>
          <span class="status-pill">${progress.done}/${progress.total} 已拍</span>
        </div>
        <div class="progress-track"><div class="progress-bar" style="--progress:${progress.percent}%"></div></div>
        <div class="shoot-shot-list">
          ${pendingHtml || `<div class="empty">这个选题的图片都已标记完成。</div>`}
        </div>
        ${done.length ? `
          <details class="done-shot-panel">
            <summary>已拍 ${done.length} 张</summary>
            <div class="shoot-shot-list done">
              ${done.map(({ item, index }) => renderShotButton(task, item, index, { showDay: true, compact: true })).join("")}
            </div>
          </details>
        ` : ""}
      </section>
    `;
  }

  function renderShootShotCard(task, item, index, options = {}) {
    const shotType = classifyShot(item, task);
    const suggestions = options.showSideQuest === false ? [] : sideQuestSuggestions(task, index, item);
    return `
      <div class="shoot-shot-card">
        ${renderShotButton(task, item, index, { showDay: true, compact: true })}
        ${suggestions.length ? `
          <div class="side-quest" data-tone="${shotType.tone}">
            <div class="side-quest-head">
              <strong>顺手补拍</strong>
              <span>${escapeHtml(shotType.label)}</span>
            </div>
            <p>${escapeHtml(sideQuestInstruction(shotType.label))}</p>
            <ul>
              ${suggestions.map((suggestion) => `
                <li>
                  <span>Day ${suggestion.day} 图 ${suggestion.index + 1}</span>
                  <em>${escapeHtml(suggestion.theme)}｜${escapeHtml(suggestion.summary)}</em>
                </li>
              `).join("")}
            </ul>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderCalendar() {
    const categories = ["全部内容", ...new Set(taskSource().map((task) => task.contentType || task.category))];
    const products = [
      "全部茶饮",
      ...productSource().map((product) => product.name),
      "任意茶饮",
      "任意最上镜茶饮",
      "7 款茶饮",
      "三档套餐",
    ];
    const tasks = taskSource().filter((task) => {
      const status = getStatus(task.day);
      const weekOk = filters.week === "全部周" || campaignWeek(task.day) === Number(filters.week);
      const categoryOk = filters.category === "全部内容" || (task.contentType || task.category) === filters.category;
      const statusOk = filters.status === "全部状态" || status === filters.status;
      const productOk = filters.product === "全部茶饮" || (task.mainProduct || task.product).includes(filters.product);
      return weekOk && categoryOk && statusOk && productOk;
    });
    const hasActiveFilters = filters.week !== "全部周"
      || filters.category !== "全部内容"
      || filters.status !== "全部状态"
      || filters.product !== "全部茶饮";
    const filterOpen = !isCompactViewport() || hasActiveFilters;
    return `
      <details class="filter-panel" ${filterOpen ? "open" : ""}>
        <summary>
          <span>筛选内容日历</span>
          <span class="status-pill">共 ${tasks.length} 天</span>
        </summary>
        <div class="calendar-tools">
          <select class="field" data-filter="week">
            <option value="全部周" ${filters.week === "全部周" ? "selected" : ""}>全部周</option>
            <option value="1" ${filters.week === "1" ? "selected" : ""}>第 1 周</option>
            <option value="2" ${filters.week === "2" ? "selected" : ""}>第 2 周</option>
            <option value="3" ${filters.week === "3" ? "selected" : ""}>第 3 周</option>
            <option value="4" ${filters.week === "4" ? "selected" : ""}>第 4 周</option>
          </select>
          <select class="field" data-filter="category">
            ${categories.map((item) => `<option value="${item}" ${filters.category === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
          <select class="field" data-filter="status">
            <option value="全部状态" ${filters.status === "全部状态" ? "selected" : ""}>全部状态</option>
            ${DATA.STATUSES.map((item) => `<option value="${item}" ${filters.status === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
          <select class="field" data-filter="product">
            ${products.map((item) => `<option value="${item}" ${filters.product === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
          <button class="ghost-btn" data-action="reset-filters">重置筛选</button>
        </div>
      </details>
      <div class="calendar-grid">
        ${tasks.length ? tasks.map(renderTaskCard).join("") : `<div class="empty">没有符合当前筛选条件的任务。</div>`}
      </div>
    `;
  }

  function isCompactViewport() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
  }

  function renderTaskCard(task) {
    const status = getStatus(task.day);
    const isToday = task.day === currentDay();
    return `
      <article class="task-card ${isToday ? "today" : ""}" data-status="${status}">
        <div class="task-meta">
          <span>Day ${task.day} · 第 ${campaignWeek(task.day)} 周 · ${formatDate(dateForDay(task.day))}</span>
          <span class="status-pill" data-status="${status}">${status}</span>
        </div>
        <div>
          <h3>${escapeHtml(task.theme)}</h3>
          <p class="task-copy">${escapeHtml(task.highClickTitle || task.title)}</p>
        </div>
        <div class="pill-row">
          <span class="pill">${task.contentType || task.category}</span>
          <span class="pill">${task.mainProduct || task.product}</span>
        </div>
        <div class="calendar-cover-note">${infoBlock("封面短文案", task.coverText || "未设置")}</div>
        <div class="card-actions">
          <select class="status-select" data-status-select="${task.day}" data-status="${status}">
            ${DATA.STATUSES.map((statusName) => `<option value="${statusName}" ${statusName === status ? "selected" : ""}>${statusName}</option>`).join("")}
          </select>
          <button class="ghost-btn" data-edit-task="${task.day}">编辑</button>
          <button class="ghost-btn" data-open-day="${task.day}">详情</button>
        </div>
      </article>
    `;
  }

  function renderKanban() {
    return `
      <div class="mobile-kanban-list">
        ${DATA.STATUSES.map((status) => {
          const tasks = taskSource().filter((task) => getStatus(task.day) === status);
          return `
            <details class="card pad kanban-mobile-group" ${tasks.length ? "open" : ""}>
              <summary>
                <span>${status}</span>
                <span class="status-pill">${tasks.length}</span>
              </summary>
              <div class="kanban-mobile-cards">
                ${tasks.length ? tasks.map(renderKanbanCard).join("") : `<div class="empty">暂无任务</div>`}
              </div>
            </details>
          `;
        }).join("")}
      </div>
      <div class="kanban desktop-kanban">
        ${DATA.STATUSES.map((status) => {
          const tasks = taskSource().filter((task) => getStatus(task.day) === status);
          return `
            <section class="kanban-col">
              <h3>${status} · ${tasks.length}</h3>
              ${tasks.length ? tasks.map(renderKanbanCard).join("") : `<div class="empty">暂无任务</div>`}
            </section>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderKanbanCard(task) {
    const status = getStatus(task.day);
    return `
      <article class="kanban-card" data-status="${status}">
        <span class="mini-title">Day ${task.day} · ${isoForDay(task.day)}</span>
        <span class="status-pill" data-status="${status}">${status}</span>
        <strong>${escapeHtml(task.theme)}</strong>
        <span>${escapeHtml(task.highClickTitle || task.title)}</span>
        <div class="pill-row">
          <span class="pill">${task.contentType || task.category}</span>
          <span class="pill">${task.mainProduct || task.product}</span>
        </div>
        <button class="ghost-btn" data-open-day="${task.day}">进入详情</button>
      </article>
    `;
  }

  function renderProducts() {
    return `
      <div class="grid cols-4">
        ${productSource().map((product, index) => `
          <article class="card product-card">
            <div class="product-swatch" style="--tone:${product.tone}"></div>
            <div class="product-body">
              <div>
                <h3>${escapeHtml(product.name)}</h3>
                <p class="mini-title">${escapeHtml(product.type)} · 封面：${product.coverFit}</p>
              </div>
              <p class="task-copy">${escapeHtml(product.role)}</p>
              <div>
                <p class="mini-title">画面关键词</p>
                <div class="pill-row">${product.imageKeywords.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}</div>
              </div>
              <div>
                <p class="mini-title">适合主题</p>
                <div class="pill-row">${product.themes.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}</div>
              </div>
              <p class="task-copy">${escapeHtml(product.note)}</p>
              <button class="ghost-btn" data-edit-product="${index}">编辑产品</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderAnalytics() {
    const m = metrics();
    const publishedByCategory = Object.fromEntries([...new Set(taskSource().map((task) => task.contentType || task.category))].map((item) => [item, 0]));
    taskSource().forEach((task) => {
      if (isPublished(getStatus(task.day))) publishedByCategory[task.contentType || task.category] += 1;
    });
    return `
      <div class="grid cols-4">
        ${statCard("发文完成率", `${m.progress}%`, "已发布 + 已复盘 / 30", m.progress)}
        ${statCard("累计曝光", `${m.totals.impressions}`, "手动复盘汇总")}
        ${statCard("累计阅读", `${m.totals.reads}`, "手动复盘汇总")}
        ${statCard("累计收藏", `${m.totals.saves}`, "手动复盘汇总")}
        ${statCard("累计点赞", `${m.totals.likes}`, "手动复盘汇总")}
        ${statCard("累计评论", `${m.totals.comments}`, "手动复盘汇总")}
        ${statCard("累计私信", `${m.totals.messages}`, "手动复盘汇总")}
        ${statCard("累计到店桌数", `${m.totals.visits}`, "手动复盘汇总")}
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        ${renderConversionRisk()}
        <article class="card pad">
          <h3 style="margin-top:0">各内容分类发布数量</h3>
          ${barChart(publishedByCategory)}
        </article>
        <article class="card pad">
          <h3 style="margin-top:0">各状态任务数量</h3>
          ${barChart(m.statusCounts)}
        </article>
        <article class="card pad wide-card">
          <h3 style="margin-top:0">内容分类表现对比</h3>
          ${categoryPerformanceTable()}
        </article>
        <article class="card pad">
          <h3 style="margin-top:0">收藏最高前 5 篇</h3>
          ${rankList("saves")}
        </article>
        <article class="card pad">
          <h3 style="margin-top:0">私信/预约最高前 5 篇</h3>
          ${rankList("conversion")}
        </article>
      </div>
    `;
  }

  function renderConversionRisk() {
    const risky = conversionRiskRows();
    if (!risky.length) return "";
    return `
      <article class="risk-card wide-card">
        <strong>私信高但预约低：需要优化承接话术</strong>
        <p>这些笔记已经带来咨询，但预约转化偏低。建议检查私信首轮回复、人数套餐说明、位置/时间确认是否清晰。</p>
        <div class="pill-row">
          ${risky.map((row) => `<button class="status-btn" data-open-day="${row.task.day}">Day ${row.task.day} · 私信 ${row.messages} / 预约 ${row.bookings}</button>`).join("")}
        </div>
      </article>
    `;
  }

  function conversionRiskRows() {
    return taskSource()
      .map((task) => {
        const review = getReview(task.day);
        const messages = toNumber(review.messages);
        const bookings = toNumber(review.bookings);
        return { task, messages, bookings };
      })
      .filter((row) => row.messages >= 5 && row.bookings <= Math.floor(row.messages * 0.25))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 5);
  }

  function categoryPerformance() {
    const stats = Object.fromEntries([...new Set(taskSource().map((task) => task.contentType || task.category))].map((category) => [
      category,
      { posts: 0, saves: 0, messages: 0, bookings: 0 },
    ]));
    taskSource().forEach((task) => {
      const review = getReview(task.day);
      const row = stats[task.contentType || task.category];
      row.posts += 1;
      row.saves += toNumber(review.saves);
      row.messages += toNumber(review.messages);
      row.bookings += toNumber(review.bookings);
    });
    return Object.entries(stats).map(([category, row]) => ({
      category,
      posts: row.posts,
      avgSaves: row.posts ? row.saves / row.posts : 0,
      avgMessages: row.posts ? row.messages / row.posts : 0,
      bookings: row.bookings,
    }));
  }

  function categoryPerformanceTable() {
    const rows = categoryPerformance();
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>内容分类</th>
              <th>篇数</th>
              <th>平均收藏</th>
              <th>平均私信</th>
              <th>预约数</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.category)}</td>
                <td>${row.posts}</td>
                <td>${row.avgSaves.toFixed(1)}</td>
                <td>${row.avgMessages.toFixed(1)}</td>
                <td>${row.bookings}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function barChart(items) {
    const values = Object.values(items);
    const max = Math.max(1, ...values);
    return `
      <div class="bar-chart">
        ${Object.entries(items).map(([label, value]) => `
          <div class="bar-row">
            <span>${escapeHtml(label)}</span>
            <div class="bar-bg"><div class="bar-fill" style="--width:${Math.round((value / max) * 100)}%"></div></div>
            <strong>${value}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function rankList(kind) {
    const rows = taskSource()
      .map((task) => {
        const review = getReview(task.day);
        const score = kind === "saves"
          ? toNumber(review.saves)
          : toNumber(review.messages) + toNumber(review.bookings);
        return { task, score, review };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!rows.length) return `<div class="empty">还没有复盘数据，填写每日复盘后这里会自动排序。</div>`;
    return `
      <ol class="rank-list">
        ${rows.map((row) => `
          <li>
            <strong>Day ${row.task.day} · ${escapeHtml(row.task.theme)}</strong>
            <p class="task-copy">${escapeHtml(row.task.title)}</p>
            <span class="status-pill">数值 ${row.score}</span>
          </li>
        `).join("")}
      </ol>
    `;
  }

  function renderWeekly() {
    return `
      <div class="grid cols-2">
        ${[1, 2, 3, 4].map(renderWeekReviewCard).join("")}
      </div>
    `;
  }

  function renderWeekReviewCard(week) {
    const tasks = taskSource().filter((task) => campaignWeek(task.day) === week);
    const published = tasks.filter((task) => isPublished(getStatus(task.day))).length;
    const reviewed = tasks.filter((task) => isReviewed(getStatus(task.day))).length;
    const totals = tasks.reduce((acc, task) => {
      const review = getReview(task.day);
      acc.saves += toNumber(review.saves);
      acc.messages += toNumber(review.messages);
      acc.bookings += toNumber(review.bookings);
      acc.visits += toNumber(review.visits);
      acc.impressions += toNumber(review.impressions);
      acc.reads += toNumber(review.reads);
      return acc;
    }, { saves: 0, messages: 0, bookings: 0, visits: 0, impressions: 0, reads: 0 });
    const top = tasks
      .map((task) => ({ task, saves: toNumber(getReview(task.day).saves), messages: toNumber(getReview(task.day).messages) }))
      .sort((a, b) => (b.saves + b.messages) - (a.saves + a.messages))[0];
    return `
      <article class="card pad week-card">
        <div class="task-meta">
          <span>第 ${week} 周 · Day ${tasks[0].day}-${tasks[tasks.length - 1].day}</span>
          <span class="status-pill">${published}/${tasks.length} 已发布</span>
        </div>
        <h3>周复盘</h3>
        <div class="progress-track"><div class="progress-bar" style="--progress:${Math.round((published / tasks.length) * 100)}%"></div></div>
        <div class="week-metrics">
          ${miniMetric("已复盘", reviewed)}
          ${miniMetric("曝光", totals.impressions)}
          ${miniMetric("阅读", totals.reads)}
          ${miniMetric("收藏", totals.saves)}
          ${miniMetric("私信", totals.messages)}
          ${miniMetric("预约", totals.bookings)}
          ${miniMetric("到店桌数", totals.visits)}
        </div>
        <div>
          <p class="mini-title">本周任务</p>
          <div class="week-task-list">
            ${tasks.map((task) => `<button class="status-btn" data-open-day="${task.day}">Day ${task.day} · ${escapeHtml(task.theme)} · ${getStatus(task.day)}</button>`).join("")}
          </div>
        </div>
        <div class="empty">
          ${top && (top.saves || top.messages)
            ? `本周重点关注：Day ${top.task.day}「${escapeHtml(top.task.theme)}」，收藏 ${top.saves}，私信 ${top.messages}。`
            : "暂无复盘数据，发布后可在每日详情中补充数据。"}
        </div>
      </article>
    `;
  }

  function miniMetric(label, value) {
    return `<span><strong>${value}</strong>${label}</span>`;
  }

  function renderLibrary() {
    return `
      <div class="library grid">
        ${renderDataManagementCard()}
        ${librarySource().map((item, index) => `
          <details>
            <summary><span>${escapeHtml(item.title)}</span><button class="ghost-btn" type="button" data-edit-library="${index}">编辑资料</button></summary>
            <div class="library-content">${item.html}</div>
          </details>
        `).join("")}
      </div>
    `;
  }

  function renderDataManagementCard() {
    return `
      <article class="card pad data-management">
        <div class="section-head">
          <div>
            <h3>数据管理</h3>
            <p class="task-copy">平时会自动读取和保存到线上。这里保留 JSON 导出/导入，方便备份，或交给 Claude 优化文案后再导入。</p>
          </div>
          <div class="notice-actions">
            <button class="btn" data-action="export">导出 JSON</button>
            <button class="ghost-btn" data-action="import">导入 JSON</button>
            <button class="ghost-btn" data-action="backup-now">线上备份</button>
            <button class="ghost-btn" data-action="logout">退出访问</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderShotButton(task, item, index, options = {}) {
    const isDone = isShotDone(task.day, index);
    return `
      <button
        class="shot-item ${options.compact ? "compact-shot" : ""}"
        type="button"
        data-shot-toggle
        data-day="${task.day}"
        data-shot-index="${index}"
        data-shot-done="${isDone ? "true" : "false"}"
        aria-pressed="${isDone ? "true" : "false"}"
        aria-label="Day ${task.day} 图 ${index + 1}，${isDone ? "已拍，点击撤销" : "未拍，点击标记已拍"}"
      >
        ${isDone ? `<span class="shot-done-badge">已拍</span>` : `<span class="shot-hint">点击标记已拍</span>`}
        <p class="mini-title">${options.showDay ? `Day ${task.day} · 图 ${index + 1}` : `图 ${index + 1}`}</p>
        ${options.showTitle ? `<strong class="shot-topic">${escapeHtml(task.theme)}</strong>` : ""}
        <p class="task-copy">${escapeHtml(item)}</p>
      </button>
    `;
  }

  function openDetail(day) {
    state.currentDay = Number(day);
    saveState({ skipCloudSave: true });
    const task = getTask(day);
    const status = getStatus(day);
    const review = getReview(day);
    const checks = state.checks[day] || {};
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <aside class="modal" role="dialog" aria-modal="true" aria-label="Day ${task.day} 详情" data-modal-panel>
          <div class="modal-head">
            <div>
              <span class="status-pill" data-status="${status}">${status}</span>
              <h2>Day ${task.day} · ${escapeHtml(task.theme)}</h2>
              <p class="page-subtitle">${escapeHtml(task.highClickTitle || task.title)}</p>
            </div>
            <div class="modal-actions">
              <button class="ghost-btn" data-edit-task="${task.day}">编辑内容</button>
              <button class="ghost-btn" data-close-modal>关闭</button>
            </div>
          </div>
          <div class="modal-status-row" data-status="${status}">
            <label>
              <span>当前状态</span>
              <select class="status-select" data-status-select="${task.day}" data-status="${status}">
                ${DATA.STATUSES.map((statusName) => `<option value="${statusName}" ${statusName === status ? "selected" : ""}>${statusName}</option>`).join("")}
              </select>
            </label>
            <div class="pill-row">
              ${DATA.STATUSES.map((statusName) => `<button class="status-btn" data-status-set="${statusName}" data-day="${task.day}" data-status="${statusName}">${statusName}</button>`).join("")}
            </div>
          </div>
          <div class="modal-body">
            <details class="card pad detail-accordion detail-execute" open>
              <summary>执行信息</summary>
              <div class="accordion-body">
                <div class="section-head">
                  <h3>一、核心信息</h3>
                  <button class="ghost-btn" data-copy="copy" data-day="${task.day}">复制发布文案模板</button>
                </div>
                <div class="detail-grid">
                  ${infoBlock("Day", `Day ${task.day}`)}
                  ${infoBlock("内容类型", task.contentType || task.rawType || task.category)}
                  ${infoBlock("主题", task.topic || task.theme)}
                  ${infoBlock("主推产品", task.mainProduct || task.product)}
                  ${infoBlock("高点击率标题", task.highClickTitle || task.title)}
                  ${infoBlock("封面短文案", task.coverText || "未设置")}
                </div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>文案标题</summary>
              <div class="accordion-body">
                <div class="section-head">
                  <h3>二、标题策略</h3>
                </div>
                <div class="detail-grid">
                  ${infoBlock("标题方向建议", task.titleDirection || openingDirection(task))}
                  ${infoBlock("标题为什么这样写", task.titleReason || "沿用原始标题策略。")}
                </div>
                <div style="margin-top:14px">
                  <p class="mini-title">备选标题</p>
                  <div class="quick-list compact-list">
                    ${(task.altTitles || []).map((title) => `<div>${escapeHtml(title)}</div>`).join("") || `<div>未设置</div>`}
                  </div>
                </div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>完整正文</summary>
              <div class="accordion-body">
                <div class="section-head">
                  <h3>三、完整正文</h3>
                  <button class="ghost-btn" data-copy="body" data-day="${task.day}">复制正文</button>
                </div>
                <div class="body-copy-box">${formatMultiline(task.bodyCopy || publishTemplate(task))}</div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>摄影清单</summary>
              <div class="accordion-body">
                <div class="section-head">
                  <h3>四、图文配图建议</h3>
                  <button class="ghost-btn" data-copy="shooting" data-day="${task.day}">复制拍摄清单</button>
                </div>
                <div class="image-plan-list">
                  ${(task.imagePlan || []).map((item, index) => renderShotButton(task, item, index)).join("")}
                </div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>标签与运营判断</summary>
              <div class="accordion-body">
                <div class="section-head">
                  <h3>五、标签</h3>
                  <button class="ghost-btn" data-copy="tags" data-day="${task.day}">复制标签</button>
                </div>
                <div class="pill-row">${(task.tags || []).map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}</div>
                <h3>六、运营判断</h3>
                <div class="detail-grid">
                  ${infoBlock("标签 SEO 原因", task.seoReason || "未设置")}
                  ${infoBlock("文案理由", task.copyReason || "未设置")}
                  ${infoBlock("运营判断点", task.operationJudge || task.conversion || "未设置")}
                </div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>发布检查</summary>
              <div class="accordion-body">
                <h3 style="margin-top:0">C. 发布检查</h3>
                <div class="checklist">
                  ${DATA.checklist.map((label) => `
                    <label class="check-item">
                      <input type="checkbox" data-check="${escapeHtml(label)}" data-day="${task.day}" ${checks[label] ? "checked" : ""} />
                      <span>${escapeHtml(label)}</span>
                    </label>
                  `).join("")}
                </div>
              </div>
            </details>

            <details class="card pad detail-accordion" open>
              <summary>数据复盘</summary>
              <div class="accordion-body">
                <h3 style="margin-top:0">D. 数据复盘</h3>
                <div class="review-grid">
                  ${REVIEW_FIELDS.map(([key, label, type]) => `
                    <label>
                      ${label}
                      <input class="detail-input" type="${type}" value="${escapeHtml(review[key] ?? "")}" data-review="${key}" data-review-type="${type}" data-day="${task.day}" />
                    </label>
                  `).join("")}
                </div>
                <div class="grid cols-2" style="margin-top:12px">
                  <label class="text-field">用户主要问题
                    <textarea class="detail-textarea" data-review="userQuestions" data-review-type="text" data-day="${task.day}">${escapeHtml(review.userQuestions || "")}</textarea>
                  </label>
                  <label class="text-field">复盘备注
                    <textarea class="detail-textarea" data-review="notes" data-review-type="text" data-day="${task.day}">${escapeHtml(review.notes || "")}</textarea>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </aside>
      </div>
    `;
  }

  function openTaskEditor(day) {
    const task = getTask(day);
    const categories = [...new Set(taskSource().map((item) => item.contentType || item.category))];
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <aside class="modal" role="dialog" aria-modal="true" aria-label="编辑 Day ${task.day}" data-modal-panel>
          <div class="modal-head">
            <div>
              <span class="status-pill">可视化编辑</span>
              <h2>编辑 Day ${task.day} · ${escapeHtml(task.theme)}</h2>
              <p class="page-subtitle">保存后会覆盖当前页面展示，但不会删除原始 Markdown 策略。</p>
            </div>
            <button class="ghost-btn" data-close-modal>关闭</button>
          </div>
          <form class="modal-body edit-form" data-edit-form="task" data-day="${task.day}">
            <article class="card pad">
              <h3 style="margin-top:0">基础内容</h3>
              <div class="review-grid">
                ${editField("topic", "主题", task.topic || task.theme)}
                ${editField("highClickTitle", "高点击率标题", task.highClickTitle || task.title)}
                ${editField("coverText", "封面短文案", task.coverText || "")}
                <label>内容分类
                  <select class="detail-input" data-edit-field="contentType">
                    ${categories.map((category) => `<option value="${category}" ${(task.contentType || task.category) === category ? "selected" : ""}>${category}</option>`).join("")}
                  </select>
                </label>
                ${editField("mainProduct", "主推产品", task.mainProduct || task.product)}
              </div>
            </article>
            <article class="card pad">
              <h3 style="margin-top:0">标题与正文</h3>
              <div class="grid cols-2">
                ${editTextarea("titleDirection", "标题方向建议", task.titleDirection || "")}
                ${editTextarea("titleReason", "标题为什么这样写", task.titleReason || "")}
                ${editTextarea("altTitles", "备选标题（一行一个）", editText(task.altTitles))}
                ${editTextarea("bodyCopy", "可直接发布正文", task.bodyCopy || "")}
              </div>
            </article>
            <article class="card pad">
              <h3 style="margin-top:0">配图、标签与运营判断</h3>
              <div class="grid cols-2">
                ${editTextarea("imagePlan", "图文配图建议（一行一图）", editText(task.imagePlan))}
                ${editTextarea("tags", "话题标签（一行一个）", editText(task.tags))}
                ${editTextarea("seoReason", "标签 SEO 原因", task.seoReason || "")}
                ${editTextarea("copyReason", "文案理由", task.copyReason || "")}
                ${editTextarea("operationJudge", "运营判断点", task.operationJudge || "")}
              </div>
            </article>
            <div class="edit-actions">
              <button class="btn" type="submit">保存编辑</button>
              <button class="ghost-btn" type="button" data-reset-task="${task.day}">恢复原始内容</button>
              <button class="ghost-btn" type="button" data-open-day="${task.day}">返回详情</button>
            </div>
          </form>
        </aside>
      </div>
    `;
  }

  function openProductEditor(index) {
    const product = getProduct(index);
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <aside class="modal" role="dialog" aria-modal="true" aria-label="编辑产品" data-modal-panel>
          <div class="modal-head">
            <div>
              <span class="status-pill">产品库编辑</span>
              <h2>编辑 ${escapeHtml(product.name)}</h2>
              <p class="page-subtitle">用于调整产品卡片、拍摄关键词和适合主题。</p>
            </div>
            <button class="ghost-btn" data-close-modal>关闭</button>
          </div>
          <form class="modal-body edit-form" data-edit-form="product" data-index="${index}">
            <article class="card pad">
              <div class="review-grid">
                ${editField("name", "产品名", product.name)}
                ${editField("type", "茶饮类型", product.type)}
                ${editField("coverFit", "是否适合做封面", product.coverFit)}
                ${editField("tone", "色块颜色", product.tone)}
              </div>
              <div class="grid cols-2" style="margin-top:12px">
                ${editTextarea("role", "内容角色", product.role)}
                ${editTextarea("note", "备注", product.note)}
                ${editTextarea("imageKeywords", "画面关键词（一行一个）", editText(product.imageKeywords))}
                ${editTextarea("themes", "适合主题（一行一个）", editText(product.themes))}
              </div>
            </article>
            <div class="edit-actions">
              <button class="btn" type="submit">保存产品</button>
              <button class="ghost-btn" type="button" data-reset-product="${index}">恢复原始产品</button>
              <button class="ghost-btn" type="button" data-close-modal>关闭</button>
            </div>
          </form>
        </aside>
      </div>
    `;
  }

  function openLibraryEditor(index) {
    const item = getLibraryItem(index);
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close-modal>
        <aside class="modal" role="dialog" aria-modal="true" aria-label="编辑资料库" data-modal-panel>
          <div class="modal-head">
            <div>
              <span class="status-pill">资料库编辑</span>
              <h2>编辑 ${escapeHtml(item.title)}</h2>
              <p class="page-subtitle">可以直接写普通文字；如果需要列表或加粗，也可以保留简单 HTML。</p>
            </div>
            <button class="ghost-btn" data-close-modal>关闭</button>
          </div>
          <form class="modal-body edit-form" data-edit-form="library" data-index="${index}">
            <article class="card pad">
              ${editField("title", "资料标题", item.title)}
              <div style="margin-top:12px">
                ${editTextarea("html", "资料内容", item.html)}
              </div>
            </article>
            <div class="edit-actions">
              <button class="btn" type="submit">保存资料</button>
              <button class="ghost-btn" type="button" data-reset-library="${index}">恢复原始资料</button>
              <button class="ghost-btn" type="button" data-close-modal>关闭</button>
            </div>
          </form>
        </aside>
      </div>
    `;
  }

  function editField(name, label, value) {
    return `
      <label>${label}
        <input class="detail-input" type="text" value="${escapeHtml(value)}" data-edit-field="${name}" />
      </label>
    `;
  }

  function editTextarea(name, label, value) {
    return `
      <label class="text-field">${label}
        <textarea class="detail-textarea edit-textarea" data-edit-field="${name}">${escapeHtml(value)}</textarea>
      </label>
    `;
  }

  function formValues(form) {
    const values = {};
    form.querySelectorAll("[data-edit-field]").forEach((field) => {
      values[field.dataset.editField] = field.value;
    });
    return values;
  }

  function normalizeTaskValues(values) {
    return {
      ...values,
      title: values.highClickTitle || values.title,
      theme: values.topic || values.theme,
      product: values.mainProduct || values.product,
      rawType: values.contentType || values.rawType,
      keywords: splitLines(values.keywords),
      tags: splitLines(values.tags),
      altTitles: splitRows(values.altTitles),
      imagePlan: splitRows(values.imagePlan),
    };
  }

  function normalizeProductValues(values) {
    return {
      ...values,
      imageKeywords: splitLines(values.imageKeywords),
      themes: splitLines(values.themes),
    };
  }

  function normalizeLibraryValues(values) {
    const html = String(values.html || "").trim();
    return {
      ...values,
      html: html.includes("<")
        ? html
        : html.split(/\n{2,}/).map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br />")}</p>`).join(""),
    };
  }

  function openingDirection(task) {
    if (task.category === "斑竹林半日游攻略") return "先回答“在哪里、怎么安排半日游、为什么值得顺路坐下”。";
    if (task.category === "工作日安静理由") return "先把工作日人少转成安静、好拍、不赶时间的理由。";
    if (task.category === "拍照机位") return "直接给可收藏的拍照动作或场景，不写空泛文艺句。";
    if (task.category === "主理人故事") return "用“我们/今天/这几天”的真实口吻开头，建立人感。";
    if (task.category === "茶饮茶点体验") return "先说明适合几个人、怎么喝、怎么搭配，避免菜单堆砌。";
    return "先讲清“成都周边也有一处松弛小院”的核心印象。";
  }

  function customShot(task, title, fallback) {
    const product = `本篇主推：${task.product}。`;
    if (title === "封面图") return `${task.shootingTask}；优先选择有人、有茶、有环境的画面。`;
    if (title === "茶饮图") return `${product} 拍清茶汤、杯型、手部动作和场景关系。`;
    if (title === "功能说明图") return `围绕“${task.conversion}”做一张路线、预约、人数或工作日说明图。`;
    return fallback;
  }

  function publishTemplate(task) {
    return [
      `Day ${task.day}｜${task.theme}`,
      `高点击率标题：${task.highClickTitle || task.title}`,
      `封面短文案：${task.coverText || ""}`,
      "",
      `标题方向建议：${task.titleDirection || openingDirection(task)}`,
      `标题理由：${task.titleReason || ""}`,
      "",
      task.bodyCopy || "",
      "",
      `话题标签：${task.tags.join(" ")}`,
    ].join("\n");
  }

  function shootingTemplate(task) {
    return [
      `Day ${task.day}｜${task.theme}`,
      `高点击率标题：${task.highClickTitle || task.title}`,
      `推荐茶饮：${task.mainProduct || task.product}`,
      "",
      ...(task.imagePlan?.length ? task.imagePlan.map((item, index) => `图${index + 1}：${item}`) : DATA.shotStructure.map(([title, body]) => `${title}：${customShot(task, title, body)}`)),
    ].join("\n");
  }

  function bodyTemplate(task) {
    return task.bodyCopy || publishTemplate(task);
  }

  function tagsTemplate(task) {
    return (task.tags || []).join(" ");
  }

  function formatMultiline(value) {
    return escapeHtml(value || "").replaceAll("\n", "<br />");
  }

  function bindEvents() {
    document.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => {
        activeView = button.dataset.nav;
        render();
      });
    });

    document.querySelectorAll("[data-status-select]").forEach((select) => {
      select.addEventListener("change", () => {
        setStatus(Number(select.dataset.statusSelect), select.value, Boolean(select.closest("[data-modal-panel]")));
      });
    });

    const startInput = document.querySelector("[data-action='start-date']");
    if (startInput) {
      startInput.addEventListener("change", () => {
        state.startDate = startInput.value || todayIso();
        saveState();
        render();
      });
    }

    document.querySelectorAll("[data-filter]").forEach((select) => {
      select.addEventListener("change", () => {
        filters[select.dataset.filter] = select.value;
        render();
      });
    });

    document.querySelector("[data-action='reset-filters']")?.addEventListener("click", () => {
      filters = {
        week: "全部周",
        category: "全部内容",
        status: "全部状态",
        product: "全部茶饮",
      };
      render();
    });

    document.getElementById("import-file")?.addEventListener("change", importJson);
  }

  document.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "export") {
        exportJson();
        return;
      }
      if (action === "import") {
        document.getElementById("import-file").click();
        return;
      }
      if (action === "export-raw-storage") {
        restoreRawStorage();
        return;
      }
      if (action === "reset-broken-storage") {
        forceResetBrokenStorage();
        return;
      }
      if (action === "reset-all-local") {
        resetAllLocalData();
        return;
      }
      if (action === "cloud-load") {
        loadCloudNow({ silent: false });
        return;
      }
      if (action === "cloud-save") {
        saveCloudNow({ silent: false });
        return;
      }
      if (action === "backup-now") {
        backupCloudNow();
        return;
      }
      if (action === "confirm-shoot-plan") {
        confirmShootPlan();
        return;
      }
      if (action === "back-shoot-select") {
        backToShootSelect();
        return;
      }
      if (action === "logout") {
        logout();
        return;
      }
    }

    const openButton = event.target.closest("[data-open-day]");
    if (openButton) {
      openDetail(Number(openButton.dataset.openDay));
      return;
    }

    const statusButton = event.target.closest("[data-status-set]");
    if (statusButton) {
      setStatus(
        Number(statusButton.dataset.day),
        statusButton.dataset.statusSet,
        Boolean(statusButton.closest("[data-modal-panel]")),
      );
      return;
    }

    const shotButton = event.target.closest("[data-shot-toggle]");
    if (shotButton) {
      setShotCheck(
        Number(shotButton.dataset.day),
        Number(shotButton.dataset.shotIndex),
        shotButton.dataset.shotDone !== "true",
      );
      return;
    }

    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      const task = getTask(Number(copyButton.dataset.day));
      const copyType = copyButton.dataset.copy;
      if (copyType === "shooting") copyText(shootingTemplate(task));
      else if (copyType === "body") copyText(bodyTemplate(task));
      else if (copyType === "tags") copyText(tagsTemplate(task));
      else copyText(publishTemplate(task));
      return;
    }

    const editTaskButton = event.target.closest("[data-edit-task]");
    if (editTaskButton) {
      event.preventDefault();
      openTaskEditor(Number(editTaskButton.dataset.editTask));
      return;
    }

    const editProductButton = event.target.closest("[data-edit-product]");
    if (editProductButton) {
      event.preventDefault();
      openProductEditor(Number(editProductButton.dataset.editProduct));
      return;
    }

    const editLibraryButton = event.target.closest("[data-edit-library]");
    if (editLibraryButton) {
      event.preventDefault();
      openLibraryEditor(Number(editLibraryButton.dataset.editLibrary));
      return;
    }

    const resetTaskButton = event.target.closest("[data-reset-task]");
    if (resetTaskButton) {
      if (confirm("确定恢复这一天的原始内容吗？进度和复盘数据不会删除。")) {
        resetTaskEdit(Number(resetTaskButton.dataset.resetTask));
      }
      return;
    }

    const resetProductButton = event.target.closest("[data-reset-product]");
    if (resetProductButton) {
      if (confirm("确定恢复这个产品的原始内容吗？")) {
        resetProductEdit(Number(resetProductButton.dataset.resetProduct));
      }
      return;
    }

    const resetLibraryButton = event.target.closest("[data-reset-library]");
    if (resetLibraryButton) {
      if (confirm("确定恢复这条资料的原始内容吗？")) {
        resetLibraryEdit(Number(resetLibraryButton.dataset.resetLibrary));
      }
      return;
    }

    const close = event.target.closest("[data-close-modal]");
    const panel = event.target.closest("[data-modal-panel]");
    if (close && !panel) document.getElementById("modal-root").innerHTML = "";
    if (event.target.matches("[data-close-modal]") && event.target.tagName === "BUTTON") {
      document.getElementById("modal-root").innerHTML = "";
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-check]")) {
      setCheck(Number(target.dataset.day), target.dataset.check, target.checked);
    }
    if (target.matches("[data-shoot-day]")) {
      toggleTodayShootDay(Number(target.dataset.shootDay), target.checked);
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-review]")) {
      setReview(Number(target.dataset.day), target.dataset.review, target.value, target.dataset.reviewType);
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-edit-form]");
    if (!form) return;
    event.preventDefault();
    const values = formValues(form);
    if (form.dataset.editForm === "task") {
      saveTaskEdit(Number(form.dataset.day), normalizeTaskValues(values));
    }
    if (form.dataset.editForm === "product") {
      saveProductEdit(Number(form.dataset.index), normalizeProductValues(values));
    }
    if (form.dataset.editForm === "library") {
      saveLibraryEdit(Number(form.dataset.index), normalizeLibraryValues(values));
    }
  });

  function renderDashboardCounters() {
    if (activeView === "dashboard" || activeView === "analytics") render();
  }

  function exportJson() {
    const backupTime = nowIso();
    state.lastBackupAt = backupTime;
    saveState();
    const payload = {
      dataVersion: DATA_VERSION,
      storageKey: STORE_KEY,
      exportedAt: backupTime,
      baseData: {
        contentPlan: contentStore.contentPlan,
        fullContent: contentStore.fullContent,
        products: contentStore.products,
        library: contentStore.library,
      },
      userState: progressPayload({ lastBackupAt: backupTime }),
      state: progressPayload({ lastBackupAt: backupTime }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qingxi-xhs-backup-${backupStamp(new Date(backupTime))}.json`;
    link.click();
    URL.revokeObjectURL(url);
    render();
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("导入会更新线上内容文案，但不会清空发布日期、状态和已拍进度。系统会先生成线上备份。是否继续？")) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        const importedAt = nowIso();
        const nextContent = parsed.content || parsed.baseData || parsed;
        applyContentPayload(nextContent);
        if (isCloudReady()) {
          await cloudRequest(backendMode === "neon" ? "/api/content/import/commit" : "/api/import-content", {
            method: "POST",
            body: JSON.stringify(backendMode === "neon" ? { content: nextContent, importId: `file-${Date.now()}` } : parsed),
          });
          setCloudStatus("ok", `内容已导入并备份：${formatDateTime(importedAt)}`);
        }
        state.importedAt = importedAt;
        storageLoadError = null;
        saveState({ importedAt, allowOverwriteAfterError: true, skipCloudSave: !isCloudReady() });
        render();
        alert(`导入成功：导入了 ${taskSource().length} 天内容；发布日期、状态和已拍进度已保留。`);
      } catch (error) {
        alert(`导入失败：${error?.message || "JSON 格式不正确或文件内容不完整。"}`);
      }
    };
    reader.onerror = () => {
      alert("导入失败：浏览器无法读取这个文件。");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function resetAllLocalData() {
    if (!confirm("这会清空所有状态、checkbox 和复盘数据。")) return;
    const typed = prompt("请再次输入 RESET 确认清空。");
    if (typed !== "RESET") {
      alert("未输入 RESET，已取消清空。");
      return;
    }
    storageLoadError = null;
    state = createDefaultState();
    saveState({ allowOverwriteAfterError: true });
    render();
    alert("已清空本地状态、checkbox、复盘数据和手动编辑内容。");
  }

  async function logout() {
    try {
      await fetch("/api/auth-logout", { method: "POST" });
    } finally {
      redirectToLogin();
    }
  }

  function startCollabPolling() {
    if (!isCloudReady()) return;
    window.clearInterval(collabPollTimer);
    collabPollTimer = window.setInterval(() => {
      pollCollabUpdates({ silent: true, rerender: true });
    }, COLLAB_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        pollCollabUpdates({ silent: true, rerender: true });
      }
    });
  }

  render();
  if (isCloudReady()) {
    loadCloudNow({ silent: true, auto: true }).finally(() => {
      startCollabPolling();
    });
  }
})();
