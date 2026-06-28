import { next } from "@vercel/functions";

const SESSION_COOKIE = "qingxi_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export default async function middleware(request) {
  const url = new URL(request.url);

  if (await hasValidSession(request)) {
    return next();
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ ok: false, message: "请先输入访问密码。" }, 401);
  }

  const loginUrl = new URL("/login.html", request.url);
  loginUrl.searchParams.set("next", `${url.pathname}${url.search}${url.hash}`);
  return Response.redirect(loginUrl, 307);
}

async function hasValidSession(request) {
  const token = getCookie(request.headers.get("cookie") || "", SESSION_COOKIE);
  if (!token || !token.includes(".")) return false;

  const secret = getSecret();
  if (!secret) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload));
    return Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function getSecret() {
  return process.env.QINGXI_SESSION_SECRET || process.env.QINGXI_ADMIN_TOKEN || process.env.QINGXI_SITE_PASSWORD || "";
}

function getCookie(cookieHeader, name) {
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function decodeBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function encodeBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const config = {
  matcher: [
    "/((?!login\\.html|api/auth-login|api/auth-logout|api/auth-status|favicon\\.ico|robots\\.txt).*)",
  ],
};
