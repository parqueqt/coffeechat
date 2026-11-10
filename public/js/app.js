// ===== 커피챗 신청 앱 =====
// 흐름: 입장(이름) → 1 누구와·언제(달력에서 날짜 → 사람별 가능 시간 → 시각) → 3 방법 → 5 메시지+제출
// 단계 id 는 step1·step3·step5 를 쓴다(예전 2·4단계는 합치거나 지웠다).
"use strict";

const state = {
  name: null,
  party: null,       // hyunwoo | minseok | both
  date: null,        // 달력에서 고른 날 "YYYY-MM-DD"
  window: null,      // 고른 가능 시간 [시작분, 끝분]
  time: null,        // 시작 "HH:MM"
  endTime: null,     // 종료 "HH:MM" (24:00 가능)
  method: null,      // 식사 | 커피 | 줌 | 기타
  message: "",
};

// status: loading | ready | error. free: { party: { date: [[시작분, 끝분], ...] } }
const schedule = { status: "loading", today: null, free: {} };
let calView = null; // 달력에 보이는 달 { year, month }

// ---------- 유틸 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const pad2 = (n) => String(n).padStart(2, "0");
const minToHHMM = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; // 1440 → "24:00"
const dateKey = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

function dowOf(key) {
  const { year, month, day } = parseDateKey(key);
  return new Date(year, month - 1, day).getDay();
}

function dateLabel(key) {
  const { month, day } = parseDateKey(key);
  return `${month}월 ${day}일 (${DOW_KO[dowOf(key)]})`;
}

