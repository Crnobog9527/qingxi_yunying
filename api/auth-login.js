import { cookieHeader, createSessionToken, getSitePassword, safeEqual } from "./_session.js";
import { readJsonBody, sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 登录。" });
    return;
  }

  const expected = getSitePassword();
  if (!expected) {
    sendJson(response, 500, { ok: false, message: "服务端未设置 QINGXI_SITE_PASSWORD。" });
    return;
  }

  try {
    const body = await readJsonBody(request);
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
