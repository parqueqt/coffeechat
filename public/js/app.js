// ===== 커피챗 신청 앱 =====
// 흐름: 입장(이름) → 1 누구와 → 2 언제(날짜/시간대/시각) → 3 방법 → 4 어디서 → 5 메시지+제출
"use strict";

const state = {
  name: null,
  party: null,       // hyunwoo | minseok | both
  date: null,        // "YYYY-MM-DD"
  slot: null,        // 시간대 key
  time: null,        // 시작 "HH:MM"
  endTime: null,     // 종료 "HH:MM" (24:00 가능)
  method: null,      // 식사 | 커피 | 운동 | 기타
  subType: null,     // place | custom | sport
  subLabel: null,    // 장소/종목/자유 텍스트
  placeSid: null,
  message: "",
};

// status: loading | ready | error. free: { party: { date: [[시작분, 끝분], ...] } }
const schedule = { status: "loading", today: null, free: {} };
let calView = null;

// ---------- 유틸 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const pad2 = (n) => String(n).padStart(2, "0");
const minToHHMM = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; // 1440 → "24:00"
const dateKey = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

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

const monthIndex = ({ year, month }) => year * 12 + month;

function shiftMonth({ year, month }, delta) {
  const moved = new Date(year, month - 1 + delta, 1);
  return { year: moved.getFullYear(), month: moved.getMonth() + 1 };
}

function monthHeaderHTML({ year, month }, canPrev, canNext) {
  return `<div class="cal-header">
    <button type="button" class="cal-nav" data-nav="-1" aria-label="이전 달" ${canPrev ? "" : "disabled"}>‹</button>
    <span>${year}년 ${month}월</span>
    <button type="button" class="cal-nav" data-nav="1" aria-label="다음 달" ${canNext ? "" : "disabled"}>›</button>
  </div>`;
}

function monthGridHTML({ year, month }, dayCell) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  let html = DOW_KO.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  html += `<div class="cal-empty"></div>`.repeat(firstDow);
  for (let day = 1; day <= daysInMonth; day++) html += dayCell(dateKey(year, month, day), day);
  return `<div class="cal-grid">${html}</div>`;
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

function slotByKey(key) { return SLOTS.find((s) => s.key === key); }

// ---------- 영업시간 판단 ----------
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
function toMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function hoursForDay(p, date) {
  if (!p.h || !p.h.length) return null; // 데이터 없음
  const dow = DOW_KO[dowOf(date)];
  return p.h.filter((h) => {
    const d = h.d || "";
    if (d.includes("매일") || d.includes(dow)) return true;
    if (d.includes("~")) { // 예: "월~금"
      const parts = d.split("~");
      const ai = DOW_KO.indexOf(parts[0].trim().charAt(0));
      const bi = DOW_KO.indexOf(parts[1].trim().charAt(0));
      const di = DOW_KO.indexOf(dow);
      if (ai >= 0 && bi >= 0) return ai <= bi ? (di >= ai && di <= bi) : (di >= ai || di <= bi);
    }
    return false;
  });
}

// true=영업중 / false=영업 아님(가능성) / null=정보 없음
function isOpenAt(p, date, time) {
  const hs = hoursForDay(p, date);
  if (hs === null) return null;
  if (!hs.length) return false; // 그 요일 영업 정보 없음 → 휴무 가능성
  const t = toMin(time);
  for (const h of hs) {
    let s = toMin(h.s), e = toMin(h.e);
    if (e <= s) e += 1440; // 자정 넘김
    const inMain = (t >= s && t < e) || (t + 1440 >= s && t + 1440 < e);
    if (inMain) {
      const inBreak = (h.b || []).some((br) => br[0] && t >= toMin(br[0]) && t < toMin(br[1]));
      if (!inBreak) return true;
    }
  }
  return false;
}

function menuLine(p, n) {
  if (!p.m || !p.m.length) return "";
  return p.m.slice(0, n).map((x) => x[0]).join(" · ");
}

function hoursLine(p) {
  if (!p.h || !p.h.length) return "";
  const h = p.h[0];
  return `${h.d} ${h.s}~${h.e}${p.h.length > 1 ? " 외" : ""}`;
}

