import type { Metadata } from "next";
import { Caveat, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Provider } from "@/components/provider";
import "./global.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-handwritten",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.byteveda.org/taskito"),
  title: {
    default: "Taskito",
    template: "%s | Taskito",
  },
  description: "Rust-powered task queue for Python. No broker required.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${caveat.variable} font-sans`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
