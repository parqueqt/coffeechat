// ===== 관리자 화면 =====
"use strict";

const ROW_PX = 22;
const ROWS = 48;
const FIRST_VISIBLE_ROW = 18; // 09:00
const DESKTOP_DAYS = 7;
const MOBILE_DAYS = 3;
const MOBILE_BREAKPOINT = 640;
const MAX_DAYS_AHEAD = 180;
const ADMIN_POLL_MS = 10000;
const TOAST_MS = 8000;
const TOUCH_SLOP_PX = 10;
const HOST_NAMES = { hyunwoo: "박현우", minseok: "박민석" };

const admin = {
  host: null,
  today: null,
  availability: {},
  bookings: [],
  lastPayload: "",
  seenBookingIds: null,
  armedCancelId: null,
  viewStart: null,
  viewDays: DESKTOP_DAYS,
  // kind: idle | pressing | dragging | anchored | saving
  gesture: { kind: "idle" },
  // null | { kind: "booking", id } | { kind: "window", date, start, end }
  sheet: null,
};

// ---------- 로그인 ----------
let loginHost = "hyunwoo";
$$(".host-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    loginHost = btn.dataset.host;
    $$(".host-toggle").forEach((b) => b.classList.toggle("on", b === btn));
  });
});

async function login() {
  const status = $("#adminLoginStatus");
  status.textContent = "";
  try {
    const out = await callApi("/api/admin/session", "POST", { host: loginHost, password: $("#adminPassword").value });
    if (out.ok) { $("#adminPassword").value = ""; await refreshDashboard(); return; }
    status.textContent = out.error === "wrong_password" ? "⚠️ 비밀번호가 맞지 않아요." : "⚠️ 로그인하지 못했어요. 잠시 후 다시 시도해주세요.";
  } catch (err) {
    status.textContent = "⚠️ 네트워크 오류가 발생했어요.";
  }
}
$("#adminLoginBtn").addEventListener("click", login);
$("#adminPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

$("#logoutBtn").addEventListener("click", async () => {
  await callApi("/api/admin/session", "DELETE").catch(() => {});
  location.reload();
});

// ---------- 대시보드 ----------
function showAdminScreen() {
  $("#gate").classList.add("hidden");
  $("#app").classList.add("hidden");
  $("#admin").classList.remove("hidden");
  $("#adminName").textContent = HOST_NAMES[admin.host];
  resetView();
}

async function refreshDashboard() {
  const out = await callApi("/api/admin/dashboard", "GET");
  if (!out.ok) return;
  if (!out.host) {
    if (admin.host) location.reload(); // 세션 만료
    return;
  }
  const firstLoad = !admin.host;
  Object.assign(admin, { host: out.host, today: out.today });
  if (firstLoad) showAdminScreen();
  const payload = JSON.stringify([out.availability, out.bookings]);
  if (payload === admin.lastPayload) return;
  admin.lastPayload = payload;
  admin.availability = out.availability;
  admin.bookings = out.bookings;
  announceNewBookings();
  renderAdmin();
}

function renderAdmin() {
  renderWeekBlocks();
  renderBookings();
  renderMyWindows();
  renderSheet();
}

function announceNewBookings() {
  const known = admin.seenBookingIds;
  admin.seenBookingIds = new Set(admin.bookings.map((b) => b.id));
  if (!known) return;
  const fresh = admin.bookings.filter((b) => !known.has(b.id));
  if (!fresh.length) return;
  const b = fresh[0];
  const more = fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : "";
  showToast(`🔔 ${b.name}님이 ${dateLabel(b.date)} ${timeRange(b.start, b.end)} 커피챗을 신청했어요${more}`);
}

let toastTimer = null;
function showToast(text) {
  const toast = $("#toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), TOAST_MS);
}

const timeRange = (start, end) => `${minToHHMM(start)}~${minToHHMM(end)}`;
const isMine = (booking) => booking.party === admin.host || booking.party === "both";

function addDays(key, delta) {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(year, month - 1, day + delta);
  return dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function datesBetween(a, b) {
  const [first, last] = a <= b ? [a, b] : [b, a];
  const dates = [];
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);
  return dates;
}

// ---------- 주간 시간표 ----------
const earliestViewStart = () =>
  admin.viewDays === DESKTOP_DAYS ? addDays(admin.today, -dowOf(admin.today)) : admin.today;

function resetView() {
  admin.viewDays = window.innerWidth < MOBILE_BREAKPOINT ? MOBILE_DAYS : DESKTOP_DAYS;
  admin.viewStart = earliestViewStart();
  buildWeekGrid();
  $("#weekScroll").scrollTop = FIRST_VISIBLE_ROW * ROW_PX;
}

function viewDates() {
  return Array.from({ length: admin.viewDays }, (_, i) => addDays(admin.viewStart, i));
}

function buildWeekGrid() {
  const dates = viewDates();
  const heads = dates.map((date) => {
    const { day } = parseDateKey(date);
    return `<div class="week-date ${date === admin.today ? "today" : ""}"><small>${DOW_KO[dowOf(date)]}</small><b>${day}</b></div>`;
  }).join("");
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="week-hour">${h ? pad2(h) : ""}</div>`).join("");
  const columns = dates.map((date) =>
    `<div class="week-day ${date < admin.today ? "past" : ""}" data-date="${date}"><div class="week-blocks"></div><div class="week-preview"></div></div>`
  ).join("");
  const scroll = $("#weekScroll");
  const scrollTop = scroll ? scroll.scrollTop : 0;
  $("#weekGrid").innerHTML = `
    <div class="week-scroll" id="weekScroll" style="--days:${dates.length}">
      <div class="week-head"><div class="week-corner"></div>${heads}</div>
      <div class="week-body"><div class="week-hours">${hours}</div>${columns}</div>
    </div>`;
  $("#weekScroll").scrollTop = scrollTop;
  $("#weekLabel").textContent = `${dateLabel(dates[0])} ~ ${dateLabel(dates[dates.length - 1])}`;
  $('[data-week="-1"]').disabled = admin.viewStart <= earliestViewStart();
  $('[data-week="1"]').disabled = addDays(admin.viewStart, admin.viewDays) > addDays(admin.today, MAX_DAYS_AHEAD);
  renderWeekBlocks();
  renderPreview();
}

function blockHTML(cls, attrs, start, end, label) {
  const top = (start / STEP_MIN) * ROW_PX;
  const height = ((end - start) / STEP_MIN) * ROW_PX - 2;
  return `<button type="button" class="block ${cls}" style="top:${top}px;height:${height}px" ${attrs}>${label}</button>`;
}

function renderWeekBlocks() {
  $$("#weekGrid .week-day").forEach((column) => {
    const date = column.dataset.date;
    const windows = (admin.availability[date] || []).map(([s, e]) =>
      blockHTML("block-open", `data-kind="window" data-start="${s}" data-end="${e}"`, s, e, `가능 ${timeRange(s, e)}`));
    const booked = admin.bookings.filter((b) => b.date === date && isMine(b)).map((b) =>
      blockHTML("block-booked", `data-kind="booking" data-id="${esc(b.id)}" title="${esc(b.name)}"`, b.start, b.end, `<b>${esc(b.name)}</b> ${timeRange(b.start, b.end)}`));
    column.querySelector(".week-blocks").innerHTML = windows.join("") + booked.join("");
  });
}

$$("[data-week]").forEach((btn) => {
  btn.addEventListener("click", () => {
    admin.viewStart = addDays(admin.viewStart, Number(btn.dataset.week) * admin.viewDays);
    buildWeekGrid();
  });
});
$("#weekToday").addEventListener("click", () => {
  admin.viewStart = earliestViewStart();
  buildWeekGrid();
});
window.addEventListener("resize", () => {
  if (!admin.host) return;
  const days = window.innerWidth < MOBILE_BREAKPOINT ? MOBILE_DAYS : DESKTOP_DAYS;
  if (days !== admin.viewDays) resetView();
});

// ---------- 시간 고르기: 마우스는 드래그, 터치는 시작 칸과 끝 칸을 차례로 누른다 ----------
const sameCell = (a, b) => a.date === b.date && a.minute === b.minute;

function cellAt(x, y) {
  const columns = [...$$("#weekGrid .week-day:not(.past)")];
  if (!columns.length) return null;
  const column = columns.find((c) => {
    const r = c.getBoundingClientRect();
    return x >= r.left && x < r.right;
  }) || (x < columns[0].getBoundingClientRect().left ? columns[0] : columns[columns.length - 1]);
  const row = Math.floor((y - column.getBoundingClientRect().top) / ROW_PX);
  return { date: column.dataset.date, minute: Math.max(0, Math.min(ROWS - 1, row)) * STEP_MIN };
}

function selectionRange(a, b) {
  return {
    dates: datesBetween(a.date, b.date),
    start: Math.min(a.minute, b.minute),
    end: Math.max(a.minute, b.minute) + STEP_MIN,
  };
}

function currentSelection() {
  const g = admin.gesture;
  if (g.kind === "dragging" || g.kind === "saving") return selectionRange(g.from, g.to);
  if (g.kind === "anchored") return selectionRange(g.from, g.from);
  if (g.kind === "pressing" && g.anchor) return selectionRange(g.anchor, g.anchor);
  return null;
}

function renderPreview() {
  const range = currentSelection();
  $$("#weekGrid .week-day").forEach((column) => {
    const show = range && range.dates.includes(column.dataset.date);
    column.querySelector(".week-preview").innerHTML = show
      ? `<div class="block block-preview" style="top:${(range.start / STEP_MIN) * ROW_PX}px;height:${((range.end - range.start) / STEP_MIN) * ROW_PX - 2}px">${timeRange(range.start, range.end)}</div>`
      : "";
  });
}

function setGesture(next) {
  admin.gesture = next;
  renderPreview();
}

$("#weekGrid").addEventListener("pointerdown", (e) => {
  const column = e.target.closest(".week-day");
  if (!column || column.classList.contains("past") || e.button !== 0 || admin.gesture.kind === "saving") return;
  const isTouch = e.pointerType === "touch";
  if (!isTouch) e.preventDefault();
  setGesture({
    kind: "pressing",
    pointerId: e.pointerId,
    from: cellAt(e.clientX, e.clientY),
    anchor: admin.gesture.kind === "anchored" ? admin.gesture.from : null,
    block: e.target.closest(".block"),
    isTouch,
    x: e.clientX,
    y: e.clientY,
  });
});

window.addEventListener("pointermove", (e) => {
  const g = admin.gesture;
  if ((g.kind !== "pressing" && g.kind !== "dragging") || e.pointerId !== g.pointerId || g.isTouch) return;
  const to = cellAt(e.clientX, e.clientY);
  if (g.kind === "pressing" && sameCell(to, g.from)) return;
  setGesture({ kind: "dragging", pointerId: g.pointerId, from: g.from, to, isTouch: false });
});

window.addEventListener("pointerup", (e) => {
  const g = admin.gesture;
  if ((g.kind !== "pressing" && g.kind !== "dragging") || e.pointerId !== g.pointerId) return;
  if (g.kind === "dragging") { saveSelection(g.from, g.to); return; }
  if (g.isTouch && Math.hypot(e.clientX - g.x, e.clientY - g.y) > TOUCH_SLOP_PX) { abandonPress(g); return; }
  if (g.anchor) {
    if (sameCell(g.anchor, g.from)) { setGesture({ kind: "idle" }); setAdminStatus(""); }
    else saveSelection(g.anchor, g.from);
    return;
  }
  if (g.block) { setGesture({ kind: "idle" }); openSheet(g.block); return; }
  setGesture({ kind: "anchored", from: g.from });
  setAdminStatus(`🕐 ${dateLabel(g.from.date)} ${minToHHMM(g.from.minute)}부터, 끝나는 칸을 눌러주세요. 같은 칸을 다시 누르면 취소돼요.`);
});

window.addEventListener("pointercancel", (e) => {
  const g = admin.gesture;
  if ((g.kind === "pressing" || g.kind === "dragging") && e.pointerId === g.pointerId) abandonPress(g);
});

function abandonPress(g) {
  setGesture(g.anchor ? { kind: "anchored", from: g.anchor } : { kind: "idle" });
}

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (admin.gesture.kind === "anchored") { setGesture({ kind: "idle" }); setAdminStatus(""); }
  closeSheet();
});

$("#weekGrid").addEventListener("click", (e) => {
  const block = e.target.closest(".block");
  if (block && e.detail === 0) openSheet(block); // 키보드 Enter
});

function setAdminStatus(text) { $("#adminStatus").textContent = text; }

async function saveSelection(from, to) {
  const { dates, start, end } = selectionRange(from, to);
  setGesture({ kind: "saving", from, to });
  const out = await callApi("/api/admin/availability", "POST", { dates, start, end }).catch(() => ({ ok: false }));
  if (out.ok) {
    await refreshDashboard().catch(() => {});
    const when = dates.length > 1 ? `${dates.length}일` : dateLabel(dates[0]);
    setAdminStatus(`✅ ${when} ${timeRange(start, end)} 올렸어요. 신청 화면에 바로 반영돼요.`);
  } else {
    setAdminStatus("⚠️ 올리지 못했어요. 잠시 후 다시 시도해주세요.");
  }
  setGesture({ kind: "idle" });
}

// ---------- 상세 시트 ----------
function openSheet(block) {
  admin.sheet = block.dataset.kind === "booking"
    ? { kind: "booking", id: block.dataset.id }
    : { kind: "window", date: block.closest(".week-day").dataset.date, start: Number(block.dataset.start), end: Number(block.dataset.end) };
  admin.armedCancelId = null;
  renderSheet();
}

function closeSheet() {
  admin.sheet = null;
  renderSheet();
}

function renderSheet() {
  const sheet = $("#sheet");
  const body = sheetBodyHTML();
  sheet.classList.toggle("hidden", body === null);
  if (body === null) { admin.sheet = null; return; }
  $("#sheetBody").innerHTML = body;
}

function sheetBodyHTML() {
  const s = admin.sheet;
  if (!s) return null;
  if (s.kind === "booking") {
    const booking = admin.bookings.find((b) => b.id === s.id);
    return booking ? bookingHTML(booking) : null;
  }
  const exists = (admin.availability[s.date] || []).some(([a, b]) => a === s.start && b === s.end);
  if (!exists) return null;
  return `
    <p class="sheet-title">${dateLabel(s.date)} ${timeRange(s.start, s.end)}</p>
    <p class="hint">신청을 받을 수 있게 열어 둔 시간이에요. 이미 들어온 신청은 함께 지워지지 않아요.</p>
    <button type="button" class="sheet-delete" id="sheetDelete">이 시간 지우기</button>`;
}

$("#sheetClose").addEventListener("click", closeSheet);
$("#sheetBody").addEventListener("click", async (e) => {
  if (!e.target.closest("#sheetDelete")) return;
  const { date, start, end } = admin.sheet;
  await callApi("/api/admin/availability", "DELETE", { date, start, end }).catch(() => {});
  admin.sheet = null;
  await refreshDashboard().catch(() => {});
  renderSheet();
});

// ---------- 신청 현황 ----------
function bookingHTML(b) {
  return `
    <div class="booking ${isMine(b) ? "mine" : ""}">
      <div class="booking-head">
        <b>${esc(b.name)}</b><span>님의 신청</span>
        <span class="booking-with">${PARTY_LABELS[b.party]}</span>
      </div>
      <div class="booking-time">${dateLabel(b.date)} ${timeRange(b.start, b.end)}</div>
      <div class="booking-meta">${esc(b.method)} · ${esc(b.location)}${b.isCustom ? " (직접 추천)" : ""}</div>
      ${b.message ? `<div class="booking-message">${esc(b.message)}</div>` : ""}
      <button type="button" class="booking-cancel" data-id="${esc(b.id)}">${admin.armedCancelId === b.id ? "정말 취소할까요?" : "취소"}</button>
    </div>`;
}

function renderBookings() {
  $("#bookingCount").textContent = admin.bookings.length ? `${admin.bookings.length}건` : "";
  $("#bookingList").innerHTML = admin.bookings.map(bookingHTML).join("") || `<p class="hint">아직 들어온 신청이 없어요.</p>`;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".booking-cancel");
  if (!btn) return;
  const id = btn.dataset.id;
  if (admin.armedCancelId !== id) {
    admin.armedCancelId = id;
    renderBookings();
    renderSheet();
    return;
  }
  admin.armedCancelId = null;
  await callApi("/api/admin/bookings", "DELETE", { id }).catch(() => {});
  await refreshDashboard().catch(() => {});
});

// ---------- 내가 올린 시간 ----------
function renderMyWindows() {
  const dates = Object.keys(admin.availability).sort();
  $("#myWindows").innerHTML = dates.map((date) => `
    <div class="window-row">
      <span class="window-date">${dateLabel(date)}</span>
      <span class="window-chips">${admin.availability[date].map(([s, e]) =>
        `<button class="window-chip" data-date="${date}" data-start="${s}" data-end="${e}" aria-label="${timeRange(s, e)} 삭제">${timeRange(s, e)} ✕</button>`
      ).join("")}</span>
    </div>`).join("") || `<p class="hint">아직 올린 시간이 없어요.</p>`;
  $$("#myWindows .window-chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await callApi("/api/admin/availability", "DELETE", {
        date: btn.dataset.date, start: Number(btn.dataset.start), end: Number(btn.dataset.end),
      }).catch(() => {});
      await refreshDashboard().catch(() => {});
    });
  });
}

refreshDashboard().catch(() => {});
setInterval(() => {
  if (admin.host && !document.hidden) refreshDashboard().catch(() => {});
}, ADMIN_POLL_MS);