// ---------- 스텝 이동 ----------
function goStep(n) {
  ["step1", "step2", "step3", "step4", "step5", "stepDone"].forEach((id) => $("#" + id).classList.add("hidden"));
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

// ---------- STEP 1: 누구와 ----------
function clearWhen() {
  state.date = null; state.slot = null; state.time = null; state.endTime = null;
  $("#step2Notice").textContent = "";
}

$$(".party-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.party = btn.dataset.party;
    clearWhen();
    calView = null;
    renderCalendar();
    goStep(2);
    loadSchedule();
  });
});

// ---------- STEP 2: 언제 ----------
const STEP_MIN = 30;           // 드롭다운 간격(분)
const DEFAULT_DURATION = 60;   // 시작 시각 선택 시 기본 종료 = +1시간
const MAX_DURATION = 120;      // 서버 검증과 같은 값
const ENDSEL_PLACEHOLDER = `<option value="">종료 시각</option>`;

function freeOn(date) { return (schedule.free[state.party] || {})[date] || []; }

function startOptions(date, slot) {
  const list = [];
  for (let m = slot.from * 60; m < slot.to * 60; m += STEP_MIN) {
    if (freeOn(date).some(([s, e]) => s <= m && m + STEP_MIN <= e)) list.push(m);
  }
  return list;
}

function isSlotFree(date, slotKey) { return startOptions(date, slotByKey(slotKey)).length > 0; }
function freeSlotCount(date) { return SLOTS.filter((s) => isSlotFree(date, s.key)).length; }

function maxEndMin(date, startMin) {
  const interval = freeOn(date).find(([s, e]) => s <= startMin && startMin < e);
  return Math.min(interval[1], startMin + MAX_DURATION);
}

function openDates() {
  return Object.keys(schedule.free[state.party] || {}).filter((d) => freeSlotCount(d) > 0).sort();
}

function renderCalendar() {
  const cal = $("#calendar");
  $("#slotPicker").classList.add("hidden");
  updateNext2();
  if (schedule.status !== "ready") {
    cal.innerHTML = `<p class="hint">${schedule.status === "error"
      ? "⚠️ 일정을 불러오지 못했어요. 잠시 후 새로고침해주세요."
      : "⏳ 열린 시간을 불러오는 중…"}</p>`;
    return;
  }
  const open = openDates();
  const todayMonth = parseDateKey(schedule.today);
  calView = calView || (open.length ? parseDateKey(open[0]) : todayMonth);
  const lastMonth = open.length ? parseDateKey(open[open.length - 1]) : todayMonth;
  const canPrev = monthIndex(calView) > monthIndex(todayMonth);
  const canNext = monthIndex(calView) < monthIndex(lastMonth);
  const grid = monthGridHTML(calView, (key, day) => {
    const free = open.includes(key) ? freeSlotCount(key) : 0;
    return `<button class="cal-day ${state.date === key ? "selected" : ""}" data-date="${key}" ${free ? "" : "disabled"}>
      ${day}${free ? `<span class="avail-dots">${"●".repeat(Math.min(free, 4))}</span>` : ""}</button>`;
  });
  const empty = open.length ? "" : `<p class="hint">🙏 ${state.party === "both"
    ? "두 분이 함께 비는 시간이 아직 없어요. 한 분씩 골라보시거나 조금 뒤에 다시 와주세요!"
    : "아직 열린 시간이 없어요. 곧 올라올 거예요!"}</p>`;
  cal.innerHTML = monthHeaderHTML(calView, canPrev, canNext) + grid + empty;
  cal.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      calView = shiftMonth(calView, Number(btn.dataset.nav));
      clearWhen();
      renderCalendar();
    });
  });
  cal.querySelectorAll(".cal-day:not(:disabled)").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearWhen();
      state.date = btn.dataset.date;
      cal.querySelectorAll(".cal-day").forEach((b) => b.classList.toggle("selected", b.dataset.date === state.date));
      renderSlots();
      updateNext2();
    });
  });
}

function renderSlots() {
  $("#slotPicker").classList.remove("hidden");
  $("#slotDateLabel").textContent = `${dateLabel(state.date)}, 시간대를 골라주세요`;
  $("#slotGrid").innerHTML = SLOTS.map((s) => {
    const free = isSlotFree(state.date, s.key);
    return `<button class="slot-chip ${state.slot === s.key ? "selected" : ""}" data-slot="${s.key}" ${free ? "" : "disabled"}>
      ${s.key}<small>${s.label}</small></button>`;
  }).join("");
  $$("#slotGrid .slot-chip:not(:disabled)").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.slot = btn.dataset.slot;
      $$("#slotGrid .slot-chip").forEach((b) => b.classList.toggle("selected", b.dataset.slot === state.slot));
      showTimeInput();
      updateNext2();
    });
  });
  $("#timeInputWrap").classList.add("hidden");
}

