document.addEventListener("DOMContentLoaded", function () {
  const GITHUB_RAW_BASE =
    "https://raw.githubusercontent.com/ByteVeda/taskito/master/docs/";

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

  function htmlToMarkdown(container) {
    var result = [];

    function processNode(node, listPrefix) {
      if (node.nodeType === Node.TEXT_NODE) {
        var text = node.textContent;
        if (text.trim()) result.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      var tag = node.tagName.toLowerCase();

      // Skip the copy button itself and edit links
      if (node.classList.contains("copy-markdown-btn")) return;
      if (node.classList.contains("md-content__button")) return;

      // Headings
      if (/^h[1-6]$/.test(tag)) {
        var level = parseInt(tag[1]);
        result.push("\n" + "#".repeat(level) + " " + node.textContent.trim() + "\n");
        return;
      }

      // Horizontal rule
      if (tag === "hr") {
        result.push("\n---\n");
        return;
      }

      // Code blocks
      if (tag === "pre") {
        var code = node.querySelector("code");
        if (code) {
          var lang = "";
          var classes = code.className.split(/\s+/);
          for (var i = 0; i < classes.length; i++) {
            var m = classes[i].match(/^language-(.+)$/);
            if (m) { lang = m[1]; break; }
          }
          result.push("\n```" + lang + "\n" + code.textContent + "```\n");
        } else {
          result.push("\n```\n" + node.textContent + "```\n");
        }
        return;
      }

      // Inline code (but not inside pre)
      if (tag === "code") {
        result.push("`" + node.textContent + "`");
        return;
      }

      // Bold
      if (tag === "strong" || tag === "b") {
        result.push("**" + node.textContent + "**");
        return;
      }

      // Italic
      if (tag === "em" || tag === "i") {
        result.push("*" + node.textContent + "*");
        return;
      }

      // Links
      if (tag === "a") {
        var href = node.getAttribute("href") || "";
        // Skip anchor links like headerlinks
        if (node.classList.contains("headerlink")) return;
        result.push("[" + node.textContent.trim() + "](" + href + ")");
        return;
      }

      // Images
      if (tag === "img") {
        var alt = node.getAttribute("alt") || "";
        var src = node.getAttribute("src") || "";
        result.push("![" + alt + "](" + src + ")");
        return;
      }

      // SVGs (e.g. pymdownx.emoji to_svg renders inline SVGs)
      if (tag === "svg") {
        var title = node.querySelector("title");
        if (title) result.push(title.textContent);
        return;
      }

      // Paragraphs
      if (tag === "p") {
        result.push("\n");
        for (var c = node.firstChild; c; c = c.nextSibling) {
          processNode(c, listPrefix);
        }
        result.push("\n");
        return;
      }

      // Blockquote
      if (tag === "blockquote") {
        var bqContent = htmlToMarkdownInner(node);
        var lines = bqContent.trim().split("\n");
        result.push("\n");
        for (var i = 0; i < lines.length; i++) {
          result.push("> " + lines[i] + "\n");
        }
        return;
      }

      // Lists
      if (tag === "ul" || tag === "ol") {
        result.push("\n");
        var items = node.children;
        for (var i = 0; i < items.length; i++) {
          if (items[i].tagName.toLowerCase() === "li") {
            var prefix = tag === "ol" ? (i + 1) + ". " : "- ";
            result.push((listPrefix || "") + prefix);
            for (var c = items[i].firstChild; c; c = c.nextSibling) {
              if (c.nodeType === Node.ELEMENT_NODE && (c.tagName.toLowerCase() === "ul" || c.tagName.toLowerCase() === "ol")) {
                processNode(c, (listPrefix || "") + "  ");
              } else {
                processNode(c, listPrefix);
              }
            }
            if (result.length === 0 || !result[result.length - 1].endsWith("\n")) {
              result.push("\n");
            }
          }
        }
        return;
      }

      // Tables
      if (tag === "table") {
        var rows = node.querySelectorAll("tr");
        for (var r = 0; r < rows.length; r++) {
          var cells = rows[r].querySelectorAll("th, td");
          var rowText = "|";
          for (var c = 0; c < cells.length; c++) {
            rowText += " " + htmlToMarkdownInner(cells[c]).trim() + " |";
          }
          result.push(rowText + "\n");
          // Add separator after header row
          if (r === 0 && rows[r].querySelector("th")) {
            var sep = "|";
            for (var c = 0; c < cells.length; c++) {
              sep += " --- |";
            }
            result.push(sep + "\n");
          }
        }
        return;
      }

      // Default: recurse into children
      for (var c = node.firstChild; c; c = c.nextSibling) {
        processNode(c, listPrefix);
      }
    }

    function htmlToMarkdownInner(el) {
      var saved = result;
      result = [];
      for (var c = el.firstChild; c; c = c.nextSibling) {
        processNode(c, "");
      }
      var out = result.join("");
      result = saved;
      return out;
    }

    for (var c = container.firstChild; c; c = c.nextSibling) {
      processNode(c, "");
    }

    // Clean up excessive blank lines
    return result.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
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

      btn.disabled = true;
      btn.classList.add("loading");
      btn.querySelector("span").textContent = "Fetching...";

      try {
        let markdown;
        // Try local _sources first (available in built site), fall back to GitHub
        let fetched = false;
        for (const url of ["/_sources/" + sourcePath, GITHUB_RAW_BASE + sourcePath]) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const text = await res.text();
              // Guard against SPA servers returning HTML for unknown routes
              if (!text.trimStart().startsWith("<!") && !text.trimStart().startsWith("<html")) {
                markdown = text;
                fetched = true;
                break;
              }
            }
          } catch (_) { /* network error, try next */ }
        }
        if (!fetched) {
          // DOM fallback — convert rendered HTML to markdown
          markdown = htmlToMarkdown(container);
        }
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
