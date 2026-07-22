
export function sendJson(response, status, payload) { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(payload)); }
export async function readJsonBody(request) { if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body; const chunks = []; for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); const text = Buffer.concat(chunks).toString("utf8"); return text.trim() ? JSON.parse(text) : {}; }

