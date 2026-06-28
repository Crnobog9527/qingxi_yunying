(() => {
  const DATA = window.QINGXI_DATA;
  const FULL_CONTENT = window.QINGXI_FULL_CONTENT || [];
  const STORE_KEY = "qingxi_xhs_workbench_v1";
  const LEGACY_STORE_KEY = "qingxi-xhs-workbench-v1";
  const DATA_VERSION = 3;
  const TODAY = new Date();
  const NAV = [
    ["dashboard", "首页 Dashboard"],
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
  let state = loadState();

  function todayIso() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createDefaultState() {
    return {
      version: DATA_VERSION,
      startDate: todayIso(),
      statuses: {},
      checks: {},
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
      throw new Error(payload.message || `请求失败：${response.status}`);
    }
    return payload;
  }

  function cloudPayload(savedAt = nowIso()) {
    return {
      dataVersion: DATA_VERSION,
      storageKey: STORE_KEY,
      cloudSavedAt: savedAt,
      baseData: {
        contentPlan: DATA.contentPlan,
        fullContent: FULL_CONTENT,
        products: DATA.products,
        library: DATA.library,
      },
      userState: serializableState({ lastCloudSavedAt: savedAt }),
      state: serializableState({ lastCloudSavedAt: savedAt }),
    };
  }

  async function saveCloudNow({ silent = false } = {}) {
    if (!isCloudReady()) {
      if (!silent) alert("当前环境不能调用线上 API。");
      return false;
    }
    try {
      setCloudStatus("saving", "正在保存到线上...");
      const savedAt = nowIso();
      const result = await cloudRequest("/api/save-data", {
        method: "POST",
        body: JSON.stringify(cloudPayload(savedAt)),
      });
      state.lastCloudSavedAt = result.savedAt || savedAt;
      persistStateLocalOnly();
      setCloudStatus("ok", `线上已保存：${formatDateTime(state.lastCloudSavedAt)}`);
      if (!silent) alert(`线上保存成功：${formatDateTime(state.lastCloudSavedAt)}`);
      return true;
    } catch (error) {
      setCloudStatus("error", error?.message || "线上保存失败。");
      if (!silent) alert(`线上保存失败：${error?.message || "请稍后重试。"}`);
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
      const result = await cloudRequest("/api/load-data");
      if (!result.exists) {
        setCloudStatus("idle", "线上还没有保存数据。");
        if (!silent && confirm("线上还没有数据。是否把当前本地进度保存到线上？")) {
          await saveCloudNow({ silent: false });
        }
        return false;
      }

      const remoteState = result.data?.userState || result.data?.state;
      if (!remoteState || typeof remoteState !== "object") {
        throw new Error("线上数据缺少 userState/state。");
      }

      const loadedAt = nowIso();
      state = normalizeState({
        ...remoteState,
        lastCloudLoadedAt: loadedAt,
        version: DATA_VERSION,
      });
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

  function setStatus(day, status, keepModal = false) {
    state.statuses[day] = status;
    saveState();
    render();
    if (keepModal) openDetail(day);
  }

  function getReview(day) {
    return state.reviews[day] || {};
  }

  function taskSource() {
    return DATA.contentPlan.map((task) => getTask(task.day));
  }

  function getTask(day) {
    const base = DATA.contentPlan.find((item) => item.day === Number(day));
    const full = FULL_CONTENT.find((item) => item.day === Number(day)) || {};
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
    const edit = state.edits?.tasks?.[day] || {};
    const merged = {
      ...base,
      ...enhanced,
      ...edit,
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
    return DATA.products.map((product, index) => getProduct(index));
  }

  function getProduct(index) {
    const base = DATA.products[index];
    const edit = state.edits?.products?.[index] || {};
    return {
      ...base,
      ...edit,
      imageKeywords: arrayField(edit.imageKeywords, base.imageKeywords),
      themes: arrayField(edit.themes, base.themes),
    };
  }

  function librarySource() {
    return DATA.library.map((item, index) => getLibraryItem(index));
  }

  function getLibraryItem(index) {
    const base = DATA.library[index];
    const edit = state.edits?.library?.[index] || {};
    return { ...base, ...edit };
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
    state.edits.tasks[day] = {
      ...(state.edits.tasks[day] || {}),
      ...values,
    };
    saveState();
    render();
    openDetail(day);
  }

  function resetTaskEdit(day) {
    delete state.edits.tasks[day];
    saveState();
    render();
    openDetail(day);
  }

  function saveProductEdit(index, values) {
    state.edits.products[index] = {
      ...(state.edits.products[index] || {}),
      ...values,
    };
    saveState();
    render();
    openProductEditor(index);
  }

  function resetProductEdit(index) {
    delete state.edits.products[index];
    saveState();
    render();
    openProductEditor(index);
  }

  function saveLibraryEdit(index, values) {
    state.edits.library[index] = {
      ...(state.edits.library[index] || {}),
      ...values,
    };
    saveState();
    render();
    openLibraryEditor(index);
  }

  function resetLibraryEdit(index) {
    delete state.edits.library[index];
    saveState();
    render();
    openLibraryEditor(index);
  }

  function setReview(day, field, value, type) {
    state.reviews[day] = state.reviews[day] || {};
    state.reviews[day][field] = type === "number" ? toNumber(value) : value;
    saveState();
    renderDashboardCounters();
  }

  function setCheck(day, label, checked) {
    state.checks[day] = state.checks[day] || {};
    state.checks[day][label] = checked;
    saveState();
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
            <p>线上保存 + 本地缓存：拍摄、发布、复盘、预约转化一处管理。</p>
          </div>
          <nav class="nav">
            ${NAV.map(([id, label]) => `<button class="${activeView === id ? "active" : ""}" data-nav="${id}">${label}</button>`).join("")}
          </nav>
          <div class="sidebar-actions">
            <button class="btn" data-action="export">导出今日备份</button>
            <button class="ghost-btn" data-action="import">导入 JSON</button>
            <input class="hide" id="import-file" type="file" accept="application/json" />
          </div>
        </aside>
        <main class="main">
          ${renderTopbar()}
          <section class="section ${activeView === "dashboard" ? "active" : ""}" id="dashboard">${renderDashboard()}</section>
          <section class="section ${activeView === "calendar" ? "active" : ""}" id="calendar">${renderCalendar()}</section>
          <section class="section ${activeView === "kanban" ? "active" : ""}" id="kanban">${renderKanban()}</section>
          <section class="section ${activeView === "products" ? "active" : ""}" id="products">${renderProducts()}</section>
          <section class="section ${activeView === "analytics" ? "active" : ""}" id="analytics">${renderAnalytics()}</section>
          <section class="section ${activeView === "weekly" ? "active" : ""}" id="weekly">${renderWeekly()}</section>
          <section class="section ${activeView === "library" ? "active" : ""}" id="library">${renderLibrary()}</section>
        </main>
      </div>
      ${renderMobileBottomNav()}
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
      .replace("30 天日历", "日历")
      .replace("任务看板", "看板")
      .replace("复盘分析", "复盘")
      .replace("本周复盘", "本周");
  }

  function renderTopbar() {
    const m = metrics();
    const titles = {
      dashboard: "小红书 30 天起号本地运营工作台",
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
          <p class="page-subtitle">Vercel Blob 线上保存，localStorage 本地缓存；不接 Supabase，不做多人协作。</p>
        </div>
        <div class="toolbar">
          <label class="mini-title">Day 1 日期</label>
          <input class="field" type="date" value="${state.startDate}" data-action="start-date" />
          <span class="status-pill" data-status="已发布">今日 Day ${m.day} / 第 ${m.week} 周</span>
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
        ${renderDataModeNotice()}
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

  function renderDataModeNotice() {
    return `
      <div class="sync-strip local-notice">
        <div data-cloud-status>${cloudStatusMarkup()}</div>
        <p class="mini-title">自动保存：${state.lastCloudSavedAt ? formatDateTime(state.lastCloudSavedAt) : "等待首次保存"} · 本地缓存：${state.lastSavedAt ? formatDateTime(state.lastSavedAt) : "尚未保存"}</p>
        ${backupReminder()}
      </div>
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

  function backupReminder() {
    if (!needsBackupReminder()) return "";
    return `<div class="backup-reminder">建议今天结束后导出一次备份。</div>`;
  }

  function needsBackupReminder() {
    if (!state.lastBackupAt) return true;
    const last = new Date(state.lastBackupAt).getTime();
    return Number.isNaN(last) || Date.now() - last > 24 * 60 * 60 * 1000;
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
      <article class="card pad quick-task">
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
          <select class="status-select" data-status-select="${task.day}">
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
        ${DATA.STATUSES.map((status) => `<button class="status-btn" data-status-set="${status}" data-day="${day}">${status}</button>`).join("")}
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
      <article class="task-card ${isToday ? "today" : ""}">
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
          <select class="status-select" data-status-select="${task.day}">
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
    return `
      <article class="kanban-card">
        <span class="mini-title">Day ${task.day} · ${isoForDay(task.day)}</span>
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
            <button class="ghost-btn" data-action="logout">退出访问</button>
          </div>
        </div>
        <p class="mini-title">线上最近保存：${state.lastCloudSavedAt ? formatDateTime(state.lastCloudSavedAt) : "尚未保存"} · 最近备份：${state.lastBackupAt ? formatDateTime(state.lastBackupAt) : "尚未导出备份"}</p>
      </article>
    `;
  }

  function openDetail(day) {
    state.currentDay = Number(day);
    saveState();
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
                  ${(task.imagePlan || []).map((item, index) => `
                    <div class="shot-item">
                      <p class="mini-title">图 ${index + 1}</p>
                      <p class="task-copy">${escapeHtml(item)}</p>
                    </div>
                  `).join("")}
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

            <article class="card pad detail-status-card">
              <h3 style="margin-top:0">当前状态</h3>
              ${statusButtons(task.day)}
            </article>

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
          <div class="modal-mobile-bar">
            <select class="status-select" data-status-select="${task.day}">
              ${DATA.STATUSES.map((statusName) => `<option value="${statusName}" ${statusName === status ? "selected" : ""}>${statusName}</option>`).join("")}
            </select>
            <button class="ghost-btn" data-close-modal>关闭</button>
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
      select.addEventListener("change", () => setStatus(Number(select.dataset.statusSelect), select.value));
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
        contentPlan: DATA.contentPlan,
        fullContent: FULL_CONTENT,
        products: DATA.products,
        library: DATA.library,
      },
      userState: serializableState({ lastBackupAt: backupTime }),
      state: serializableState({ lastBackupAt: backupTime }),
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
    if (!confirm("导入会覆盖当前本地进度，建议先导出当前备份。是否继续？")) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const next = parsed.userState || parsed.state || parsed;
        if (!next || typeof next !== "object") throw new Error("备份文件缺少用户进度数据。");
        const importedAt = nowIso();
        state = normalizeState({
          ...next,
          importedAt,
          version: DATA_VERSION,
        });
        storageLoadError = null;
        saveState({ importedAt, allowOverwriteAfterError: true });
        render();
        const days = Object.keys(state.statuses || {}).length || taskSource().length;
        alert(`导入成功：导入了 ${days} 天数据。最近保存时间：${formatDateTime(state.lastSavedAt)}。`);
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

  render();
  if (isCloudReady()) {
    loadCloudNow({ silent: true, auto: true });
  }
})();
