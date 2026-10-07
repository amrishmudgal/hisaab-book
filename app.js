(() => {
  "use strict";

  const STORAGE_KEY = "maid-math-v1";
  const APP_NAME = "Hisaab Book";
  const DEFAULT_FREE_SHIFTS = 8;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const monthKey = (d = new Date()) => {
    if (typeof d === "string") return d.slice(0, 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const parseMonth = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return { y, m };
  };
  const addMonths = (ym, delta) => {
    const { y, m } = parseMonth(ym);
    return monthKey(new Date(y, m - 1 + delta, 1));
  };
  const formatMonthLabel = (ym) => {
    const { y, m } = parseMonth(ym);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };
  const formatDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };
  const formatINR = (n) => {
    const neg = n < 0;
    const abs = Math.abs(Number(n) || 0);
    const formatted = abs.toLocaleString("en-IN", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
    return (neg ? "−₹" : "₹") + formatted;
  };
  const initials = (name) => {
    const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };
  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function daysInMonth(ym) {
    const { y, m } = parseMonth(ym);
    return new Date(y, m, 0).getDate();
  }

  function defaultState() {
    return { setupDone: false, maids: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.maids)) return defaultState();
      data.maids = data.maids.map(migrateMaid);
      return data;
    } catch {
      return defaultState();
    }
  }

  /**
   * trackingFrom = first month we accrue salary & carry balances.
   * Salary effectiveFrom only picks the RATE for a month — never starts accrual.
   * startingBalance = opening on trackingFrom (default 0).
   * freeShiftsPerMonth = paid leave allowance in shifts (default 8 ≈ 4 days).
   * absences = [{ date: "YYYY-MM-DD", shift: "morning"|"evening" }]
   */
  function migrateMaid(m) {
    const payments = Array.isArray(m.payments) ? m.payments : [];
    const payMonths = payments.map((p) => monthKey(p.date)).sort();
    const now = monthKey();
    let trackingFrom = m.trackingFrom;
    if (!trackingFrom || !/^\d{4}-\d{2}$/.test(trackingFrom)) {
      trackingFrom = payMonths[0] || now;
    }
    const startingBalance =
      m.startingBalance != null && Number.isFinite(Number(m.startingBalance))
        ? Math.round(Number(m.startingBalance))
        : 0;
    let freeShiftsPerMonth = DEFAULT_FREE_SHIFTS;
    if (m.freeShiftsPerMonth != null && Number.isFinite(Number(m.freeShiftsPerMonth))) {
      freeShiftsPerMonth = Math.max(0, Math.round(Number(m.freeShiftsPerMonth)));
    }
    const absences = normalizeAbsences(m.absences);
    return {
      ...m,
      name: m.name || "Person",
      salaryHistory: Array.isArray(m.salaryHistory) ? m.salaryHistory : [],
      payments,
      trackingFrom,
      startingBalance,
      freeShiftsPerMonth,
      absences,
    };
  }

  function normalizeAbsences(raw) {
    if (!raw) return [];
    // Compact map: { "YYYY-MM-DD": ["morning","evening"] } or { "YYYY-MM-DD": {morning:true} }
    if (!Array.isArray(raw) && typeof raw === "object") {
      const out = [];
      for (const [date, val] of Object.entries(raw)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (Array.isArray(val)) {
          for (const s of val) {
            if (s === "morning" || s === "evening") out.push({ date, shift: s });
          }
        } else if (val && typeof val === "object") {
          if (val.morning) out.push({ date, shift: "morning" });
          if (val.evening) out.push({ date, shift: "evening" });
        }
      }
      return dedupeAbsences(out);
    }
    if (!Array.isArray(raw)) return [];
    return dedupeAbsences(
      raw
        .filter((a) => a && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && (a.shift === "morning" || a.shift === "evening"))
        .map((a) => ({ date: a.date, shift: a.shift }))
    );
  }

  function dedupeAbsences(list) {
    const seen = new Set();
    const out = [];
    for (const a of list) {
      const k = a.date + "|" + a.shift;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = load();

  function createPerson({ name, salary, startingBalance, freeShiftsPerMonth }) {
    const ym = monthKey();
    const amount = Math.max(0, Math.round(Number(salary) || 0));
    const bal = Math.round(Number(startingBalance) || 0);
    const free =
      freeShiftsPerMonth != null && Number.isFinite(Number(freeShiftsPerMonth))
        ? Math.max(0, Math.round(Number(freeShiftsPerMonth)))
        : DEFAULT_FREE_SHIFTS;
    const cleanName = String(name || "").trim() || "Person";
    return {
      id: uid(),
      name: cleanName,
      salaryHistory: [{ id: uid(), amount, effectiveFrom: ym }],
      payments: [],
      trackingFrom: ym,
      startingBalance: bal,
      freeShiftsPerMonth: free,
      absences: [],
    };
  }

  function salaryForMonth(maid, ym) {
    const hist = [...(maid.salaryHistory || [])].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom)
    );
    let amt = 0;
    for (const h of hist) {
      if (h.effectiveFrom <= ym) amt = Number(h.amount) || 0;
      else break;
    }
    return amt;
  }

  function paymentsInMonth(maid, ym) {
    return (maid.payments || [])
      .filter((p) => monthKey(p.date) === ym)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  function paidInMonth(maid, ym) {
    return paymentsInMonth(maid, ym).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }

  function freeAllowance(maid) {
    const n = Number(maid.freeShiftsPerMonth);
    if (!Number.isFinite(n)) return DEFAULT_FREE_SHIFTS;
    return Math.max(0, Math.round(n));
  }

  function absencesInMonth(maid, ym) {
    return (maid.absences || []).filter((a) => monthKey(a.date) === ym);
  }

  function isAbsent(maid, date, shift) {
    return (maid.absences || []).some((a) => a.date === date && a.shift === shift);
  }

  function toggleAbsence(maid, date, shift) {
    if (!maid.absences) maid.absences = [];
    const idx = maid.absences.findIndex((a) => a.date === date && a.shift === shift);
    if (idx >= 0) maid.absences.splice(idx, 1);
    else maid.absences.push({ date, shift });
  }

  /**
   * Attendance deduction for a month.
   * perShiftRate = monthlySalary / (daysInMonth * 2)
   * deduction = max(0, absentShifts - freeShiftsPerMonth) * perShiftRate (round nearest ₹)
   * effectiveSalary = max(0, salary - deduction)
   */
  function attendanceStats(maid, ym) {
    const salary = salaryForMonth(maid, ym);
    const days = daysInMonth(ym);
    const free = freeAllowance(maid);
    const absentShifts = absencesInMonth(maid, ym).length;
    const billable = Math.max(0, absentShifts - free);
    const perShiftRate = days > 0 ? salary / (days * 2) : 0;
    const deduction = Math.round(billable * perShiftRate);
    const effectiveSalary = Math.max(0, salary - deduction);
    const freeRemaining = Math.max(0, free - absentShifts);
    const freeUsed = Math.min(absentShifts, free);
    return {
      salary,
      days,
      free,
      absentShifts,
      billable,
      perShiftRate,
      deduction,
      effectiveSalary,
      freeRemaining,
      freeUsed,
    };
  }

  /** First month of ledger accrual for this person. */
  function trackingStart(maid) {
    if (maid.trackingFrom && /^\d{4}-\d{2}$/.test(maid.trackingFrom)) return maid.trackingFrom;
    const payMonths = (maid.payments || []).map((p) => monthKey(p.date)).sort();
    return payMonths[0] || monthKey();
  }

  /**
   * Closing after month ym.
   * closing = opening + effectiveSalary - advancesPaid
   */
  function closingBalance(maid, ym) {
    const start = trackingStart(maid);
    if (ym < start) {
      return Number(maid.startingBalance) || 0;
    }
    let opening = Number(maid.startingBalance) || 0;
    let cursor = start;
    while (true) {
      const att = attendanceStats(maid, cursor);
      const paid = paidInMonth(maid, cursor);
      const closing = opening + att.effectiveSalary - paid;
      if (cursor === ym) return closing;
      opening = closing;
      cursor = addMonths(cursor, 1);
      if (cursor > ym) return closing;
    }
  }

  function openingBalance(maid, ym) {
    const start = trackingStart(maid);
    if (ym <= start) return Number(maid.startingBalance) || 0;
    return closingBalance(maid, addMonths(ym, -1));
  }

  function monthSummary(maid, ym) {
    const opening = openingBalance(maid, ym);
    const att = attendanceStats(maid, ym);
    const paid = paidInMonth(maid, ym);
    const closing = opening + att.effectiveSalary - paid;
    const entries = paymentsInMonth(maid, ym);
    const entriesTotal = entries.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return {
      opening,
      salary: att.salary,
      deduction: att.deduction,
      effectiveSalary: att.effectiveSalary,
      paid,
      closing,
      owed: opening + att.effectiveSalary,
      entriesTotal,
      trackingFrom: trackingStart(maid),
      att,
    };
  }

  let route = { name: "home" };
  let toastTimer = null;

  function navigate(r) {
    route = r;
    render();
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2400);
  }

  function balClass(n) {
    if (n > 0) return "pos";
    if (n < 0) return "neg";
    return "zero";
  }

  function balChip(n) {
    if (n > 0) return `<span class="chip ok">You owe them</span>`;
    if (n < 0) return `<span class="chip warn">They owe household</span>`;
    return `<span class="chip">Settled</span>`;
  }

  function homeAttLine(s) {
    const a = s.att;
    if (!a) return "";
    if (a.deduction > 0) {
      return `<div class="home-att">${a.absentShifts} absence${a.absentShifts === 1 ? "" : "s"} · Attendance −${formatINR(a.deduction)}</div>`;
    }
    if (a.absentShifts > 0) {
      return `<div class="home-att" style="color:var(--text-muted)">${a.absentShifts} absence${a.absentShifts === 1 ? "" : "s"} · within free leave</div>`;
    }
    return "";
  }

  function renderSetup() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="page">
        <div class="setup-hero">
          <div class="logo">₹</div>
          <h1>${APP_NAME}</h1>
          <p>Track salaries, advances, attendance, and carry-forward balances for household help or anyone you pay — stored only on this phone.</p>
        </div>
        <form id="setup-form">
          ${[1, 2]
            .map(
              (i) => `
            <div class="maid-block">
              <h3><span class="maid-avatar" style="width:32px;height:32px;font-size:0.8rem;border-radius:10px">${i}</span> Person ${i}</h3>
              <div class="field">
                <label>Name</label>
                <input name="name${i}" required maxlength="40" placeholder="e.g. Sunita" value="Person ${i}" />
              </div>
              <div class="field">
                <label>Monthly salary (₹)</label>
                <input name="salary${i}" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="" />
              </div>
              <div class="field">
                <label>Starting balance (₹)</label>
                <input name="start${i}" type="number" inputmode="numeric" step="1" placeholder="0" value="0" />
                <div class="error" style="color:var(--text-muted);margin-top:4px">Usually 0. Use only if you already owe them (or they owe you — use negative) from before you start tracking.</div>
              </div>
              <div class="field">
                <label>Free leave shifts / month</label>
                <input name="free${i}" type="number" inputmode="numeric" min="0" step="1" value="${DEFAULT_FREE_SHIFTS}" />
                <div class="error" style="color:var(--text-muted);margin-top:4px">Default ${DEFAULT_FREE_SHIFTS} ≈ 4 full days (morning + evening). First this many absent shifts do not deduct salary.</div>
              </div>
            </div>`
            )
            .join("")}
          <p class="hint">Tracking starts from <strong>this month</strong>. Past unpaid months are <strong>not</strong> auto-added. You can add more people anytime, and change names, salary, leave, and starting balance later.</p>
          <button class="btn btn-primary btn-block" type="submit">Start tracking</button>
        </form>
      </div>`;

    document.getElementById("setup-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const maids = [1, 2].map((i) => {
        const name = String(fd.get(`name${i}`) || `Person ${i}`).trim() || `Person ${i}`;
        const amount = Math.max(0, Math.round(Number(fd.get(`salary${i}`)) || 0));
        const startingBalance = Math.round(Number(fd.get(`start${i}`)) || 0);
        const freeShiftsPerMonth = Math.max(0, Math.round(Number(fd.get(`free${i}`)) || DEFAULT_FREE_SHIFTS));
        return createPerson({ name, salary: amount, startingBalance, freeShiftsPerMonth });
      });
      state = { setupDone: true, maids };
      save(state);
      navigate({ name: "home" });
      toast("Ready — tap a card to open their ledger");
    };
  }

  function renderHome() {
    const app = document.getElementById("app");
    const ym = monthKey();
    const cards = state.maids
      .map((m) => {
        const s = monthSummary(m, ym);
        return `
        <button class="maid-card" data-open="${m.id}" type="button">
          <div class="name-row">
            <div class="maid-avatar">${escapeHtml(initials(m.name))}</div>
            <div style="flex:1;min-width:0;text-align:left">
              <h2 class="name">${escapeHtml(m.name)}</h2>
              <div class="meta">Salary ${formatINR(s.salary)} / month · ${formatMonthLabel(ym)}</div>
              ${homeAttLine(s)}
            </div>
          </div>
          <div class="balance-row">
            <div>
              <div class="balance-label">Current balance</div>
              <div class="balance-amt ${balClass(s.closing)}">${formatINR(s.closing)}</div>
            </div>
            <div>${balChip(s.closing)}</div>
          </div>
          <div class="btn-row" style="margin-top:12px">
            <span class="btn btn-primary" data-quick-pay="${m.id}" style="pointer-events:none;flex:1">＋ Add payment</span>
          </div>
        </button>`;
      })
      .join("");

    const empty = `
      <div class="empty">
        <div class="emoji">👋</div>
        <p><strong>No people yet</strong></p>
        <p>Add household help or anyone you pay to start a ledger.</p>
        <button class="btn btn-primary" id="empty-add" type="button" style="margin-top:12px;flex:none;min-width:160px">＋ Add person</button>
      </div>`;

    app.innerHTML = `
      <header class="topbar">
        <div style="flex:1;min-width:0">
          <h1>${APP_NAME}<span class="sub">Local only · ₹ INR</span></h1>
        </div>
        <button class="btn btn-primary" id="add-person-top" type="button" style="flex:none;min-width:auto;padding:8px 12px;min-height:40px;font-size:0.85rem">＋ Add</button>
      </header>
      <div class="page">
        <p class="hint">Tap a card to open their ledger. Positive = you still owe them; negative = advances exceeded salary (carries forward). Opening starts at ₹0 unless you set a starting balance.</p>
        ${cards || empty}
        ${
          state.maids.length
            ? `<button class="btn btn-primary btn-block" id="add-person" type="button" style="margin-top:12px">＋ Add person</button>`
            : ""
        }
      </div>`;

    const openAdd = () => openAddPersonSheet();
    ["add-person", "add-person-top", "empty-add"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.onclick = openAdd;
    });

    app.querySelectorAll("[data-open]").forEach((el) => {
      el.onclick = (ev) => {
        const quick = ev.target.closest("[data-quick-pay]");
        const id = el.getAttribute("data-open");
        if (quick) navigate({ name: "detail", maidId: id, showPay: true });
        else navigate({ name: "detail", maidId: id });
      };
    });
  }

  function buildAttendanceCalendar(maid, viewMonth) {
    const { y, m } = parseMonth(viewMonth);
    const days = daysInMonth(viewMonth);
    const today = todayISO();
    const rows = [];
    for (let d = 1; d <= days; d++) {
      const date = `${viewMonth}-${String(d).padStart(2, "0")}`;
      const weekday = new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short" });
      const morningAbsent = isAbsent(maid, date, "morning");
      const eveningAbsent = isAbsent(maid, date, "evening");
      const future = date > today;
      rows.push(`
        <div class="att-day${future ? " future" : ""}" data-date="${date}">
          <div class="dow"><span class="num">${d}</span>${weekday}</div>
          <button type="button" class="att-shift ${morningAbsent ? "absent" : "present"}" data-shift="morning" data-date="${date}" aria-pressed="${morningAbsent}">
            <span class="lbl">Morning</span>
            <span>${morningAbsent ? "Absent" : "Present"}</span>
          </button>
          <button type="button" class="att-shift ${eveningAbsent ? "absent" : "present"}" data-shift="evening" data-date="${date}" aria-pressed="${eveningAbsent}">
            <span class="lbl">Evening</span>
            <span>${eveningAbsent ? "Absent" : "Present"}</span>
          </button>
        </div>`);
    }
    return rows.join("");
  }

  function renderDetail() {
    const maid = state.maids.find((m) => m.id === route.maidId);
    if (!maid) {
      navigate({ name: "home" });
      return;
    }
    const viewMonth = route.month || monthKey();
    const s = monthSummary(maid, viewMonth);
    const a = s.att;
    const entries = paymentsInMonth(maid, viewMonth);
    const isCurrent = viewMonth === monthKey();
    const paidMismatch = s.paid !== s.entriesTotal;
    const showAtt = !!route.showAttendance;

    const app = document.getElementById("app");
    app.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" id="back" aria-label="Back">←</button>
        <div style="flex:1;min-width:0">
          <h1 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(maid.name)}<span class="sub">Ledger</span></h1>
        </div>
        <button class="icon-btn" id="edit-name" aria-label="Edit name" title="Edit name">✎</button>
      </header>
      <div class="page">
        <div class="name-banner">
          <div class="label">Person ledger</div>
          <div class="maid-name">${escapeHtml(maid.name)}</div>
          <div class="actions">
            <button class="ghost" id="rename-btn" type="button">Edit name</button>
            <button class="ghost" id="salary-btn" type="button">Change salary</button>
            <button class="ghost" id="leave-btn" type="button">Free leave</button>
            <button class="ghost" id="opening-btn" type="button">Starting balance</button>
          </div>
        </div>

        <div class="month-picker">
          <button class="icon-btn" id="prev-m" type="button" aria-label="Previous month">‹</button>
          <div class="label">${formatMonthLabel(viewMonth)}${isCurrent ? " · This month" : ""}</div>
          <button class="icon-btn" id="next-m" type="button" aria-label="Next month" ${viewMonth >= monthKey() ? "disabled" : ""}>›</button>
        </div>

        <div class="summary-grid">
          <div class="stat">
            <div class="label">Opening</div>
            <div class="value ${balClass(s.opening)}">${formatINR(s.opening)}</div>
          </div>
          <div class="stat">
            <div class="label">Salary</div>
            <div class="value">${formatINR(s.salary)}</div>
          </div>
          <div class="stat">
            <div class="label">Attendance deduction</div>
            <div class="value ${a.deduction > 0 ? "deduct" : ""}">${a.deduction > 0 ? "−" : ""}${formatINR(a.deduction)}</div>
          </div>
          <div class="stat">
            <div class="label">Effective salary</div>
            <div class="value">${formatINR(s.effectiveSalary)}</div>
          </div>
          <div class="stat">
            <div class="label">Advances paid</div>
            <div class="value">${formatINR(s.paid)}</div>
          </div>
          <div class="stat">
            <div class="label">Closing balance</div>
            <div class="value ${balClass(s.closing)}">${formatINR(s.closing)}</div>
          </div>
          <div class="stat wide">
            <div class="label">This month owed (opening + effective)</div>
            <div class="value big ${balClass(s.owed)}">${formatINR(s.owed)}</div>
            <div style="margin-top:8px">${balChip(s.closing)}</div>
            <div style="margin-top:8px;font-size:0.75rem;color:var(--text-muted)">Tracking from ${formatMonthLabel(s.trackingFrom)} · Starting balance ${formatINR(maid.startingBalance || 0)}</div>
          </div>
        </div>

        <div class="section-title">
          <span>Attendance · ${formatMonthLabel(viewMonth)}</span>
          <button class="btn btn-secondary" id="toggle-att" type="button" style="flex:none;min-width:auto;padding:8px 14px;min-height:40px">${showAtt ? "Hide" : "Mark"}</button>
        </div>
        <div class="att-summary">
          <span class="att-pill">${a.absentShifts} absent shift${a.absentShifts === 1 ? "" : "s"}</span>
          <span class="att-pill ${a.freeRemaining > 0 ? "ok" : ""}">${a.freeRemaining} of ${a.free} free left</span>
          <span class="att-pill ${a.deduction > 0 ? "warn" : ""}">Deduction ${a.deduction > 0 ? "−" : ""}${formatINR(a.deduction)}</span>
        </div>
        ${
          showAtt
            ? `<p class="hint" style="margin-bottom:8px">Tap Morning / Evening to toggle Absent ↔ Present. Default is present (nothing stored). First ${a.free} absent shifts this month are free leave.</p>
               <div class="att-cal" id="att-cal">${buildAttendanceCalendar(maid, viewMonth)}</div>`
            : ""
        }

        <div class="section-title">
          <span>Payments · ${escapeHtml(maid.name)}</span>
          <button class="btn btn-primary" id="add-pay" type="button" style="flex:none;min-width:auto;padding:8px 14px;min-height:40px">＋ Add</button>
        </div>
        ${
          paidMismatch
            ? `<p class="hint" style="border-color:#f0c0bc;background:var(--negative-bg)">Payment list total ${formatINR(s.entriesTotal)} does not match Advances paid ${formatINR(s.paid)}. Please re-check entries.</p>`
            : entries.length
              ? `<p style="margin:0 0 10px;font-size:0.8rem;color:var(--text-muted)">List total ${formatINR(s.entriesTotal)} = Advances paid</p>`
              : ""
        }
        <div class="list">
          ${
            entries.length
              ? entries
                  .map(
                    (p) => `
            <button class="entry" type="button" data-edit-pay="${p.id}">
              <div class="grow">
                <div class="date">${formatDate(p.date)}</div>
                <div class="note">${escapeHtml(p.note || "Advance / payment")}</div>
              </div>
              <div class="amt">${formatINR(p.amount)}</div>
            </button>`
                  )
                  .join("")
              : `<div class="empty"><div class="emoji">🧾</div><p>No payments for ${escapeHtml(maid.name)} this month.</p><p>Tap ＋ Add to record an advance.</p></div>`
          }
        </div>
        <button class="btn btn-danger btn-block" id="remove-person" type="button" style="margin-top:16px">Remove ${escapeHtml(maid.name)}</button>
        <div class="fab-spacer"></div>
      </div>`;

    document.getElementById("back").onclick = () => navigate({ name: "home" });
    document.getElementById("prev-m").onclick = () =>
      navigate({ name: "detail", maidId: maid.id, month: addMonths(viewMonth, -1), showAttendance: showAtt });
    document.getElementById("next-m").onclick = () => {
      const n = addMonths(viewMonth, 1);
      if (n <= monthKey()) navigate({ name: "detail", maidId: maid.id, month: n, showAttendance: showAtt });
    };
    const openRename = () => openNameSheet(maid);
    document.getElementById("edit-name").onclick = openRename;
    document.getElementById("rename-btn").onclick = openRename;
    document.getElementById("salary-btn").onclick = () => openSalarySheet(maid, viewMonth);
    document.getElementById("leave-btn").onclick = () => openLeaveSheet(maid);
    document.getElementById("opening-btn").onclick = () => openOpeningSheet(maid);
    document.getElementById("add-pay").onclick = () => openPaymentSheet(maid, null, viewMonth);
    document.getElementById("remove-person").onclick = () => openRemovePersonSheet(maid);
    document.getElementById("toggle-att").onclick = () =>
      navigate({ name: "detail", maidId: maid.id, month: viewMonth, showAttendance: !showAtt });

    app.querySelectorAll("[data-edit-pay]").forEach((el) => {
      el.onclick = () => {
        const p = maid.payments.find((x) => x.id === el.getAttribute("data-edit-pay"));
        if (p) openPaymentSheet(maid, p, viewMonth);
      };
    });

    const cal = document.getElementById("att-cal");
    if (cal) {
      cal.querySelectorAll(".att-shift").forEach((btn) => {
        btn.onclick = () => {
          const date = btn.getAttribute("data-date");
          const shift = btn.getAttribute("data-shift");
          toggleAbsence(maid, date, shift);
          save(state);
          navigate({ name: "detail", maidId: maid.id, month: viewMonth, showAttendance: true });
        };
      });
    }

    if (route.showPay) {
      route.showPay = false;
      openPaymentSheet(maid, null, viewMonth);
    }
  }

  function openOverlay(html, { center = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "overlay" + (center ? " center" : "");
    wrap.innerHTML = html;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.remove();
    });
    document.body.appendChild(wrap);
    return wrap;
  }

  function openAddPersonSheet() {
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Add person</h2>
        <p class="sheet-sub">Create a new ledger for household help or anyone you pay. Tracking starts from <strong>this month</strong>.</p>
        <form id="add-person-form">
          <div class="field">
            <label>Name</label>
            <input name="name" required maxlength="40" placeholder="e.g. Sunita" autofocus />
          </div>
          <div class="field">
            <label>Monthly salary (₹)</label>
            <input name="salary" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="0" />
          </div>
          <div class="field">
            <label>Starting balance (₹)</label>
            <input name="bal" type="number" inputmode="decimal" step="1" value="0" />
            <div class="hint" style="margin:8px 0 0">
              <strong>How to enter it</strong><br/>
              • <code>0</code> — clean start<br/>
              • Positive e.g. <code>2000</code> — you already owed them ₹2,000<br/>
              • Negative e.g. <code>-1500</code> — they already took ₹1,500 more than salary (type the minus sign)
            </div>
          </div>
          <div class="field">
            <label>Free leave shifts / month</label>
            <input name="free" type="number" inputmode="numeric" min="0" step="1" value="${DEFAULT_FREE_SHIFTS}" />
            <div class="hint" style="margin:8px 0 0">${DEFAULT_FREE_SHIFTS} ≈ 4 full days (2 shifts/day). First this many absences do not deduct salary.</div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Add person</button>
          </div>
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    ov.querySelector("#add-person-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get("name") || "").trim();
      if (!name) return;
      const salary = Math.max(0, Math.round(Number(fd.get("salary")) || 0));
      const startingBalance = Math.round(Number(fd.get("bal")) || 0);
      const freeShiftsPerMonth = Math.max(0, Math.round(Number(fd.get("free")) || DEFAULT_FREE_SHIFTS));
      const person = createPerson({ name, salary, startingBalance, freeShiftsPerMonth });
      state.maids.push(person);
      state.setupDone = true;
      save(state);
      ov.remove();
      toast(`Added ${name}`);
      navigate({ name: "detail", maidId: person.id });
    };
  }

  function openRemovePersonSheet(maid) {
    const ov = openOverlay(
      `<div class="dialog">
        <h3>Remove ${escapeHtml(maid.name)}?</h3>
        <p>This permanently deletes their ledger, payments, attendance, and salary history on this device. Type <strong>DELETE</strong> to confirm.</p>
        <div class="field" style="margin-bottom:14px">
          <label>Type DELETE</label>
          <input id="confirm-text" maxlength="20" placeholder="DELETE" autocomplete="off" autofocus />
        </div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="no">Cancel</button>
          <button class="btn btn-danger" id="yes" disabled>Remove</button>
        </div>
      </div>`,
      { center: true }
    );
    const input = ov.querySelector("#confirm-text");
    const yes = ov.querySelector("#yes");
    input.oninput = () => {
      yes.disabled = input.value.trim() !== "DELETE";
    };
    ov.querySelector("#no").onclick = () => ov.remove();
    yes.onclick = () => {
      if (input.value.trim() !== "DELETE") return;
      state.maids = state.maids.filter((m) => m.id !== maid.id);
      save(state);
      ov.remove();
      toast(`${maid.name} removed`);
      navigate({ name: "home" });
    };
  }

  function openNameSheet(maid) {
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Edit name</h2>
        <p class="sheet-sub">This name appears on the home card and throughout their ledger.</p>
        <form id="name-form">
          <div class="field">
            <label>Name</label>
            <input name="name" required maxlength="40" value="${escapeHtml(maid.name)}" autofocus />
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save name</button>
          </div>
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    ov.querySelector("#name-form").onsubmit = (e) => {
      e.preventDefault();
      const name = String(new FormData(e.target).get("name") || "").trim();
      if (!name) return;
      maid.name = name;
      save(state);
      ov.remove();
      toast(`Ledger renamed to ${name}`);
      render();
    };
  }

  function openLeaveSheet(maid) {
    const current = freeAllowance(maid);
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Free leave shifts</h2>
        <p class="sheet-sub">For <strong>${escapeHtml(maid.name)}</strong>. Each day has two shifts (Morning + Evening). Absent shifts within this allowance do not reduce salary.</p>
        <form id="leave-form">
          <div class="field">
            <label>Free leave shifts / month</label>
            <input name="free" type="number" inputmode="numeric" min="0" step="1" required value="${current}" autofocus />
            <div class="hint" style="margin:8px 0 0">
              <strong>Hint</strong><br/>
              • <code>8</code> ≈ 4 full leave days<br/>
              • <code>0</code> — every absence deducts<br/>
              • Deduction = absent shifts beyond this × (salary ÷ days ÷ 2)
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    ov.querySelector("#leave-form").onsubmit = (e) => {
      e.preventDefault();
      const free = Math.max(0, Math.round(Number(new FormData(e.target).get("free")) || 0));
      maid.freeShiftsPerMonth = free;
      save(state);
      ov.remove();
      toast(`Free leave set to ${free} shifts/month`);
      render();
    };
  }

  function openOpeningSheet(maid) {
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Starting balance</h2>
        <p class="sheet-sub">For <strong>${escapeHtml(maid.name)}</strong>. This is the opening amount on the first tracking month — not a backfill of past unpaid salaries. Use <strong>0</strong> to clear a wrong huge opening.</p>
        <form id="open-form">
          <div class="field">
            <label>Starting balance (₹)</label>
            <input name="bal" type="number" inputmode="decimal" step="1" required value="${Number(maid.startingBalance) || 0}" autofocus />
            <div class="hint" style="margin:8px 0 0">
              <strong>How to enter it</strong><br/>
              • <code>0</code> — clean start<br/>
              • Positive e.g. <code>2000</code> — you already owed them ₹2,000<br/>
              • Negative e.g. <code>-1500</code> — they already took ₹1,500 more than salary (type the minus sign)
            </div>
          </div>
          <div class="field">
            <label>Track from month</label>
            <input name="from" type="month" required value="${trackingStart(maid)}" />
            <div class="error" style="color:var(--text-muted)">Salary is only counted from this month forward. Earlier months are ignored.</div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
          <button type="button" class="btn btn-danger btn-block" id="reset0" style="margin-top:10px">Reset starting balance to ₹0</button>
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    ov.querySelector("#reset0").onclick = () => {
      maid.startingBalance = 0;
      save(state);
      ov.remove();
      toast(`Starting balance for ${maid.name} reset to ₹0`);
      render();
    };
    ov.querySelector("#open-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const bal = Math.round(Number(fd.get("bal")) || 0);
      const from = String(fd.get("from"));
      if (!/^\d{4}-\d{2}$/.test(from)) return;
      maid.startingBalance = bal;
      maid.trackingFrom = from;
      save(state);
      ov.remove();
      toast("Starting balance updated");
      render();
    };
  }

  function openSalarySheet(maid, viewMonth) {
    const current = salaryForMonth(maid, viewMonth);
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Change salary</h2>
        <p class="sheet-sub">For <strong>${escapeHtml(maid.name)}</strong>. “Effective from” only chooses which rate applies in each month — it does <strong>not</strong> invent unpaid salary for empty past months.</p>
        <form id="salary-form">
          <div class="field">
            <label>Monthly salary (₹)</label>
            <input name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${current || ""}" />
          </div>
          <div class="field">
            <label>Rate effective from month</label>
            <input name="from" type="month" required value="${viewMonth}" />
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save salary</button>
          </div>
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    ov.querySelector("#salary-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = Math.max(0, Math.round(Number(fd.get("amount")) || 0));
      const effectiveFrom = String(fd.get("from"));
      if (!/^\d{4}-\d{2}$/.test(effectiveFrom)) return;
      const hist = maid.salaryHistory || (maid.salaryHistory = []);
      const existing = hist.find((h) => h.effectiveFrom === effectiveFrom);
      if (existing) existing.amount = amount;
      else hist.push({ id: uid(), amount, effectiveFrom });
      hist.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      save(state);
      ov.remove();
      toast(`Salary for ${maid.name} updated`);
      render();
    };
  }

  function openPaymentSheet(maid, payment, viewMonth) {
    const isEdit = !!payment;
    const defaultDate =
      payment?.date ||
      (viewMonth === monthKey()
        ? todayISO()
        : `${viewMonth}-${String(Math.min(28, new Date().getDate())).padStart(2, "0")}`);
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>${isEdit ? "Edit payment" : "Add payment"}</h2>
        <p class="sheet-sub">Advance against <strong>${escapeHtml(maid.name)}</strong>’s salary for the payment’s month.</p>
        <form id="pay-form">
          <div class="field">
            <label>Amount (₹)</label>
            <input name="amount" type="number" inputmode="numeric" min="1" step="1" required value="${payment ? payment.amount : ""}" autofocus />
          </div>
          <div class="field">
            <label>Date</label>
            <input name="date" type="date" required value="${defaultDate}" />
          </div>
          <div class="field">
            <label>Note (optional)</label>
            <textarea name="note" maxlength="200" placeholder="e.g. Mid-month advance">${escapeHtml(payment?.note || "")}</textarea>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" id="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEdit ? "Save" : "Add payment"}</button>
          </div>
          ${
            isEdit
              ? `<button type="button" class="btn btn-danger btn-block" id="delete" style="margin-top:10px">Delete payment</button>`
              : ""
          }
        </form>
      </div>`);
    ov.querySelector("#cancel").onclick = () => ov.remove();
    if (isEdit) {
      ov.querySelector("#delete").onclick = () => {
        confirmDelete(`Delete this ₹ payment for ${maid.name}?`, () => {
          maid.payments = maid.payments.filter((p) => p.id !== payment.id);
          save(state);
          ov.remove();
          toast("Payment deleted");
          navigate({ name: "detail", maidId: maid.id, month: monthKey(payment.date) });
        });
      };
    }
    ov.querySelector("#pay-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = Math.round(Number(fd.get("amount")) || 0);
      const date = String(fd.get("date"));
      const note = String(fd.get("note") || "").trim();
      if (amount < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const pm = monthKey(date);
      if (!maid.trackingFrom || pm < maid.trackingFrom) {
        maid.trackingFrom = pm;
      }
      if (isEdit) {
        payment.amount = amount;
        payment.date = date;
        payment.note = note;
      } else {
        maid.payments.push({ id: uid(), amount, date, note });
      }
      save(state);
      ov.remove();
      toast(isEdit ? "Payment updated" : `Payment added for ${maid.name}`);
      navigate({ name: "detail", maidId: maid.id, month: monthKey(date) });
    };
  }

  function confirmDelete(message, onYes) {
    const ov = openOverlay(
      `<div class="dialog">
        <h3>Are you sure?</h3>
        <p>${escapeHtml(message)}</p>
        <div class="btn-row">
          <button class="btn btn-secondary" id="no">Cancel</button>
          <button class="btn btn-danger" id="yes">Delete</button>
        </div>
      </div>`,
      { center: true }
    );
    ov.querySelector("#no").onclick = () => ov.remove();
    ov.querySelector("#yes").onclick = () => {
      ov.remove();
      onYes();
    };
  }

  function render() {
    if (!state.setupDone || !state.maids?.length) {
      if (state.setupDone && Array.isArray(state.maids) && state.maids.length === 0) {
        renderHome();
        return;
      }
      renderSetup();
      return;
    }
    if (route.name === "detail") renderDetail();
    else renderHome();
  }

  if (!state.setupDone && (!state.maids || !state.maids.length)) {
    route = { name: "setup" };
  }
  render();
})();
