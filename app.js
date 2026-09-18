/* Wolf v2. One wolf, one number, one streak. Local-first, syncs one file per day to a private GitHub repo. */
(function () {
  "use strict";
  const P = window.PLAN;
  const $ = (s) => document.querySelector(s);
  const VERSION = "6.5";
  try { const qs = new URLSearchParams(location.search); if (/^\d{4}-\d{2}-\d{2}$/.test(qs.get("start") || "")) P.start = qs.get("start"); } catch {}

  /* ---------- dates ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dayIndex = (s) => Math.round((parse(s) - parse(P.start)) / 864e5) + 1;
  // The app's "today" rolls at dayRollHour, so 00:30 still belongs to the night before.
  const today = () => { const d = new Date(); d.setHours(d.getHours() - (P.dayRollHour || 0)); return ymd(d); };
  const clockHour = () => new Date().getHours();   // real wall clock, for evening and grace windows
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const fmtDate = (s, opts) => parse(s).toLocaleDateString([], opts || { weekday: "short", day: "numeric", month: "short" });

  /* ---------- store ---------- */
  const LS = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const store = { days: LS.get("wolf2.days", {}), token: LS.get("wolf.token", ""), pending: LS.get("wolf2.pending", []), lastSync: LS.get("wolf2.lastSync", null), sound: LS.get("wolf.sound", true), akey: LS.get("wolf.akey", "") };
  const persist = () => { LS.set("wolf2.days", store.days); LS.set("wolf.token", store.token); LS.set("wolf2.pending", store.pending); LS.set("wolf2.lastSync", store.lastSync); LS.set("wolf.sound", store.sound); LS.set("wolf.akey", store.akey); };

  /* ---------- sound ---------- */
  // Eight cues. Played through <audio> elements, not Web Audio: on iOS media elements ignore the
  // ringer switch, Web Audio does not. A small pool per cue lets fast ticks overlap. Families by
  // playbackRate with pitch following (preservesPitch off).
  const SFX = (() => {
    // Five cues, raw WAV (no decoder priming), decoded once and kept warm. Media elements, not Web Audio,
    // so they play with the ringer on silent. Anything not listed here is intentionally silent.
    const names = ["tick", "untick", "checkin", "milestone", "click"];
    const pool = {}; let unlocked = false;
    function make(n) {
      const a = new Audio(`sfx/${n}.wav`); a.preload = "auto"; a.setAttribute("playsinline", "");
      try { a.preservesPitch = false; a.mozPreservesPitch = false; a.webkitPreservesPitch = false; } catch {}
      a.addEventListener("ended", () => { a.currentTime = 0; });   // rewind after, never before
      a.load(); return a;
    }
    function el(n) { const list = (pool[n] ||= [make(n), make(n), make(n)]); return list.find((x) => x.paused || x.ended) || list[0]; }
    function play(name, o = {}) {
      if (!store.sound || !pool[name]) return;
      const go = () => { const a = el(name); if (a.currentTime) a.currentTime = 0; const r = o.rate || 1, v = Math.min(1, o.gain == null ? 1 : o.gain); if (a.playbackRate !== r) a.playbackRate = r; if (a.volume !== v) a.volume = v; a.play().catch(() => {}); };
      if (o.delay) setTimeout(go, o.delay * 1000); else go();
    }
    function preload() { names.forEach((n) => el(n)); }
    // iOS needs one user gesture before media will play: warm every element silently on the first touch.
    const unlock = () => { if (unlocked) return; unlocked = true; names.forEach((n) => pool[n].forEach((a) => { a.volume = 0; a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = 1; }).catch(() => { a.volume = 1; }); })); };
    ["touchstart", "pointerdown", "keydown"].forEach((ev) => addEventListener(ev, unlock, { once: true, capture: true, passive: true }));
    preload();
    return { play, preload };
  })();
  const blank = (date) => ({ date, day: dayIndex(date), done: {}, times: {}, ig: "", checkedIn: false, checkedInAt: 0, updated: 0 });
  const rec = (date) => (store.days[date] ||= blank(date));
  const peek = (date) => store.days[date];

  /* ---------- habits and scoring ---------- */
  const due = (date) => { const n = dayIndex(date); const dow = parse(date).getDay(); return P.habits.filter((h) => (!h.from || n >= h.from) && (!h.days || h.days.includes(dow))); };
  const minutesOn = (date) => { const r = peek(date); return r && r.ig !== "" && r.ig != null ? Number(r.ig) : null; };
  // A habit is "met" on a day: ticked, or (weekly) the trailing 7 days already hit the target, or (minutes) under the limit.
  function metOn(h, date) {
    const r = peek(date);
    if (h.minutes) { const m = minutesOn(date); return m != null && m <= h.limit; }
    if (r && r.done[h.id]) return true;
    if (h.weekly) { let c = 0; for (let i = 0; i < 7; i++) { const x = peek(addDays(date, -i)); if (x && x.done[h.id]) c++; } return c >= h.weekly; }
    return false;
  }
  function completion(date) {
    const list = due(date); const d = list.filter((h) => metOn(h, date)).length;
    return { done: d, total: list.length, r: list.length ? d / list.length : 0 };
  }
  const touched = (date) => { const r = peek(date); return !!r && (Object.values(r.done).some(Boolean) || minutesOn(date) != null); };
  // 7-day mean. Days before day 1 count as the prior (0.5) so he starts at "Normal".
  // Today joins only once something is ticked, so a fresh morning never reads as a zero day.
  function wolfScore() {
    const t = today(); let sum = 0, n = 0;
    for (let i = P.wolf.window - 1; i >= 0; i--) {
      const d = addDays(t, -i); const di = dayIndex(d);
      if (i === 0 && !touched(d)) continue;
      sum += di < 1 ? P.wolf.prior : completion(d).r; n++;
    }
    return n ? sum / n : P.wolf.prior;
  }
  const stageOf = (score) => Math.min(10, Math.max(1, Math.round(score * 10)));
  function brainMinutes() {
    const t = today(); let sum = 0, n = 0; const vals = [];
    for (let i = P.brain.window - 1; i >= 0; i--) { const d = addDays(t, -i); const v = minutesOn(d); vals.push({ date: d, v }); if (v != null) { sum += v; n++; } }
    return { minutes: n ? sum / n : null, vals };
  }
  const brainStage = (m) => m == null ? 5 : Math.min(10, Math.max(1, Math.round(10 - m / (P.brain.minutesForDead / 10))));
  // Consecutive checked-in nights ending today (or yesterday if tonight is still open).
  // One missed night per `freezeEveryDays` is absorbed silently, provided the night before it was kept.
  const frozen = new Set();
  function streak() {
    frozen.clear();
    let d = today(); const r0 = peek(d);
    if (!(r0 && r0.checkedIn)) d = addDays(d, -1);
    let s = 0, lastFreeze = null;
    for (let guard = 0; guard < 400; guard++) {
      const r = peek(d);
      if (r && r.checkedIn) { s++; d = addDays(d, -1); continue; }
      const before = peek(addDays(d, -1));
      const farEnough = lastFreeze === null || Math.round((parse(lastFreeze) - parse(d)) / 864e5) >= (P.freezeEveryDays || 7);
      if (dayIndex(d) >= 1 && before && before.checkedIn && farEnough) { frozen.add(d); lastFreeze = d; d = addDays(d, -1); continue; }
      break;
    }
    return s;
  }
  const missedYesterday = (date) => { const y = peek(addDays(date, -1)); return dayIndex(date) > 1 && !(y && y.checkedIn); };
  const canCheckIn = (date) => dayIndex(date) >= 1 && date <= today();
  const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
  function nightMessage(date) {
    const { r } = completion(date); const list = due(date); const rr = rec(date);
    const missed = P.missedPriority.map((id) => list.find((h) => h.id === id)).filter((h) => h && !rr.done[h.id]);
    const name = missed.length ? missed[0].label.toLowerCase().replace(/^no /, "no ") : "";
    const bank = missedYesterday(date) && r >= 0.5 ? P.messages.comeback : r >= 0.999 ? P.messages.all : r >= 0.75 ? P.messages.most : r >= 0.5 ? P.messages.half : P.messages.low;
    return pick(bank, dayIndex(date)).replace("{missed}", name);
  }
  const stageLine = (n) => n <= 2 ? "Get him up. Sunlight and water." : n <= 4 ? "Coming back. Keep ticking." : n === 5 ? "Holding steady." : n <= 7 ? "Getting there." : n <= 9 ? "Strong. Do not let up." : "Apex. Keep it exactly like this.";

  /* ---------- icons ---------- */
  // Solid icon set (fill). tick and chev stay as strokes.
  const I = {
    sunrise: '<path d="M5.2 12.5a4.8 4.8 0 0 1 9.6 0z"/><path d="M2.5 15h15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M10 2.6v2.6M4 6.2l1.8 1.8M16 6.2l-1.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    sun: '<circle cx="10" cy="10" r="4"/><path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    drop: '<path d="M10 2.5c3.2 3.8 5.3 6.6 5.3 9.3a5.3 5.3 0 0 1-10.6 0C4.7 9.1 6.8 6.3 10 2.5z"/>',
    egg: '<path d="M10 2.5c3.2 0 5.8 4.5 5.8 8.4a5.8 5.8 0 0 1-11.6 0C4.2 7 6.8 2.5 10 2.5z"/>',
    pill: '<rect x="2.5" y="6.8" width="15" height="6.4" rx="3.2" transform="rotate(-35 10 10)"/><path d="M8 6l4 5.8" stroke="#141210" stroke-width="1.6" stroke-linecap="round"/>',
    cup: '<path d="M3.5 6.5h10v6a3.5 3.5 0 0 1-3.5 3.5H7a3.5 3.5 0 0 1-3.5-3.5v-6z"/><path d="M13.5 8h1.3a2.2 2.2 0 0 1 0 4.4h-1.3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    cupoff: '<path d="M3.5 6.5h10v6a3.5 3.5 0 0 1-3.5 3.5H7a3.5 3.5 0 0 1-3.5-3.5v-6z"/><path d="M13.5 8h1.3a2.2 2.2 0 0 1 0 4.4h-1.3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M2.5 17.5l15-15" stroke="#141210" stroke-width="3.4" stroke-linecap="round"/><path d="M2.5 17.5l15-15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    leafoff: '<path d="M16.5 3.5c-7 0-11 3.5-11 9.5 0 1.3.3 2.4.8 3.3C12 15.5 16 11.5 16.5 3.5z"/><path d="M2.5 17.5l15-15" stroke="#141210" stroke-width="3.4" stroke-linecap="round"/><path d="M2.5 17.5l15-15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    dumbbell: '<rect x="6.5" y="9" width="7" height="2"/><rect x="4" y="6" width="2.6" height="8" rx="1"/><rect x="13.4" y="6" width="2.6" height="8" rx="1"/><rect x="2" y="8" width="1.6" height="4" rx=".8"/><rect x="16.4" y="8" width="1.6" height="4" rx=".8"/>',
    phoneoff: '<rect x="5.5" y="2" width="9" height="16" rx="2.2"/><rect x="8.5" y="14.6" width="3" height="1.2" rx=".6" fill="#141210"/><path d="M2.5 17.5l15-15" stroke="#141210" stroke-width="3.4" stroke-linecap="round"/><path d="M2.5 17.5l15-15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    brain: '<path d="M9.3 3a3 3 0 0 0-2.9 2.2A3 3 0 0 0 4 9.6a3 3 0 0 0 1.4 4.7A3 3 0 0 0 9.3 17h.4V3zM10.7 3v14h.4a3 3 0 0 0 3.9-2.7A3 3 0 0 0 16 9.6a3 3 0 0 0-2.4-4.4A3 3 0 0 0 10.7 3z"/>',
    moon: '<path d="M16 12.6A6.6 6.6 0 0 1 7.4 4a6.6 6.6 0 1 0 8.6 8.6z"/>',
    tick: '<path d="M3 8.6l3.1 3.1L13 4.9"/>',
    chev: '<path d="M4.5 7.5L10 13l5.5-5.5"/>'
  };
  const STROKE = new Set(["tick", "chev"]);
  const svg = (k, vb = 20, sw = 1.5) => STROKE.has(k) ? `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>` : `<svg viewBox="0 0 ${vb} ${vb}" fill="currentColor" aria-hidden="true">${I[k]}</svg>`;

  /* ---------- art crossfade ---------- */
  const shownStage = { wolf: 0, brain: 0 };
  const VEXT = /Apple/.test(navigator.vendor) ? "mp4" : "webm";   // HEVC alpha for Safari / iOS, VP9 alpha elsewhere
  const VIDEO = { wolf: true, brain: false };   // stages that ship as looping clips
  function srcFor(kind, n) { return VIDEO[kind] ? `img/${kind}/${pad(n)}.${VEXT}?v=${VERSION}` : `img/${kind}/${pad(n)}.webp`; }
  function load(el, kind, n, cb) {
    const src = srcFor(kind, n);
    if (el.tagName === "VIDEO") { el.poster = `img/${kind}/${pad(n)}.webp`; el.oncanplay = () => { el.play().catch(() => {}); cb && cb(); }; el.src = src; el.load(); }
    else { el.onload = cb; el.src = src; }
  }
  function setStage(kind, el, n) {
    const a = el.querySelector(".a"), b = el.querySelector(".b");
    if (shownStage[kind] === n) return;
    if (!shownStage[kind]) { load(a, kind, n); shownStage[kind] = n; return; }
    const prev = shownStage[kind]; shownStage[kind] = n;
    if (kind === "wolf" && !el.closest(".view").hidden) SFX.play(n > prev ? "stageup" : "stagedown", { rate: 1.12 - n * 0.03, gain: 0.9 });
    load(b, kind, n, () => { el.classList.add("swap"); setTimeout(() => { load(a, kind, n); el.classList.remove("swap"); if (b.tagName === "VIDEO") b.pause(); }, 720); });
  }
  const plate = $("#plate");
  function setPlate(n, dim) { plate.style.backgroundImage = `url(img/bg/${pad(n)}.webp)`; plate.classList.toggle("dim", !!dim); }

  function habitScore(id) {
    const t = today(); let d = 0, n = 0;
    for (let date = P.start; date <= t; date = addDays(date, 1)) {
      if (date === t && !touched(t)) continue;
      const h = due(date).find((x) => x.id === id); if (!h) continue;
      n++; if (metOn(h, date)) d++;
    }
    return n ? d / n : null;
  }
  const short = { wake: "Up", sun: "Sun", water: "Water", vits: "Vits", breakfast: "Food", coffee11: "Coffee", caff: "Caffeine", nic: "Nicotine", gym: "Gym", phone: "Phone", brainrot: "Brainrot", bed: "Bed" };
  function renderGrid() {
    const host = $("#hgrid"); host.innerHTML = "";
    P.habits.forEach((h) => {
      const sc = habitScore(h.id);
      const el = document.createElement("button"); el.type = "button";
      el.className = "hg" + (sc == null ? "" : sc >= 0.7 ? " good" : sc < 0.4 ? " bad" : "");
      el.innerHTML = `<span class="ic">${svg(h.icon)}</span><b>${sc == null ? "–" : Math.round(sc * 100) + "%"}</b><span>${short[h.id] || h.label}</span><span class="mbar"><i style="width:${sc == null ? 0 : Math.round(sc * 100)}%"></i></span>`;
      el.addEventListener("click", () => show("habits"));
      host.appendChild(el);
    });
  }

  /* ---------- render: home ---------- */
  function renderHome() {
    renderGrid();
    const t = today(); const n = dayIndex(t); const score = wolfScore(); const st = stageOf(score);
    $("#topLeft").textContent = n >= 1 ? `Day ${n} · ${fmtDate(t)}` : fmtDate(t, { weekday: "long", day: "numeric", month: "long" });
    $("#wolfPct").textContent = Math.round(score * 100);
    $("#wolfBar").style.width = Math.round(score * 100) + "%";
    $("#wolfStage").textContent = P.stages[st - 1];
    $("#wolfLine").textContent = stageLine(st);
    setStage("wolf", $("#wolfArt"), st);
    const s = streak(); $("#streakNum").textContent = s; $("#streakBtn").classList.toggle("zero", s === 0);
    const r = peek(t); const c = completion(t);
    const evening = clockHour() >= P.eveningFromHour || clockHour() < (P.dayRollHour || 0);
    const open = evening && !(r && r.checkedIn);
    $("#streakBtn").classList.toggle("risk", open);
    $("#btnTonight").hidden = !open;
    $("#homeMini").hidden = open;
    $("#homeMini").textContent = r && r.checkedIn ? "Checked in. Sleep well." : c.total ? `Today ${c.done} of ${c.total}` : "";
    $("#grain").style.opacity = (0.30 + (1 - score) * 0.18).toFixed(2);
  }

  /* ---------- render: habits ---------- */
  let viewDate = today();
  function renderHabits() {
    const d = viewDate; const n = dayIndex(d); const r = rec(d); const list = due(d);
    $("#hDay").textContent = n >= 1 ? `Day ${n}` : fmtDate(d, { weekday: "long" });
    $("#hDate").textContent = fmtDate(d);
    $("#nextDay").disabled = d >= today();
    const c = completion(d);
    $("#hDone").textContent = `${c.done} of ${c.total}`; $("#hBar").style.width = Math.round(c.r * 100) + "%";
    const host = $("#habitList"); const openIds = new Set([...host.querySelectorAll(".habit.open")].map((e) => e.dataset.id)); host.innerHTML = "";
    list.forEach((h) => {
      const met = metOn(h, d);
      const el = document.createElement("div"); el.className = "habit" + (met ? " done" : "") + (openIds.has(h.id) ? " open" : ""); el.dataset.id = h.id;
      const time = h.time && r.times[h.id] ? `<span class="h-time">${r.times[h.id]}</span>` : "";
      const right = h.minutes ? `<input type="number" class="h-min" data-min="1" inputmode="numeric" min="0" max="900" placeholder="min" value="${r.ig ?? ""}" aria-label="Minutes">` : `<span class="h-box">${svg("tick", 16, 2.4)}</span>`;
      el.innerHTML = `<div class="habit-head">
          <${h.minutes ? "div" : "button type=\"button\""} class="habit-row" ${h.minutes ? "" : `data-act="toggle" aria-pressed="${r.done[h.id] ? "true" : "false"}"`}>
            <span class="h-icon">${svg(h.icon)}</span>
            <span class="h-text"><span class="h-label">${h.label}</span>${time}</span>
            ${right}
          </${h.minutes ? "div" : "button"}>
          <button type="button" class="h-more" data-act="more" aria-label="Details">${svg("chev", 20, 1.6)}</button>
        </div>
        <div class="h-detail">${h.why ? `<span>${h.why}</span>` : ""}${h.time ? `<input type="time" step="300" data-time="${h.id}" value="${r.times[h.id] || h.defaultTime || ""}" aria-label="Time">` : ""}</div>`;
      host.appendChild(el);
    });
    const wrap = $("#checkinWrap"); const can = canCheckIn(d);
    wrap.hidden = !can;
    wrap.classList.toggle("done", !!r.checkedIn);
    $("#btnCheckin").hidden = !!r.checkedIn;
    $("#btnCheckin").textContent = d === today() ? "Done for tonight" : `Check off ${fmtDate(d, { weekday: "long" })}`;
    $("#checkinNote").textContent = r.checkedIn ? "Checked in. Tap any row to change it." : (d === today() ? "Tick the day, then check in before the phone goes away." : "Tick what you did, then check it off.");
    $("#prevDay").disabled = dayIndex(d) <= -6;
  }

  /* ---------- render: brain ---------- */
  function renderBrain() {
    const { minutes, vals } = brainMinutes(); const st = brainStage(minutes);
    $("#brainStage").textContent = P.brainStages[st - 1];
    $("#brainLine").textContent = minutes == null ? "Log your minutes on the Habits page and it tells you the truth." : st >= 8 ? "Barely touched it." : st >= 6 ? "Normal use." : st >= 4 ? "Getting spongy." : "The evening went into the feed.";
    setStage("brain", $("#brainArt"), st);
    $("#brainAvg").textContent = minutes == null ? "–" : Math.round(minutes);
    const tr = $("#brainTrend"); tr.innerHTML = "";
    vals.forEach((v) => { const d = document.createElement("div"); d.className = "t"; d.innerHTML = `<b>${v.v == null ? "–" : v.v}</b><span>${DOW[parse(v.date).getDay()]}</span>`; tr.appendChild(d); });
  }
  function renderBlocks(host, items, current) {
    host.innerHTML = "";
    items.forEach((b) => { const el = document.createElement("div"); el.className = "block" + (current && current(b) ? " now" : ""); el.innerHTML = `<h2>${b.title}</h2><ul>${b.lines.map((l) => `<li>${l}</li>`).join("")}</ul>`; host.appendChild(el); });
  }

  /* ---------- ask: Claude on the phone, answering from the plan + his own days ---------- */
  const ASK = (() => {
    const A = P.ask || {}; const host = $("#thread"); const input = $("#askInput"); const form = $("#composer");
    let know = LS.get("wolf.know", null);   // {sha, text, at} pulled from the private data repo
    let busy = false;
    const dayKey = () => "wolf.ask." + today();
    const hist = () => LS.get(dayKey(), []);
    const saveHist = (h) => LS.set(dayKey(), h.slice(-40));
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    async function warm() {
      if (!store.token || !navigator.onLine) return;
      if (know && Date.now() - (know.at || 0) < 3600e3) return;
      try { const f = await ghGet(A.knowledgePath || "knowledge.md"); if (!f) return;
        know = (know && know.sha === f.sha) ? { ...know, at: Date.now() } : { sha: f.sha, text: unb64(f.content), at: Date.now() };
        LS.set("wolf.know", know); } catch {}
    }
    const fallbackKnowledge = () => "# Habits\n" + P.habits.map((h) => `- ${h.label}: ${h.why || ""}`).join("\n") + "\n\n# Focus\n" + P.focus.map((f) => `${f.title}\n` + f.lines.map((l) => "- " + l).join("\n")).join("\n\n");

    const RULES = `You are the Ask tab inside Wolf, Shaan's phone app for his 30-day Austin reset. You answer from the knowledge below and from the live state. You are his coach for the month, not a general assistant.

How to answer:
- One or two short sentences by default. He has said "too much to read". Expand only when he asks for more or asks for a plan or a session.
- Lead with the answer. Yes or no first when the question is yes or no. Then the one reason that matters.
- Plain spoken English. Direct, a bit dry, like a mate who knows the plan. Swearing is fine when it lands. No hype, no cheerleading, no lectures.
- Never use markdown: no headers, no bullet lists, no bold, no emojis. Plain lines. A short list only if he asks for a session or a plan, one item per line.
- Never use an em dash. Use a comma, a full stop, or a new sentence.
- 24-hour times, like 14:00.
- Use the live state. The right answer depends on the day number, the time now, and what he has ticked. Say the specific time, not the general rule.
- If he asks how he is doing, use the data, be honest, and name the one thing to fix. Celebrate real follow-through in one line. Never shame a miss.
- Never suggest an earlier alarm without first checking that bedtime is landing near 23:30.
- No naps is a rule in days 1 to 4. After that, still avoid them.
- He IS hungry in the mornings. Never tell him to force breakfast down or that wolves have no morning appetite.
- You are not a doctor. For anything medical, say what to measure or ask his doctor. Never diagnose.
- Do not invent facts about him or the plan. If the knowledge does not cover it, say so in one line and give the best general answer.
- Frame changes as experiments, not commitments. One change at a time.`;

    function stateText() {
      const now = new Date(); const t = today(); const n = dayIndex(t);
      const phase = P.focus.find((b) => n >= b.from && n <= b.to);
      const r = peek(t) || blank(t); const list = due(t);
      const rows = list.map((h) => { const m = metOn(h, t); const tm = h.time && r.times[h.id] ? ` at ${r.times[h.id]}` : ""; const mins = h.minutes ? (r.ig !== "" && r.ig != null ? ` (${r.ig} min logged)` : " (no minutes logged)") : ""; return `- ${h.label}: ${m ? "done" : "not yet"}${tm}${mins}`; }).join("\n");
      const y = addDays(t, -1); const ry = peek(y); const cy = completion(y);
      const yl = dayIndex(y) >= 1 ? `Yesterday (day ${dayIndex(y)}): ${cy.done} of ${cy.total} done${ry && ry.times.bed ? `, bed ${ry.times.bed}` : ""}${ry && ry.times.wake ? `, up ${ry.times.wake}` : ""}${ry && ry.checkedIn ? ", checked in" : ", no check-in"}.` : "Yesterday: before day 1.";
      let sum = 0, k = 0; for (let i = 1; i <= 7; i++) { const d = addDays(t, -i); if (dayIndex(d) < 1) break; sum += completion(d).r; k++; }
      const misses = P.habits.map((h) => ({ h, s: habitScore(h.id) })).filter((x) => x.s != null).sort((a, b) => a.s - b.s).slice(0, 3).map((x) => `${x.h.label} ${Math.round(x.s * 100)}%`).join(", ");
      const bm = brainMinutes().minutes;
      const c = completion(t);
      return `# Live state
Now: ${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}, ${hhmm(now)} local (Austin).
Plan day: ${n >= 1 ? n : `not started (day 1 is ${fmtDate(P.start)})`}. Phase: ${phase ? phase.title : "none"}.
Today so far: ${c.done} of ${c.total} habits done.
${rows}
${yl}
Last ${k} logged days: ${k ? Math.round((sum / k) * 100) + "% average completion" : "nothing logged yet"}. Check-in streak: ${streak()} nights. Wolf: ${P.stages[stageOf(wolfScore()) - 1]} (${Math.round(wolfScore() * 100)}%).
Weakest habits so far: ${misses || "no data yet"}.
Brainrot 7-day average: ${bm == null ? "no minutes logged" : Math.round(bm) + " min a day"}.
Commitments: no alcohol, no cigarettes since 15 Sept. Pouches allowed with an 18:00 cutoff until the week 4 decision.`;
    }

    function paintThread() {
      host.innerHTML = "";
      hist().forEach((m) => { const el = document.createElement("div"); el.className = "msg " + (m.role === "user" ? "u" : "a"); el.textContent = m.shown || m.text; host.appendChild(el); });
    }
    function paintFocus() {
      const n = Math.max(1, dayIndex(today())); const b = P.focus.find((x) => n >= x.from && n <= x.to); const card = $("#focusCard");
      if (!b) { card.hidden = true; return; } card.hidden = false;
      const closed = LS.get("wolf.focusClosed", false);
      card.className = "focus" + (closed ? " closed" : "");
      card.innerHTML = `<h2>${b.title}</h2><ul>${b.lines.map((l) => `<li>${l}</li>`).join("")}</ul><button type="button" class="more">${closed ? "Show" : "Hide"}</button>`;
      card.querySelector(".more").onclick = () => { LS.set("wolf.focusClosed", !closed); paintFocus(); SFX.play("click", { gain: 0.5 }); };
    }
    function paintChips() {
      const c = $("#chips"); c.innerHTML = "";
      (A.chips || []).forEach(([label, q]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = label; b.addEventListener("click", () => send(label, q)); c.appendChild(b); });
    }
    function render() {
      paintFocus(); paintChips(); paintThread();
      const has = !!store.akey; $("#askEmpty").hidden = has; form.hidden = !has;
      $("#askStatus").textContent = has ? "Key saved" : "No key";
    }

    async function stream(messages, onText) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": store.akey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: A.model || "claude-opus-5", max_tokens: 1024, stream: true,
          output_config: { effort: "low" },
          system: [
            { type: "text", text: RULES + "\n\n" + (know ? know.text : fallbackKnowledge()), cache_control: { type: "ephemeral" } },
            { type: "text", text: stateText() }
          ],
          messages
        })
      });
      if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); m = (j.error && j.error.message) || m; } catch {} throw new Error(m); }
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = "", out = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop();
        for (const ev of parts) for (const line of ev.split("\n")) {
          if (!line.startsWith("data:")) continue;
          let j; try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") { out += j.delta.text; onText(out); }
          else if (j.type === "error") throw new Error((j.error && j.error.message) || "stream error");
        }
      }
      return out.trim();
    }

    async function send(shown, text) {
      if (busy || !store.akey) return; const q = (text || shown || "").trim(); if (!q) return;
      busy = true; form.classList.add("busy"); $("#askSend").disabled = true; SFX.play("click", { gain: 0.6 });
      const h = hist(); h.push({ role: "user", text: q, shown: shown || q, t: Date.now() }); saveHist(h); paintThread();
      const el = document.createElement("div"); el.className = "msg a wait"; host.appendChild(el); el.scrollIntoView({ block: "end" });
      try {
        await warm();
        const msgs = h.slice(-12).map((m) => ({ role: m.role, content: m.text }));
        const a = await stream(msgs, (t) => { el.classList.remove("wait"); el.textContent = t; });
        el.textContent = a || "Nothing came back. Ask again.";
        const h2 = hist(); h2.push({ role: "assistant", text: a, t: Date.now() }); saveHist(h2);
        logAsks(h2);
      } catch (e) {
        el.classList.remove("wait"); el.classList.add("err");
        el.textContent = /401|api key|x-api-key|authentication/i.test(e.message) ? "Key rejected. Check it in Settings." : navigator.onLine ? `Did not get through. ${e.message}` : "No signal. Try again when you are online.";
        const h2 = hist(); if (h2.length && h2[h2.length - 1].role === "user") { h2.pop(); saveHist(h2); }
      } finally { busy = false; form.classList.remove("busy"); $("#askSend").disabled = false; el.scrollIntoView({ block: "end" }); }
    }
    // The day's questions go to the private repo too, so the knowledge can be tightened from what he actually asks.
    async function logAsks(h) {
      if (!store.token || !navigator.onLine) return;
      const t = today();
      try { await ghPut(`asks/${t}.json`, { date: t, day: dayIndex(t), asks: h.map((m) => ({ role: m.role, text: m.text, t: m.t })) }, `wolf ask: ${t}`); } catch {}
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ""; send(q, q); });
    $("#askEmpty").addEventListener("click", () => openSheet());
    return { render, warm, clearToday: () => { LS.set(dayKey(), []); paintThread(); } };
  })();
  function renderAsk() { ASK.render(); }

  /* ---------- render: calendar ---------- */
  function renderMonth(host, titleEl, y, m) {
    titleEl.textContent = new Date(y, m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
    host.innerHTML = "";
    const first = new Date(y, m, 1); const lead = (first.getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate(); const t = today();
    for (let i = 0; i < lead; i++) { const e = document.createElement("div"); e.className = "cd empty"; host.appendChild(e); }
    streak();   // refreshes the frozen set
    for (let d = 1; d <= days; d++) {
      const date = ymd(new Date(y, m, d)); const c = completion(date); const r = peek(date);
      const e = document.createElement("button"); e.type = "button"; e.className = "cd" + (date > t ? " future" : "") + (date === t ? " today" : "") + (r && r.checkedIn ? " in" : "") + (frozen.has(date) ? " frz" : "") + (c.r >= 0.6 ? " hi" : "");
      e.dataset.date = date; e.disabled = date > t; e.classList.toggle("hi", c.r >= 0.35);
      e.innerHTML = `<i style="height:${Math.round(c.r * 100)}%"></i><b>${d}</b>`;
      host.appendChild(e);
    }
  }
  function renderCal() {
    const s = parse(P.start); const y = s.getFullYear(), m = s.getMonth();
    renderMonth($("#calGrid"), $("#calTitle"), y, m);
    renderMonth($("#calGrid2"), $("#calTitle2"), m === 11 ? y + 1 : y, (m + 1) % 12);
    const t = today(); let ins = 0, sum = 0, n = 0;
    for (let d = P.start; d <= t; d = addDays(d, 1)) { if (d === t && !touched(d)) continue; const r = peek(d); if (r && r.checkedIn) ins++; sum += completion(d).r; n++; }
    $("#calSum").textContent = n ? `${Math.round((sum / n) * 100)}% average · ${ins} check-in${ins === 1 ? "" : "s"}` : "";
  }

  /* ---------- night screen ---------- */
  function showNight(date) {
    const s = streak(); const t = today();
    $("#nightStreak").textContent = s; $("#nightLabel").textContent = s === 1 ? "night in a row" : "nights in a row";
    const ms = P.milestones && P.milestones[s];
    $("#nightMsg").textContent = ms ? `${ms} ${nightMessage(date)}` : nightMessage(date);
    const wk = $("#nightWeek"); wk.innerHTML = "";
    const mon = addDays(t, -((parse(t).getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) { const d = addDays(mon, i); const r = peek(d); const el = document.createElement("div"); el.className = "d"; el.innerHTML = `<div class="dot${r && r.checkedIn ? " on" : ""}">${r && r.checkedIn ? svg("tick", 16, 2.4) : ""}</div><span>${DOW[parse(d).getDay()]}</span>`; wk.appendChild(el); }
    $("#night").hidden = false;
  }
  $("#nightClose").addEventListener("click", () => { $("#night").hidden = true; });

  /* ---------- sync (unchanged mechanics) ---------- */
  const api = () => `https://api.github.com/repos/${P.data.owner}/${P.data.repo}/contents/`;
  const headers = () => ({ Authorization: `Bearer ${store.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  const b64 = (s) => btoa(unescape(encodeURIComponent(s))); const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
  const shas = {}; let syncing = false; const dot = $("#syncStatus");
  const setSync = (_state, msg) => { if (msg) dot.textContent = msg; };
  async function ghGet(path) { const r = await fetch(api() + path, { headers: headers() }); if (r.status === 404) return null; if (!r.ok) throw new Error(`GET ${path} ${r.status}`); return r.json(); }
  async function ghPut(path, obj, message) {
    let sha = shas[path]; if (!sha) { const cur = await ghGet(path); if (cur) sha = cur.sha; }
    const body = { message, content: b64(JSON.stringify(obj, null, 2)) }; if (sha) body.sha = sha;
    let r = await fetch(api() + path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { const cur = await ghGet(path); if (cur) body.sha = cur.sha; r = await fetch(api() + path, { method: "PUT", headers: headers(), body: JSON.stringify(body) }); }
    if (!r.ok) throw new Error(`PUT ${path} ${r.status}`); const j = await r.json(); shas[path] = j.content.sha;
  }
  function queue(date) { if (!store.pending.includes(date)) store.pending.push(date); persist(); clearTimeout(queue.t); queue.t = setTimeout(flush, 1800); }
  async function flush() {
    if (!store.token || syncing || !store.pending.length || !navigator.onLine) { if (!store.token) setSync("", "Not connected"); return; }
    syncing = true; setSync("busy", "Syncing");
    try { while (store.pending.length) { const date = store.pending[0]; await ghPut(`days/${date}.json`, store.days[date], `wolf: ${date}`); store.pending.shift(); persist(); }
      store.lastSync = Date.now(); persist(); setSync("ok", `Synced ${new Date(store.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`); }
    catch (e) { setSync("err", e.message.includes("401") ? "Token rejected. It needs contents read and write on wolf-data." : `Will retry. ${e.message}`); }
    finally { syncing = false; }
  }
  async function pullHistory() {
    if (!store.token) { setSync("", "Add a token first"); return; } setSync("busy", "Pulling");
    try { const list = (await ghGet("days")) || []; let n = 0;
      for (const f of list) { if (!f.name.endsWith(".json")) continue; const date = f.name.slice(0, -5); if (store.pending.includes(date)) continue;
        const local = peek(date); const file = await ghGet(`days/${f.name}`); if (!file) continue;
        const remote = JSON.parse(unb64(file.content)); shas[`days/${date}.json`] = file.sha;
        if (remote.done && (!local || (remote.updated || 0) >= (local.updated || 0))) { store.days[date] = remote; n++; } }
      const cfg = await ghGet("config.json"); if (cfg) Object.assign(P, JSON.parse(unb64(cfg.content)));
      persist(); renderAll(); setSync("ok", `Pulled ${n} day${n === 1 ? "" : "s"}`); }
    catch (e) { setSync("err", `Pull failed. ${e.message}`); }
  }
  addEventListener("online", flush); document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderAll(); flush(); } });

  /* ---------- grain ---------- */
  (function grain() {
    const cv = $("#grain"); const c = cv.getContext("2d"); const frames = []; let fi = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const build = () => { try { const dpr = Math.min(2, devicePixelRatio || 1); const w = Math.max(1, Math.ceil((innerWidth || 390) * dpr / 2)), h = Math.max(1, Math.ceil((innerHeight || 844) * dpr / 2)); cv.width = w; cv.height = h; frames.length = 0;
      for (let f = 0; f < 4; f++) { const id = c.createImageData(w, h); const d = id.data; for (let i = 0; i < d.length; i += 4) { const v = 96 + (Math.random() * 128) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } frames.push(id); } } catch { frames.length = 0; } };
    build(); addEventListener("resize", build);
    const tick = () => { if (!frames.length) return; c.putImageData(frames[fi], 0, 0); fi = (fi + 1) % frames.length; };
    tick(); if (!reduced) setInterval(tick, 125);
  })();

  /* ---------- interactions ---------- */
  $("#habitList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const el = btn.closest(".habit"); const id = el.dataset.id; const r = rec(viewDate);
    if (btn.dataset.act === "more") { el.classList.toggle("open"); SFX.play("click", { gain: 0.6 }); return; }
    r.done[id] = !r.done[id]; r.updated = Date.now(); persist(); queue(viewDate);
    const h = P.habits.find((x) => x.id === id);
    el.classList.toggle("done", metOn(h, viewDate)); btn.setAttribute("aria-pressed", r.done[id] ? "true" : "false");
    const c = completion(viewDate); $("#hDone").textContent = `${c.done} of ${c.total}`; $("#hBar").style.width = Math.round(c.r * 100) + "%";
    // the pop rises as the day fills: 0.95 at the first tick to ~1.14 at the last (accumulation family)
    if (r.done[id]) { SFX.play("tick", { rate: 0.95 + 0.19 * (c.total > 1 ? (c.done - 1) / (c.total - 1) : 1) }); if (c.done === c.total) SFX.play("complete", { delay: 0.18 }); }
    else SFX.play("untick");
    renderHome();
  });
  $("#habitList").addEventListener("change", (e) => {
    const mi = e.target.closest("input[data-min]");
    if (mi) { const r = rec(viewDate); r.ig = mi.value; r.updated = Date.now(); persist(); queue(viewDate); renderHabits(); renderHome(); return; }
    const inp = e.target.closest("input[data-time]"); if (!inp) return;
    const r = rec(viewDate); r.times[inp.dataset.time] = inp.value; r.updated = Date.now(); persist(); queue(viewDate);
    const row = inp.closest(".habit"); const t = row.querySelector(".h-time"); if (t) t.textContent = inp.value; else if (inp.value) { const s = document.createElement("span"); s.className = "h-time"; s.textContent = inp.value; row.querySelector(".h-text").appendChild(s); }
  });
  $("#prevDay").addEventListener("click", () => { viewDate = addDays(viewDate, -1); renderHabits(); SFX.play("click", { gain: 0.5, rate: 0.95 }); });
  $("#nextDay").addEventListener("click", () => { if (viewDate < today()) { viewDate = addDays(viewDate, 1); renderHabits(); SFX.play("click", { gain: 0.5, rate: 1.05 }); } });
  $("#btnCheckin").addEventListener("click", () => {
    const r = rec(viewDate); if (r.checkedIn || !canCheckIn(viewDate)) return;
    r.checkedIn = true; r.checkedInAt = Date.now(); r.updated = Date.now(); persist(); queue(viewDate);
    renderHabits(); renderHome();
    const s = streak(); SFX.play(P.milestones && P.milestones[s] ? "milestone" : "checkin");
    showNight(viewDate);
  });
  $("#btnTonight").addEventListener("click", () => { viewDate = today(); show("habits"); });
  $("#streakBtn").addEventListener("click", () => { show("habits"); openCal(); });
  $("#calGrid").addEventListener("click", onCalClick); $("#calGrid2").addEventListener("click", onCalClick);
  function onCalClick(e) { const b = e.target.closest(".cd[data-date]"); if (!b || b.disabled) return; viewDate = b.dataset.date; closeCal(); show("habits"); }

  const calSheet = $("#calSheet"), calScrim = $("#calScrim");
  const openCal = () => { renderCal(); calSheet.hidden = false; calScrim.hidden = false; };
  const closeCal = () => { calSheet.hidden = true; calScrim.hidden = true; };
  $("#btnCal").addEventListener("click", openCal); $("#btnCalClose").addEventListener("click", closeCal); calScrim.addEventListener("click", closeCal);
  const views = ["home", "habits", "brain", "ask"];
  function show(v) {
    if (!views.includes(v)) v = "home";
    views.forEach((k) => { $(`#view-${k}`).hidden = k !== v; });
    $("#topLeft").hidden = v === "habits";
    document.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.view === v; t.classList.toggle("is-active", on); if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
    if (v === "home") { setPlate(1, false); renderHome(); }
    if (v === "habits") { setPlate(4, true); renderHabits(); }
    if (v === "brain") { setPlate(2, false); renderBrain(); }
    if (v === "ask") { setPlate(4, true); renderAsk(); ASK.warm(); }
    scrollTo({ top: 0 }); try { history.replaceState(null, "", "#" + v); } catch {}
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  function renderAll() { renderHome(); renderHabits(); renderBrain(); renderAsk(); }

  /* ---------- settings ---------- */
  const sheet = $("#sheet"), scrim = $("#sheetScrim");
  const openSheet = () => { sheet.hidden = false; scrim.hidden = false; $("#fToken").value = store.token; $("#fKey").value = store.akey; flush(); };
  const closeSheet = () => { sheet.hidden = true; scrim.hidden = true; };
  $("#btnSettings").addEventListener("click", openSheet); $("#btnClose").addEventListener("click", closeSheet); scrim.addEventListener("click", closeSheet);
  $("#btnSaveToken").addEventListener("click", async () => {
    store.token = $("#fToken").value.trim(); persist(); if (!store.token) { setSync("", "Not connected"); return; }
    setSync("busy", "Checking token");
    try { await ghGet("README.md"); setSync("ok", "Connected"); queue(today()); flush(); } catch { setSync("err", "Token rejected. It needs contents read and write on wolf-data."); }
  });
  $("#btnPull").addEventListener("click", pullHistory); $("#ver").textContent = VERSION;
  $("#btnSaveKey").addEventListener("click", () => { store.akey = $("#fKey").value.trim(); persist(); renderAsk(); if (store.akey) { $("#askStatus").textContent = "Key saved"; ASK.warm(); } });
  $("#btnClearAsk").addEventListener("click", () => { ASK.clearToday(); SFX.play("untick"); });
  const soundBtn = $("#btnSound"); const paintSound = () => { soundBtn.textContent = store.sound ? "Sounds on" : "Sounds off"; soundBtn.setAttribute("aria-pressed", store.sound ? "true" : "false"); };
  paintSound(); soundBtn.addEventListener("click", () => { store.sound = !store.sound; persist(); paintSound(); if (store.sound) SFX.play("tick"); });
  // Sound lab: try any candidate inside the real app without changing the shipped defaults.
  try { const sab = getComputedStyle(document.documentElement).getPropertyValue("--sab"); const tb = document.querySelector(".tabs").getBoundingClientRect().bottom; $("#dbg").textContent = `inner ${innerWidth}x${innerHeight} · screen ${screen.width}x${screen.height} · body ${document.body.getBoundingClientRect().height|0} · tabsBottom ${tb|0} · sab ${sab.trim() || "0"} · standalone ${!!navigator.standalone}`; } catch {}

  /* ---------- iOS standalone reserves the home-indicator strip itself; do not pad for it twice ---------- */
  function fitViewport() {
    const reserved = !!navigator.standalone && (screen.height - innerHeight) > 40;
    document.documentElement.style.setProperty("--sab-eff", reserved ? "0px" : "env(safe-area-inset-bottom,0px)");
  }
  fitViewport(); addEventListener("resize", fitViewport);

  /* ---------- boot ---------- */
  const startView = (location.hash || "#home").slice(1);
  renderAll(); show(startView);
  if (store.token) { setSync("ok", store.lastSync ? `Synced ${new Date(store.lastSync).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : "Connected"); flush(); } else setSync("", "Not connected");
  let lastDay = today(); setInterval(() => { if (today() !== lastDay) { lastDay = today(); viewDate = today(); renderAll(); } }, 60000);
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  // Self-updating: if the server's version differs from this build, drop every cache and reload once.
  async function checkUpdate(force) {
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) return false;
      const { v } = await r.json();
      if (v !== VERSION || force) {
        const rs = await navigator.serviceWorker.getRegistrations(); for (const x of rs) await x.unregister();
        const ks = await caches.keys(); for (const k of ks) await caches.delete(k);
        location.replace(location.pathname + "?u=" + Date.now() + location.hash); return true;
      }
    } catch {}
    return false;
  }
  if (!/[?&]u=/.test(location.search)) { checkUpdate(false); document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(false); }); }
  $("#btnUpdate").addEventListener("click", async () => { $("#btnUpdate").textContent = "Updating"; const did = await checkUpdate(true); if (!did) $("#btnUpdate").textContent = "Up to date"; });
})();
