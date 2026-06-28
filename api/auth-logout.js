import { clearCookieHeader } from "./_session.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "只支持 POST 退出。" });
    return;
  }
  response.setHeader("Set-Cookie", clearCookieHeader());
  sendJson(response, 200, { ok: true });
}
