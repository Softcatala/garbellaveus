import { Transcription } from '../domain/transcription.entity';

export interface UniqueTranscription {
  // ID of the first transcription with this text (used as vote targetId)
  representativeId: number;
  text: string;
  origins: string[];
  // True when 2+ distinct models produced exactly this string
  hasAgreement: boolean;
}

export function deduplicateTranscriptions(transcriptions: Transcription[]): UniqueTranscription[] {
  const byText = new Map<string, UniqueTranscription>();

  for (const t of transcriptions) {
    const existing = byText.get(t.text);
    if (existing) {
      if (!existing.origins.includes(t.origin)) {
        existing.origins.push(t.origin);
        existing.hasAgreement = existing.origins.length >= 2;
      }
    } else {
      byText.set(t.text, {
        representativeId: t.id,
        text: t.text,
        origins: [t.origin],
        hasAgreement: false,
      });
    }
  }

  // Sort: agreed-upon texts first, then the punctuated second-pass candidate
  // (scripts/whisper_transcribe — issue #8), then by representative ID.
  // Without the origin tiebreak, a punctuated candidate never outranks an
  // older, unpunctuated one on a tie: it's posted after the originals so it
  // always has a higher representativeId, and it's rarely byte-identical to
  // them (different punctuation/wording), so it rarely earns hasAgreement
  // either — it would sort last on every clip, every time.
  return [...byText.values()].sort((a, b) => {
    if (a.hasAgreement !== b.hasAgreement) return a.hasAgreement ? -1 : 1;
    const aWhisper = a.origins.includes('whisper-large-v3-turbo');
    const bWhisper = b.origins.includes('whisper-large-v3-turbo');
    if (aWhisper !== bWhisper) return aWhisper ? -1 : 1;
    return a.representativeId - b.representativeId;
  });
}
