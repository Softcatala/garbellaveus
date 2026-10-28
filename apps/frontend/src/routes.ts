// Canonical (Catalan) paths used for all links. The English paths are kept
// registered in App.tsx so old bookmarks and shared URLs keep working.
export const ROUTES = {
  home: '/',
  list: '/llista',
  evaluate: '/avalua',
  about: '/quant-a',
  guidelines: '/pautes',
  confirmEmail: '/confirma-correu',
  unsubscribeEmail: '/baixa-correu',
  // Unlinked: feature-flag switchboard (see flags.ts).
  flags: '/banderes',
  clip: (id: string) => `/clip/${id}`,
} as const;

export const LEGACY_ROUTES = {
  list: '/list',
  evaluate: '/evaluate',
  about: '/about',
  guidelines: '/guidelines',
} as const;
