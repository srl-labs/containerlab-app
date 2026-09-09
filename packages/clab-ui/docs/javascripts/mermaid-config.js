document.addEventListener("DOMContentLoaded", function () {
  var attempts = 0;
  var check = setInterval(function () {
    attempts++;
    if (attempts > 50) {
      clearInterval(check);
      return;
    }
    if (typeof mermaid === "undefined" || !mermaid.initialize) return;
    clearInterval(check);

    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        fontFamily:
          "var(--md-text-font-family, -apple-system, sans-serif)",
        fontSize: "14px",
        primaryColor: "#eff6ff",
        primaryBorderColor: "#93c5fd",
        primaryTextColor: "#1e40af",
        secondaryColor: "#ecfdf5",
        secondaryBorderColor: "#a7f3d0",
        secondaryTextColor: "#065f46",
        tertiaryColor: "#f5f3ff",
        tertiaryBorderColor: "#c4b5fd",
        tertiaryTextColor: "#5b21b6",
        lineColor: "#64748b",
        nodeBorder: "#93c5fd",
        mainBkg: "#eff6ff",
        nodeTextColor: "#0f172a",
        edgeLabelBackground: "#ffffff",
        clusterBkg: "#f8fafc",
        clusterBorder: "#cbd5e1",
        actorBkg: "#eff6ff",
        actorBorder: "#93c5fd",
        actorTextColor: "#1e40af",
        actorLineColor: "#94a3b8",
        signalColor: "#475569",
        signalTextColor: "#0f172a",
        activationBkgColor: "#dbeafe",
        activationBorderColor: "#60a5fa",
        sequenceNumberColor: "#ffffff",
        noteBkgColor: "#fffbeb",
        noteBorderColor: "#fde68a",
        noteTextColor: "#92400e",
      },
      flowchart: {
        htmlLabels: true,
        curve: "basis",
        padding: 16,
        nodeSpacing: 50,
        rankSpacing: 60,
        useMaxWidth: true,
      },
      sequence: {
        actorMargin: 60,
        messageMargin: 40,
        mirrorActors: false,
        useMaxWidth: true,
        rightAngles: false,
      },
    });

    // Convert <pre class="mermaid"><code>...</code></pre> to <div class="mermaid">...</div>
    // Keep the element in the same DOM position so panzoom wrappers stay intact
    document.querySelectorAll("pre.mermaid").forEach(function (pre) {
      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = text;
      pre.replaceWith(div);
    });

    mermaid.run();
  }, 100);
});
