import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Shantell+Sans:wght@500;600;700&display=swap",
  },
];

// Apply the persisted theme before paint to avoid a light/dark flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('taskito-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// Apply the active SDK before paint (query > localStorage > default) so the
// CSS show/hide picks the right variant with no flash. Mirrors readSdk().
const SDK_INIT = `(function(){try{var u=new URLSearchParams(location.search).get('sdk');var s=(u==='python'||u==='node')?u:(localStorage.getItem('taskito-sdk')||'python');if(s!=='python'&&s!=='node'){s='python';}document.documentElement.setAttribute('data-sdk',s);}catch(e){document.documentElement.setAttribute('data-sdk','python');}})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-sdk="python"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: tiny no-flash theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: tiny no-flash sdk bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: SDK_INIT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Something went wrong";
  return (
    <main className="error-page">
      <h1>{message}</h1>
      <a href="/">Back to the docs</a>
    </main>
  );
}
