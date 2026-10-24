var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Background: paper + symbol grid ----------
// A light gray "paper" with faint water-stain lines, covered by a grid of small
// colored symbols that fades in from the left and slowly shifts color. The whole
// grid is out of focus; moving the cursor slowly brings it into focus along a
// lagging, fluid trail, which fades back out over a few seconds.
(function () {
  var canvas = document.querySelector(".backdrop");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var PAPER = "#a8a8a8";
  var CELL = 15;                   // grid spacing in px
  var FOCUS_SCALE = 16;            // the focus trail is stored at 1/16 size
  var COLOR_SPEED = 0.12;          // how fast the colors shift
  var SYMBOLS = [
    // [chance, color, alpha]
    [0.62, "#dcd6d5", 0.5],        // faint light symbols (most of the grid)
    [0.065, "#c8437a", 0.85],      // pink
    [0.05, "#94ee9c", 0.85],       // green
    [0.05, "#f2c64c", 0.85],       // yellow
    [0.06, "#7d7a78", 0.7]         // dark gray
  ];

  var W, H, dpr;
  var paper, fog, soft, haze, fogMask, softMask, sharp, cells, layer, focusA, focusB;

  // ----- noise -----
  var perm = new Uint8Array(512);
  (function () {
    var p = [];
    for (var i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  function hash(x, y) { return perm[perm[x & 255] + (y & 255)] / 255; }
  function fade(t) { return t * t * (3 - 2 * t); }
  function noise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = fade(x - xi), yf = fade(y - yi);
    var a = hash(xi, yi) + (hash(xi + 1, yi) - hash(xi, yi)) * xf;
    var b = hash(xi, yi + 1) + (hash(xi + 1, yi + 1) - hash(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  }
  function fbm(x, y) { return noise(x, y) * 0.6 + noise(x * 2.3, y * 2.3) * 0.28 + noise(x * 5.1, y * 5.1) * 0.12; }
  function smooth(e0, e1, v) { v = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return v * v * (3 - 2 * v); }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  // How dense the grid is in each part of the screen: 0 = bare paper (left), 1 = full grid (right)
  function focusAt(x, y) {
    var t = (x / W) * 0.85 + (y / H) * 0.15 + (fbm(x / 260, y / 260) - 0.5) * 0.35;
    return t;
  }

  // Draws an alpha mask at low resolution, then scales it up softly
  function mask(fn) {
    var mw = Math.ceil(W / 8), mh = Math.ceil(H / 8);
    var small = makeCanvas(mw, mh), sctx = small.getContext("2d");
    var img = sctx.createImageData(mw, mh);
    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        img.data[(y * mw + x) * 4 + 3] = 255 * fn(focusAt(x * 8, y * 8));
      }
    }
    sctx.putImageData(img, 0, 0);
    return small;
  }

  function drawPaper() {
    paper = makeCanvas(canvas.width, canvas.height);
    var p = paper.getContext("2d");
    p.fillStyle = PAPER;
    p.fillRect(0, 0, paper.width, paper.height);

    // Slightly warmer tone where the grid is
    var g = p.createLinearGradient(0, 0, paper.width, 0);
    g.addColorStop(0, "rgba(169, 159, 157, 0)");
    g.addColorStop(1, "rgba(169, 159, 157, 0.9)");
    p.fillStyle = g;
    p.fillRect(0, 0, paper.width, paper.height);

    // Water-stain lines + mottling, computed at 1/3 size and scaled up softly
    var sw = Math.ceil(W / 3), sh = Math.ceil(H / 3);
    var small = makeCanvas(sw, sh), s = small.getContext("2d");
    var img = s.createImageData(sw, sh);
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        var n = fbm(x / 230 + 3.1, y / 230 + 7.7) * 1.7 + (noise(x / 6, y / 6) - 0.5) * 0.03;
        var line = Math.abs(n - Math.round(n));                 // distance to a contour
        var edge = Math.max(0, 1 - line / 0.018) * (1 - smooth(0.4, 0.75, x / sw));
        var mottle = (noise(x / 9, y / 9) - 0.5) * 10;
        var i = (y * sw + x) * 4;
        var dark = edge * 22 - mottle;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = dark > 0 ? 80 : 255;
        img.data[i + 3] = Math.min(255, Math.abs(dark) * 2.2);
      }
    }
    s.putImageData(img, 0, 0);
    p.globalAlpha = 0.35;
    p.filter = "blur(" + dpr + "px)";
    p.drawImage(small, 0, 0, paper.width, paper.height);
    p.filter = "none";
    p.globalAlpha = 1;
  }

  // Each grid cell keeps its shape, but its color shifts over time. The color
  // comes from a slowly drifting noise field, so changes roll across the grid in waves.
  function makeCells() {
    cells = [];
    var cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cells.push({ c: c, r: r, seed: Math.random(), kind: Math.floor(Math.random() * 3), alpha: 0.75 + Math.random() * 0.25, color: -2 });
      }
    }
    sharp = makeCanvas(canvas.width, canvas.height);
  }

  function colorFor(cell, t) {
    var n = noise(cell.c * 0.09 + t * COLOR_SPEED, cell.r * 0.09 - t * COLOR_SPEED * 0.7);
    var roll = (cell.seed + n * 2.2) % 1;
    for (var k = 0; k < SYMBOLS.length; k++) {
      if (roll < SYMBOLS[k][0]) return k;
      roll -= SYMBOLS[k][0];
    }
    return -1; // empty cell
  }

  function updateSymbols(t) {
    var s = sharp.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i], color = colorFor(cell, t);
      if (color === cell.color) continue;
      cell.color = color;
      var x = cell.c * CELL, y = cell.r * CELL;
      s.clearRect(x, y, CELL, CELL);
      if (color < 0) continue;
      s.globalAlpha = SYMBOLS[color][2] * cell.alpha;
      s.fillStyle = s.strokeStyle = SYMBOLS[color][1];
      drawSymbol(s, cell.kind, x + CELL / 2, y + CELL / 2, CELL);
    }
  }

  // Blurry versions of the grid, made at small size each update so they follow the color changes
  function updateBlur(small, maskCanvas, blurPx) {
    var b = small.getContext("2d");
    b.globalCompositeOperation = "source-over";
    b.clearRect(0, 0, small.width, small.height);
    b.filter = "blur(" + blurPx + "px)";
    b.drawImage(sharp, 0, 0, small.width, small.height);
    b.filter = "none";
    b.globalCompositeOperation = "destination-in";
    b.drawImage(maskCanvas, 0, 0, small.width, small.height);
  }

  function drawSymbol(s, kind, x, y, size) {
    if (kind === 0) {                       // square
      var q = size * 0.56;
      s.fillRect(x - q / 2, y - q / 2, q, q);
    } else if (kind === 1) {                // ring
      s.lineWidth = size * 0.13;
      s.beginPath();
      s.arc(x, y, size * 0.33, 0, Math.PI * 2);
      s.stroke();
    } else {                                // four-point star
      var o = size * 0.38, i = size * 0.1;
      s.beginPath();
      s.moveTo(x, y - o);
      s.quadraticCurveTo(x + i, y - i, x + o, y);
      s.quadraticCurveTo(x + i, y + i, x, y + o);
      s.quadraticCurveTo(x - i, y + i, x - o, y);
      s.quadraticCurveTo(x - i, y - i, x, y - o);
      s.fill();
    }
  }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    drawPaper();
    makeCells();
    fogMask = mask(function (t) { return smooth(0.12, 0.45, t) * 0.55; });
    softMask = mask(function (t) { return smooth(0.36, 0.58, t) * 0.9; });
    fog = makeCanvas(Math.ceil(W / 12), Math.ceil(H / 12));
    soft = makeCanvas(Math.ceil(W / 5), Math.ceil(H / 5));
    haze = makeCanvas(Math.ceil(W / 2), Math.ceil(H / 2));
    refresh(performance.now() / 1000);

    layer = makeCanvas(canvas.width, canvas.height);
    focusA = makeCanvas(Math.ceil(W / FOCUS_SCALE), Math.ceil(H / FOCUS_SCALE));
    focusB = makeCanvas(focusA.width, focusA.height);
  }

  // ----- cursor trail -----
  // The brush follows the cursor on a loose spring, so it trails behind and drifts.
  var target = { x: 0, y: 0, active: false };
  var brush = { x: 0, y: 0, vx: 0, vy: 0 };

  function updateFocus() {
    var a = focusA.getContext("2d"), b = focusB.getContext("2d");

    // Spread out a little (fluid feel) and fade slowly
    b.clearRect(0, 0, focusB.width, focusB.height);
    b.filter = "blur(0.7px)";
    b.globalAlpha = 0.985;
    b.drawImage(focusA, 0, 0);
    b.filter = "none";
    b.globalAlpha = 1;

    brush.vx = (brush.vx + (target.x - brush.x) * 0.018) * 0.9;
    brush.vy = (brush.vy + (target.y - brush.y) * 0.018) * 0.9;
    brush.x += brush.vx;
    brush.y += brush.vy;

    var speed = Math.min(1, Math.sqrt(brush.vx * brush.vx + brush.vy * brush.vy) / 6);
    if (target.active && speed > 0.02) {
      var bx = brush.x / FOCUS_SCALE, by = brush.y / FOCUS_SCALE, rad = 120 / FOCUS_SCALE;
      var g = b.createRadialGradient(bx, by, 0, bx, by, rad);
      g.addColorStop(0, "rgba(0,0,0," + 0.16 * speed + ")");
      g.addColorStop(1, "rgba(0,0,0,0)");
      b.globalCompositeOperation = "lighter";
      b.fillStyle = g;
      b.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
      b.globalCompositeOperation = "source-over";
    }

    var t = focusA; focusA = focusB; focusB = t;
  }

  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(paper, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(haze, 0, 0, canvas.width, canvas.height);

    // Sharp grid, shown only along the cursor trail
    var l = layer.getContext("2d");
    l.globalCompositeOperation = "source-over";
    l.clearRect(0, 0, layer.width, layer.height);
    l.imageSmoothingEnabled = true;
    l.drawImage(focusA, 0, 0, layer.width, layer.height);
    l.globalCompositeOperation = "source-in";
    l.drawImage(sharp, 0, 0);
    ctx.drawImage(layer, 0, 0);

    // Soft gray wash over everything so the colors stay muted
    ctx.fillStyle = "rgba(170, 166, 164, 0.22)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function refresh(t) {
    updateSymbols(t);
    updateBlur(fog, fogMask, 0.5);
    updateBlur(soft, softMask, 0.4);

    // Combine both at half size with a real blur, so it reads soft instead of blocky
    var h = haze.getContext("2d");
    h.clearRect(0, 0, haze.width, haze.height);
    h.imageSmoothingEnabled = true;
    h.imageSmoothingQuality = "high";
    h.filter = "blur(4px)";
    h.drawImage(fog, 0, 0, haze.width, haze.height);
    h.filter = "blur(1.5px)";
    h.drawImage(soft, 0, 0, haze.width, haze.height);
    h.filter = "none";
  }

  var tick = 0;
  function frame(time) {
    // Colors step at ~20 fps for a slightly choppy, ASCII-animation feel
    if (++tick % 3 === 0) refresh(time / 1000);
    updateFocus();
    render();
    requestAnimationFrame(frame);
  }

  function pointAt(x, y) {
    if (!target.active) { brush.x = x; brush.y = y; }
    target.x = x; target.y = y; target.active = true;
  }

  window.addEventListener("mousemove", function (e) { pointAt(e.clientX, e.clientY); });
  document.addEventListener("mouseleave", function () { target.active = false; });
  window.addEventListener("touchmove", function (e) { pointAt(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  window.addEventListener("touchend", function () { target.active = false; });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { build(); render(); }, 150);
  });

  build();
  if (reduceMotion) render();
  else requestAnimationFrame(frame);
})();

