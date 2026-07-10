import { cookieHeader, createSessionToken, getSitePassword, safeEqual } from "./_session.js";
import { readJsonBody, sendJson } from "./_storage.js";
import { isNeonConfigured, query } from "./_db.js";
import { verifyPasswordHash } from "./_password.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 登录。" });
    return;
  }

  const expected = getSitePassword();
  if (!expected && process.env.QINGXI_MEMBER_LOGIN_MODE !== "neon") {
    sendJson(response, 500, { ok: false, message: "服务端未设置 QINGXI_SITE_PASSWORD。" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    if (process.env.QINGXI_MEMBER_LOGIN_MODE === "neon" && body.username && isNeonConfigured()) {
      const result = await query("SELECT id, role, password_hash FROM members WHERE workspace_id=$1 AND username=$2 AND active=true", [process.env.QINGXI_WORKSPACE_ID || "qingxi", String(body.username).slice(0, 100)]);
      const member = result.rows[0];
      if (!member || !(await verifyPasswordHash(body.password, member.password_hash))) {
        sendJson(response, 403, { ok: false, message: "账号或密码不正确。" });
        return;
      }
      response.setHeader("Set-Cookie", cookieHeader(createSessionToken(Date.now(), { actorId: member.id, role: member.role })));
      sendJson(response, 200, { ok: true, actorId: member.id, role: member.role });
      return;
    }
    if (!expected) {
      sendJson(response, 403, { ok: false, message: "请提供成员账号。" });
      return;
    }
    if (!safeEqual(body.password, expected)) {
      sendJson(response, 403, { ok: false, message: "访问密码不正确。" });
      return;
    }

    response.setHeader("Set-Cookie", cookieHeader(createSessionToken()));
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error?.message || "登录失败。" });
  }
}
