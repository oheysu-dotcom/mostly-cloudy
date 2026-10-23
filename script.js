var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Background: paper + symbol grid ----------
// A light gray "paper" with faint water-stain lines, covered by a grid of small
// colored symbols that goes from blurry on the left to sharp on the right.
// Moving the cursor slowly brings the grid into focus along a lagging, fluid
// trail, which fades back out over a few seconds.
(function () {
  var canvas = document.querySelector(".backdrop");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var PAPER = "#bfbfbf";
  var CELL = 15;                   // grid spacing in px
  var FOCUS_SCALE = 16;            // the focus trail is stored at 1/16 size
  var SYMBOLS = [
    // [chance, color, alpha]
    [0.62, "#dcd6d5", 0.5],        // faint light symbols (most of the grid)
    [0.065, "#c8437a", 0.85],      // pink
    [0.05, "#94ee9c", 0.85],       // green
    [0.05, "#f2c64c", 0.85],       // yellow
    [0.06, "#7d7a78", 0.7]         // dark gray
  ];

  var W, H, dpr;
  var paper, fog, soft, sharp, sharpMask, layer, focusA, focusB;

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

  // How "in focus" each part of the screen is: 0 = blurry left, 1 = sharp right
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

  function masked(source, maskCanvas) {
    var out = makeCanvas(canvas.width, canvas.height), o = out.getContext("2d");
    o.imageSmoothingEnabled = true;
    o.drawImage(maskCanvas, 0, 0, out.width, out.height);
    o.globalCompositeOperation = "source-in";
    o.drawImage(source, 0, 0);
    return out;
  }

  function blurred(source, factor, px) {
    var w = Math.ceil(source.width / factor), h = Math.ceil(source.height / factor);
    var small = makeCanvas(w, h), s = small.getContext("2d");
    s.drawImage(source, 0, 0, w, h);
    var out = makeCanvas(source.width, source.height), o = out.getContext("2d");
    o.filter = "blur(" + px + "px)";
    o.drawImage(small, 0, 0, out.width, out.height);
    return out;
  }

  function drawPaper() {
    paper = makeCanvas(canvas.width, canvas.height);
    var p = paper.getContext("2d");
    p.fillStyle = PAPER;
    p.fillRect(0, 0, paper.width, paper.height);

    // Slightly warmer tone where the grid is
    var g = p.createLinearGradient(0, 0, paper.width, 0);
    g.addColorStop(0, "rgba(190, 180, 178, 0)");
    g.addColorStop(1, "rgba(190, 180, 178, 0.9)");
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

  function drawSymbols() {
    sharp = makeCanvas(canvas.width, canvas.height);
    var s = sharp.getContext("2d");
    s.scale(dpr, dpr);
    var cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var roll = Math.random(), pick = null;
        for (var k = 0; k < SYMBOLS.length; k++) {
          if (roll < SYMBOLS[k][0]) { pick = SYMBOLS[k]; break; }
          roll -= SYMBOLS[k][0];
        }
        if (!pick) continue;
        var cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        s.globalAlpha = pick[2] * (0.75 + Math.random() * 0.25);
        s.fillStyle = s.strokeStyle = pick[1];
        drawSymbol(s, Math.floor(Math.random() * 3), cx, cy, CELL);
      }
    }
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
    drawSymbols();
    fog = masked(blurred(sharp, 14 * dpr, 6 * dpr), mask(function (t) { return smooth(0.12, 0.45, t) * 0.55; }));
    soft = masked(blurred(sharp, 5 * dpr, 2 * dpr), mask(function (t) { return smooth(0.36, 0.58, t) * 0.9; }));
    sharpMask = mask(function (t) { return smooth(0.55, 0.72, t); });

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
    ctx.drawImage(fog, 0, 0);
    ctx.drawImage(soft, 0, 0);

    // Sharp grid, shown where it's naturally in focus plus along the cursor trail
    var l = layer.getContext("2d");
    l.globalCompositeOperation = "source-over";
    l.clearRect(0, 0, layer.width, layer.height);
    l.imageSmoothingEnabled = true;
    l.drawImage(sharpMask, 0, 0, layer.width, layer.height);
    l.globalCompositeOperation = "lighter";
    l.drawImage(focusA, 0, 0, layer.width, layer.height);
    l.globalCompositeOperation = "source-in";
    l.drawImage(sharp, 0, 0);
    ctx.drawImage(layer, 0, 0);

    // Soft gray wash over everything so the colors stay muted
    ctx.fillStyle = "rgba(192, 188, 186, 0.22)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function frame() {
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
