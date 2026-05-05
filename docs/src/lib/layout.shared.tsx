import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

const PRIMARY_NAV_LINKS = [
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
];

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}

export function homeOptions(): BaseLayoutProps {
  return {
    ...baseOptions(),
    links: PRIMARY_NAV_LINKS,
  };
}