function resetEndSel() {
  const endSel = $("#endSel");
  endSel.innerHTML = ENDSEL_PLACEHOLDER;
  endSel.disabled = true;
  state.endTime = null;
}

function renderEndOptions() {
  const endSel = $("#endSel");
  const startMin = toMin(state.time);
  const maxEnd = maxEndMin(state.date, startMin);
  const opts = [];
  for (let m = startMin + STEP_MIN; m <= maxEnd; m += STEP_MIN) opts.push(m);
  endSel.innerHTML = opts.map((m) => `<option value="${m}">${minToHHMM(m)}</option>`).join("");
  const def = opts.includes(startMin + DEFAULT_DURATION) ? startMin + DEFAULT_DURATION : opts[opts.length - 1];
  endSel.value = String(def);
  endSel.disabled = false;
  state.endTime = minToHHMM(def);
}

function showTimeInput() {
  const s = slotByKey(state.slot);
  $("#timeInputWrap").classList.remove("hidden");
  $("#timeRangeHint").textContent = `${s.key} 시간대(${s.label})에서 시작 시각을 고르면 종료 시각을 정할 수 있어요 (최대 2시간)`;
  state.time = null;
  $("#startSel").innerHTML = `<option value="">시작 시각</option>` +
    startOptions(state.date, s).map((m) => `<option value="${m}">${minToHHMM(m)}</option>`).join("");
  resetEndSel();
}

$("#startSel").addEventListener("change", (e) => {
  const v = e.target.value;
  if (!v) { state.time = null; resetEndSel(); updateNext2(); return; }
  state.time = minToHHMM(Number(v));
  renderEndOptions();
  updateNext2();
});
$("#endSel").addEventListener("change", (e) => {
  state.endTime = e.target.value ? minToHHMM(Number(e.target.value)) : null;
  updateNext2();
});

function timeRangeLabel() { return `${state.time}~${state.endTime}`; }

function validStep2() { return state.date && state.slot && state.time && state.endTime; }
function updateNext2() { $("#toStep3").classList.toggle("hidden", !validStep2()); }

$("#step2 .btn-back").addEventListener("click", () => goStep(1));
$("#toStep3").addEventListener("click", () => { if (validStep2()) goStep(3); });

// ---------- STEP 3: 방법 ----------
$$(".method-card[data-method]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.method = btn.dataset.method;
    state.subType = null; state.subLabel = null; state.placeSid = null;
    renderStep4();
    goStep(4);
  });
});
$("#step3 .btn-back").addEventListener("click", () => goStep(2));

// ---------- STEP 4: 어디서 ----------
function openFilterHint() {
  return `<p class="hint">🕐 <b>${dateLabel(state.date)} ${state.time}</b>에 영업하지 않는 곳은 자동으로 제외했어요. (영업시간 정보가 없는 곳은 보여드려요)</p>`;
}

