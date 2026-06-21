// Lightweight regex syntax highlighter ported from the prototype's landing.js.
// Deterministic + synchronous, so it runs during prerender (HTML baked in) — no
// async Shiki on the landing. Emits the same .kw/.str/.fn/.num/.cmt/.def token
// classes the design system styles. Build-time Shiki still powers MDX code blocks.

function escapeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PY_KW = new Set([
  "from",
  "import",
  "def",
  "return",
  "class",
  "async",
  "await",
  "try",
  "except",
  "raise",
  "if",
  "else",
  "for",
  "in",
  "with",
  "as",
  "None",
  "True",
  "False",
  "self",
]);

const TS_KW = new Set([
  "import",
  "from",
  "export",
  "const",
  "let",
  "var",
  "function",
  "return",
  "await",
  "async",
  "new",
  "class",
  "extends",
  "if",
  "else",
  "for",
  "of",
  "in",
  "try",
  "catch",
  "throw",
  "typeof",
  "number",
  "string",
  "boolean",
  "void",
  "null",
  "undefined",
  "true",
  "false",
]);

function tokenize(code: string, kw: Set<string>, lineComment: RegExp): string {
  const escaped = escapeHtml(code);
  const re =
    /(\/\/[^\n]*|#[^\n]*)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[A-Za-z_][\w.]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$]\w*)/g;
  void lineComment;
  return escaped.replace(
    re,
    (m, cmt, str, dec, num, ident, offset: number, full: string) => {
      if (cmt != null) return `<span class="cmt">${cmt}</span>`;
      if (str != null) return `<span class="str">${str}</span>`;
      if (dec != null) return `<span class="fn">${dec}</span>`;
      if (num != null) return `<span class="num">${num}</span>`;
      if (ident != null) {
        if (kw.has(ident)) return `<span class="kw">${ident}</span>`;
        if (/^\s*\(/.test(full.slice(offset + ident.length)))
          return `<span class="def">${ident}</span>`;
        return ident;
      }
      return m;
    },
  );
}

export function highlightPython(code: string): string {
  return tokenize(code, PY_KW, /#[^\n]*/);
}

export function highlightTs(code: string): string {
  return tokenize(code, TS_KW, /\/\/[^\n]*/);
}
