/* Wolf v2. One wolf, one number, one streak. Local-first, syncs one file per day to a private GitHub repo. */
(function () {
  "use strict";
  const P = window.PLAN;
  const $ = (s) => document.querySelector(s);
  const VERSION = "2.0";
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
  const store = { days: LS.get("wolf2.days", {}), token: LS.get("wolf.token", ""), pending: LS.get("wolf2.pending", []), lastSync: LS.get("wolf2.lastSync", null) };
  const persist = () => { LS.set("wolf2.days", store.days); LS.set("wolf.token", store.token); LS.set("wolf2.pending", store.pending); LS.set("wolf2.lastSync", store.lastSync); };
  const blank = (date) => ({ date, day: dayIndex(date), done: {}, times: {}, ig: "", checkedIn: false, checkedInAt: 0, updated: 0 });
  const rec = (date) => (store.days[date] ||= blank(date));
  const peek = (date) => store.days[date];

  /* ---------- habits and scoring ---------- */
  const due = (date) => { const n = dayIndex(date); const dow = parse(date).getDay(); return P.habits.filter((h) => (!h.from || n >= h.from) && (!h.days || h.days.includes(dow))); };
  function completion(date) {
    const list = due(date); const r = peek(date); const d = r ? list.filter((h) => r.done[h.id]).length : 0;
    return { done: d, total: list.length, r: list.length ? d / list.length : 0 };
  }
  const touched = (date) => { const r = peek(date); return !!r && Object.values(r.done).some(Boolean); };
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
    const t = today(); const w = [3, 2, 1]; let num = 0, den = 0; const vals = [];
    for (let i = 0; i < P.brain.window; i++) {
      const d = addDays(t, -i); const r = peek(d); const v = r && r.ig !== "" && r.ig != null ? Number(r.ig) : null;
      vals.push({ date: d, v }); if (v != null) { num += v * w[i]; den += w[i]; }
    }
    return { minutes: den ? num / den : null, vals };
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
  const I = {
    sunrise: '<path d="M3 15h14M5.5 12a4.5 4.5 0 0 1 9 0M10 3v3M4.2 6.2l1.4 1.4M15.8 6.2l-1.4 1.4"/>',
    sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
    drop: '<path d="M10 3c3 3.6 5 6.2 5 8.7a5 5 0 0 1-10 0C5 9.2 7 6.6 10 3z"/>',
    pill: '<rect x="3" y="7" width="14" height="6" rx="3" transform="rotate(-35 10 10)"/><path d="M8.2 6.2l3.6 5.2"/>',
    egg: '<path d="M10 3c3 0 5.5 4.2 5.5 8a5.5 5.5 0 0 1-11 0C4.5 7.2 7 3 10 3z"/>',
    cup: '<path d="M4 7h9v5.5a3.5 3.5 0 0 1-3.5 3.5h-2A3.5 3.5 0 0 1 4 12.5V7zM13 8.5h1.5a2 2 0 0 1 0 4H13"/>',
    cupoff: '<path d="M4 7h9v5.5a3.5 3.5 0 0 1-3.5 3.5h-2A3.5 3.5 0 0 1 4 12.5V7zM13 8.5h1.5a2 2 0 0 1 0 4H13M3 17L17 3"/>',
    leafoff: '<path d="M16 4c-6 0-10 3-10 9 0 1 .2 2 .6 3C11.5 16 15 12 16 4zM6.6 16C8 12.5 10 10 13 8M3 17L17 3"/>',
    dumbbell: '<path d="M6.5 10h7M3 8v4M17 8v4M5 6.5v7M15 6.5v7"/>',
    phoneoff: '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2M3 17L17 3"/>',
    moon: '<path d="M15.5 12.5A6 6 0 0 1 7.5 4.5a6 6 0 1 0 8 8z"/>',
    tick: '<path d="M3 8.6l3.1 3.1L13 4.9"/>',
    chev: '<path d="M4.5 7.5L10 13l5.5-5.5"/>'
  };
  const svg = (k, vb = 20, sw = 1.5) => `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

  /* ---------- art crossfade ---------- */
  const shownStage = { wolf: 0, brain: 0 };
  function setStage(kind, el, n) {
    const src = `img/${kind}/${pad(n)}.webp`;
    const a = el.querySelector("img.a"), b = el.querySelector("img.b");
    if (shownStage[kind] === n) return;
    if (!shownStage[kind]) { a.src = src; shownStage[kind] = n; return; }
    shownStage[kind] = n;
    b.onload = () => { el.classList.add("swap"); setTimeout(() => { a.src = src; el.classList.remove("swap"); }, 720); };
    b.src = src;
  }
  const plate = $("#plate");
  function setPlate(n, dim) { plate.style.backgroundImage = `url(img/bg/${pad(n)}.webp)`; plate.classList.toggle("dim", !!dim); }

  function habitScore(id) {
    const t = today(); let d = 0, n = 0;
    for (let date = P.start; date <= t; date = addDays(date, 1)) {
      if (date === t && !touched(t)) continue;
      const h = due(date).find((x) => x.id === id); if (!h) continue;
      n++; const r = peek(date); if (r && r.done[id]) d++;
    }
    return n ? d / n : null;
  }
  const short = { wake: "Up", sun: "Sun", water: "Water", vits: "Vits", breakfast: "Food", coffee11: "Coffee", caff: "Caffeine", nic: "Nicotine", gym: "Gym", phone: "Phone", bed: "Bed" };
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
      const el = document.createElement("div"); el.className = "habit" + (r.done[h.id] ? " done" : "") + (openIds.has(h.id) ? " open" : ""); el.dataset.id = h.id;
      const time = h.time && r.times[h.id] ? `<span class="h-time">${r.times[h.id]}</span>` : "";
      el.innerHTML = `<div class="habit-head">
          <button type="button" class="habit-row" data-act="toggle" aria-pressed="${r.done[h.id] ? "true" : "false"}">
            <span class="h-icon">${svg(h.icon)}</span>
            <span class="h-text"><span class="h-label">${h.label}</span>${time}</span>
            <span class="h-box">${svg("tick", 16, 2.4)}</span>
          </button>
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
    $("#prevDay").disabled = dayIndex(d) <= 1;
  }

  /* ---------- render: brain ---------- */
  function renderBrain() {
    const { minutes, vals } = brainMinutes(); const st = brainStage(minutes);
    $("#brainStage").textContent = P.brainStages[st - 1];
    $("#brainLine").textContent = minutes == null ? "Type tonight's minutes and it tells you the truth." : st >= 8 ? "Barely touched it." : st >= 6 ? "Normal use." : st >= 4 ? "Getting spongy." : "The evening went into the feed.";
    setStage("brain", $("#brainArt"), st);
    const r = peek(today()); const el = $("#fIg"); if (document.activeElement !== el) el.value = r ? (r.ig ?? "") : "";
    const tr = $("#brainTrend"); tr.innerHTML = "";
    vals.forEach((v, i) => { const d = document.createElement("div"); d.className = "t"; d.innerHTML = `<b>${v.v == null ? "–" : v.v}</b><span>${i === 0 ? "today" : i === 1 ? "yesterday" : DOW[parse(v.date).getDay()]}</span>`; tr.appendChild(d); });
  }

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
    if (btn.dataset.act === "more") { el.classList.toggle("open"); return; }
    r.done[id] = !r.done[id]; r.updated = Date.now(); persist(); queue(viewDate);
    el.classList.toggle("done", !!r.done[id]); btn.setAttribute("aria-pressed", r.done[id] ? "true" : "false");
    const c = completion(viewDate); $("#hDone").textContent = `${c.done} of ${c.total}`; $("#hBar").style.width = Math.round(c.r * 100) + "%";
    renderHome();
  });
  $("#habitList").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-time]"); if (!inp) return;
    const r = rec(viewDate); r.times[inp.dataset.time] = inp.value; r.updated = Date.now(); persist(); queue(viewDate);
    const row = inp.closest(".habit"); const t = row.querySelector(".h-time"); if (t) t.textContent = inp.value; else if (inp.value) { const s = document.createElement("span"); s.className = "h-time"; s.textContent = inp.value; row.querySelector(".h-text").appendChild(s); }
  });
  $("#prevDay").addEventListener("click", () => { viewDate = addDays(viewDate, -1); renderHabits(); });
  $("#nextDay").addEventListener("click", () => { if (viewDate < today()) { viewDate = addDays(viewDate, 1); renderHabits(); } });
  $("#btnCheckin").addEventListener("click", () => {
    const r = rec(viewDate); if (r.checkedIn || !canCheckIn(viewDate)) return;
    r.checkedIn = true; r.checkedInAt = Date.now(); r.updated = Date.now(); persist(); queue(viewDate);
    renderHabits(); renderHome(); showNight(viewDate);
  });
  $("#btnTonight").addEventListener("click", () => { viewDate = today(); show("habits"); });
  $("#streakBtn").addEventListener("click", () => show("cal"));
  $("#fIg").addEventListener("change", (e) => { const r = rec(today()); r.ig = e.target.value; r.updated = Date.now(); persist(); queue(today()); renderBrain(); });
  $("#calGrid").addEventListener("click", onCalClick); $("#calGrid2").addEventListener("click", onCalClick);
  function onCalClick(e) { const b = e.target.closest(".cd[data-date]"); if (!b || b.disabled) return; viewDate = b.dataset.date; show("habits"); }

  const views = ["home", "habits", "brain", "cal"];
  function show(v) {
    if (!views.includes(v)) v = "home";
    views.forEach((k) => { $(`#view-${k}`).hidden = k !== v; });
    $("#topLeft").hidden = v === "habits";
    document.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.view === v; t.classList.toggle("is-active", on); if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
    if (v === "home") { setPlate(1, false); renderHome(); }
    if (v === "habits") { setPlate(4, true); renderHabits(); }
    if (v === "brain") { setPlate(2, false); renderBrain(); }
    if (v === "cal") { setPlate(4, true); renderCal(); }
    scrollTo({ top: 0 }); try { history.replaceState(null, "", "#" + v); } catch {}
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  function renderAll() { renderHome(); renderHabits(); renderBrain(); renderCal(); }

  /* ---------- settings ---------- */
  const sheet = $("#sheet"), scrim = $("#sheetScrim");
  const openSheet = () => { sheet.hidden = false; scrim.hidden = false; $("#fToken").value = store.token; flush(); };
  const closeSheet = () => { sheet.hidden = true; scrim.hidden = true; };
  $("#btnSettings").addEventListener("click", openSheet); $("#btnClose").addEventListener("click", closeSheet); scrim.addEventListener("click", closeSheet);
  $("#btnSaveToken").addEventListener("click", async () => {
    store.token = $("#fToken").value.trim(); persist(); if (!store.token) { setSync("", "Not connected"); return; }
    setSync("busy", "Checking token");
    try { await ghGet("README.md"); setSync("ok", "Connected"); queue(today()); flush(); } catch { setSync("err", "Token rejected. It needs contents read and write on wolf-data."); }
  });
  $("#btnPull").addEventListener("click", pullHistory); $("#ver").textContent = VERSION;

  /* ---------- boot ---------- */
  const startView = (location.hash || "#home").slice(1);
  renderAll(); show(startView);
  if (store.token) { setSync("ok", store.lastSync ? `Synced ${new Date(store.lastSync).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : "Connected"); flush(); } else setSync("", "Not connected");
  let lastDay = today(); setInterval(() => { if (today() !== lastDay) { lastDay = today(); viewDate = today(); renderAll(); } }, 60000);
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
