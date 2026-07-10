import { get, put } from "@vercel/blob";

export const LEGACY_WORKBENCH_PATH = process.env.QINGXI_BLOB_PATH || "qingxi-workbench.json";
export const CONTENT_BLOB_PATH = process.env.QINGXI_CONTENT_BLOB_PATH || "qingxi/content/latest.json";
export const PROGRESS_BLOB_PATH = process.env.QINGXI_PROGRESS_BLOB_PATH || "qingxi/progress/current.json";
export const BLOB_ACCESS = process.env.QINGXI_BLOB_ACCESS || "private";

export function isBlobBackend() {
  return process.env.QINGXI_STORAGE_BACKEND !== "neon";
}

export function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.end(JSON.stringify(payload));
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 2 * 1024 * 1024) throw new Error("请求体过大。");
    chunks.push(buffer);
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
  if (blobResult.stream) {
    return readableStreamToText(blobResult.stream);
  }
  if (blobResult.body) {
    return readableStreamToText(blobResult.body);
  }
  return String(blobResult);
}

async function readableStreamToText(stream) {
  const chunks = [];
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function backupBlobPath(kind, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `qingxi/backups/${kind}/${stamp}.json`;
}

export async function loadJsonBlob(path) {
  try {
    const blob = await get(path, { access: BLOB_ACCESS });
    if (!blob || blob.statusCode === 404) return { exists: false };
    if (blob.statusCode && blob.statusCode !== 200) {
      throw new Error(`Blob 读取失败：HTTP ${blob.statusCode}`);
    }
    const text = await blobToText(blob);
    if (!text.trim()) return { exists: false };
    return {
      exists: true,
      data: JSON.parse(text),
      pathname: blob.blob?.pathname || path,
      etag: blob.blob?.etag || blob.etag || "",
    };
  } catch (error) {
    const message = String(error?.message || error);
    if (/not found|404|no such/i.test(message)) {
      return { exists: false };
    }
    throw error;
  }
}

export async function saveJsonBlob(path, payload) {
  return put(path, JSON.stringify(payload, null, 2), {
    access: BLOB_ACCESS,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

export async function loadWorkbenchBlob() {
  return loadJsonBlob(LEGACY_WORKBENCH_PATH);
}

export async function saveWorkbenchBlob(payload) {
  return saveJsonBlob(LEGACY_WORKBENCH_PATH, payload);
}
