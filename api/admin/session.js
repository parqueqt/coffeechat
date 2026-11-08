import { endSession, json, readJson, route, startSession } from "../../lib/http.js";
import { AppError, parseHost } from "../../lib/schedule.js";
import { getStore } from "../../lib/store.js";

export const POST = route(async (request) => {
  const body = await readJson(request);
  const hostId = parseHost(body.host);
  if (body.password !== (process.env.ADMIN_PASSWORD || "0000")) throw new AppError("wrong_password");
  const cookie = await startSession(request, getStore(), hostId);
  return json({ ok: true, host: hostId }, { headers: { "Set-Cookie": cookie } });
});

export const DELETE = route(async (request) => {
  const cookie = await endSession(request, getStore());
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
});