function renderStep4() {
  const el = $("#step4");
  if (state.method === "식사") {
    el.innerHTML = `
      <p class="step-title">🍚 어디서 먹을까요?</p>
      <p class="hint">맛집 리스트예요. ⭐찐맛집 · ✅검증된 맛집부터 골라보세요!</p>
      ${openFilterHint()}
      ${pickerHTML("meal")}`;
    initPicker("meal");
  } else if (state.method === "커피") {
    el.innerHTML = `
      <p class="step-title">☕ 어느 카페로 갈까요?</p>
      <p class="hint">💡 좋은 곳 아시면 <b>직접 추천</b>해주셔도 좋아요!</p>
      ${openFilterHint()}
      ${pickerHTML("cafe")}`;
    initPicker("cafe");
  } else if (state.method === "운동") {
    el.innerHTML = `
      <p class="step-title">🏸 어떤 운동을 할까요?</p>
      <div class="sport-grid">
        ${SPORTS.map((s) => `<button class="sport-card" data-sport="${s.name}"><span class="s-emoji">${s.emoji}</span>${s.name}</button>`).join("")}
        <button class="sport-card" data-sport="__custom"><span class="s-emoji">✏️</span>직접 제안</button>
      </div>
      <div class="custom-wrap hidden" id="customWrap">
        <input type="text" id="customInput" placeholder="하고 싶은 운동을 알려주세요!" maxlength="40">
      </div>
      ${navRowHTML()}`;
    $$("#step4 .sport-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#step4 .sport-card").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        if (btn.dataset.sport === "__custom") {
          $("#customWrap").classList.remove("hidden");
          state.subType = "custom"; state.subLabel = $("#customInput").value.trim();
          $("#customInput").focus();
        } else {
          $("#customWrap").classList.add("hidden");
          state.subType = "sport"; state.subLabel = btn.dataset.sport;
        }
        updateNext4();
      });
    });
    bindCustomInput();
    bindNavRow();
  } else {
    el.innerHTML = `
      <p class="step-title">✨ 자유롭게 제안해주세요!</p>
      <p class="hint">독서 📖, 노래방 🎤, 보드게임, 산책, 전시… 뭐든 환영이에요.</p>
      <div class="custom-wrap">
        <input type="text" id="customInput" placeholder="예: 같이 독서해요! / 노래방 가요!" maxlength="60">
      </div>
      ${navRowHTML()}`;
    state.subType = "custom";
    bindCustomInput();
    bindNavRow();
  }
}

function navRowHTML() {
  return `
    <div class="nav-row">
      <button class="btn-back" data-back="3">← 이전</button>
      <button class="btn-next" id="toStep5" disabled style="opacity:.5">다음 →</button>
    </div>`;
}

function bindCustomInput() {
  const inp = $("#customInput");
  if (!inp) return;
  inp.addEventListener("input", () => {
    if (state.subType === "custom") state.subLabel = inp.value.trim();
    updateNext4();
  });
}

function bindNavRow() {
  const back = $("#step4 .btn-back");
  if (back) back.addEventListener("click", () => goStep(3));
  const next = $("#toStep5");
  if (next) next.addEventListener("click", () => {
    if (!state.subLabel) return;
    renderStep5();
    goStep(5);
  });
}

function updateNext4() {
  const next = $("#toStep5");
  if (!next) return;
  const ok = !!state.subLabel;
  next.disabled = !ok;
  next.style.opacity = ok ? "1" : ".5";
}

// ---------- 장소 선택 컴포넌트 (식사/커피 공용) ----------
const pickerCtx = { mode: "meal", tier: 0, cat: "전체", region: "전체", q: "", view: "map", map: null, markers: [], infoWin: null };

function pickerHTML(mode) {
  const isCafe = mode === "cafe";
  const regions = [...new Set(PLACES.filter((p) => !isCafe || p.c === "카페").map((p) => p.r))].sort();
  return `
    <div class="view-toggle">
      <button id="vwMap" class="on">🗺️ 지도</button>
      <button id="vwList">📃 리스트</button>
    </div>
    <div class="filter-row">
      <button class="chip tier-chip on" data-tier="0">전체</button>
      <button class="chip tier-chip" data-tier="3">⭐ 찐맛집</button>
      <button class="chip tier-chip" data-tier="2">✅ 검증된</button>
      ${isCafe ? "" : `
      <button class="chip cat-chip on" data-cat="전체">모든 종류</button>
      <button class="chip cat-chip" data-cat="식사">🍚 식사</button>
      <button class="chip cat-chip" data-cat="카페">☕ 카페</button>
      <button class="chip cat-chip" data-cat="술·바">🍺 술·바</button>`}
      <select class="region-select" id="regionSel">
        <option value="전체">모든 지역</option>
        ${regions.map((r) => `<option value="${r}">${r}</option>`).join("")}
      </select>
      <input class="search-input" id="placeSearch" placeholder="🔍 이름/주소 검색">
    </div>
    <p class="count-label" id="countLabel"></p>
    <div id="mapBox" class="hidden"></div>
    <div class="place-list" id="placeList"></div>
    <button class="etc-toggle" id="etcToggle">✏️ 리스트에 없어요! 제가 추천할게요 (etc)</button>
    <button class="etc-toggle" id="skipToggle">🤷 아직 못 정했어요 — 만나서 정할게요 (스킵)</button>
    <div class="custom-wrap hidden" id="customWrap">
      <input type="text" id="customInput" placeholder="${isCafe ? "추천하고 싶은 카페를 알려주세요!" : "추천하고 싶은 맛집을 알려주세요!"}" maxlength="60">
    </div>
    <div id="selectedBanner" class="selected-banner hidden"></div>
    ${navRowHTML()}`;
}

