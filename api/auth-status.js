import { requestHasSession } from "./_session.js";
import { sendJson } from "./_storage.js";

export default async function handler(request, response) {
  sendJson(response, 200, { ok: true, authenticated: requestHasSession(request) });
}
