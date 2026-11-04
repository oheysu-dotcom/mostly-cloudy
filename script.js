var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Background video ----------
// Loops on its own. For visitors who ask their device for less motion, it
// holds still on its first frame instead.
(function () {
  var video = document.querySelector(".backdrop");
  if (!video || !reduceMotion) return;
  video.removeAttribute("autoplay");
  video.pause();
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
    var items = Array.prototype.slice.call(track.children);
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

    // Scrolling (mouse wheel or trackpad) anywhere on the panel steps through
    // the artists. One gesture moves one artist: after a switch we wait for
    // the wheel to go quiet, so a trackpad's coasting doesn't skip ahead.
    var panel = roster.closest(".overlay") || roster;
    var pending = 0, locked = false, quiet;

    function index() {
      return Array.prototype.indexOf.call(tabs, roster.querySelector('[aria-selected="true"]'));
    }

    panel.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;   // sideways scrolls are left alone
      var dir = e.deltaY > 0 ? 1 : -1;

      // If the artist's text is taller than the panel, scroll it first and
      // only switch once it reaches the top or bottom
      var canScroll = dir > 0
        ? roster.scrollTop + roster.clientHeight < roster.scrollHeight - 1
        : roster.scrollTop > 0;
      if (canScroll && !locked) { pending = 0; return; }

      var target = index() + dir;
      if (target < 0 || target >= tabs.length) return;        // no wrap-around at the ends
      e.preventDefault();

      clearTimeout(quiet);
      quiet = setTimeout(function () { locked = false; pending = 0; }, 220);
      if (locked) return;

      pending += e.deltaY;
      if (Math.abs(pending) < 30) return;
      locked = true;
      pending = 0;
      roster.dataset.dir = dir > 0 ? "down" : "up";
      select(tabs[target]);
      roster.scrollTop = 0;
    }, { passive: false });
  }

  // Archive: count the days since the first show, and hide photos (crowd
  // shots first, from the end of the list) that would run past the names
  function setupArchive(archive) {
    archive.querySelectorAll("[data-days-since]").forEach(function (el) {
      var p = el.getAttribute("data-days-since").split("-");
      var start = Date.UTC(+p[0], p[1] - 1, +p[2]);
      var now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      el.textContent = Math.floor((today - start) / 864e5).toLocaleString("en-US");
    });

    var names = archive.querySelector(".archive-names");
    var photos = archive.querySelector(".archive-photos");
    if (!names || !photos) return;
    var imgs = Array.prototype.slice.call(photos.querySelectorAll("img"));

    function fit() {
      imgs.forEach(function (img) { img.hidden = false; });
      for (var i = imgs.length - 1; i >= 0; i--) {
        if (photos.offsetHeight <= names.offsetHeight) break;
        if (imgs[i].getAttribute("data-kind") === "solo") break;   // never drop the artists themselves
        imgs[i].hidden = true;
      }
    }
    window.addEventListener("resize", fit);
    if (document.fonts) document.fonts.ready.then(fit);
    fit();
  }

  function setup(scope) {
    scope.querySelectorAll("[data-track]").forEach(setupTrack);
    scope.querySelectorAll(".roster").forEach(setupRoster);
    scope.querySelectorAll(".archive").forEach(setupArchive);
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