function initPicker(mode) {
  pickerCtx.mode = mode; pickerCtx.tier = 0; pickerCtx.cat = "전체";
  pickerCtx.region = "전체"; pickerCtx.q = ""; pickerCtx.view = "map";
  pickerCtx.map = null; pickerCtx.markers = [];

  $$("#step4 .tier-chip").forEach((c) => c.addEventListener("click", () => {
    $$("#step4 .tier-chip").forEach((x) => x.classList.remove("on"));
    c.classList.add("on");
    pickerCtx.tier = Number(c.dataset.tier);
    refreshPicker();
  }));
  $$("#step4 .cat-chip").forEach((c) => c.addEventListener("click", () => {
    $$("#step4 .cat-chip").forEach((x) => x.classList.remove("on"));
    c.classList.add("on");
    pickerCtx.cat = c.dataset.cat;
    refreshPicker();
  }));
  $("#regionSel").addEventListener("change", (e) => { pickerCtx.region = e.target.value; refreshPicker(); });
  $("#placeSearch").addEventListener("input", (e) => { pickerCtx.q = e.target.value.trim(); refreshPicker(); });

  $("#vwList").addEventListener("click", () => setPickerView("list"));
  $("#vwMap").addEventListener("click", () => setPickerView("map"));

  $("#skipToggle").addEventListener("click", () => {
    state.subType = "skip"; state.subLabel = "미정 (만나서 결정)"; state.placeSid = null;
    $("#customWrap").classList.add("hidden");
    $$("#step4 .place-item").forEach((x) => x.classList.remove("selected"));
    const banner = $("#selectedBanner");
    banner.classList.remove("hidden");
    banner.innerHTML = `✔ 장소는 <b>만나서 정하기</b>로 했어요 — 아래 <b>다음</b> 버튼을 눌러주세요!`;
    updateNext4();
  });
  $("#etcToggle").addEventListener("click", () => {
    $("#customWrap").classList.toggle("hidden");
    if (!$("#customWrap").classList.contains("hidden")) {
      state.subType = "custom"; state.subLabel = $("#customInput").value.trim(); state.placeSid = null;
      $$("#step4 .place-item").forEach((x) => x.classList.remove("selected"));
      $("#customInput").focus();
      updateNext4();
    }
  });
  bindCustomInput();
  bindNavRow();
  refreshPicker();
  setPickerView(CONFIG.NAVER_CLIENT_ID ? "map" : "list");
}

function filteredPlaces() {
  const isCafe = pickerCtx.mode === "cafe";
  const list = PLACES.filter((p) => {
    if (isCafe && p.c !== "카페") return false;
    if (pickerCtx.tier && p.t !== pickerCtx.tier) return false;
    if (!isCafe && pickerCtx.cat !== "전체" && p.c !== pickerCtx.cat) return false;
    if (pickerCtx.region !== "전체" && p.r !== pickerCtx.region) return false;
    if (pickerCtx.q && !(p.n.includes(pickerCtx.q) || p.a.includes(pickerCtx.q))) return false;
    // 선택한 날짜·시각에 영업하지 않는 곳 제외 (정보 없는 곳은 유지)
    if (state.date && state.time && isOpenAt(p, state.date, state.time) === false) return false;
    return true;
  });
  // 관악구 → 서울 → 그 외 순으로, 같은 지역에선 찐맛집/검증된 우선
  const rank = (p) => (p.g === "관악구" ? 0 : p.r === "서울" ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || b.t - a.t || a.n.localeCompare(b.n, "ko"));
  return list;
}

function tierBadge(p) {
  if (p.t === 3) return `<span class="pi-badge badge-t3">⭐ 찐맛집</span>`;
  if (p.t === 2) return `<span class="pi-badge badge-t2">✅ 검증된</span>`;
  return "";
}