// ---------- Bouncing logo ----------
// Bounces the logo around the screen like an old DVD screensaver.
(function () {
  var logo = document.querySelector(".bouncer");
  if (!logo) return;

  var speed = 1.6; // pixels per frame
  var x = Math.random() * (window.innerWidth - logo.offsetWidth);
  var y = Math.random() * (window.innerHeight - logo.offsetHeight);
  var dx = speed;
  var dy = speed;

  function step() {
    var maxX = window.innerWidth - logo.offsetWidth;
    var maxY = window.innerHeight - logo.offsetHeight;

    x += dx;
    y += dy;

    if (x <= 0) { x = 0; dx = Math.abs(dx); }
    if (x >= maxX) { x = maxX; dx = -Math.abs(dx); }
    if (y <= 0) { y = 0; dy = Math.abs(dy); }
    if (y >= maxY) { y = maxY; dy = -Math.abs(dy); }

    logo.style.transform = "translate(" + x + "px, " + y + "px)";
    if (!reduceMotion) requestAnimationFrame(step);
  }

  function start() {
    x = Math.max(0, Math.min(x, window.innerWidth - logo.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - logo.offsetHeight));
    step();
  }

  if (logo.complete) start();
  else logo.addEventListener("load", start);
})();

// ---------- Panels ----------
// Horizontal tracks (Events, Archive photo strips), the Artists roster, and
// moving between pages without reloading, so the background and the
// bouncing logo carry on uninterrupted.
(function () {
  var smooth = reduceMotion ? "auto" : "smooth";

  // Horizontal tracks: arrow buttons, a counter, and arrow keys
  function setupTrack(track) {
    var items = Array.prototype.filter.call(track.children, function (el) {
      return !el.classList.contains("track-end");
    });
    var nav = track.parentNode.querySelector("[data-nav]");
    if (!items.length) return;

    // Where the track has to scroll to for item i to line up at the start
    function pos(i) {
      var pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      return items[i].offsetLeft - track.offsetLeft - pad;
    }

    function current() {
      var idx = 0;
      items.forEach(function (el, i) { if (pos(i) <= track.scrollLeft + 2) idx = i; });
      if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 2) idx = items.length - 1;
      return idx;
    }

    function go(i) {
      i = Math.max(0, Math.min(items.length - 1, i));
      track.scrollTo({ left: pos(i), behavior: smooth });
    }

    function update() {
      if (!nav) return;
      nav.hidden = track.scrollWidth <= track.clientWidth + 2;
      // Count the items fully in view, e.g. "01–03 / 05"
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var seen = items.map(function (el) { return el.offsetLeft - track.offsetLeft; }).reduce(function (acc, left, i) {
        var right = left + items[i].offsetWidth;
        if (left >= track.scrollLeft - 2 && right <= track.scrollLeft + track.clientWidth + 2) acc.push(i + 1);
        return acc;
      }, []);
      if (!seen.length) seen = [current() + 1];
      var first = seen[0], last = seen[seen.length - 1];
      nav.querySelector("[data-count]").textContent = pad(first) + (last > first ? "–" + pad(last) : "") + " / " + pad(items.length);
      nav.querySelector("[data-prev]").disabled = track.scrollLeft <= 2;
      nav.querySelector("[data-next]").disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    }

    if (nav) {
      nav.querySelector("[data-prev]").addEventListener("click", function () { go(current() - 1); });
      nav.querySelector("[data-next]").addEventListener("click", function () { go(current() + 1); });
    }
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); go(current() + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current() - 1); }
    });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    track.querySelectorAll("img").forEach(function (img) { if (!img.complete) img.addEventListener("load", update); });
    var details = track.closest("details");
    if (details) details.addEventListener("toggle", update);
    update();
  }

  // Artists: show one artist at a time
  function setupRoster(roster) {
    var tabs = roster.querySelectorAll('[role="tab"]');
    roster.classList.add("is-tabbed");

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function (e) { e.preventDefault(); select(tab); });
      tab.addEventListener("keydown", function (e) {
        var next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (next) { e.preventDefault(); select(tabs[(i + next + tabs.length) % tabs.length], true); }
      });
    });
    select(roster.querySelector('[aria-selected="true"]') || tabs[0]);
  }

  function setup(scope) {
    scope.querySelectorAll("[data-track]").forEach(setupTrack);
    scope.querySelectorAll(".roster").forEach(setupRoster);
  }

  // On phones the panel stops just above the menu, so it needs the menu's size
  var menu = document.querySelector(".menu");
  function measureMenu() {
    if (!menu) return;
    document.documentElement.style.setProperty("--menu-h", menu.offsetHeight + "px");
    document.documentElement.style.setProperty("--menu-w", menu.offsetWidth + "px");
  }
  window.addEventListener("resize", measureMenu);
  if (document.fonts) document.fonts.ready.then(measureMenu);
  measureMenu();

  // ----- moving between pages without a reload -----
  var PAGES = /(^|\/)(index|events|archive|artists)\.html$/;

  function swapTo(url, push) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (text) {
      var doc = new DOMParser().parseFromString(text, "text/html");
      var oldPanel = document.querySelector(".overlay");
      var oldCatcher = document.querySelector(".overlay-close");
      var newPanel = doc.querySelector(".overlay");
      var newCatcher = doc.querySelector(".overlay-close");

      function place() {
        if (oldPanel) oldPanel.remove();
        if (oldCatcher) oldCatcher.remove();
        var main = document.querySelector("main");
        if (newCatcher) document.body.insertBefore(document.importNode(newCatcher, true), main);
        if (newPanel) {
          var panel = document.importNode(newPanel, true);
          document.body.insertBefore(panel, main);
          setup(panel);
          var heading = panel.querySelector("h1");
          if (heading) heading.focus({ preventScroll: true });
        }
        document.body.classList.toggle("has-overlay", !!newPanel);
        document.title = doc.title;
        var current = doc.querySelector(".menu [aria-current]");
        document.querySelectorAll(".menu a").forEach(function (a) {
          if (current && a.getAttribute("href") === current.getAttribute("href")) a.setAttribute("aria-current", "page");
          else a.removeAttribute("aria-current");
        });
        if (push) history.pushState({}, "", url);
        measureMenu();
      }

      // Let the old panel fade out first when closing
      if (oldPanel && !newPanel && !reduceMotion) {
        oldPanel.classList.add("is-leaving");
        setTimeout(place, 140);
      } else {
        place();
      }
    });
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");
    if (e.defaultPrevented || !a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (a.getAttribute("href").charAt(0) === "#") return;
    var url = new URL(a.getAttribute("href"), location.href);
    if (url.origin !== location.origin || !PAGES.test(url.pathname)) return;
    e.preventDefault();
    if (url.href === location.href && document.querySelector(".overlay")) return;
    swapTo(url.href, true).catch(function () { location.href = url.href; });
  });

  window.addEventListener("popstate", function () {
    swapTo(location.href, false).catch(function () { location.reload(); });
  });

  // Escape closes an open panel
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var close = document.querySelector("[data-close]");
    if (close) close.click();
  });

  setup(document);
})();
