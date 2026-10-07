(() => {
  "use strict";

  const STORAGE_KEY = "maid-math-v1";
  const APP_NAME = "Hisaab Book";

  // ---------- utils ----------
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const monthKey = (d = new Date()) => {
    if (typeof d === "string") {
      // YYYY-MM or YYYY-MM-DD
      return d.slice(0, 7);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const parseMonth = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return { y, m };
  };
  const addMonths = (ym, delta) => {
    const { y, m } = parseMonth(ym);
    const dt = new Date(y, m - 1 + delta, 1);
    return monthKey(dt);
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

  // ---------- storage ----------
  function defaultState() {
    return {
      setupDone: false,
      maids: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.maids)) return defaultState();
      return data;
    } catch {
      return defaultState();
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = load();

  // ---------- domain ----------
  /** Salary effective for a given month: latest salaryHistory entry with effectiveFrom <= month */
  function salaryForMonth(maid, ym) {
    const hist = [...(maid.salaryHistory || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
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

  /** Closing balance after month ym (can be negative). Opening of next = this closing. */
  function closingBalance(maid, ym) {
    // Walk from earliest relevant month to ym
    const months = collectMonths(maid);
    if (!months.length) {
      // no history — just salary - paid for this month (opening 0)
      return salaryForMonth(maid, ym) - paidInMonth(maid, ym);
    }
    const first = months[0] < ym ? months[0] : ym;
    let cursor = first;
    let opening = 0;
    // If ym is before first activity, opening 0
    if (ym < first) {
      return salaryForMonth(maid, ym) - paidInMonth(maid, ym);
    }
    while (true) {
      const salary = salaryForMonth(maid, cursor);
      const paid = paidInMonth(maid, cursor);
      const closing = opening + salary - paid;
      if (cursor === ym) return closing;
      opening = closing;
      cursor = addMonths(cursor, 1);
      if (cursor > ym) return closing; // safety
      // stop runaway
      if (cursor > addMonths(ym, 0)) break;
    }
    return opening;
  }

  function openingBalance(maid, ym) {
    const prev = addMonths(ym, -1);
    // If nothing happened before this month, opening is 0
    const months = collectMonths(maid);
    if (!months.length || months[0] >= ym) return 0;
    return closingBalance(maid, prev);
  }

  function monthSummary(maid, ym) {
    const opening = openingBalance(maid, ym);
    const salary = salaryForMonth(maid, ym);
    const paid = paidInMonth(maid, ym);
    const closing = opening + salary - paid;
    return { opening, salary, paid, closing, owed: opening + salary };
  }

  function collectMonths(maid) {
    const set = new Set();
    for (const h of maid.salaryHistory || []) set.add(h.effectiveFrom);
    for (const p of maid.payments || []) set.add(monthKey(p.date));
    return [...set].sort();
  }

  function currentBalance(maid) {
    return monthSummary(maid, monthKey()).closing;
  }

  // ---------- routing ----------
  let route = { name: "home" }; // home | detail | setup
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
    toastTimer = setTimeout(() => el.remove(), 2200);
  }

  // ---------- UI helpers ----------
  function balClass(n) {
    if (n > 0) return "pos";
    if (n < 0) return "neg";
    return "zero";
  }

  function balChip(n) {
    if (n > 0) return `<span class="chip ok">You owe her</span>`;
    if (n < 0) return `<span class="chip warn">She owes household</span>`;
    return `<span class="chip">Settled</span>`;
  }

  // ---------- screens ----------
  function renderSetup() {
    const app = document.getElementById("app");
    app.innerHTML = `
      <div class="page">
        <div class="setup-hero">
          <div class="logo">₹</div>
          <h1>${APP_NAME}</h1>
          <p>Track two maids’ salaries, advances, and carry-forward balances — stored only on this phone.</p>
        </div>
        <form id="setup-form">
          ${[1, 2]
            .map(
              (i) => `
            <div class="maid-block">
              <h3><span class="maid-avatar" style="width:32px;height:32px;font-size:0.8rem;border-radius:10px">${i}</span> Maid ${i}</h3>
              <div class="field">
                <label>Name</label>
                <input name="name${i}" required maxlength="40" placeholder="e.g. Sunita" value="Maid ${i}" />
              </div>
              <div class="field">
                <label>Monthly salary (₹)</label>
                <input name="salary${i}" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="" />
              </div>
            </div>`
            )
            .join("")}
          <p class="hint">You can change names and salaries anytime. Past months keep the salary that was in effect then.</p>
          <button class="btn btn-primary btn-block" type="submit">Start tracking</button>
        </form>
      </div>`;

    document.getElementById("setup-form").onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const ym = monthKey();
      const maids = [1, 2].map((i) => {
        const name = String(fd.get(`name${i}`) || `Maid ${i}`).trim() || `Maid ${i}`;
        const amount = Math.max(0, Math.round(Number(fd.get(`salary${i}`)) || 0));
        return {
          id: uid(),
          name,
          salaryHistory: [{ id: uid(), amount, effectiveFrom: ym }],
          payments: [],
        };
      });
      state = { setupDone: true, maids };
      save(state);
      navigate({ name: "home" });
      toast("Ready — tap a maid to open her ledger");
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

    app.innerHTML = `
      <header class="topbar">
        <div style="flex:1">
          <h1>${APP_NAME}<span class="sub">Local only · ₹ INR</span></h1>
        </div>
      </header>
      <div class="page">
        <p class="hint">Tap a maid’s card to open <strong>her</strong> ledger. Positive balance = you still owe her; negative = advances exceeded salary (carries forward).</p>
        ${cards || `<div class="empty"><div class="emoji">👋</div><p>No maids yet.</p></div>`}
      </div>`;

    app.querySelectorAll("[data-open]").forEach((el) => {
      el.onclick = (ev) => {
        const quick = ev.target.closest("[data-quick-pay]");
        const id = el.getAttribute("data-open");
        if (quick) {
          navigate({ name: "detail", maidId: id, showPay: true });
        } else {
          navigate({ name: "detail", maidId: id });
        }
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
          <div class="label">Maid ledger</div>
          <div class="maid-name">${escapeHtml(maid.name)}</div>
          <div class="actions">
            <button class="ghost" id="rename-btn" type="button">Edit name</button>
            <button class="ghost" id="salary-btn" type="button">Change salary</button>
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
          </div>
        </div>

        <div class="section-title">
          <span>Payments · ${escapeHtml(maid.name)}</span>
          <button class="btn btn-primary" id="add-pay" type="button" style="flex:none;min-width:auto;padding:8px 14px;min-height:40px">＋ Add</button>
        </div>
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
    document.getElementById("add-pay").onclick = () => openPaymentSheet(maid, null, viewMonth);
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

  // ---------- sheets ----------
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

  function openNameSheet(maid) {
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Edit name</h2>
        <p class="sheet-sub">This name appears on the home card and throughout her ledger.</p>
        <form id="name-form">
          <div class="field">
            <label>Maid’s name</label>
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

  function openSalarySheet(maid, viewMonth) {
    const current = salaryForMonth(maid, viewMonth);
    const ov = openOverlay(`
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>Change salary</h2>
        <p class="sheet-sub">For <strong>${escapeHtml(maid.name)}</strong>. New amount applies from the month you choose; earlier months keep the old salary.</p>
        <form id="salary-form">
          <div class="field">
            <label>Monthly salary (₹)</label>
            <input name="amount" type="number" inputmode="numeric" min="0" step="1" required value="${current || ""}" />
          </div>
          <div class="field">
            <label>Effective from month</label>
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
      // Replace same-month entry or add
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
          // stay on month of deleted payment if possible
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

  // ---------- render root ----------
  function render() {
    if (!state.setupDone || !state.maids?.length) {
      renderSetup();
      return;
    }
    if (route.name === "detail") renderDetail();
    else renderHome();
  }

  // Boot
  if (!state.setupDone && (!state.maids || !state.maids.length)) {
    route = { name: "setup" };
  }
  render();
})();
