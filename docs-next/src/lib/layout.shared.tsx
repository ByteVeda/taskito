import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: "Getting Started",
        url: "/docs/getting-started/installation",
      },
      {
        text: "Guides",
        url: "/docs/guides",
      },
      {
        text: "Architecture",
        url: "/docs/architecture/overview",
      },
      {
        text: "API",
        url: "/docs/api-reference/overview",
      },
      {
        text: "Changelog",
        url: "/docs/more/changelog",
      },
    ],
  };
}
