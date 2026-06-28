import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { usePrefetchDocs } from "@/hooks";
import { DEFAULT_SDK, SDK_IDS } from "@/lib";
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
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Shantell+Sans:wght@500;600;700&display=optional",
  },
];

// Apply the persisted theme before paint to avoid a light/dark flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('taskito-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// Registry ids + default as inert JSON on the <html> data attribute below.
const SDK_CONFIG = JSON.stringify({ ids: [...SDK_IDS], def: DEFAULT_SDK });

// No-flash SDK bootstrap: query > localStorage > default, validated against the
// data-sdk-config above. Static string (no interpolation); keeps the SSR default on error.
const SDK_INIT = `(function(){try{var c=JSON.parse(document.documentElement.getAttribute('data-sdk-config')),ids=c.ids,def=c.def;var u=new URLSearchParams(location.search).get('sdk');var s=ids.indexOf(u)>=0?u:(localStorage.getItem('taskito-sdk')||def);if(ids.indexOf(s)<0){s=def;}document.documentElement.setAttribute('data-sdk',s);}catch(e){}})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-sdk={DEFAULT_SDK}
      data-sdk-config={SDK_CONFIG}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: tiny no-flash theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static no-flash sdk bootstrap */}
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
  usePrefetchDocs();
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
