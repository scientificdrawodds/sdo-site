// The Alaska 2027 table: reads data/alaska_2027.csv in the browser and builds a plain HTML table. Clicking a
// column name opens a menu to sort and filter that column, as in a spreadsheet; the hunt number opens the hunt's
// details; Residency and Guide status filter by who can apply.
(function () {
  "use strict";

  var CSV_URL = "data/alaska_2027.csv";
  var DASH = "\u2013";
  var DB200 = "Residents, and nonresidents hunting with a relative within second-degree of kindred";
  // Nonresidents must hunt these species with a licensed guide or a resident relative
  var GUIDE_SPECIES = ["Brown/grizzly bear", "Sheep", "Goat"];
  var DETAILS = ["Area", "Legal animal", "Who can apply", "Restrictions"];
  // Season dates written without a year fall in the 2027-2028 hunting year, July 1, 2027, to June 30, 2028
  var HUNT_YEAR = 2027;
  var MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
  var SORTS = {
    text: ["Sort A to Z", "Sort Z to A"],
    number: ["Sort smallest to largest", "Sort largest to smallest"],
    date: ["Sort earliest to latest", "Sort latest to earliest"]
  };

  // The visible columns. sort: how the column sorts. filter: "list" for a checkbox list of the column's values,
  // "range" for a minimum and a maximum
  var COLUMNS = [
    {key: "Hunt", label: "Hunt", sort: "text", filter: "list", css: "col-hunt"},
    {key: "Species", label: "Species", sort: "text", filter: "list", css: "col-species"},
    {key: "Unit", label: "Unit", sort: "text", filter: "list", css: "col-unit"},
    {key: "Draw Probability (1 entry)", label: "1 entry", group: "Draw Probability", sort: "number", filter: "range",
     pct: true, css: "col-prob num"},
    {key: "Draw Probability (6 entries)", label: "6 entries", group: "Draw Probability", sort: "number", filter: "range",
     pct: true, css: "col-prob num"},
    {key: "Permits", label: "Permits", sort: "number", filter: "range", css: "col-permits num"},
    {key: "Season", label: "Season", sort: "date", filter: "list", css: "col-season"},
    {key: "Forecast Notes", label: "Forecast Notes", sort: "text", filter: "list", blank: "No note", css: "col-notes"}
  ];

  var wrap = document.getElementById("sdo-table");
  var countEl = document.getElementById("sdo-count");
  var residencyEl = document.getElementById("sdo-residency");
  var guideEl = document.getElementById("sdo-guide");
  var clearEl = document.getElementById("sdo-clear");
  if (!wrap) return;

  var collator = new Intl.Collator("en", {numeric: true, sensitivity: "base"});
  var rows = [];
  var tbody = null;
  var heads = [];        // the header button of each column
  var menu = null;       // the open menu: {el, col, button}
  // off: the values each list filter hides; min and max: each range filter
  var state = {residency: "all", guide: "any", off: {}, min: {}, max: {}, sortKey: null, sortDir: 1, open: {}};

  // ---------------------------------------------------------------------------------------- reading the file
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    var out = [], row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
        } else { field += c; }
      } else if (c === '"') { quoted = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); out.push(row); row = []; field = "";
      } else { field += c; }
    }
    if (field !== "" || row.length) { row.push(field); out.push(row); }
    var head = out.shift();
    return out.filter(function (r) { return r.length > 1 || r[0] !== ""; }).map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] === undefined ? "" : r[j]; });
      return o;
    });
  }

  // A printed value as a number to sort by and a range to filter on; null for a dash.
  // "up to 25" is 25; "under 0.1%" is below 0.1; "over 99%" is above 99.
  function numeric(s) {
    s = (s || "").trim();
    if (s === "" || s === DASH) return null;
    var n = parseFloat(s.replace(/[^0-9.]/g, ""));
    if (isNaN(n)) return null;
    if (/^under/i.test(s)) return {sort: n / 2, lo: 0, hi: n, openHi: true};
    if (/^over/i.test(s)) return {sort: (n + 100) / 2, lo: n, hi: 100, openLo: true};
    return {sort: n, lo: n, hi: n};
  }

  // A season's opening date as a number to sort by (20270810 for Aug. 10, 2027), or null if it can't be read.
  // The year is the one written with the date or before it ("Spring 2028: Apr. 1-May 15"); without one, July to
  // December are in 2027 and January to June in 2028.
  function seasonStart(s) {
    var m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b(?:,\s*(\d{4}))?/.exec(s || "");
    if (!m) return null;
    var month = MONTHS[m[1].toLowerCase()], day = +m[2];
    var before = (s.slice(0, m.index).match(/\b\d{4}\b/g) || []).pop();
    var year = m[3] ? +m[3] : before ? +before : month >= 7 ? HUNT_YEAR : HUNT_YEAR + 1;
    return year * 10000 + month * 100 + day;
  }

  function inRange(v, min, max) {
    if (min === null && max === null) return true;
    if (v === null) return false;                       // a dash has no value to compare
    if (min !== null && (v.openHi ? v.hi <= min : v.hi < min)) return false;
    if (max !== null && (v.openLo ? v.lo >= max : v.lo > max)) return false;
    return true;
  }

  function valueOf(x) {
    return x === undefined || x === null || isNaN(x) ? null : x;
  }

  // ---------------------------------------------------------------------------------------- residency and guide
  // Which hunts each setting shows. "Nonresidents without a guide" follows the supplement: the black bear hunts
  // (DL018, DL027-DL030) are for nonresidents with neither a licensed guide nor a resident relative; the moose and
  // caribou ones bar only a licensed guide, so a nonresident hunting with a resident relative may apply.
  function eligible(r) {
    if (state.residency === "all") return true;
    var who = r["Who can apply"];
    if (state.residency === "resident") {
      return who === "Residents and nonresidents" || who === "Residents only" || who === DB200;
    }
    var g = state.guide;
    var needsGuide = GUIDE_SPECIES.indexOf(r.Species) >= 0;
    switch (who) {
      case "Residents only":
        return false;
      case "Residents and nonresidents":
      case "Nonresidents only":
        return g !== "neither" || !needsGuide;
      case DB200:
      case "Nonresidents guided by a resident relative":
        return g === "any" || g === "relative";
      case "Nonresidents with a licensed guide":
        return g === "any" || g === "guide";
      case "Nonresidents without a guide":
        return g === "any" || g === "neither" || (g === "relative" && r.Species !== "Black bear");
      default:
        return g === "any";
    }
  }

  // ---------------------------------------------------------------------------------------- filtering and sorting
  function passes(r) {
    if (!eligible(r)) return false;
    for (var i = 0; i < COLUMNS.length; i++) {
      var c = COLUMNS[i], k = c.key;
      if (c.filter === "list" && state.off[k] && state.off[k][r[k]]) return false;
      if (c.filter === "range" && !inRange(r._num[k], valueOf(state.min[k]), valueOf(state.max[k]))) return false;
    }
    return true;
  }

  function isFiltered(c) {
    if (c.filter === "list") return !!state.off[c.key] && Object.keys(state.off[c.key]).length > 0;
    return valueOf(state.min[c.key]) !== null || valueOf(state.max[c.key]) !== null;
  }

  function sortValue(c, r) {
    if (c.sort === "number") return r._num[c.key] ? r._num[c.key].sort : null;
    if (c.sort === "date") return r._start;
    return r[c.key] === "" ? null : r[c.key];
  }

  function sorted(list) {
    var c = COLUMNS.filter(function (x) { return x.key === state.sortKey; })[0];
    if (!c) return list;                                 // the file's order: species, then hunt number
    var dir = state.sortDir;
    return list.slice().sort(function (a, b) {
      var x = sortValue(c, a), y = sortValue(c, b);
      if (x === null || y === null) {                    // dashes, blanks and unreadable dates last, either way
        return x === y ? a._i - b._i : x === null ? 1 : -1;
      }
      return dir * (c.sort === "text" ? collator.compare(x, y) : x - y) || a._i - b._i;
    });
  }

  // The values a list filter offers: "No note" first, seasons by opening date, the rest A to Z
  function values(c) {
    var seen = Object.create(null), out = [];
    rows.forEach(function (r) { if (!(r[c.key] in seen)) { seen[r[c.key]] = true; out.push(r[c.key]); } });
    return out.sort(function (a, b) {
      if (a === "" || b === "") return a === "" ? -1 : 1;
      if (c.sort === "date") {
        var x = seasonStart(a), y = seasonStart(b);
        if (x !== y) return x === null ? 1 : y === null ? -1 : x - y;
      }
      return collator.compare(a, b);
    });
  }

  // ---------------------------------------------------------------------------------------- the table
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // The mark on a filtered column's header
  function funnel() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    var path = document.createElementNS(ns, "path");
    svg.setAttribute("class", "sdo-mark");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    path.setAttribute("d", "M1.5 2h13L9.5 8.2V14l-3-1.6V8.2z");
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }

  function headButton(c) {
    var b = el("button", {type: "button", class: "sdo-head", "aria-haspopup": "dialog", "aria-expanded": "false"});
    if (c.group) b.append(el("span", {class: "visually-hidden"}, c.group + ", "));
    b.append(el("span", {class: "sdo-head-label"}, c.label));
    var icons = el("span", {class: "sdo-head-icons"});
    icons.append(el("span", {class: "sdo-arrow", "aria-hidden": "true"}), funnel(),
                 el("span", {class: "sdo-caret", "aria-hidden": "true"}, "\u25BE"));
    b.append(icons, el("span", {class: "visually-hidden sdo-filtered-note"}));
    b.addEventListener("click", function (e) { toggleMenu(c, b, e.detail === 0); });
    return b;
  }

  function toggleMenu(c, b, byKeyboard) {
    if (menu && menu.col === c) closeMenu(false);
    else openMenu(c, b, byKeyboard);
  }

  function build() {
    var table = el("table", {class: "sdo-table"});
    var thead = table.createTHead();
    var r1 = thead.insertRow(), r2 = thead.insertRow();
    var groupDone = false;
    COLUMNS.forEach(function (c) {
      var th = el("th", {scope: "col", class: c.css + " sdo-has-menu"});
      var b = headButton(c);
      th.append(b);
      // the whole header cell opens the menu, not only its text
      th.addEventListener("click", function (e) { if (!b.contains(e.target)) toggleMenu(c, b, false); });
      heads.push(b);
      if (c.group) {
        if (!groupDone) {
          r1.append(el("th", {scope: "colgroup", colspan: "2", class: "sdo-group"}, c.group));
          groupDone = true;
        }
        r2.append(th);
      } else {
        th.rowSpan = 2;
        r1.append(th);
      }
    });
    tbody = table.createTBody();
    wrap.replaceChildren(table);
  }

  function detailsRow(r) {
    var tr = el("tr", {class: "sdo-details", id: "sdo-details-" + r.Hunt});
    var td = el("td", {colspan: String(COLUMNS.length)});
    var body = el("div", {class: "sdo-details-body"});
    var dl = el("dl");
    DETAILS.forEach(function (k) {
      if (!r[k]) return;
      dl.append(el("dt", null, k), el("dd", null, r[k]));
    });
    body.append(dl);
    td.append(body);
    tr.append(td);
    return tr;
  }

  function toggle(r, button, tr) {
    var open = !state.open[r.Hunt];
    state.open[r.Hunt] = open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      tr.after(detailsRow(r));
    } else {
      var d = document.getElementById("sdo-details-" + r.Hunt);
      if (d) d.remove();
    }
  }

  function bodyRow(r) {
    var tr = el("tr");
    COLUMNS.forEach(function (c) {
      if (c.key === "Hunt") {
        var th = el("th", {scope: "row", class: c.css});
        var b = el("button", {type: "button", class: "sdo-hunt", "aria-expanded": String(!!state.open[r.Hunt]),
                              "aria-controls": "sdo-details-" + r.Hunt}, r.Hunt);
        b.addEventListener("click", function () { toggle(r, b, tr); });
        th.append(b);
        tr.append(th);
      } else {
        tr.append(el("td", {class: c.css}, r[c.key]));
      }
    });
    return tr;
  }

  function render() {
    var shown = sorted(rows.filter(passes));
    var frag = document.createDocumentFragment();
    shown.forEach(function (r) {
      frag.append(bodyRow(r));
      if (state.open[r.Hunt]) frag.append(detailsRow(r));
    });
    tbody.replaceChildren(frag);
    heads.forEach(function (b, i) {
      var c = COLUMNS[i], th = b.parentNode, on = isFiltered(c), sortedHere = c.key === state.sortKey;
      if (sortedHere) th.setAttribute("aria-sort", state.sortDir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
      b.querySelector(".sdo-arrow").textContent = sortedHere ? (state.sortDir > 0 ? "\u25B2" : "\u25BC") : "";
      b.classList.toggle("is-filtered", on);
      b.querySelector(".sdo-filtered-note").textContent = on ? ", filtered" : "";
    });
    countEl.textContent = shown.length
      ? "Showing " + shown.length + " of " + rows.length + " hunts."
      : "No hunts match. Loosen a filter or click Clear filters.";
    fitDetails();
  }

  // The details text wraps to the visible width of the table box, however far it is scrolled
  function fitDetails() {
    wrap.style.setProperty("--sdo-wrap-w", wrap.clientWidth + "px");
  }

  // ---------------------------------------------------------------------------------------- the header menus
  // A menu has the column's sorts, then its filter. Every change applies at once and the menu stays open.
  function openMenu(c, button, byKeyboard) {
    closeMenu(false);
    var name = c.group ? c.group + ", " + c.label : c.label;
    var box = el("div", {class: "sdo-menu", id: "sdo-menu", role: "dialog", tabindex: "-1",
                         "aria-label": name + ": sort and filter"});
    var sorts = el("div", {class: "sdo-menu-sort"});
    SORTS[c.sort].forEach(function (text, j) {
      var dir = j === 0 ? 1 : -1;
      var s = el("button", {type: "button", class: "sdo-menu-item",
                            "aria-pressed": String(state.sortKey === c.key && state.sortDir === dir)}, text);
      s.addEventListener("click", function () {
        state.sortKey = c.key;
        state.sortDir = dir;
        sorts.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === s)); });
        render();
      });
      sorts.append(s);
    });
    box.append(sorts, el("div", {class: "sdo-menu-heading"}, "Filter"),
               c.filter === "list" ? listFilter(c, name) : rangeFilter(c, name));
    box.addEventListener("keydown", trapTab);
    document.body.append(box);
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", "sdo-menu");
    menu = {el: box, col: c, button: button, th: button.closest("th")};
    place();
    (byKeyboard ? sorts.querySelector("button") : box).focus({preventScroll: true});
  }

  function listFilter(c, name) {
    var off = state.off[c.key] || (state.off[c.key] = Object.create(null));
    var part = el("div", {class: "sdo-menu-filter"});
    var find = el("input", {type: "text", class: "sdo-menu-find", placeholder: "Search", autocomplete: "off",
                            "aria-label": "Search " + name + " values"});
    var links = el("div", {class: "sdo-menu-links"});
    var all = el("button", {type: "button", class: "sdo-link"}, "Select all");
    var none = el("button", {type: "button", class: "sdo-link"}, "Clear");
    var list = el("div", {class: "sdo-menu-list", role: "group", "aria-label": name + " values"});
    var empty = el("p", {class: "sdo-menu-empty", hidden: ""}, "No values match.");
    var items = values(c).map(function (v) {
      var text = v === "" ? c.blank : v;
      var check = el("input", {type: "checkbox"});
      var label = el("label", {class: "sdo-menu-check"});
      check.checked = !off[v];
      check.addEventListener("change", function () {
        if (check.checked) delete off[v]; else off[v] = true;
        render();
      });
      label.append(check, el("span", null, text));
      list.append(label);
      return {value: v, text: text.toLowerCase(), label: label, check: check};
    });
    function shown() { return items.filter(function (it) { return !it.label.hidden; }); }
    // Select all and Clear act on the values the box has narrowed the list to
    function setShown(on) {
      shown().forEach(function (it) {
        it.check.checked = on;
        if (on) delete off[it.value]; else off[it.value] = true;
      });
      render();
    }
    find.addEventListener("input", function () {
      var q = find.value.trim().toLowerCase();
      items.forEach(function (it) { it.label.hidden = q !== "" && it.text.indexOf(q) < 0; });
      empty.hidden = shown().length > 0;
    });
    all.addEventListener("click", function () { setShown(true); });
    none.addEventListener("click", function () { setShown(false); });
    // the arrow keys move between the box and the values
    part.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var stops = [find].concat(shown().map(function (it) { return it.check; }));
      var i = stops.indexOf(document.activeElement);
      if (i < 0) return;
      var next = stops[e.key === "ArrowDown" ? Math.min(i + 1, stops.length - 1) : Math.max(i - 1, 0)];
      e.preventDefault();
      next.focus();
      if (next !== find) next.scrollIntoView({block: "nearest"});
    });
    links.append(all, none);
    part.append(find, links, list, empty);
    return part;
  }

  function rangeFilter(c, name) {
    var part = el("div", {class: "sdo-menu-filter"});
    ["min", "max"].forEach(function (end) {
      var word = end === "min" ? "Minimum" : "Maximum";
      var label = el("label", {class: "sdo-menu-bound"});
      var input = el("input", {type: "number", inputmode: "decimal", step: "any", min: "0",
                               "aria-label": name + ", " + word.toLowerCase() + (c.pct ? ", percent" : "")});
      if (valueOf(state[end][c.key]) !== null) input.value = String(state[end][c.key]);
      input.addEventListener("input", function () {
        state[end][c.key] = input.value === "" ? null : parseFloat(input.value);
        render();
      });
      label.append(el("span", null, word), input, el("span", {class: "sdo-unit"}, c.pct ? "%" : ""));
      part.append(label);
    });
    return part;
  }

  function closeMenu(refocus) {
    if (!menu) return;
    var m = menu;
    menu = null;
    m.el.remove();
    m.button.setAttribute("aria-expanded", "false");
    m.button.removeAttribute("aria-controls");
    if (refocus) m.button.focus();
  }

  // Under the column name, kept on the screen; above it if there is no room below
  function place() {
    if (!menu) return;
    var r = menu.th.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, m = menu.el;
    m.style.maxHeight = (vh - 16) + "px";
    var w = m.offsetWidth, h = m.offsetHeight;
    var top = r.bottom + 2;
    if (top + h > vh - 8) top = r.top - h - 2 >= 8 ? r.top - h - 2 : Math.max(8, vh - h - 8);
    m.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    m.style.top = top + "px";
  }

  // Tab and Shift+Tab stay inside the open menu
  function trapTab(e) {
    if (e.key !== "Tab") return;
    var stops = Array.prototype.filter.call(menu.el.querySelectorAll("button, input"), function (x) {
      return x.getClientRects().length > 0;
    });
    var first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === menu.el)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function outside(target) {
    return !menu.el.contains(target) && !menu.th.contains(target);
  }

  document.addEventListener("pointerdown", function (e) { if (menu && outside(e.target)) closeMenu(false); }, true);
  // focus moving elsewhere closes the menu; a click on the column name only moves it to the table box around it
  document.addEventListener("focusin", function (e) {
    if (menu && outside(e.target) && !e.target.contains(menu.th)) closeMenu(false);
  });
  document.addEventListener("keydown", function (e) {
    if (menu && e.key === "Escape") { e.preventDefault(); closeMenu(true); }
  });
  window.addEventListener("scroll", place, true);      // the page or the table box
  window.addEventListener("resize", function () { fitDetails(); place(); });

  // ---------------------------------------------------------------------------------------- the controls
  function setGuideEnabled() {
    var on = state.residency === "nonresident";
    guideEl.disabled = !on;
    if (!on) { guideEl.value = "any"; state.guide = "any"; }
  }

  residencyEl.addEventListener("change", function () {
    state.residency = residencyEl.value;
    setGuideEnabled();
    render();
  });
  guideEl.addEventListener("change", function () { state.guide = guideEl.value; render(); });
  clearEl.addEventListener("click", function () {
    closeMenu(false);
    residencyEl.value = "all";
    state.residency = "all";
    state.off = {}; state.min = {}; state.max = {};
    setGuideEnabled();
    render();
  });

  fetch(CSV_URL)
    .then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return res.text();
    })
    .then(function (text) {
      rows = parseCSV(text);
      rows.forEach(function (r, i) {
        r._i = i;
        r._start = seasonStart(r.Season);
        r._num = {};
        COLUMNS.forEach(function (c) { if (c.filter === "range") r._num[c.key] = numeric(r[c.key]); });
      });
      // the controls may hold values the browser restored on reload
      state.residency = residencyEl.value;
      setGuideEnabled();
      state.guide = guideEl.value;
      build();
      render();
    })
    .catch(function () {
      countEl.textContent = "The table could not be loaded. Use Download CSV for the full table.";
    });
})();
