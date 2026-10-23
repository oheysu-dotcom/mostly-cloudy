var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- ASCII clouds background ----------
// Slowly drifting clouds drawn with text characters. Moving the cursor parts
// the clouds and sends soft ripples out from it.
(function () {
  var canvas = document.querySelector(".ascii");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var RAMP = " .':;+*xo%#@";             // light → dense
  var COLORS = ["#3c3c3b", "#424241", "#494948", "#525250", "#5e5e5c"]; // just above the #353534 background
  var FONT_SIZE = 13;
  var CELL_H = 15;
  var CURSOR_RADIUS = 170;

  var W, H, cellW, cols, rows;
  var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, strength: 0, target: 0 };

  // Value noise
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

  function hash(x, y, z) { return perm[perm[perm[x & 255] + (y & 255)] + (z & 255)] / 255; }
  function fade(t) { return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function noise(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    var a = lerp(lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), xf),
                 lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), xf), yf);
    var b = lerp(lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), xf),
                 lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), xf), yf);
    return lerp(a, b, zf);
  }

  function clouds(x, y, z) {
    return noise(x, y, z) * 0.57 + noise(x * 2.1, y * 2.1, z * 1.3) * 0.29 + noise(x * 4.3, y * 4.3, z * 1.7) * 0.14;
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT_SIZE + "px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    cellW = ctx.measureText("M").width;
    cols = Math.ceil(W / cellW) + 1;
    rows = Math.ceil(H / CELL_H) + 1;
  }

  function draw(time) {
    var t = time / 1000;

    // Ease the cursor so the effect glides instead of snapping
    mouse.x += (mouse.tx - mouse.x) * 0.12;
    mouse.y += (mouse.ty - mouse.y) * 0.12;
    mouse.strength += (mouse.target - mouse.strength) * 0.05;

    ctx.fillStyle = "#353534";
    ctx.fillRect(0, 0, W, H);

    var lines = [];
    for (var c = 0; c < COLORS.length; c++) lines.push(new Array(cols));

    for (var r = 0; r < rows; r++) {
      var py = r * CELL_H + CELL_H / 2;
      for (c = 0; c < COLORS.length; c++) lines[c].fill(" ");

      for (var x = 0; x < cols; x++) {
        var px = x * cellW + cellW / 2;

        var n = clouds(x * 0.035 + t * 0.045, r * 0.075, t * 0.04);
        var v = Math.min(1, Math.max(0, (n - 0.38) / 0.4));
        var glow = 0;

        if (mouse.strength > 0.01) {
          var dx = px - mouse.x, dy = py - mouse.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < CURSOR_RADIUS) {
            var k = Math.sqrt(1 - d / CURSOR_RADIUS) * mouse.strength;
            var ripple = Math.pow(0.5 + 0.5 * Math.sin(d * 0.11 - t * 4.5), 3);
            v = v * (1 - k) + k * ripple * 0.75;
            glow = k * ripple;
          }
        }

        var ch = RAMP[Math.round(v * (RAMP.length - 1))];
        if (ch === " ") continue;
        var shade = Math.min(COLORS.length - 1, Math.floor(v * 3 + glow * 2.2));
        lines[shade][x] = ch;
      }

      // Monospace text lines up perfectly, so draw each shade as one string
      for (c = 0; c < COLORS.length; c++) {
        ctx.fillStyle = COLORS[c];
        ctx.fillText(lines[c].join(""), 0, r * CELL_H);
      }
    }

    if (!reduceMotion) requestAnimationFrame(draw);
  }

  function pointAt(x, y) { mouse.tx = x; mouse.ty = y; mouse.target = 1; }

  window.addEventListener("mousemove", function (e) {
    if (mouse.target === 0) { mouse.x = e.clientX; mouse.y = e.clientY; }
    pointAt(e.clientX, e.clientY);
  });
  document.addEventListener("mouseleave", function () { mouse.target = 0; });
  window.addEventListener("touchmove", function (e) {
    var p = e.touches[0];
    pointAt(p.clientX, p.clientY);
  }, { passive: true });
  window.addEventListener("touchend", function () { mouse.target = 0; });
  window.addEventListener("resize", resize);

  resize();
  requestAnimationFrame(draw);
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