async function callApi(path, method, body) {
  const res = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ---------- 스텝 이동 ----------
function goStep(n) {
  ["step1", "step3", "step5", "stepDone"].forEach((id) => $("#" + id).classList.add("hidden"));
  $("#" + (n === "done" ? "stepDone" : "step" + n)).classList.remove("hidden");
  $$(".step-dot").forEach((dot) => {
    const s = Number(dot.dataset.step);
    dot.classList.toggle("active", s === n);
    dot.classList.toggle("done", n === "done" ? true : s < n);
  });
  $("#apply").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 입장 ----------
function setGateRole(role) {
  $$(".gate-role").forEach((b) => b.classList.toggle("on", b.dataset.role === role));
  $("#guestPanel").classList.toggle("hidden", role !== "guest");
  $("#adminPanel").classList.toggle("hidden", role !== "admin");
}
$$(".gate-role").forEach((b) => b.addEventListener("click", () => setGateRole(b.dataset.role)));

function enterApp() {
  state.name = $("#applicantName").value.trim();
  if (!state.name) return;
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  window.scrollTo(0, 0);
  renderCalendar();
  loadSchedule();
}

$("#applicantName").addEventListener("input", () => {
  const ok = !!$("#applicantName").value.trim();
  const btn = $("#enterBtn");
  btn.disabled = !ok;
  btn.style.opacity = ok ? "1" : ".5";
});
$("#enterBtn").addEventListener("click", enterApp);
// keydown이 아니라 keyup을 쓰는 이유: 한글 IME는 조합 중 첫 엔터를 "조합 확정"에 써 버려서
// keydown만 보면 엔터를 두 번 눌러야 넘어감. keyup 시점엔 조합이 끝나 value가 확정돼 있음.
$("#applicantName").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
$("#applicantName").addEventListener("keyup", (e) => { if (e.key === "Enter") enterApp(); });

// ---------- STEP 1: 달력 → 그날 사람별 가능 시간 → 시각 ----------
const STEP_MIN = 30;           // 시각 간격(분). admin.js 도 쓴다
const DEFAULT_DURATION = 60;   // 기본 만남 길이
const MAX_DURATION = 120;      // 서버 검증과 같은 값
const HOSTS = ["hyunwoo", "minseok"];
const PARTY_SECTIONS = [
  { party: "hyunwoo", title: "🙋 박현우 가능 시간" },
  { party: "minseok", title: "🙋 박민석 가능 시간" },
  { party: "both", title: "🙌 두 분 함께 가능한 시간" },
];

const usableOn = (party, date) =>
  ((schedule.free[party] || {})[date] || []).filter(([s, e]) => e - s >= STEP_MIN);

function openDates() {
  const dates = new Set();
  for (const host of HOSTS) {
    for (const date of Object.keys(schedule.free[host] || {})) if (usableOn(host, date).length) dates.add(date);
  }
  return [...dates].sort();
}

const monthOf = (key) => { const { year, month } = parseDateKey(key); return { year, month }; };
const monthIndex = ({ year, month }) => year * 12 + month;
function shiftMonth({ year, month }, delta) {
  const moved = new Date(year, month - 1 + delta, 1);
  return { year: moved.getFullYear(), month: moved.getMonth() + 1 };
}

function clearPick() {
  Object.assign(state, { party: null, window: null, time: null, endTime: null });
  $("#step1Notice").textContent = "";
  $("#timeInputWrap").classList.add("hidden");
  updateNext1();
}

function renderCalendar() {
  const cal = $("#calendar");
  if (schedule.status !== "ready") {
    cal.innerHTML = `<p class="hint">${schedule.status === "error"
      ? "⚠️ 일정을 불러오지 못했어요. 잠시 후 새로고침해주세요."
      : "⏳ 가능한 시간을 불러오는 중…"}</p>`;
    $("#dayTimes").innerHTML = "";
    return;
  }
  const open = openDates();
  if (state.date && !open.includes(state.date)) { state.date = null; clearPick(); }
  const first = monthOf(schedule.today);
  const last = open.length ? monthOf(open[open.length - 1]) : first;
  calView = calView || (open.length ? monthOf(open[0]) : first);
  if (monthIndex(calView) < monthIndex(first)) calView = first;
  if (monthIndex(calView) > monthIndex(last)) calView = last;

  const { year, month } = calView;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  let cells = DOW_KO.map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
  cells += `<div class="cal-empty"></div>`.repeat(firstDow);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    const who = HOSTS.filter((host) => usableOn(host, key).length);
    const cls = ["cal-day", key === schedule.today ? "today" : "", key === state.date ? "selected" : ""].join(" ");
    cells += `<button type="button" class="${cls}" data-date="${key}" ${who.length ? "" : "disabled"}>
      <span class="cal-num">${day}</span>
      <span class="cal-dots">${who.map((host) => `<i class="dot dot-${host}"></i>`).join("")}</span>
    </button>`;
  }
  cal.innerHTML = `
    <div class="cal-header">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="이전 달" ${monthIndex(calView) > monthIndex(first) ? "" : "disabled"}>‹</button>
      <span>${year}년 ${month}월</span>
      <button type="button" class="cal-nav" data-nav="1" aria-label="다음 달" ${monthIndex(calView) < monthIndex(last) ? "" : "disabled"}>›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend"><span><i class="dot dot-hyunwoo"></i>박현우 가능</span><span><i class="dot dot-minseok"></i>박민석 가능</span></div>
    ${open.length ? "" : `<p class="hint">🙏 아직 올라온 시간이 없어요. 곧 올라올 거예요!</p>`}`;
  renderDayTimes(open.length > 0);
}

const isPicked = (party, s, e) => state.party === party && state.window?.[0] === s && state.window?.[1] === e;

function renderDayTimes(anyOpen) {
  const box = $("#dayTimes");
  if (!state.date) {
    box.innerHTML = anyOpen ? `<p class="hint">👆 점이 찍힌 날짜를 누르면 그날 가능한 시간이 나와요.</p>` : "";
    return;
  }
  const sections = PARTY_SECTIONS.map(({ party, title }) => {
    const list = usableOn(party, state.date);
    if (!list.length) return "";
    const chips = list.map(([s, e]) =>
      `<button type="button" class="time-chip ${isPicked(party, s, e) ? "selected" : ""}" data-party="${party}" data-start="${s}" data-end="${e}">${minToHHMM(s)}~${minToHHMM(e)}</button>`
    ).join("");
    return `<div class="board-section"><p class="board-title">${title}</p><div class="board-chips">${chips}</div></div>`;
  }).join("");
  box.innerHTML = `<p class="day-title">${dateLabel(state.date)}</p>${sections}`;
}

$("#calendar").addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav && !nav.disabled) {
    calView = shiftMonth(calView, Number(nav.dataset.nav));
    renderCalendar();
    return;
  }
  const day = e.target.closest(".cal-day");
  if (!day || day.disabled) return;
  state.date = day.dataset.date;
  clearPick();
  renderCalendar();
});

