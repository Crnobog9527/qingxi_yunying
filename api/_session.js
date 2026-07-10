import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "qingxi_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function getSitePassword() {
  return process.env.QINGXI_SITE_PASSWORD || process.env.QINGXI_ADMIN_TOKEN || "";
}

export function getSessionSecret() {
  return process.env.QINGXI_SESSION_SECRET || process.env.QINGXI_ADMIN_TOKEN || process.env.QINGXI_SITE_PASSWORD || "";
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createSessionToken(now = Date.now(), context = {}) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("服务端未设置访问密码或会话密钥。");
  const payload = Buffer.from(JSON.stringify({
    iat: now,
    exp: now + SESSION_MAX_AGE * 1000,
    actorId: context.actorId || "legacy-shared",
    role: context.role || "owner",
  })).toString("base64url");
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionToken(token) {
  return Boolean(getSessionPayload(token));
}

export function getSessionPayload(token) {
  const secret = getSessionSecret();
  if (!secret || !token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.exp) > Date.now() ? parsed : null;
  } catch {
    return false;
  }
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function cookieHeader(token) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE}`,
  ].join("; ");
}

export function clearCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function requestHasSession(request) {
  return Boolean(getSessionContext(request));
}

export function getSessionContext(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const payload = getSessionPayload(token);
  if (!payload) return null;
  return { actorId: payload.actorId || "legacy-shared", role: payload.role || "owner" };
}
