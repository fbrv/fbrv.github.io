// Theme toggle — cycles light / dark, persisted per browser.
(function () {
  var root = document.documentElement;
  var btn = document.querySelector("[data-theme-toggle]");
  if (btn) {
    btn.addEventListener("click", function () {
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var current = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      btn.setAttribute("aria-label", "Switch to " + (next === "dark" ? "light" : "dark") + " mode");
    });
  }

  // Reading width — narrow / normal / wide, persisted per browser.
  // No stored value means "auto": the CSS picks a measure from the viewport.
  var WIDTHS = ["narrow", "normal", "wide"];
  var LABELS = { narrow: "\u2039\u203a", normal: "\u2194", wide: "\u00ab\u00bb" };
  var wbtn = document.querySelector("[data-measure-toggle]");
  if (wbtn) {
    var icon = wbtn.querySelector("[data-measure-icon]");
    var paint = function (v) {
      if (icon) icon.textContent = LABELS[v] || LABELS.normal;
      wbtn.setAttribute("aria-label", "Reading width: " + v + ". Click to change.");
      wbtn.setAttribute("title", "Reading width: " + v);
    };
    var stored = null;
    try { stored = localStorage.getItem("measure"); } catch (e) {}
    paint(stored || "normal");
    wbtn.addEventListener("click", function () {
      var current = root.getAttribute("data-measure") || "normal";
      var next = WIDTHS[(WIDTHS.indexOf(current) + 1) % WIDTHS.length];
      root.setAttribute("data-measure", next);
      try { localStorage.setItem("measure", next); } catch (e) {}
      paint(next);
    });
  }

  // Copy buttons on code blocks.
  document.querySelectorAll(".highlight").forEach(function (block) {
    var pre = block.querySelector("pre");
    if (!pre) return;
    var btn = document.createElement("button");
    btn.className = "code-copy";
    btn.type = "button";
    btn.textContent = "copy";
    btn.addEventListener("click", function () {
      var code = block.querySelector("code") || pre;
      navigator.clipboard.writeText(code.innerText.replace(/\n$/, "")).then(function () {
        btn.textContent = "copied";
        setTimeout(function () { btn.textContent = "copy"; }, 1400);
      }).catch(function () { btn.textContent = "failed"; });
    });
    block.appendChild(btn);
  });

  // Wrap wide tables so they scroll instead of breaking the grid.
  document.querySelectorAll(".prose table").forEach(function (t) {
    if (t.parentElement.classList.contains("table-wrap")) return;
    var wrap = document.createElement("div");
    wrap.className = "table-wrap";
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  });
})();
