// 일정 규칙. 저장소와 HTTP 를 모르는 순수 함수만 둔다.
// 시각은 그날 0시부터의 분(0~1440), 날짜는 KST 기준 "YYYY-MM-DD" 다.

export const HOSTS = { hyunwoo: "박현우", minseok: "박민석" };
export const PARTIES = {
  hyunwoo: ["hyunwoo"],
  minseok: ["minseok"],
  both: ["hyunwoo", "minseok"],
};

const METHODS = ["식사", "커피", "줌", "기타"]; // 장소는 고르지 않는다. 예전 신청의 location 은 그대로 읽힌다
const STEP_MINUTES = 30;
const DAY_MINUTES = 1440;
const MAX_BOOKING_MINUTES = 120;
const MAX_DATES_PER_UPLOAD = 62;

export class AppError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const emptyDoc = () => ({ availability: {}, bookings: [] });

export function kstNow(ms = Date.now()) {
  const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
  return { date: iso.slice(0, 10), minute: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) };
}

function mergeIntervals(list) {
  const merged = [];
  for (const [start, end] of [...list].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function subtractIntervals(base, cuts) {
  return cuts.reduce(
    (rest, [cutStart, cutEnd]) =>
      rest.flatMap(([start, end]) =>
        cutEnd <= start || cutStart >= end
          ? [[start, end]]
          : [[start, cutStart], [cutEnd, end]].filter(([a, b]) => a < b)
      ),
    base
  );
}

function intersectIntervals(left, right) {
  return left.flatMap(([a1, a2]) =>
    right.flatMap(([b1, b2]) => {
      const start = Math.max(a1, b1);
      const end = Math.min(a2, b2);
      return start < end ? [[start, end]] : [];
    })
  );
}

function hostFree(doc, hostId, date, now) {
  if (date < now.date) return [];
  const opened = doc.availability[hostId]?.[date] ?? [];
  const booked = doc.bookings
    .filter((b) => b.date === date && PARTIES[b.party].includes(hostId))
    .map((b) => [b.start, b.end]);
  const elapsed = date === now.date ? [[0, now.minute]] : [];
  return subtractIntervals(opened, [...booked, ...elapsed]);
}

export function freeIntervals(doc, party, date, now) {
  return PARTIES[party].map((hostId) => hostFree(doc, hostId, date, now)).reduce(intersectIntervals);
}

// 신청자에게 나가는 유일한 뷰. 이름과 메시지가 섞이지 않도록 빈 시간만 만든다.
export function publicSchedule(doc, now) {
  const dates = [...new Set(Object.values(doc.availability).flatMap(Object.keys))].filter((d) => d >= now.date);
  const free = {};
  for (const party of Object.keys(PARTIES)) {
    free[party] = {};
    for (const date of dates) {
      const intervals = freeIntervals(doc, party, date, now);
      if (intervals.length) free[party][date] = intervals;
    }
  }
  return { today: now.date, free };
}

export function adminView(doc, hostId, now) {
  const availability = Object.fromEntries(
    Object.entries(doc.availability[hostId] ?? {}).filter(([date, list]) => date >= now.date && list.length)
  );
  const bookings = doc.bookings
    .filter((b) => b.date >= now.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { today: now.date, availability, bookings };
}

function parseText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError("invalid_input");
  const roundTrip = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 10) !== value) {
    throw new AppError("invalid_input");
  }
  return value;
}

function parseRange(start, end) {
  const onGrid = (m) => Number.isInteger(m) && m >= 0 && m <= DAY_MINUTES && m % STEP_MINUTES === 0;
  if (!onGrid(start) || !onGrid(end) || start >= end) throw new AppError("invalid_input");
  return [start, end];
}

export function parseHost(value) {
  if (typeof value !== "string" || !Object.hasOwn(HOSTS, value)) throw new AppError("invalid_input");
  return value;
}

export function parseBooking(body) {
  const name = parseText(body.name, 30);
  const location = parseText(body.location, 60);
  const message = parseText(body.message, 500);
  if (!name) throw new AppError("invalid_input");
  if (typeof body.party !== "string" || !Object.hasOwn(PARTIES, body.party)) throw new AppError("invalid_input");
  if (!METHODS.includes(body.method)) throw new AppError("invalid_input");
  const [start, end] = parseRange(body.start, body.end);
  if (end - start > MAX_BOOKING_MINUTES) throw new AppError("invalid_input");
  return {
    name,
    party: body.party,
    date: parseDate(body.date),
    start,
    end,
    method: body.method,
    location,
    isCustom: body.isCustom === true,
    message,
  };
}

export function parseAvailabilityUpload(body) {
  if (!Array.isArray(body.dates) || !body.dates.length || body.dates.length > MAX_DATES_PER_UPLOAD) {
    throw new AppError("invalid_input");
  }
  const [start, end] = parseRange(body.start, body.end);
  return { dates: [...new Set(body.dates.map(parseDate))], start, end };
}

export function parseAvailabilityRemoval(body) {
  const [start, end] = parseRange(body.start, body.end);
  return { date: parseDate(body.date), start, end };
}

export function addAvailability(doc, hostId, { dates, start, end }, now) {
  if (dates.some((date) => date < now.date)) throw new AppError("past_date");
  const hostDays = (doc.availability[hostId] ??= {});
  for (const date of dates) hostDays[date] = mergeIntervals([...(hostDays[date] ?? []), [start, end]]);
}

export function removeAvailability(doc, hostId, { date, start, end }) {
  const hostDays = doc.availability[hostId];
  if (!hostDays?.[date]) return;
  hostDays[date] = subtractIntervals(hostDays[date], [[start, end]]);
  if (!hostDays[date].length) delete hostDays[date];
}

export function createBooking(doc, input, now, identity) {
  const sameRequest = doc.bookings.find(
    (b) =>
      b.name === input.name &&
      b.party === input.party &&
      b.date === input.date &&
      b.start === input.start &&
      b.end === input.end
  );
  if (sameRequest) return sameRequest;
  const fits = freeIntervals(doc, input.party, input.date, now).some(
    ([start, end]) => start <= input.start && input.end <= end
  );
  if (!fits) throw new AppError("slot_taken");
  const booking = { ...input, ...identity };
  doc.bookings.push(booking);
  return booking;
}

