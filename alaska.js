// The Alaska 2027 table: reads data/alaska_2027.csv in the browser and builds a plain HTML table with
// a filter in every column header, sorting, hunt details, and residency and guide-status filters.
(function () {
  "use strict";

  var CSV_URL = "data/alaska_2027.csv";
  var DASH = "–";
  var DB200 = "Residents, and nonresidents hunting with a relative within second-degree of kindred";
  // Nonresidents must hunt these species with a licensed guide or a resident relative
  var GUIDE_SPECIES = ["Brown/grizzly bear", "Sheep", "Goat"];
  var DETAILS = ["Area", "Legal animal", "Who can apply", "Restrictions"];
  var ALL = "\u0000all";

  // The visible columns. text: type to filter; pick: a pick-list; range: a minimum and a maximum
  var COLUMNS = [
    {key: "Hunt", label: "Hunt", kind: "text", css: "col-hunt"},
    {key: "Species", label: "Species", kind: "pick", css: "col-species"},
    {key: "Unit", label: "Unit", kind: "text", css: "col-unit"},
    {key: "Draw Probability (1 entry)", label: "1 entry", group: "Draw Probability", kind: "range", pct: true,
     css: "col-prob num"},
    {key: "Draw Probability (6 entries)", label: "6 entries", group: "Draw Probability", kind: "range", pct: true,
     css: "col-prob num"},
    {key: "Permits", label: "Permits", kind: "range", css: "col-permits num"},
    {key: "Season", label: "Season", kind: "text", css: "col-season"},
    {key: "Forecast Notes", label: "Forecast Notes", kind: "pick", blank: "No note", css: "col-notes"}
  ];

  var wrap = document.getElementById("sdo-table");
  var countEl = document.getElementById("sdo-count");
  var residencyEl = document.getElementById("sdo-residency");
  var guideEl = document.getElementById("sdo-guide");
  var searchEl = document.getElementById("sdo-search");
  var clearEl = document.getElementById("sdo-clear");
  if (!wrap) return;

  var rows = [];
  var tbody = null;
  var heads = [];
  var filterInputs = [];
  var state = {residency: "all", guide: "any", words: [], text: {}, pick: {}, min: {}, max: {},
               sortKey: null, sortDir: 1, open: {}};

  // ---------------------------------------------------------------------------------------- reading the file
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
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

  function inRange(v, min, max) {
    if (min === null && max === null) return true;
    if (v === null) return false;                       // a dash has no value to compare
    if (min !== null && (v.openHi ? v.hi <= min : v.hi < min)) return false;
    if (max !== null && (v.openLo ? v.lo >= max : v.lo > max)) return false;
    return true;
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
    for (var w = 0; w < state.words.length; w++) {
      if (r._all.indexOf(state.words[w]) < 0) return false;
    }
    for (var i = 0; i < COLUMNS.length; i++) {
      var c = COLUMNS[i], k = c.key;
      if (c.kind === "text" && state.text[k] && r[k].toLowerCase().indexOf(state.text[k]) < 0) return false;
      if (c.kind === "pick" && state.pick[k] !== undefined && state.pick[k] !== ALL && r[k] !== state.pick[k]) return false;
      if (c.kind === "range" && !inRange(r._num[k], valueOf(state.min[k]), valueOf(state.max[k]))) return false;
    }
    return true;
  }

  function valueOf(x) {
    return x === undefined || x === null || isNaN(x) ? null : x;
  }

  function sorted(list) {
    var c = COLUMNS.filter(function (x) { return x.key === state.sortKey; })[0];
    if (!c) return list;                                 // the file's order: species, then hunt number
    var dir = state.sortDir;
    return list.slice().sort(function (a, b) {
      if (c.kind === "range") {
        var x = a._num[c.key], y = b._num[c.key];
        if (x === null || y === null) {                  // dashes always last
          if (x === null && y === null) return a._i - b._i;
          return x === null ? 1 : -1;
        }
        return dir * (x.sort - y.sort) || a._i - b._i;
      }
      return dir * a[c.key].localeCompare(b[c.key], "en", {numeric: true, sensitivity: "base"}) || a._i - b._i;
    });
  }

  // ---------------------------------------------------------------------------------------- the table
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function sortButton(c) {
    var b = el("button", {type: "button", class: "sdo-sort"}, c.label);
    if (c.group) b.setAttribute("aria-label", c.group + ", " + c.label);
    b.addEventListener("click", function () {
      if (state.sortKey === c.key) state.sortDir = -state.sortDir;
      else { state.sortKey = c.key; state.sortDir = 1; }
      render();
    });
    return b;
  }

  function filterControl(c) {
    var name = c.group ? c.group + ", " + c.label : c.label;
    if (c.kind === "text") {
      var t = el("input", {type: "text", size: "1", placeholder: "Filter", autocomplete: "off", "aria-label": "Filter " + name});
      t.addEventListener("input", function () { state.text[c.key] = t.value.trim().toLowerCase(); render(); });
      filterInputs.push(t);
      return t;
    }
    if (c.kind === "pick") {
      var s = el("select", {"aria-label": "Filter " + name});
      s.append(el("option", {value: ALL}, "All"));
      var values = [];
      rows.forEach(function (r) { if (values.indexOf(r[c.key]) < 0) values.push(r[c.key]); });
      values.sort();
      if (c.blank && values.indexOf("") >= 0) s.append(el("option", {value: ""}, c.blank));
      values.forEach(function (v) { if (v !== "") s.append(el("option", {value: v}, v)); });
      s.addEventListener("change", function () { state.pick[c.key] = s.value; render(); });
      filterInputs.push(s);
      return s;
    }
    var box = el("div", {class: "sdo-range"});
    ["min", "max"].forEach(function (end) {
      var i = el("input", {type: "number", inputmode: "decimal", step: "any", min: "0", size: "1",
                           placeholder: end + (c.pct ? " %" : ""),
                           "aria-label": name + ", " + (end === "min" ? "minimum" : "maximum") + (c.pct ? ", percent" : "")});
      i.addEventListener("input", function () {
        state[end][c.key] = i.value === "" ? null : parseFloat(i.value);
        render();
      });
      filterInputs.push(i);
      box.append(i);
    });
    return box;
  }

  function build() {
    var table = el("table", {class: "sdo-table"});
    var thead = table.createTHead();
    var r1 = thead.insertRow(), r2 = thead.insertRow(), r3 = thead.insertRow();
    r3.className = "sdo-filter-row";
    var groupDone = false;
    COLUMNS.forEach(function (c) {
      var th = el("th", {scope: "col", class: c.css});
      th.append(sortButton(c));
      heads.push(th);
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
      var td = el("td", {class: c.css});
      td.append(filterControl(c));
      r3.append(td);
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
    heads.forEach(function (th, i) {
      if (COLUMNS[i].key === state.sortKey) th.setAttribute("aria-sort", state.sortDir > 0 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
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
  searchEl.addEventListener("input", function () {
    state.words = searchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
    render();
  });
  clearEl.addEventListener("click", function () {
    filterInputs.forEach(function (i) { i.value = i.tagName === "SELECT" ? ALL : ""; });
    residencyEl.value = "all";
    searchEl.value = "";
    state.residency = "all";
    state.words = [];
    state.text = {}; state.pick = {}; state.min = {}; state.max = {};
    setGuideEnabled();
    render();
  });
  window.addEventListener("resize", fitDetails);

  fetch(CSV_URL)
    .then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return res.text();
    })
    .then(function (text) {
      rows = parseCSV(text);
      rows.forEach(function (r, i) {
        r._i = i;
        r._all = Object.keys(r).filter(function (k) { return k.charAt(0) !== "_"; })
          .map(function (k) { return r[k].toLowerCase(); }).join("\u0001");
        r._num = {};
        COLUMNS.forEach(function (c) { if (c.kind === "range") r._num[c.key] = numeric(r[c.key]); });
      });
      // the controls may hold values the browser restored on reload
      state.residency = residencyEl.value;
      setGuideEnabled();
      state.guide = guideEl.value;
      state.words = searchEl.value.toLowerCase().split(/\s+/).filter(Boolean);
      build();
      render();
    })
    .catch(function () {
      countEl.textContent = "The table could not be loaded. Use Download CSV for the full table.";
    });
})();
