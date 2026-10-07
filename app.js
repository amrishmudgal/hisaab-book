(() => {
  "use strict";

  const STORAGE_KEY = "maid-math-v1";
  const APP_NAME = "Hisaab Book";

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

  function defaultState() {
    return { setupDone: false, maids: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.maids)) return defaultState();
      // Migrate / sanitize each person (storage key & array name kept for compatibility)
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
   */
  function migrateMaid(m) {
    const payments = Array.isArray(m.payments) ? m.payments : [];
    const payMonths = payments.map((p) => monthKey(p.date)).sort();
    const now = monthKey();
    let trackingFrom = m.trackingFrom;
    if (!trackingFrom || !/^\d{4}-\d{2}$/.test(trackingFrom)) {
      // Prefer earliest payment month, else "now". NEVER use salary effectiveFrom
      // (that caused multi-year unpaid salary backfill).
      trackingFrom = payMonths[0] || now;
    }
    const startingBalance =
      m.startingBalance != null && Number.isFinite(Number(m.startingBalance))
        ? Math.round(Number(m.startingBalance))
        : 0;
    return {
      ...m,
      name: m.name || "Person",
      salaryHistory: Array.isArray(m.salaryHistory) ? m.salaryHistory : [],
      payments,
      trackingFrom,
      startingBalance,
    };
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = load();

  function createPerson({ name, salary, startingBalance }) {
    const ym = monthKey();
    const amount = Math.max(0, Math.round(Number(salary) || 0));
    const bal = Math.round(Number(startingBalance) || 0);
    const cleanName = String(name || "").trim() || "Person";
    return {
      id: uid(),
      name: cleanName,
      salaryHistory: [{ id: uid(), amount, effectiveFrom: ym }],
      payments: [],
      trackingFrom: ym,
      startingBalance: bal,
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

  /** First month of ledger accrual for this person. */
  function trackingStart(maid) {
    if (maid.trackingFrom && /^\d{4}-\d{2}$/.test(maid.trackingFrom)) return maid.trackingFrom;
    const payMonths = (maid.payments || []).map((p) => monthKey(p.date)).sort();
    return payMonths[0] || monthKey();
  }

  /**
   * Closing after month ym.
   * Accrues ONLY from trackingStart → ym. Empty months before trackingStart are ignored.
   * Opening of trackingStart = startingBalance (default 0).
   */
  function closingBalance(maid, ym) {
    const start = trackingStart(maid);
    if (ym < start) {
      // Before tracking: no accrual; treat as startingBalance with no salary for that view
      return Number(maid.startingBalance) || 0;
    }
    let opening = Number(maid.startingBalance) || 0;
    let cursor = start;
    while (true) {
      const salary = salaryForMonth(maid, cursor);
      const paid = paidInMonth(maid, cursor);
      const closing = opening + salary - paid;
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
    const salary = salaryForMonth(maid, ym);
    const paid = paidInMonth(maid, ym);
    const closing = opening + salary - paid;
    const entries = paymentsInMonth(maid, ym);
    // Sanity: paid must equal sum of listed entries
    const entriesTotal = entries.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return {
      opening,
      salary,
      paid,
      closing,
      owed: opening + salary,
      entriesTotal,
      trackingFrom: trackingStart(maid),
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

  function renderSetup() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="page">
        <div class="setup-hero">
          <div class="logo">₹</div>
          <h1>${APP_NAME}</h1>
          <p>Track salaries, advances, and carry-forward balances for maids or anyone you pay — stored only on this phone.</p>
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
            </div>`
            )
            .join("")}
          <p class="hint">Tracking starts from <strong>this month</strong>. Past unpaid months are <strong>not</strong> auto-added. You can add more people anytime, and change names, salary, and starting balance later.</p>
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
        return createPerson({ name, salary: amount, startingBalance });
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
        <p>Add a maid or anyone you pay to start a ledger.</p>
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

  function renderDetail() {
    const maid = state.maids.find((m) => m.id === route.maidId);
    if (!maid) {
      navigate({ name: "home" });
      return;
    }
    const viewMonth = route.month || monthKey();
    const s = monthSummary(maid, viewMonth);
    const entries = paymentsInMonth(maid, viewMonth);
    const isCurrent = viewMonth === monthKey();
    const paidMismatch = s.paid !== s.entriesTotal;

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
            <div class="label">Advances paid</div>
            <div class="value">${formatINR(s.paid)}</div>
          </div>
          <div class="stat">
            <div class="label">Closing balance</div>
            <div class="value ${balClass(s.closing)}">${formatINR(s.closing)}</div>
          </div>
          <div class="stat wide">
            <div class="label">This month owed (opening + salary)</div>
            <div class="value big ${balClass(s.owed)}">${formatINR(s.owed)}</div>
            <div style="margin-top:8px">${balChip(s.closing)}</div>
            <div style="margin-top:8px;font-size:0.75rem;color:var(--text-muted)">Tracking from ${formatMonthLabel(s.trackingFrom)} · Starting balance ${formatINR(maid.startingBalance || 0)}</div>
          </div>
        </div>

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
      navigate({ name: "detail", maidId: maid.id, month: addMonths(viewMonth, -1) });
    document.getElementById("next-m").onclick = () => {
      const n = addMonths(viewMonth, 1);
      if (n <= monthKey()) navigate({ name: "detail", maidId: maid.id, month: n });
    };
    const openRename = () => openNameSheet(maid);
    document.getElementById("edit-name").onclick = openRename;
    document.getElementById("rename-btn").onclick = openRename;
    document.getElementById("salary-btn").onclick = () => openSalarySheet(maid, viewMonth);
    document.getElementById("opening-btn").onclick = () => openOpeningSheet(maid);
    document.getElementById("add-pay").onclick = () => openPaymentSheet(maid, null, viewMonth);
    document.getElementById("remove-person").onclick = () => openRemovePersonSheet(maid);
    app.querySelectorAll("[data-edit-pay]").forEach((el) => {
      el.onclick = () => {
        const p = maid.payments.find((x) => x.id === el.getAttribute("data-edit-pay"));
        if (p) openPaymentSheet(maid, p, viewMonth);
      };
    });

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
        <p class="sheet-sub">Create a new ledger for a maid or anyone you pay. Tracking starts from <strong>this month</strong>.</p>
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
      const person = createPerson({ name, salary, startingBalance });
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
        <p>This permanently deletes their ledger, payments, and salary history on this device. Type <strong>DELETE</strong> to confirm.</p>
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
      // Keep trackingFrom; just zero the open
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
      // If first payment is before trackingFrom, pull trackingFrom earlier so payment counts
      // but do NOT pull trackingFrom based on salary effectiveFrom.
      const pm = monthKey(date);
      if (!maid.trackingFrom || pm < maid.trackingFrom) {
        // Only extend tracking earlier when user records a payment in that month
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
      // If setupDone but all removed → empty home with Add (not full setup again)
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

  // One-time fix for already-corrupted ledgers: if opening for current month is
  // absurdly large vs salary (e.g. > 3 months of accrued unpaid with no intent),
  // we do NOT auto-wipe — user uses "Starting balance" → Reset to ₹0.
  // Migration already stops using salary effectiveFrom as tracking start.

  if (!state.setupDone && (!state.maids || !state.maids.length)) {
    route = { name: "setup" };
  }
  render();
})();
