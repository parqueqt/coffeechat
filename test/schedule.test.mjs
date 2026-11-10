import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAvailability,
  createBooking,
  emptyDoc,
  freeIntervals,
  kstNow,
  parseBooking,
  publicSchedule,
  removeAvailability,
} from "../lib/schedule.js";

const NOW = { date: "2030-01-10", minute: 600 };
const DAY = "2030-01-20";
const id = (n) => ({ id: `b${n}`, createdAt: "2030-01-01T00:00:00.000Z" });
const request = (over = {}) => ({
  name: "홍길동", party: "hyunwoo", date: DAY, start: 720, end: 780,
  method: "커피", location: "카페", isCustom: false, message: "", ...over,
});

function docWith(...uploads) {
  const doc = emptyDoc();
  for (const [host, start, end] of uploads) addAvailability(doc, host, { dates: [DAY], start, end }, NOW);
  return doc;
}

test("overlapping uploads merge and repeating one changes nothing", () => {
  const doc = docWith(["hyunwoo", 600, 720], ["hyunwoo", 660, 780], ["hyunwoo", 660, 780]);
  assert.deepEqual(doc.availability.hyunwoo[DAY], [[600, 780]]);
});

test("a booking removes only its own time for that host", () => {
  const doc = docWith(["hyunwoo", 600, 840], ["minseok", 600, 840]);
  createBooking(doc, request(), NOW, id(1));
  assert.deepEqual(freeIntervals(doc, "hyunwoo", DAY, NOW), [[600, 720], [780, 840]]);
  assert.deepEqual(freeIntervals(doc, "minseok", DAY, NOW), [[600, 840]]);
});

test("meeting both hosts offers only the shared time and blocks both", () => {
  const doc = docWith(["hyunwoo", 600, 780], ["minseok", 720, 900]);
  assert.deepEqual(freeIntervals(doc, "both", DAY, NOW), [[720, 780]]);
  createBooking(doc, request({ party: "both", start: 720, end: 780 }), NOW, id(1));
  assert.deepEqual(freeIntervals(doc, "hyunwoo", DAY, NOW), [[600, 720]]);
  assert.deepEqual(freeIntervals(doc, "minseok", DAY, NOW), [[780, 900]]);
});

test("a booking overlapping an earlier one is refused", () => {
  const doc = docWith(["hyunwoo", 600, 840]);
  createBooking(doc, request({ start: 720, end: 780 }), NOW, id(1));
  assert.throws(() => createBooking(doc, request({ name: "김철수", start: 750, end: 810 }), NOW, id(2)), { code: "slot_taken" });
});

test("removing part of an opened window keeps the rest", () => {
  const doc = docWith(["hyunwoo", 600, 840]);
  removeAvailability(doc, "hyunwoo", { date: DAY, start: 660, end: 720 });
  assert.deepEqual(doc.availability.hyunwoo[DAY], [[600, 660], [720, 840]]);
});

test("a booked time stays closed even if the window is removed and opened again", () => {
  const doc = docWith(["hyunwoo", 600, 840]);
  createBooking(doc, request({ start: 720, end: 780 }), NOW, id(1));
  removeAvailability(doc, "hyunwoo", { date: DAY, start: 600, end: 840 });
  addAvailability(doc, "hyunwoo", { dates: [DAY], start: 600, end: 840 }, NOW);
  assert.throws(() => createBooking(doc, request({ name: "김철수", start: 720, end: 780 }), NOW, id(2)), { code: "slot_taken" });
});

test("a booking outside the opened time is refused", () => {
  const doc = docWith(["hyunwoo", 600, 720]);
  assert.throws(() => createBooking(doc, request({ start: 690, end: 750 }), NOW, id(1)), { code: "slot_taken" });
});

test("resubmitting the same request returns the original booking", () => {
  const doc = docWith(["hyunwoo", 600, 840]);
  const first = createBooking(doc, request(), NOW, id(1));
  const second = createBooking(doc, request(), NOW, id(2));
  assert.equal(second.id, first.id);
  assert.equal(doc.bookings.length, 1);
});

test("past dates and elapsed time are not offered", () => {
  const doc = emptyDoc();
  addAvailability(doc, "hyunwoo", { dates: [NOW.date], start: 540, end: 720 }, NOW);
  assert.deepEqual(freeIntervals(doc, "hyunwoo", NOW.date, NOW), [[600, 720]]);
  assert.deepEqual(freeIntervals(doc, "hyunwoo", NOW.date, { date: "2030-01-11", minute: 0 }), []);
  assert.throws(() => addAvailability(emptyDoc(), "hyunwoo", { dates: ["2030-01-09"], start: 540, end: 720 }, NOW), { code: "past_date" });
});

test("the public schedule never contains applicant details", () => {
  const doc = docWith(["hyunwoo", 600, 840]);
  createBooking(doc, request({ name: "비공개이름", message: "비공개메시지" }), NOW, id(1));
  const body = JSON.stringify(publicSchedule(doc, NOW));
  assert.ok(!body.includes("비공개이름") && !body.includes("비공개메시지"), body);
});

test("invalid booking input is rejected", () => {
  const bad = [
    { name: "   " },
    { location: "" },
    { party: "__proto__" },
    { party: "constructor" },
    { method: "수면" },
    { date: "2030-02-31" },
    { date: "tomorrow" },
    { start: 725, end: 785 },
    { start: 780, end: 720 },
    { start: 600, end: 750 },
    { start: "720" },
  ];
  for (const over of bad) assert.throws(() => parseBooking(request(over)), { code: "invalid_input" }, JSON.stringify(over));
});

test("kstNow uses Korean time across the UTC date boundary", () => {
  assert.deepEqual(kstNow(Date.UTC(2030, 0, 31, 15, 30)), { date: "2030-02-01", minute: 30 });
});