$("#dayTimes").addEventListener("click", (e) => {
  const chip = e.target.closest(".time-chip");
  if (!chip) return;
  const s = Number(chip.dataset.start);
  const end = Number(chip.dataset.end);
  Object.assign(state, { party: chip.dataset.party, window: [s, end] });
  $("#step1Notice").textContent = "";
  $$("#dayTimes .time-chip").forEach((b) => b.classList.toggle("selected", b === chip));
  const starts = [];
  for (let m = s; m + STEP_MIN <= end; m += STEP_MIN) starts.push(m);
  $("#startSel").innerHTML = starts.map((m) => `<option value="${m}">${minToHHMM(m)}</option>`).join("");
  state.time = minToHHMM(s);
  renderEndOptions();
  $("#pickedLabel").textContent = `${PARTY_LABELS[state.party]} · ${dateLabel(state.date)}, 만나는 시각을 정해주세요 🕐`;
  $("#timeInputWrap").classList.remove("hidden");
  updateNext1();
  $("#timeInputWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function renderEndOptions() {
  const startMin = toMin(state.time);
  const maxEnd = Math.min(state.window[1], startMin + MAX_DURATION);
  const opts = [];
  for (let m = startMin + STEP_MIN; m <= maxEnd; m += STEP_MIN) opts.push(m);
  const def = opts.includes(startMin + DEFAULT_DURATION) ? startMin + DEFAULT_DURATION : opts[opts.length - 1];
  $("#endSel").innerHTML = opts.map((m) => `<option value="${m}" ${m === def ? "selected" : ""}>${minToHHMM(m)}</option>`).join("");
  state.endTime = minToHHMM(def);
}

$("#startSel").addEventListener("change", (e) => {
  state.time = minToHHMM(Number(e.target.value));
  renderEndOptions();
  updateNext1();
});
$("#endSel").addEventListener("change", (e) => {
  state.endTime = minToHHMM(Number(e.target.value));
  updateNext1();
});

function timeRangeLabel() { return `${state.time}~${state.endTime}`; }

function validStep1() { return state.party && state.date && state.window && state.time && state.endTime; }
function updateNext1() { $("#toStep3").classList.toggle("hidden", !validStep1()); }

$("#toStep3").addEventListener("click", () => { if (validStep1()) goStep(3); });

// ---------- STEP 3: 방법 (장소는 고르지 않는다) ----------
const METHOD_EMOJI = { 식사: "🍚", 커피: "☕", 줌: "💻", 기타: "✨" };

$$(".method-card[data-method]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.method = btn.dataset.method;
    renderStep5();
    goStep(5);
  });
});
$("#step3 .btn-back").addEventListener("click", () => goStep(1));

// ---------- STEP 5: 메시지 + 확인 ----------
function renderStep5() {
  $("#summary").innerHTML = `
    <div><b>이름</b> ${esc(state.name)}</div>
    <div><b>누구와</b> ${PARTY_LABELS[state.party]}</div>
    <div><b>날짜</b> ${dateLabel(state.date)}</div>
    <div><b>시간</b> ${timeRangeLabel()}</div>
    <div><b>방법</b> ${METHOD_EMOJI[state.method]} ${state.method}</div>`;
}
$("#step5 .btn-back").addEventListener("click", () => goStep(3));

$("#messageInput").addEventListener("input", () => {
  state.message = $("#messageInput").value.trim();
});

const SUBMIT_ERRORS = {
  invalid_input: "⚠️ 입력 내용을 다시 확인해주세요.",
  busy: "⚠️ 신청이 몰리고 있어요. 잠시 후 다시 시도해주세요.",
  storage_not_configured: "⚠️ 예약 시스템이 아직 연결 준비 중이에요. 잠시 후 다시 시도해주세요!",
};

$("#submitBtn").addEventListener("click", async () => {
  const status = $("#submitStatus");
  const btn = $("#submitBtn");
  btn.disabled = true; btn.textContent = "신청 중… ☕";
  status.textContent = "";
  try {
    const out = await callApi("/api/bookings", "POST", {
      name: state.name,
      party: state.party,
      date: state.date,
      start: toMin(state.time),
      end: toMin(state.endTime),
      method: state.method,
      message: state.message,
    });
    if (out.ok) {
      const particle = state.method === "줌" ? "으로" : "로";
      $("#doneMsg").innerHTML = `<b>${esc(state.name)}</b>님, ${dateLabel(state.date)} ${timeRangeLabel()}<br>${PARTY_LABELS[state.party]}와(과) ${METHOD_EMOJI[state.method]} ${state.method}${particle} 만나요!`;
      goStep("done");
    } else if (out.error === "slot_taken") {
      clearPick();
      await loadSchedule();
      renderCalendar();
      $("#step1Notice").textContent = "😢 아쉽게도 방금 다른 분이 그 시간을 선택했어요. 다른 시간을 골라주세요!";
      goStep(1);
    } else {
      status.textContent = SUBMIT_ERRORS[out.error] || "⚠️ 오류가 발생했어요. 잠시 후 다시 시도해주세요.";
    }
  } catch (err) {
    status.textContent = "⚠️ 네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.";
  } finally {
    btn.disabled = false; btn.textContent = "커피챗 신청하기 🚀";
  }
});

// ---------- 일정 현황 로드 ----------
async function loadSchedule() {
  try {
    const out = await callApi("/api/schedule", "GET");
    if (!out.ok) throw new Error(out.error);
    schedule.today = out.today;
    schedule.free = out.free;
    schedule.status = "ready";
  } catch (err) {
    console.warn("schedule load failed", err);
    if (schedule.status !== "ready") schedule.status = "error";
  }
  if (!$("#step1").classList.contains("hidden") && !state.window) renderCalendar();
}

// 시간을 고르기 전까지만 갱신한다. 고른 뒤에 다시 그리면 고른 표시가 흔들린다.
setInterval(() => {
  if (!document.hidden && !$("#app").classList.contains("hidden") && !$("#step1").classList.contains("hidden") && !state.window) {
    loadSchedule();
  }
}, 15000);