function refreshPicker() {
  const list = filteredPlaces();
  $("#countLabel").textContent = `${list.length}곳 (선택 시각 영업 기준)`;
  const box = $("#placeList");
  box.innerHTML = list.map((p) => `
    <button class="place-item ${state.placeSid === p.sid ? "selected" : ""}" data-sid="${p.sid}">
      <div>
        <span class="pi-name">${p.n}</span>${tierBadge(p)}
        <div class="pi-addr">${p.c} · ${p.a}</div>
        ${menuLine(p, 2) ? `<div class="pi-menu">🍽 ${menuLine(p, 2)}</div>` : ""}
      </div>
      <a class="pi-link" href="https://map.naver.com/p/entry/place/${p.sid}" target="_blank" rel="noopener" onclick="event.stopPropagation()">네이버 ↗</a>
    </button>`).join("") || `<p class="hint">조건에 맞는 곳이 없어요 😢 필터를 바꾸거나 직접 추천해주세요!</p>`;
  $$("#step4 .place-item").forEach((item) => {
    item.addEventListener("click", () => selectPlace(item.dataset.sid));
  });
  if (pickerCtx.view === "map") renderMarkers(list);
}

function selectPlace(sid) {
  const p = PLACES.find((x) => x.sid === sid);
  if (!p) return;
  state.subType = "place"; state.subLabel = p.n; state.placeSid = sid;
  $("#customWrap").classList.add("hidden");
  $$("#step4 .place-item").forEach((x) => x.classList.toggle("selected", x.dataset.sid === sid));
  // 선택됨 배너 표시 (지도 모드에서도 선택이 됐다는 걸 확실히 보여줌)
  const banner = $("#selectedBanner");
  if (banner) {
    banner.classList.remove("hidden");
    banner.innerHTML = `✔ 선택됨: <b>${p.n}</b> — 아래 <b>다음</b> 버튼을 눌러주세요!`;
  }
  updateNext4();
}
window.__selectPlace = selectPlace; // 지도 인포윈도우에서 사용

function setPickerView(view) {
  pickerCtx.view = view;
  $("#vwList").classList.toggle("on", view === "list");
  $("#vwMap").classList.toggle("on", view === "map");
  $("#placeList").classList.toggle("hidden", view === "map");
  $("#mapBox").classList.toggle("hidden", view !== "map");
  if (view === "map") ensureMap();
}

