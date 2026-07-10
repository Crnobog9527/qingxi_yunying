import { getSessionContext } from "./_session.js";
import { sendJson } from "./_storage.js";

export function requireRole(request, response, roles = ["owner", "editor", "viewer"]) {
  const context = getSessionContext(request);
  if (!context) {
    sendJson(response, 401, { ok: false, message: "请先输入访问密码。" });
    return null;
  }
  if (!roles.includes(context.role)) {
    sendJson(response, 403, { ok: false, message: "当前账号没有执行此操作的权限。" });
    return null;
  }
  return context;
}
