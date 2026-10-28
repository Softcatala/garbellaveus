// Client-side feature flags, stored in this browser's localStorage and toggled
// from the unlinked ROUTES.flags page. Lets a feature ship to production dark so
// it can be tried there with real services (e.g. SMTP) while ordinary visitors
// never see it. This hides UI only — it is not access control: the backend
// routes behind a flag stay reachable.

const KEY = 'catvoice:flags';

export const FLAGS = {
  emailReminders: {
    label: 'Recordatoris per correu',
    description: "Mostra la invitació a deixar el correu després de 5 avaluacions (i cada 30 després d'«Ara no»).",
  },
} as const;

export type FlagName = keyof typeof FLAGS;

type Stored = Partial<Record<FlagName, boolean>>;

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
