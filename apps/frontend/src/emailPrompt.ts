// When to ask an evaluator for their email. The anonymous username is the only
// identity, so the "not now" / "never" choices live in this browser's
// localStorage, next to it. Skips are never counted: `validations` is the number
// of clips the server has seen an answer for.

const KEY = 'catvoice:email-prompt';

export const FIRST_PROMPT_AT = 5;
export const SNOOZE_VALIDATIONS = 30;

interface PromptState {
  never?: boolean;
  nextAt?: number;
}

function read(): PromptState {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as PromptState;
  } catch {
    return {};
  }
}

function write(state: PromptState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: worst case we ask again */
  }
}

export function shouldPrompt(validations: number, subscribed: boolean): boolean {
  if (subscribed) return false;
  const state = read();
  if (state.never) return false;
  return validations >= (state.nextAt ?? FIRST_PROMPT_AT);
}

/** "Not now": ask again after another SNOOZE_VALIDATIONS answered clips. */
export function snooze(validations: number) {
  write({ ...read(), nextAt: validations + SNOOZE_VALIDATIONS });
}

/** "Never": do not ask again from this browser. */
export function dismissForever() {
  write({ ...read(), never: true });
}
