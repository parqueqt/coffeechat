import { randomBytes } from "node:crypto";
import { AppError } from "./schedule.js";

const COOKIE_NAME = "cc_admin";
const SESSION_SECONDS = 7 * 24 * 3600;

const STATUS_BY_CODE = {
  invalid_input: 400,
  past_date: 400,
  wrong_password: 401,
  unauthorized: 401,
  slot_taken: 409,
  busy: 503,
  storage_not_configured: 503,
};

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

export function route(handler) {
  return async (request) => {
    try {
      const result = await handler(request);
      return result instanceof Response ? result : json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof AppError) {
        return json({ ok: false, error: err.code }, { status: STATUS_BY_CODE[err.code] ?? 400 });
      }
      console.error(err);
      return json({ ok: false, error: "server_error" }, { status: 500 });
    }
  };
}

export async function readJson(request) {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new AppError("invalid_input");
  return body;
}

function sessionToken(request) {
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}

function buildCookie(request, value, maxAge) {
  const secure = request.headers.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function currentAdmin(request, store) {
  const token = sessionToken(request);
  return token ? store.findSession(token) : null;
}

export async function requireAdmin(request, store) {
  const hostId = await currentAdmin(request, store);
  if (!hostId) throw new AppError("unauthorized");
  return hostId;
}

export async function startSession(request, store, hostId) {
  const token = randomBytes(32).toString("hex");
  await store.saveSession(token, hostId, SESSION_SECONDS);
  return buildCookie(request, token, SESSION_SECONDS);
}

export async function endSession(request, store) {
  const token = sessionToken(request);
  if (token) await store.deleteSession(token);
  return buildCookie(request, "", 0);
}
