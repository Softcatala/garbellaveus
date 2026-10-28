// Client-side feature flags, stored in this browser's localStorage and toggled
// from the unlinked ROUTES.flags page. Lets a feature ship to production dark so
// it can be tried there with real services (e.g. SMTP) while ordinary visitors
// never see it. This hides UI only — it is not access control: the backend
// routes behind a flag stay reachable.

const KEY = 'catvoice:flags';

export interface FlagDefinition {
  label: string;
  description: string;
}

// No flags at the moment. To ship something dark, add it here, gate the code
// with `isEnabled('name')`, and switch it on per browser at ROUTES.flags:
//   myFeature: { label: 'My feature', description: 'What it does.' },
export const FLAGS: Record<string, FlagDefinition> = {};

export type FlagName = string;

type Stored = Record<string, boolean>;

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Stored;
  } catch {
    return {};
  }
}

export function isEnabled(flag: FlagName): boolean {
  return read()[flag] === true;
}

export function setFlag(flag: FlagName, enabled: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [flag]: enabled }));
  } catch {
    /* storage unavailable: the flag simply stays off */
  }
}
