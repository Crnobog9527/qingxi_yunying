import { get, put } from "@vercel/blob";

export const DATA_BLOB_PATH = process.env.QINGXI_BLOB_PATH || "qingxi-workbench.json";
export const BLOB_ACCESS = process.env.QINGXI_BLOB_ACCESS || "private";

export function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function verifyAdminToken(request) {
  const expected = process.env.QINGXI_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "服务端未设置 QINGXI_ADMIN_TOKEN，无法启用线上保存。",
    };
  }

  const headerToken = request.headers["x-qingxi-token"];
  const authHeader = request.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const received = Array.isArray(headerToken) ? headerToken[0] : headerToken || bearerToken;

  if (!received) {
    return { ok: false, status: 401, message: "请先输入线上保存口令。" };
  }

  if (received !== expected) {
    return { ok: false, status: 403, message: "线上保存口令不正确。" };
  }

  return { ok: true };
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export async function blobToText(blobResult) {
  if (!blobResult) return "";
  if (typeof blobResult.text === "function") return blobResult.text();
  if (typeof blobResult.arrayBuffer === "function") {
    return Buffer.from(await blobResult.arrayBuffer()).toString("utf8");
  }
  if (blobResult.body) {
    const chunks = [];
    for await (const chunk of blobResult.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return String(blobResult);
}

export async function loadWorkbenchBlob() {
  try {
    const blob = await get(DATA_BLOB_PATH, { access: BLOB_ACCESS });
    const text = await blobToText(blob);
    if (!text.trim()) return { exists: false };
    return {
      exists: true,
      data: JSON.parse(text),
      pathname: DATA_BLOB_PATH,
      etag: blob.etag || "",
    };
  } catch (error) {
    const message = String(error?.message || error);
    if (/not found|404|no such/i.test(message)) {
      return { exists: false };
    }
    throw error;
  }
}

export async function saveWorkbenchBlob(payload) {
  return put(DATA_BLOB_PATH, JSON.stringify(payload, null, 2), {
    access: BLOB_ACCESS,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}
