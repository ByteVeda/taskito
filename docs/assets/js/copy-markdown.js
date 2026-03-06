document.addEventListener("DOMContentLoaded", function () {
  const REPO_RAW_BASE =
    "https://raw.githubusercontent.com/pratyush618/taskito/master/docs/";

  function getSourcePath() {
    // Try the edit button first (most reliable)
    const editLink = document.querySelector("a[title='Edit this page']");
    if (editLink) {
      const href = editLink.getAttribute("href");
      const match = href.match(/\/docs\/(.+\.md)$/);
      if (match) return match[1];
    }

    // Fallback: derive from URL path
    let path = window.location.pathname;

    // Strip site prefix (handles both root and subdirectory deploys)
    const base = document.querySelector("base");
    if (base) {
      const baseHref = new URL(base.href).pathname;
      if (path.startsWith(baseHref)) {
        path = path.slice(baseHref.length);
      }
    }

    // Remove leading slash
    path = path.replace(/^\//, "");

    // Handle trailing slash or empty → index.md
    if (path === "") {
      path = "index.md";
    } else if (path.endsWith("/")) {
      path = path.slice(0, -1) + ".md";
    } else if (!path.endsWith(".md")) {
      // e.g. /guide/tasks → guide/tasks.md
      path += ".md";
    }

    return path;
  }

  function injectButton() {
    const container = document.querySelector(".md-content__inner");
    if (!container) return;

    const btn = document.createElement("button");
    btn.className = "copy-markdown-btn";
    btn.setAttribute("aria-label", "Copy page as Markdown");
    btn.title = "Copy as Markdown";
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
      '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/>' +
      "</svg>" +
      "<span>Copy as Markdown</span>";

    btn.addEventListener("click", async function () {
      const sourcePath = getSourcePath();
      const url = REPO_RAW_BASE + sourcePath;

      btn.disabled = true;
      btn.classList.add("loading");
      btn.querySelector("span").textContent = "Fetching...";

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch: " + res.status);
        const markdown = await res.text();
        await navigator.clipboard.writeText(markdown);

        btn.classList.remove("loading");
        btn.classList.add("copied");
        btn.querySelector("span").textContent = "Copied!";

        setTimeout(function () {
          btn.classList.remove("copied");
          btn.querySelector("span").textContent = "Copy as Markdown";
          btn.disabled = false;
        }, 2000);
      } catch (err) {
        btn.classList.remove("loading");
        btn.classList.add("error");
        btn.querySelector("span").textContent = "Error";
        console.error("Copy as Markdown failed:", err);

        setTimeout(function () {
          btn.classList.remove("error");
          btn.querySelector("span").textContent = "Copy as Markdown";
          btn.disabled = false;
        }, 2000);
      }
    });

    // Insert before the first heading
    const firstHeading = container.querySelector("h1, h2");
    if (firstHeading) {
      firstHeading.parentNode.insertBefore(btn, firstHeading.nextSibling);
    } else {
      container.prepend(btn);
    }
  }

  // Support Zensical instant navigation
  if (typeof document$ !== "undefined") {
    document$.subscribe(function () {
      injectButton();
    });
  } else {
    injectButton();
  }
});
