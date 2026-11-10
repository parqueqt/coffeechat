import assert from "node:assert/strict";
import { test } from "node:test";
import * as adminAvailability from "../api/admin/availability.js";
import * as adminDashboard from "../api/admin/dashboard.js";
import * as adminSession from "../api/admin/session.js";
import * as bookings from "../api/bookings.js";
import * as schedule from "../api/schedule.js";

let dateCounter = 0;
function freshDate() {
  dateCounter += 1;
  const month = String(Math.ceil(dateCounter / 28)).padStart(2, "0");
  const day = String(((dateCounter - 1) % 28) + 1).padStart(2, "0");
  return `2099-${month}-${day}`;
}

async function call(handler, method, body, cookie) {
  const response = await handler(
    new Request("http://local.test/api", {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  return { status: response.status, out: await response.json(), setCookie: response.headers.get("set-cookie") };
}

async function loginAs(host) {
  const { setCookie } = await call(adminSession.POST, "POST", { host, password: "0000" });
  return setCookie.split(";")[0];
}

async function open(date, start, end, host = "hyunwoo") {
  const cookie = await loginAs(host);
  const { status } = await call(adminAvailability.POST, "POST", { dates: [date], start, end }, cookie);
  assert.equal(status, 200);
}

const bookingBody = (date, over = {}) => ({
  name: "홍길동", party: "hyunwoo", date, start: 720, end: 780, method: "커피", location: "카페", ...over,
});

test("admin login needs the right password", async () => {
  const wrong = await call(adminSession.POST, "POST", { host: "hyunwoo", password: "1234" });
  assert.deepEqual([wrong.status, wrong.out.error], [401, "wrong_password"]);
  const unknown = await call(adminSession.POST, "POST", { host: "someone", password: "0000" });
  assert.equal(unknown.status, 400);
  const right = await call(adminSession.POST, "POST", { host: "minseok", password: "0000" });
  assert.equal(right.status, 200);
  assert.match(right.setCookie, /HttpOnly/);
  assert.match(right.setCookie, /SameSite=Lax/);
  const cookie = right.setCookie.split(";")[0];
  assert.equal((await call(adminDashboard.GET, "GET", undefined, cookie)).out.host, "minseok");
});

test("ADMIN_PASSWORD replaces the default password", async () => {
  process.env.ADMIN_PASSWORD = "changed";
  try {
    assert.equal((await call(adminSession.POST, "POST", { host: "hyunwoo", password: "0000" })).status, 401);
    assert.equal((await call(adminSession.POST, "POST", { host: "hyunwoo", password: "changed" })).status, 200);
  } finally {
    delete process.env.ADMIN_PASSWORD;
  }
});

test("logout ends the session", async () => {
  const cookie = await loginAs("hyunwoo");
  await call(adminSession.DELETE, "DELETE", undefined, cookie);
  assert.equal((await call(adminDashboard.GET, "GET", undefined, cookie)).out.host, null);
});

test("anonymous callers cannot use admin endpoints or read applicants", async () => {
  const date = freshDate();
  assert.equal((await call(adminAvailability.POST, "POST", { dates: [date], start: 600, end: 720 })).status, 401);
  assert.equal((await call(adminAvailability.POST, "POST", { dates: [date], start: 600, end: 720 }, "cc_admin=forged")).status, 401);
  const dashboard = await call(adminDashboard.GET, "GET");
  assert.deepEqual(dashboard.out, { ok: true, host: null });
});

test("an opened time can be booked and shows up for admins at once", async () => {
  const date = freshDate();
  await open(date, 600, 840);
  assert.deepEqual((await call(schedule.GET, "GET")).out.free.hyunwoo[date], [[600, 840]]);

  const booked = await call(bookings.POST, "POST", bookingBody(date, { message: "<img src=x>" }));
  assert.equal(booked.status, 200);
  assert.deepEqual((await call(schedule.GET, "GET")).out.free.hyunwoo[date], [[600, 720], [780, 840]]);

  const cookie = await loginAs("minseok");
  const row = (await call(adminDashboard.GET, "GET", undefined, cookie)).out.bookings.find((b) => b.id === booked.out.id);
  assert.equal(row.name, "홍길동");
  assert.equal(row.message, "<img src=x>");
});

test("an admin can remove a wrongly opened time, but only their own", async () => {
  const date = freshDate();
  await open(date, 600, 840, "hyunwoo");
  await open(date, 600, 840, "minseok");
  const anonymous = await call(adminAvailability.DELETE, "DELETE", { date, start: 600, end: 840 });
  assert.equal(anonymous.status, 401);

  const cookie = await loginAs("hyunwoo");
  assert.equal((await call(adminAvailability.DELETE, "DELETE", { date, start: 660, end: 720 }, cookie)).status, 200);
  const free = (await call(schedule.GET, "GET")).out.free;
  assert.deepEqual(free.hyunwoo[date], [[600, 660], [720, 840]]);
  assert.deepEqual(free.minseok[date], [[600, 840]]);
});

test("removing an opened time does not cancel a booking inside it, and admins cannot cancel bookings", async () => {
  const date = freshDate();
  await open(date, 600, 840);
  const booked = await call(bookings.POST, "POST", bookingBody(date));
  const cookie = await loginAs("hyunwoo");
  await call(adminAvailability.DELETE, "DELETE", { date, start: 600, end: 840 }, cookie);
  const row = (await call(adminDashboard.GET, "GET", undefined, cookie)).out.bookings.find((b) => b.id === booked.out.id);
  assert.equal(row.name, "홍길동");
  await assert.rejects(import("../api/admin/bookings.js"), { code: "ERR_MODULE_NOT_FOUND" });
});

test("a time nobody opened cannot be booked", async () => {
  const { status, out } = await call(bookings.POST, "POST", bookingBody(freshDate()));
  assert.deepEqual([status, out.error], [409, "slot_taken"]);
});

test("simultaneous requests for one time produce exactly one booking", async () => {
  const date = freshDate();
  await open(date, 600, 840);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => call(bookings.POST, "POST", bookingBody(date, { name: `신청자${i}` })))
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, ...Array(19).fill(409)]);
});

test("simultaneous requests for different times all succeed", async () => {
  const date = freshDate();
  await open(date, 0, 1440);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      call(bookings.POST, "POST", bookingBody(date, { name: `신청자${i}`, start: i * 60, end: i * 60 + 30 }))
    )
  );
  assert.deepEqual(results.map((r) => r.status), Array(10).fill(200));
});

test("malformed bodies are rejected without a server error", async () => {
  for (const body of ["{not json", "null", "[1,2]"]) {
    assert.equal((await call(bookings.POST, "POST", body)).status, 400, body);
  }
});

test("a Vercel deployment without storage refuses instead of using memory", async () => {
  const saved = { ...process.env };
  for (const key of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[key];
  process.env.VERCEL = "1";
  try {
    const { status, out } = await call(schedule.GET, "GET");
    assert.deepEqual([status, out.error], [503, "storage_not_configured"]);
  } finally {
    process.env = saved;
  }
});
