import { requireRole } from "../../../_authz.js";
import { HttpError, requireObject } from "../../../_validation.js";
import { readJsonBody, sendJson } from "../../../_storage.js";

function inspect(content) {
  requireObject(content, "content");
  for (const key of ["contentPlan", "fullContent", "products", "library"]) {
    if (content[key] !== undefined && !Array.isArray(content[key])) throw new HttpError(400, `${key} 必须是数组。`);
  }
  const days = (content.contentPlan || []).map((item) => Number(item.day));
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 30)) throw new HttpError(400, "内容中的 day 必须在 1 到 30 之间。");
  return {
    contentPlan: content.contentPlan?.length || 0,
    fullContent: content.fullContent?.length || 0,
    products: content.products?.length || 0,
    library: content.library?.length || 0,
    duplicateDays: days.filter((day, index) => days.indexOf(day) !== index),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { ok: false, message: "只支持 POST。" });
  if (!requireRole(request, response, ["owner"])) return;
  try {
    const body = await readJsonBody(request);
    const content = body.content || body;
    return sendJson(response, 200, { ok: true, preview: inspect(content) });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    sendJson(response, status, { ok: false, message: error?.message || "导入预览失败。" });
  }
}