// ---------- 네이버 지도 ----------
let naverLoading = false;
function ensureMap() {
  if (!CONFIG.NAVER_CLIENT_ID) {
    $("#mapBox").innerHTML = `<div class="map-notice">🗺️ 지도는 준비 중이에요!<br>리스트에서 골라주세요 🙏</div>`;
    $("#mapBox").style.height = "auto";
    return;
  }
  if (window.naver && window.naver.maps) { buildMap(); return; }
  if (naverLoading) return;
  naverLoading = true;
  const s = document.createElement("script");
  s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CONFIG.NAVER_CLIENT_ID}`;
  s.onload = buildMap;
  document.head.appendChild(s);
}

function buildMap() {
  if (!$("#mapBox") || $("#mapBox").classList.contains("hidden")) return;
  pickerCtx.map = new naver.maps.Map("mapBox", {
    center: new naver.maps.LatLng(37.4783, 126.9527), // 서울대입구
    zoom: 13,
  });
  pickerCtx.infoWin = new naver.maps.InfoWindow({ content: "", borderWidth: 0, backgroundColor: "transparent", disableAnchor: true });
  // 지도 빈 곳을 클릭해도 인포윈도우 닫힘
  naver.maps.Event.addListener(pickerCtx.map, "click", () => pickerCtx.infoWin && pickerCtx.infoWin.close());
  renderMarkers(filteredPlaces());
}

window.__closeInfo = () => { if (pickerCtx.infoWin) pickerCtx.infoWin.close(); };

function markerColor(t) { return t === 3 ? "#e8a020" : t === 2 ? "#5c8a58" : "#8b5e34"; }

function renderMarkers(list) {
  if (!pickerCtx.map || !(window.naver && window.naver.maps)) return;
  pickerCtx.markers.forEach((m) => m.setMap(null));
  pickerCtx.markers = [];
  list.forEach((p) => {
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: pickerCtx.map,
      title: p.n,
      icon: {
        content: `<div style="width:${p.t === 3 ? 18 : 13}px;height:${p.t === 3 ? 18 : 13}px;border-radius:50%;background:${markerColor(p.t)};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        anchor: new naver.maps.Point(8, 8),
      },
    });
    naver.maps.Event.addListener(marker, "click", () => {
      const div = document.createElement("div");
      div.innerHTML = `
        <div style="position:relative;background:#fff;border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.25);padding:12px 30px 12px 14px;font-family:Pretendard,sans-serif;max-width:230px">
          <button type="button" class="iw-close" style="position:absolute;top:6px;right:6px;width:22px;height:22px;border:none;background:#f3e2cd;color:#8b5e34;border-radius:50%;font-size:12px;font-weight:700;cursor:pointer;line-height:1">✕</button>
          <b style="font-size:15px">${p.n}</b> ${p.t === 3 ? "⭐" : p.t === 2 ? "✅" : ""}
          <div style="font-size:12px;color:#8a7060;margin:4px 0">${p.c} · ${p.a}</div>
          ${menuLine(p, 3) ? `<div style="font-size:12px;color:#3b2a1f;margin:2px 0">🍽 ${menuLine(p, 3)}</div>` : ""}
          ${hoursLine(p) ? `<div style="font-size:12px;color:#8a7060;margin:2px 0">🕐 ${hoursLine(p)}</div>` : ""}
          <div style="display:flex;gap:6px;margin-top:8px">
            <button type="button" class="iw-select" style="flex:1;background:#c47b3f;color:#fff;border:none;border-radius:8px;padding:7px;font-weight:700;cursor:pointer;font-family:inherit">이곳 선택 ✓</button>
            <a href="https://map.naver.com/p/entry/place/${p.sid}" target="_blank" rel="noopener" style="background:#f3e2cd;color:#8b5e34;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:700;text-decoration:none">상세 ↗</a>
          </div>
        </div>`;
      div.querySelector(".iw-close").addEventListener("click", (ev) => {
        ev.stopPropagation();
        pickerCtx.infoWin.close();
      });
      div.querySelector(".iw-select").addEventListener("click", (ev) => {
        ev.stopPropagation();
        selectPlace(p.sid);
        pickerCtx.infoWin.close();
      });
      pickerCtx.infoWin.setContent(div);
      pickerCtx.infoWin.open(pickerCtx.map, marker);
    });
    pickerCtx.markers.push(marker);
  });
}

// ---------- STEP 5: 메시지 + 확인 ----------
function renderStep5() {
  $("#summary").innerHTML = `
    <div><b>이름</b> ${esc(state.name)}</div>
    <div><b>누구와</b> ${PARTY_LABELS[state.party]}</div>
    <div><b>날짜</b> ${dateLabel(state.date)}</div>
    <div><b>시간</b> ${state.slot} · ${timeRangeLabel()}</div>
    <div><b>방법</b> ${({ 식사: "🍚", 커피: "☕", 운동: "🏸", 기타: "✨" })[state.method]} ${state.method}</div>
    <div><b>${state.method === "운동" ? "종목" : "장소"}</b> ${esc(state.subLabel)}${state.subType === "custom" ? " (직접 추천)" : ""}</div>`;
  $("#step5 .btn-back").onclick = () => goStep(4);
}

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
      location: state.subLabel,
      isCustom: state.subType === "custom",
      message: state.message,
    });
    if (out.ok) {
      $("#doneMsg").innerHTML = `<b>${esc(state.name)}</b>님, ${dateLabel(state.date)} ${timeRangeLabel()}<br>${PARTY_LABELS[state.party]}와(과) 「${esc(state.subLabel)}」에서 만나요!`;
      goStep("done");
    } else if (out.error === "slot_taken") {
      clearWhen();
      await loadSchedule();
      renderCalendar();
      $("#step2Notice").textContent = "😢 아쉽게도 방금 다른 분이 그 시간을 선택했어요. 다른 시간을 골라주세요!";
      goStep(2);
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
  if (!$("#step2").classList.contains("hidden") && !state.date) renderCalendar();
}

// 날짜를 고르기 전까지만 갱신한다. 고른 뒤에 다시 그리면 입력 중인 시간이 사라진다.
setInterval(() => {
  if (!document.hidden && !$("#app").classList.contains("hidden") && !$("#step2").classList.contains("hidden") && !state.date) {
    loadSchedule();
  }
}, 15000);
