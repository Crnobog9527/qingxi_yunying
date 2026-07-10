import { requestHasSession } from "./_session.js";
import { backupIfExists, DATA_VERSION, hasContent, normalizeContentPayload, nowIso } from "./_workspace.js";
import { CONTENT_BLOB_PATH, PROGRESS_BLOB_PATH, isBlobBackend, readJsonBody, saveJsonBlob, sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 导入内容。" });
    return;
  }

  if (!requestHasSession(request)) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return;
  }
  if (!isBlobBackend()) return sendJson(response, 409, { ok: false, message: "Neon 模式请使用内容预览和提交接口。" });

  try {
    const payload = await readJsonBody(request);
    if (!hasContent(payload)) {
      sendJson(response, 400, { ok: false, message: "导入内容缺少 content/baseData/contentPlan/fullContent。" });
      return;
    }

    const importedAt = nowIso();
    const when = new Date(importedAt);
    const backups = {
      content: await backupIfExists("content", CONTENT_BLOB_PATH, when),
      progress: await backupIfExists("progress", PROGRESS_BLOB_PATH, when),
    };
    const content = normalizeContentPayload(payload);
    const blob = await saveJsonBlob(CONTENT_BLOB_PATH, {
      version: DATA_VERSION,
      importedAt,
      sourceExportedAt: payload.exportedAt || "",
      ...content,
    });

    sendJson(response, 200, {
      ok: true,
      importedAt,
      pathname: blob.pathname,
      url: blob.url,
      backups,
      counts: {
        contentPlan: content.contentPlan.length,
        fullContent: content.fullContent.length,
        products: content.products.length,
        library: content.library.length,
      },
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || "导入内容失败。",
    });
  }
}
