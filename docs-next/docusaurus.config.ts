import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Taskito',
  tagline: 'Rust-powered task queue for Python. No broker required.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.byteveda.org',
  baseUrl: '/taskito/',

  organizationName: 'ByteVeda',
  projectName: 'taskito',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/ByteVeda/taskito/tree/master/docs-next/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Taskito',
      logo: {
        alt: 'Taskito Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'gettingStartedSidebar',
          position: 'left',
          label: 'Getting Started',
        },
        {
          type: 'docSidebar',
          sidebarId: 'guidesSidebar',
          position: 'left',
          label: 'Guides',
        },
        {
          type: 'docSidebar',
          sidebarId: 'architectureSidebar',
          position: 'left',
          label: 'Architecture',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiReferenceSidebar',
          position: 'left',
          label: 'API',
        },
        {
          type: 'dropdown',
          label: 'More',
          position: 'left',
          items: [
            {to: '/docs/more/examples', label: 'Examples'},
            {to: '/docs/more/comparison', label: 'Comparison'},
            {to: '/docs/more/faq', label: 'FAQ'},
            {to: '/docs/more/changelog', label: 'Changelog'},
          ],
        },
        {
          href: 'https://github.com/ByteVeda/taskito',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/installation'},
            {label: 'Guides', to: '/docs/guides/core'},
            {label: 'API Reference', to: '/docs/api-reference/overview'},
            {label: 'Architecture', to: '/docs/architecture/overview'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: 'https://github.com/ByteVeda/taskito'},
            {label: 'PyPI', href: 'https://pypi.org/project/taskito/'},
            {label: 'Changelog', to: '/docs/more/changelog'},
            {label: 'Issues', href: 'https://github.com/ByteVeda/taskito/issues'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'Examples', to: '/docs/more/examples'},
            {label: 'Comparison', to: '/docs/more/comparison'},
            {label: 'FAQ', to: '/docs/more/faq'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ByteVeda. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['rust', 'toml', 'bash', 'yaml', 'json', 'python'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
