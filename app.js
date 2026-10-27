/* Todo List — tasks live in localStorage (S3.store). Natural-language due dates are parsed locally. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "todo.items";
  var items = [], view = S3.store("todo.view") || "all", listFilter = "";
  var tasksEl = $("#tasks"), addEl = $("#add");

  // ---------- dates ----------
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function isoDow(d) { return d.getDay() || 7; } // Mon=1 … Sun=7
  var DAYS = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7 };
  var MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); } // "constructor" is not a weekday
  var TODAY = ["today", "tod", "tonight", "اليوم"], TOMORROW = ["tomorrow", "tmr", "tmrw", "tom", "غدا", "غداً", "بكرا", "بكره", "بكرة"];
  function monthDay(m, d, base) {
    if (d < 1 || d > 31) return null;
    var x = new Date(base.getFullYear(), m, d);
    if (x.getMonth() !== m) return null;
    if (x < addDays(base, 0)) x = new Date(base.getFullYear() + 1, m, d);
    return x;
  }
  // Try to read a due date at tokens[i…]; returns {len, date} or null.
  function dueAt(t, i, base) {
    var a = t[i], b = t[i + 1], c = t[i + 2], m;
    if (a === "in" && b && /^\d{1,3}$/.test(b) && c && /^(day|days|d|week|weeks|w)$/.test(c)) return { len: 3, date: addDays(base, +b * (/^w/.test(c) ? 7 : 1)) };
    if (a === "next" && b === "week") return { len: 2, date: addDays(base, 8 - isoDow(base)) };
    if (a === "next" && own(DAYS, b)) return { len: 2, date: addDays(base, 8 - isoDow(base) + DAYS[b] - 1) };
    if (TODAY.indexOf(a) >= 0) return { len: 1, date: addDays(base, 0) };
    if (TOMORROW.indexOf(a) >= 0) return { len: 1, date: addDays(base, 1) };
    if (own(DAYS, a)) return { len: 1, date: addDays(base, (DAYS[a] - isoDow(base) + 7) % 7) };
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a))) { var x = new Date(+m[1], m[2] - 1, +m[3]); return x.getMonth() === m[2] - 1 ? { len: 1, date: x } : null; }
    if (/^\d{1,2}$/.test(a) && own(MONTHS, b)) { var d1 = monthDay(MONTHS[b], +a, base); return d1 ? { len: 2, date: d1 } : null; }
    if (own(MONTHS, a) && b && /^\d{1,2}(st|nd|rd|th)?$/.test(b)) { var d2 = monthDay(MONTHS[a], parseInt(b, 10), base); return d2 ? { len: 2, date: d2 } : null; }
    return null;
  }
  var PRI = { "!1": 1, "p1": 1, "!high": 1, "!!!": 1, "!2": 2, "p2": 2, "!med": 2, "!medium": 2, "!!": 2, "!3": 3, "p3": 3, "!low": 3 };
  // "Pay rent fri !1 #home" → {title:"Pay rent", due:"…", pri:1, list:"home"}
  function parse(text, base) {
    var raw = String(text || "").trim().split(/\s+/).filter(Boolean), low = raw.map(function (w) { return w.toLowerCase(); });
    var keep = raw.map(function () { return true; }), r = { title: "", due: "", pri: 0, list: "" };
    for (var i = 0; i < raw.length; i++) {
      if (!keep[i]) continue;
      var tag = /^#([\p{L}\p{N}_-]{1,30})$/u.exec(raw[i]);
      if (tag && !r.list) { r.list = tag[1].toLowerCase(); keep[i] = false; continue; }
      if (own(PRI, low[i]) && !r.pri) { r.pri = PRI[low[i]]; keep[i] = false; continue; }
      if (!r.due) {
        var hit = dueAt(low, i, base);
        if (hit) {
          r.due = iso(hit.date);
          for (var k = 0; k < hit.len; k++) keep[i + k] = false;
          if (i > 0 && keep[i - 1] && /^(on|by|due)$/.test(low[i - 1])) keep[i - 1] = false;
          i += hit.len - 1;
        }
      }
    }
    r.title = raw.filter(function (w, j) { return keep[j]; }).join(" ");
    return r;
  }
  // Put the visible items in their new order back into the full list, keeping hidden items where they were.
  function reorderSubset(all, newVisibleIds) {
    var set = {}; newVisibleIds.forEach(function (id) { set[id] = 1; });
    var slots = [], byId = {};
    all.forEach(function (it, i) { if (set[it.id]) { slots.push(i); byId[it.id] = it; } });
    var out = all.slice();
    newVisibleIds.forEach(function (id, j) { out[slots[j]] = byId[id]; });
    return out;
  }
  function dueLabel(due, today) {
    var d = Math.round((parseISO(due) - parseISO(today)) / 864e5), dt = parseISO(due);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d === -1) return "Yesterday";
    if (d > 1 && d < 7) return dt.toLocaleDateString("en-GB", { weekday: "short" });
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: dt.getFullYear() !== parseISO(today).getFullYear() ? "numeric" : undefined });
  }

  // ---------- untrusted data ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clean(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).slice(0, 10000).map(function (o) {
      o = o && typeof o === "object" ? o : {};
      var id = typeof o.id === "string" && /^[a-z0-9]{1,24}$/i.test(o.id) && !seen[o.id] ? o.id : uid(); seen[id] = 1;
      var t = function (v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : 0; };
      return {
        id: id, title: typeof o.title === "string" ? o.title.slice(0, 300) : "", done: o.done === true,
        due: typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : "",
        pri: [1, 2, 3].indexOf(o.pri) >= 0 ? o.pri : 0,
        list: typeof o.list === "string" && /^[\p{L}\p{N}_-]{1,30}$/u.test(o.list) ? o.list.toLowerCase() : "",
        created: t(o.created) || Date.now(), doneAt: t(o.doneAt)
      };
    }).filter(function (x) { return x.title.trim(); });
  }
  function persist() { if (S3.store(KEY, items) === undefined) S3.toast("Couldn't save — browser storage is blocked or full", "error"); }

  // ---------- view ----------
  function today() { return iso(new Date()); }
  function visible() {
    var t = today(), v = items.filter(function (it) {
      if (listFilter && it.list !== listFilter) return false;
      if (view === "done") return it.done;
      if (it.done && view !== "all") return false;
      if (view === "today") return it.due && it.due <= t;
      if (view === "upcoming") return it.due && it.due > t;
      return true;
    });
    if (view === "upcoming") v.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
    if (view === "done") v.sort(function (a, b) { return b.doneAt - a.doneAt; });
    return v;
  }
  var canDrag = function () { return view === "all" || view === "today"; };
  function drawPreview() {
    var p = parse(addEl.value, new Date()), box = $("#preview"), t = today();
    box.textContent = "";
    if (p.due) {
      var lbl = dueLabel(p.due, t), full = parseISO(p.due).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: p.due.slice(0, 4) !== t.slice(0, 4) ? "numeric" : undefined });
      box.appendChild(h("span", { "class": "chip accent", text: "📅 " + (/\d/.test(lbl) ? full : lbl + " · " + full) }));
    }
    if (p.pri) box.appendChild(h("span", { "class": "chip p" + p.pri, text: ["", "High", "Medium", "Low"][p.pri] + " priority" }));
    if (p.list) box.appendChild(h("span", { "class": "chip", text: "#" + p.list }));
  }
  function drawLists() {
    var counts = {};
    items.forEach(function (it) { if (it.list && !it.done) counts[it.list] = (counts[it.list] || 0) + 1; });
    var box = $("#lists"); box.textContent = "";
    Object.keys(counts).sort().forEach(function (l) {
      box.appendChild(h("button", { "class": "chip list-chip", "aria-pressed": String(listFilter === l), "data-list": l, text: "#" + l + " " + counts[l] }));
    });
    if (listFilter && !counts[listFilter] && !items.some(function (it) { return it.list === listFilter; })) listFilter = "";
  }
  function render() {
    var t = today(), v = visible();
    tasksEl.textContent = "";
    $$("#view button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === view)); });
    tasksEl.classList.toggle("no-drag", !canDrag());
    if (!v.length) {
      var msg = { all: ["Nothing to do", "Add your first task above."], today: ["All clear for today", "Nothing due today or overdue."], upcoming: ["Nothing upcoming", "Tasks with a future due date show here."], done: ["Nothing done yet", "Tick a task to see it here."] }[view];
      tasksEl.appendChild(h("li", { "class": "empty" }, [h("b", { text: msg[0] }), msg[1]]));
    }
    v.forEach(function (it) {
      var over = it.due && !it.done && it.due < t;
      tasksEl.appendChild(h("li", { "class": "task" + (it.done ? " done" : "") + (it.pri ? " p" + it.pri : ""), "data-id": it.id, tabindex: "-1" }, [
        h("span", { "class": "grip", "aria-hidden": "true", title: "Drag to reorder", text: "⠿" }),
        h("input", { type: "checkbox", "class": "tick", checked: it.done, "aria-label": "Done: " + it.title }),
        h("span", { "class": "t-body" }, [
          h("span", { "class": "t-title", dir: "auto", text: it.title }),
          h("span", { "class": "t-meta" }, [
            it.due ? h("span", { "class": "chip t-due" + (over ? " bad" : it.due === t ? " warn" : ""), text: (over ? "Overdue · " : "") + dueLabel(it.due, t) }) : null,
            it.list ? h("span", { "class": "chip", text: "#" + it.list }) : null
          ])
        ]),
        h("button", { "class": "btn ghost icon small t-edit", "aria-label": "Edit task", title: "Edit", text: "✎" }),
        h("button", { "class": "btn ghost icon small t-del", "aria-label": "Delete task", title: "Delete", html: S3.icon("trash") })
      ]));
    });
    var left = items.filter(function (it) { return !it.done; }).length, done = items.length - left;
    $("#left").textContent = left + (left === 1 ? " task" : " tasks") + " left" + (done ? " · " + done + " done" : "");
    $("#clearDone").disabled = !done;
    drawLists();
  }
  function setView(v) { view = v; S3.store("todo.view", v); render(); }

  // ---------- actions ----------
  function add() {
    var p = parse(addEl.value, new Date());
    if (!p.title) { if (addEl.value.trim()) S3.toast("Add a few words for the task itself", "error"); return; }
    if (!p.list && listFilter) p.list = listFilter;
    items.unshift({ id: uid(), title: p.title, done: false, due: p.due, pri: p.pri, list: p.list, created: Date.now(), doneAt: 0 });
    addEl.value = ""; drawPreview(); persist();
    if (view === "done" || (view === "today" && !(p.due && p.due <= today())) || (view === "upcoming" && !(p.due > today()))) view = "all";
    setView(view);
  }
  addEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { addEl.value = ""; drawPreview(); } });
  addEl.addEventListener("input", drawPreview);
  $("#addBtn").addEventListener("click", function () { add(); addEl.focus(); });
  $$("#view button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.v); }); });
  $("#lists").addEventListener("click", function (e) {
    var b = e.target.closest("[data-list]"); if (!b) return;
    listFilter = listFilter === b.dataset.list ? "" : b.dataset.list; render();
  });
  function byId(id) { return items.filter(function (x) { return x.id === id; })[0]; }
  function remove(it) {
    var at = items.indexOf(it); items.splice(at, 1); persist(); render();
    var t = S3.toast("Deleted “" + it.title.slice(0, 40) + "” ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { items.splice(Math.min(at, items.length), 0, it); persist(); render(); t.remove(); } }));
  }
  function edit(li) {
    var it = byId(li.dataset.id), span = $(".t-title", li);
    var inp = h("input", { "class": "input t-input", dir: "auto", maxlength: "300", value: it.title, "aria-label": "Edit task" });
    span.replaceWith(inp); inp.focus(); inp.select();
    var finished = false;
    function finish(save) {
      if (finished) return; finished = true;
      if (save) {
        var p = parse(inp.value, new Date());
        if (p.title) { it.title = p.title; if (p.due) it.due = p.due; if (p.pri) it.pri = p.pri; if (p.list) it.list = p.list; persist(); }
      }
      render();
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); });
    inp.addEventListener("blur", function () { finish(true); });
  }
  tasksEl.addEventListener("change", function (e) {
    if (!e.target.classList.contains("tick")) return;
    var it = byId(e.target.closest(".task").dataset.id);
    it.done = e.target.checked; it.doneAt = it.done ? Date.now() : 0; persist();
    if (it.done) S3.done();
    setTimeout(render, it.done && view !== "all" && view !== "done" ? 350 : 0);
  });
  tasksEl.addEventListener("click", function (e) {
    var li = e.target.closest(".task"); if (!li) return;
    if (e.target.closest(".t-del")) remove(byId(li.dataset.id));
    else if (e.target.closest(".t-edit")) edit(li);
  });
  tasksEl.addEventListener("dblclick", function (e) { var li = e.target.closest(".task"); if (li && e.target.closest(".t-title")) edit(li); });
  tasksEl.addEventListener("keydown", function (e) {
    var li = e.target.closest(".task"); if (!li || e.target.tagName === "INPUT" && e.target.type !== "checkbox") return;
    if (e.key === "Delete") remove(byId(li.dataset.id));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var sib = e.key === "ArrowDown" ? li.nextElementSibling : li.previousElementSibling;
      if (sib && sib.classList.contains("task")) $(".tick", sib).focus();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); addEl.focus(); }
  });
  $("#clearDone").addEventListener("click", function () {
    var before = items.slice(), n = items.filter(function (it) { return it.done; }).length;
    items = items.filter(function (it) { return !it.done; }); persist(); render();
    var t = S3.toast("Cleared " + n + " completed ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { items = before; persist(); render(); t.remove(); } }));
  });
  $("#expJson").addEventListener("click", function () {
    S3.download(JSON.stringify({ app: "s3-todo-list", version: 1, items: items }, null, 2), "todo-backup.json", "application/json"); S3.done();
  });
  $("#expMd").addEventListener("click", function () {
    var md = "# To-do\n\n" + items.map(function (it) {
      return "- [" + (it.done ? "x" : " ") + "] " + it.title.replace(/\r?\n/g, " ") + (it.due ? " (due " + it.due + ")" : "") + (it.pri ? " !" + it.pri : "") + (it.list ? " #" + it.list : "");
    }).join("\n") + "\n";
    S3.download(md, "todo.md", "text/markdown;charset=utf-8"); S3.done();
  });
  $("#imp input").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { S3.toast("That file is too large", "error"); return; }
    S3.readFile(f, "text").then(function (t) {
      var d; try { d = JSON.parse(t); } catch (err) { S3.toast("Not valid JSON", "error"); return; }
      var raw = Array.isArray(d) ? d : d && Array.isArray(d.items) ? d.items : null;
      if (!raw) { S3.toast("That doesn't look like a to-do backup", "error"); return; }
      var merged = clean(items.concat(raw)), added = merged.length - items.length;
      items = merged; persist(); render(); S3.toast("Imported " + added + " task" + (added === 1 ? "" : "s")); S3.done();
    });
  });

  // ---------- drag to reorder (pointer events on the ⠿ handle: mouse, pen, touch) ----------
  var drag = null;
  tasksEl.addEventListener("pointerdown", function (e) {
    var g = e.target.closest(".grip"); if (!g || !canDrag()) return;
    e.preventDefault();
    var li = g.closest(".task"), r = li.getBoundingClientRect();
    drag = { li: li, dy: e.clientY - r.top, ph: h("li", { "class": "placeholder" }) };
    drag.ph.style.height = r.height + "px";
    li.classList.add("lifted"); li.style.width = r.width + "px"; li.style.top = r.top + "px"; li.style.left = r.left + "px";
    li.parentNode.insertBefore(drag.ph, li);
    document.body.classList.add("is-dragging");
    g.setPointerCapture(e.pointerId);
  });
  tasksEl.addEventListener("pointermove", function (e) {
    if (!drag) return;
    drag.li.style.top = (e.clientY - drag.dy) + "px";
    var before = null;
    $$(".task", tasksEl).some(function (x) {
      if (x === drag.li) return false;
      var r = x.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { before = x; return true; }
      return false;
    });
    if (before) tasksEl.insertBefore(drag.ph, before); else tasksEl.appendChild(drag.ph);
    if (e.clientY > innerHeight - 30) window.scrollBy(0, 10); else if (e.clientY < 30) window.scrollBy(0, -10);
  });
  function drop(commit) {
    if (!drag) return;
    tasksEl.insertBefore(drag.li, drag.ph); drag.ph.remove();
    drag.li.classList.remove("lifted"); drag.li.style.cssText = "";
    document.body.classList.remove("is-dragging");
    if (commit) { items = reorderSubset(items, $$(".task", tasksEl).map(function (x) { return x.dataset.id; })); persist(); }
    drag = null; render();
  }
  tasksEl.addEventListener("pointerup", function () { drop(true); });
  tasksEl.addEventListener("pointercancel", function () { drop(false); });

  // ---------- boot ----------
  items = clean(S3.store(KEY));
  if (["all", "today", "upcoming", "done"].indexOf(view) < 0) view = "all";
  render(); drawPreview();

  window.S3_DEMO = function () {
    var b = new Date();
    items = clean([
      { title: "Send invoice to Blue Fern Café", due: iso(b), pri: 1, list: "work" },
      { title: "Book dentist appointment", due: iso(addDays(b, 1)), list: "home" },
      { title: "Draft Q4 roadmap", due: iso(addDays(b, 3)), pri: 2, list: "work" },
      { title: "Renew car insurance", due: iso(addDays(b, -1)), pri: 1, list: "home" },
      { title: "Read two chapters of “Deep Work”", list: "personal", pri: 3 },
      { title: "Water the plants", done: true, doneAt: Date.now(), list: "home" }
    ]);
    persist(); setView("all");
    addEl.value = "Call grandma next sun !2 #family"; drawPreview();
  };

  window.S3_SELFTEST = function () {
    var base = new Date(2026, 9, 28); // Wednesday 28 Oct 2026
    function eq(text, title, due, pri, list) { var p = parse(text, base); return p.title === title && p.due === due && p.pri === (pri || 0) && p.list === (list || ""); }
    var okP = eq("Pay rent fri !2 #home", "Pay rent", "2026-10-30", 2, "home") &&
      eq("Call mom tomorrow", "Call mom", "2026-10-29") &&
      eq("Standup wed", "Standup", "2026-10-28") &&
      eq("Dentist next mon !1", "Dentist", "2026-11-02", 1) &&
      eq("Plan trip next week", "Plan trip", "2026-11-02") &&
      eq("Taxes in 3 days", "Taxes", "2026-10-31") &&
      eq("Review in 2 weeks p3", "Review", "2026-11-11", 3) &&
      eq("Report due 5 nov", "Report", "2026-11-05") &&
      eq("Party on jan 3rd #fun", "Party", "2027-01-03", 0, "fun") &&
      eq("Ship 2026-12-01 !!!", "Ship", "2026-12-01", 1) &&
      eq("بكرا اشتري خبز #بيت", "اشتري خبز", "2026-10-29", 0, "بيت") &&
      eq("Read today's paper", "Read today's paper", "") &&
      eq("Fix bug 31 feb", "Fix bug 31 feb", "") &&
      eq("Meet at 10 #a #b", "Meet at 10 #b", "", 0, "a") &&
      eq("Fix constructor toString 5 constructor", "Fix constructor toString 5 constructor", "");
    var all = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    var okR = reorderSubset(all, ["d", "b"]).map(function (x) { return x.id; }).join("") === "adcbe" &&
      reorderSubset(all, ["e", "a", "c"]).map(function (x) { return x.id; }).join("") === "ebadc";
    var okL = dueLabel("2026-10-29", "2026-10-28") === "Tomorrow" && dueLabel("2026-10-28", "2026-10-28") === "Today" && dueLabel("2026-10-30", "2026-10-28") === "Fri";
    var src = clean([{ title: "x ✓", due: "2026-01-01", pri: 2, list: "work", done: true, doneAt: 5, created: 3 }]);
    var okJ = JSON.stringify(clean(JSON.parse(JSON.stringify(src)))) === JSON.stringify(src);
    var bad = clean([{ title: "<b>x</b>", pri: 9, list: "a b<", due: "tmrw", id: "x" }, { title: "y", id: "x" }, { title: "" }, null, 4]);
    var okB = bad.length === 2 && bad[0].pri === 0 && bad[0].list === "" && bad[0].due === "" && bad[0].id !== bad[1].id && bad[0].title === "<b>x</b>";
    return okP && okR && okL && okJ && okB;
  };
})();
