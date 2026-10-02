import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { AudioPlayer } from '../components/AudioPlayer';
import type { Clip, UniqueTranscription, VoteSummary, Vote } from '../types';
import { DIMENSIONS, DIALECT_VALUES, IRRELEVANT_REASONS, type Dimension, type IrrelevantReason } from '../types';
import { translateValue } from '../i18nValues';
import { resolveDimension } from '../voteUtils';

const SKIP_STORAGE_KEY = 'catvoice:skipped';

function getSkipped(): string[] {
  try { return JSON.parse(localStorage.getItem(SKIP_STORAGE_KEY) || '[]'); } catch { return []; }
}
function addSkipped(clipId: string) {
  const skipped = getSkipped();
  if (!skipped.includes(clipId)) {
    localStorage.setItem(SKIP_STORAGE_KEY, JSON.stringify([...skipped, clipId]));
  }
}

function isDimension(value: string | null): value is Dimension {
  return !!value && (DIMENSIONS as readonly string[]).includes(value);
}

interface EvalState {
  clip: Clip;
  uniqueTranscriptions: UniqueTranscription[];
  votes: VoteSummary[];
  userVotes: Vote[];
}

interface Props {
  username: string;
}

export function EvaluatePage({ username }: Props) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentClipId = searchParams.get('clipId');
  // Dimension is sourced from the URL, not its own state — that's what makes the
  // in-progress flow shareable/bookmarkable/back-button-safe. Its absence also
  // doubles as the signal to show the dimension picker screen below.
  const dimensionParam = searchParams.get('dimension');
  const dimension: Dimension = isDimension(dimensionParam) ? dimensionParam : 'transcription';

  const [state, setState] = useState<EvalState | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState('');
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<number | null>(null);
  // Two-step transcription flow, mirroring dialect's picker: "Incorrect" opens
  // this instead of immediately voting, so editing only ever happens once the
  // evaluator has explicitly said the current text is wrong.
  const [transcriptionCorrecting, setTranscriptionCorrecting] = useState(false);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);
  const [dialectPicker, setDialectPicker] = useState(false);
  const [selectedDialect, setSelectedDialect] = useState('');
  const [irrelevantPicker, setIrrelevantPicker] = useState(false);
  const [irrelevantReason, setIrrelevantReason] = useState<IrrelevantReason>('not_catalan');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  // Prevents double-fetch when we push a new clipId to the URL ourselves
  const selfNavRef = useRef(false);

  function resetUi() {
    setVoting(false);
    setTranscriptionCorrecting(false);
    setEditText('');
    setError('');
    setSelectedTranscriptionId(null);
    setCopied(false);
    setDialectPicker(false);
    setSelectedDialect('');
    setIrrelevantPicker(false);
    setIrrelevantReason('not_catalan');
    setReportOpen(false);
    setReportText('');
    setReportSubmitted(false);
  }

  function applyData(data: { clip: import('../types').Clip; uniqueTranscriptions: import('../types').UniqueTranscription[]; votes: VoteSummary[]; userVotes: Vote[] }) {
    const uniqueTranscriptions = data.uniqueTranscriptions ?? [];

    // If the user already voted on a specific transcription, put that one first
    const priorTxVote = data.userVotes.find((v) => v.dimension === 'transcription');
    let ordered = uniqueTranscriptions;
    if (priorTxVote?.targetId) {
      const priorId = Number(priorTxVote.targetId);
      const idx = uniqueTranscriptions.findIndex((tx) => tx.representativeId === priorId);
      if (idx > 0) {
        ordered = [uniqueTranscriptions[idx], ...uniqueTranscriptions.slice(0, idx), ...uniqueTranscriptions.slice(idx + 1)];
      }
    }

    setState({ clip: data.clip, uniqueTranscriptions: ordered, votes: data.votes, userVotes: data.userVotes });
    setSelectedTranscriptionId(ordered[0]?.representativeId ?? null);
    setDone(false);
  }

  const loadNext = useCallback(async (skipAdditional: string[] = []) => {
    setLoading(true);
    resetUi();
    const skipped = [...getSkipped(), ...skipAdditional];
    try {
      const data = await api.evaluateNext(username, dimension, skipped);
      if (data.done) {
        setDone(true);
        setState(null);
      } else {
        applyData(data);
        selfNavRef.current = true;
        setSearchParams({ clipId: data.clip.clipId, dimension });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [username, dimension, setSearchParams]);

  const loadClip = useCallback(async (clipId: string) => {
    setLoading(true);
    resetUi();
    try {
      const data = await api.evaluateClip(clipId, username);
      applyData(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [username]);

  // React to URL clipId/dimension changes (browser back/forward navigation,
  // and picking a dimension on the picker screen below). With no dimension
  // chosen yet, do nothing — the picker screen is what's shown in that case.
  useEffect(() => {
    if (selfNavRef.current) {
      selfNavRef.current = false;
      return;
    }
    if (currentClipId) {
      loadClip(currentClipId);
    } else if (dimensionParam) {
      loadNext();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClipId, dimensionParam]);

  // Dimension picking is a one-time step right after "Evaluate" (see the
  // dimensionParam-less render branch below), not a tab you flip mid-flow —
  // feedback was that in-flow tabs read as "this will advance to the next
  // dimension on the same clip", which isn't what voting does. `replace: true`
  // because this is the same logical step as landing on /evaluate, not a new one.
  const chooseDimension = (d: Dimension) => {
    setSearchParams({ dimension: d }, { replace: true });
  };

  // Explicit escape hatch back to the dimension picker, so switching what you're
  // evaluating is unmistakably "start a new evaluation flow", not "stay on this
  // clip but change what the buttons mean".
  const backToDimensionPicker = () => {
    resetUi();
    setState(null);
    setDone(false);
    setSearchParams({}, { replace: true });
  };

  const skip = () => {
    if (state) {
      addSkipped(state.clip.clipId);
      loadNext([state.clip.clipId]);
    }
  };

  const confirmFlagIrrelevant = async () => {
    if (!state || voting) return;
    setVoting(true);
    try {
      await api.flagIrrelevant(state.clip.clipId, username, irrelevantReason);
      loadNext();
    } catch (e) {
      setError(String(e));
      setVoting(false);
    }
  };

  const genderResolved = resolveDimension(state?.votes ?? [], 'gender', state?.clip.gender);
  const dialectResolved = resolveDimension(state?.votes ?? [], 'dialect', state?.clip.detectedDialect);

  // Snapshot of what's actually on screen for the current dimension, kept as a
  // reference on the report — not a live pointer, since votes may change it later.
  const currentDimensionValue =
    dimension === 'transcription'
      ? (state?.uniqueTranscriptions[0]?.text ?? state?.clip.candidate1 ?? state?.clip.candidate2 ?? null)
      : dimension === 'gender'
      ? genderResolved.value
      : dialectResolved.value;

  const submitIssueReport = async () => {
    if (!state || !reportText.trim() || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await api.reportIssue({
        clipId: state.clip.clipId,
        dimension,
        dimensionValue: currentDimensionValue,
        message: reportText.trim(),
        username,
      });
      setReportOpen(false);
      setReportText('');
      setReportSubmitted(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setReportSubmitting(false);
    }
  };

  const vote = async (value: 1 | -1) => {
    if (!state || voting) return;

    // Dialect has more than two possible values, so "incorrect" doesn't imply a
    // specific alternative — ask the evaluator to pick the right one first.
    if (dimension === 'dialect' && value === -1 && !dialectPicker) {
      setDialectPicker(true);
      return;
    }

    // Transcription: "incorrect" opens the correction step below instead of
    // voting immediately — saveCorrection/declineCorrection handle the actual
    // votes once the evaluator picks Save or Never ask there.
    if (dimension === 'transcription' && value === -1 && !transcriptionCorrecting) {
      const best = state.uniqueTranscriptions[0];
      setEditText(best?.text ?? state.clip.candidate1 ?? state.clip.candidate2 ?? '');
      setTranscriptionCorrecting(true);
      return;
    }

    setVoting(true);
    try {
      let targetId: string | undefined;

      if (dimension === 'transcription') {
        // Only reachable with value === 1 (confirming the displayed text as-is) —
        // the -1 path is intercepted above. Dataset candidates aren't persisted
        // as a Transcription row until someone votes on them, so create one here
        // if there's no existing row yet to target.
        const best = state.uniqueTranscriptions[0];
        let voteTargetId = selectedTranscriptionId;
        if (voteTargetId == null && !best) {
          const text = state.clip.candidate1 ?? state.clip.candidate2 ?? '';
          if (text) {
            const newT = await api.createTranscription({ clipId: state.clip.clipId, origin: 'human', text });
            voteTargetId = newT.id;
          }
        }
        targetId = voteTargetId != null ? String(voteTargetId) : undefined;
      } else if (dimension === 'gender') {
        targetId = genderResolved.value ?? undefined;
      } else {
        targetId = dialectResolved.value ?? undefined;
      }

      await api.castVote({ clipId: state.clip.clipId, dimension, targetId, username, value });

      // Binary gender: an "incorrect" vote deterministically implies the other value,
      // so raise it as a competing candidate for the next evaluator to confirm.
      if (dimension === 'gender' && value === -1 && targetId) {
        const opposite = targetId === 'male' ? 'female' : 'male';
        await api.castVote({ clipId: state.clip.clipId, dimension, targetId: opposite, username, value: 1 });
      }

      // Dialect: the evaluator explicitly chose the correct value in the picker above.
      if (dimension === 'dialect' && value === -1 && selectedDialect) {
        await api.castVote({ clipId: state.clip.clipId, dimension, targetId: selectedDialect, username, value: 1 });
      }

      loadNext();
    } catch (e) {
      setError(String(e));
      setVoting(false);
    }
  };

  // Shared by saveCorrection/declineCorrection: the transcription row to cast
  // the "incorrect" downvote against, creating one from the raw dataset
  // candidate first if this clip has never had a Transcription row voted on.
  const resolveOriginalTranscriptionId = async (): Promise<string | undefined> => {
    if (!state) return undefined;
    if (selectedTranscriptionId != null) return String(selectedTranscriptionId);
    const best = state.uniqueTranscriptions[0];
    if (best) return String(best.representativeId);
    const text = (state.clip.candidate1 ?? state.clip.candidate2 ?? '').trim();
    if (!text) return undefined;
    const created = await api.createTranscription({ clipId: state.clip.clipId, origin: 'human', text });
    return String(created.id);
  };

  const saveCorrection = async () => {
    if (!state || voting) return;
    const corrected = editText.trim();
    if (!corrected) return;
    setVoting(true);
    try {
      const originalId = await resolveOriginalTranscriptionId();
      if (originalId) {
        await api.castVote({ clipId: state.clip.clipId, dimension: 'transcription', targetId: originalId, username, value: -1 });
      }
      const newT = await api.createTranscription({ clipId: state.clip.clipId, origin: 'human', text: corrected });
      await api.castVote({ clipId: state.clip.clipId, dimension: 'transcription', targetId: String(newT.id), username, value: 1 });
      loadNext();
    } catch (e) {
      setError(String(e));
      setVoting(false);
    }
  };

  // "Never ask [me to correct this] again": register that the current text is
  // wrong without requiring a fix, then move on — unlike Skip, this still casts
  // the incorrect vote so other evaluators see it needs work.
  const declineCorrection = async () => {
    if (!state || voting) return;
    setVoting(true);
    try {
      const originalId = await resolveOriginalTranscriptionId();
      if (originalId) {
        await api.castVote({ clipId: state.clip.clipId, dimension: 'transcription', targetId: originalId, username, value: -1 });
      }
      loadNext();
    } catch (e) {
      setError(String(e));
      setVoting(false);
    }
  };

  // Most clips have no dialect signal at all (no audio-model guess, no
  // town-derived vote) — rather than a dead-end with disabled Correct/Incorrect
  // buttons, let the evaluator suggest one from scratch. Just a single upvote:
  // there's no existing candidate to downvote.
  const suggestDialect = async () => {
    if (!state || voting || !selectedDialect) return;
    setVoting(true);
    try {
      await api.castVote({ clipId: state.clip.clipId, dimension: 'dialect', targetId: selectedDialect, username, value: 1 });
      loadNext();
    } catch (e) {
      setError(String(e));
      setVoting(false);
    }
  };

  const userVotesForDimension = state?.userVotes.filter((v) => v.dimension === dimension) ?? [];

  // Gender/dialect votes can flip between competing targets (a downvote auto-raises
  // the corrected candidate as a +1 companion row), so "the user's current stance" is
  // best represented by whichever vote matches what's actually displayed right now —
  // not just "any negative row", which goes stale the moment a correction is
  // reconfirmed, or becomes ambiguous after more than one correction round.
  const dimResolvedValue = dimension === 'gender'
    ? genderResolved.value
    : dimension === 'dialect'
    ? dialectResolved.value
    : null;
  const userVoteOnResolved = dimResolvedValue
    ? userVotesForDimension.find((v) => v.targetId === dimResolvedValue)
    : undefined;
  const userVoteForDimension = userVoteOnResolved
    ?? userVotesForDimension.find((v) => v.value === -1)
    ?? userVotesForDimension[0];
  // True only for an actual correction (a +1 on what's shown, alongside a -1 the
  // user cast on some other target) — not a plain first-time confirmation.
  const userCorrectedDimension =
    !!userVoteOnResolved &&
    userVoteOnResolved.value === 1 &&
    userVotesForDimension.some((v) => v.value === -1 && v.targetId !== dimResolvedValue);
  const netVotes = dimension === 'gender'
    ? genderResolved.netVotes
    : dimension === 'dialect'
    ? dialectResolved.netVotes
    : (state?.votes.filter((v) => v.dimension === dimension).reduce((max, v) => Math.max(max, v.netVotes), 0) ?? 0);

  const bestTx = state?.uniqueTranscriptions[0];
  // The pre-correction baseline text, used both for the read-only step-1 display
  // and to tell whether the step-2 textarea actually changed anything.
  const originalText = bestTx?.text ?? state?.clip.candidate1 ?? state?.clip.candidate2 ?? '';

  // Vote button labels default to generic Correct/Incorrect, but restate the
  // specific value being confirmed for dimensions where a bare "Correct" is
  // easy to click through without registering what it's agreeing to.
  const dialectValueLabel = dialectResolved.value ? translateValue(t, 'dialect', dialectResolved.value) : '';
  const correctLabel =
    dimension === 'dialect' && dialectResolved.value
      ? t('evaluate.dialectCorrect', { value: dialectValueLabel })
      : dimension === 'gender' && genderResolved.value === 'male'
      ? t('evaluate.genderCorrectMale')
      : dimension === 'gender' && genderResolved.value === 'female'
      ? t('evaluate.genderCorrectFemale')
      : t('evaluate.correct');
  const incorrectLabel =
    dimension === 'dialect' && dialectResolved.value
      ? t('evaluate.dialectIncorrect', { value: dialectValueLabel })
      : dimension === 'gender' && genderResolved.value === 'male'
      ? t('evaluate.genderIncorrectFemale')
      : dimension === 'gender' && genderResolved.value === 'female'
      ? t('evaluate.genderIncorrectMale')
      : t('evaluate.incorrect');

  const copyClipUrl = (clipId: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/clip/${clipId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // No dimension chosen yet: this is the very first step after clicking
  // "Evaluate" — pick what you're evaluating before any clip loads.
  if (!dimensionParam) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-gray-800 mb-1 text-center">{t('evaluate.chooseDimensionTitle')}</h2>
        <p className="text-sm text-gray-500 mb-8 text-center">{t('evaluate.chooseDimensionSubtitle')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Gender is hidden here pending an internal discussion about it being
              a controversial dimension to evaluate — the capability itself (voting,
              stats, ?dimension=gender deep links) is untouched, just not offered
              as a starting choice. */}
          {DIMENSIONS.filter((d) => d !== 'gender').map((d) => (
            <button
              key={d}
              onClick={() => chooseDimension(d)}
              className="bg-white border border-gray-200 hover:border-brand-400 hover:shadow-md rounded-2xl p-6 text-center transition"
            >
              <div className="text-lg font-semibold text-gray-800 mb-1">{t(`dimension.${d}`)}</div>
              <div className="text-xs text-gray-500">{t(`evaluate.dimensionHint.${d}`)}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">{t('evaluate.loading')}</div>
    );
  }

  if (done) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('evaluate.allDone')}</h2>
        <p className="text-gray-500 mb-6">{t('evaluate.allDoneDescription')}</p>
        <button onClick={() => loadNext()} className="btn-primary mr-3">{t('evaluate.startOver')}</button>
        <button onClick={backToDimensionPicker} className="btn-secondary mr-3">{t('evaluate.evaluateOtherDimension')}</button>
        <Link to="/list" className="btn-secondary">{t('evaluate.backToList')}</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-end gap-2 mb-6 text-xs">
        <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
          {t(`dimension.${dimension}`)}
        </span>
        <button
          onClick={backToDimensionPicker}
          className="text-gray-400 hover:text-brand-600 hover:underline"
        >
          {t('evaluate.switchDimensionAction')}
        </button>
      </div>

      {error && <div className="text-red-500 text-sm mb-4 p-3 bg-red-50 rounded-lg">{error}</div>}

      {state && (
        <div className="space-y-6">
          {/* Clip info */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <button
                onClick={() => copyClipUrl(state.clip.clipId)}
                className="text-xs font-mono text-gray-400 hover:text-brand-500 transition"
                title={t('evaluate.copyLink')}
              >
                {copied ? t('evaluate.copied') : state.clip.clipId}
              </button>
              {state.clip.gender && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {translateValue(t, 'gender', state.clip.gender)}
                </span>
              )}
              {state.clip.duration && (
                <span className="text-xs text-gray-400">{state.clip.duration.toFixed(1)}s</span>
              )}
              {netVotes >= 2 && (
                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{t('evaluate.goldenBadge')}</span>
              )}
              {state.clip.detectedLanguage && state.clip.detectedLanguage !== 'catalan' && (
                <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">
                  ⚠ {translateValue(t, 'language', state.clip.detectedLanguage)}
                </span>
              )}
              {state.clip.isRelevant === false && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                  {t('evaluate.flaggedIrrelevant')}
                </span>
              )}
            </div>

            {/* Audio player */}
            {state.clip.tarFile != null ? (
              <AudioPlayer src={api.audioUrl(state.clip.clipId)} autoPlay />
            ) : (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-500 text-center">
                {t('evaluate.audioNotIndexed')}
              </div>
            )}

            {/* YouTube link — always shown */}
            {state.clip.ytUrl && (
              <a
                href={state.clip.ytUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
              >
                {t('evaluate.openYouTube')}
              </a>
            )}
          </div>

          {/* Dimension-specific content */}
          {dimension === 'transcription' && (() => {
            if (!originalText) {
              return <p className="text-sm text-gray-400">{t('evaluate.noTranscription')}</p>;
            }

            const tVotes = bestTx
              ? state.votes.find((v) => v.dimension === 'transcription' && v.targetId === String(bestTx.representativeId))
              : null;

            // Step 2: the evaluator said the text above was wrong — collect a
            // correction (or let them decline one) instead of showing it read-only.
            if (transcriptionCorrecting) {
              const trimmedEdit = editText.trim();
              return (
                <div className="bg-white rounded-2xl border border-brand-200 p-5">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('evaluate.correctionPrompt')}
                  </label>
                  <textarea
                    ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    rows={3}
                    className="w-full border border-brand-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none overflow-hidden"
                    autoFocus
                  />
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <button
                      onClick={saveCorrection}
                      disabled={voting || !trimmedEdit || trimmedEdit === originalText}
                      className={`px-2 py-2.5 rounded-lg transition font-semibold text-sm sm:text-base ${
                        voting || !trimmedEdit || trimmedEdit === originalText
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {t('evaluate.saveCorrection')}
                    </button>
                    <button
                      onClick={skip}
                      disabled={voting}
                      className="px-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-600 font-medium py-2.5 rounded-lg transition text-sm sm:text-base"
                    >
                      {t('evaluate.skip')}
                    </button>
                    <button
                      onClick={declineCorrection}
                      disabled={voting}
                      className="px-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-600 font-medium py-2.5 rounded-lg transition text-sm sm:text-base leading-tight"
                    >
                      {t('evaluate.neverAskCorrection')}
                    </button>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {t('evaluate.transcriptionGuidelinesTitle')}
                    </p>
                    <ul className="text-xs text-gray-500 list-disc list-inside space-y-1.5">
                      <li>{t('evaluate.transcriptionGuideline1')}</li>
                      <li>{t('evaluate.transcriptionGuideline2')}</li>
                      <li>{t('evaluate.transcriptionGuideline3')}</li>
                      <li>{t('evaluate.transcriptionGuideline4')}</li>
                    </ul>
                  </div>
                </div>
              );
            }

            return (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                {(bestTx || tVotes) && (
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {bestTx?.origins.map((o) => (
                      <span key={o} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                        {translateValue(t, 'origin', o)}
                      </span>
                    ))}
                    {bestTx?.hasAgreement && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                        {t('evaluate.modelsAgree', { count: bestTx.origins.length })}
                      </span>
                    )}
                    {tVotes && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
                        tVotes.netVotes >= 2
                          ? 'bg-green-100 text-green-700'
                          : tVotes.netVotes < 0
                          ? 'bg-red-100 text-red-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {t('evaluate.votesCount', { net: tVotes.netVotes > 0 ? `+${tVotes.netVotes}` : tVotes.netVotes })}
                      </span>
                    )}
                  </div>
                )}
                <p className="text-sm text-gray-800 leading-relaxed">{originalText}</p>
              </div>
            );
          })()}

          {dimension === 'gender' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-3">{t('evaluate.genderAnnotation')}</h3>
              <div className="text-2xl font-bold text-gray-800 mb-2">
                {genderResolved.value ? translateValue(t, 'gender', genderResolved.value) : t('values.gender.unknown')}
              </div>
              <p className="text-sm text-gray-500">
                {t('evaluate.genderInstruction')}
              </p>
              {genderResolved.candidates.length > 0 && (
                <div className="mt-3 text-sm text-gray-500">
                  {t('evaluate.netVotes', { count: genderResolved.netVotes })}
                  {genderResolved.isGolden && t('evaluate.goldenSuffix')}
                </div>
              )}
            </div>
          )}

          {dimension === 'dialect' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-3">{t('evaluate.dialectDetection')}</h3>
              {dialectResolved.value ? (
                <>
                  <div className="text-xl font-bold text-gray-800 mb-2">
                    {translateValue(t, 'dialect', dialectResolved.value)}
                  </div>
                  <p className="text-sm text-gray-500">
                    {t('evaluate.dialectInstruction')}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400">
                  {t('evaluate.noDialect')}
                </p>
              )}
              {dialectResolved.candidates.length > 0 && (
                <div className="mt-3 text-sm text-gray-500">
                  {t('evaluate.netVotes', { count: dialectResolved.netVotes })}
                  {dialectResolved.isGolden && t('evaluate.goldenSuffix')}
                </div>
              )}

              {/* Evaluator flagged the current suggestion as wrong — pick the actual dialect */}
              {dialectPicker && dialectResolved.value && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('evaluate.dialectPickerPrompt')}
                  </label>
                  <select
                    value={selectedDialect}
                    onChange={(e) => setSelectedDialect(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    autoFocus
                  >
                    <option value="">{t('evaluate.dialectPickerPlaceholder')}</option>
                    {DIALECT_VALUES.filter((d) => d !== dialectResolved.value).map((d) => (
                      <option key={d} value={d}>{translateValue(t, 'dialect', d)}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => vote(-1)}
                      disabled={!selectedDialect || voting}
                      className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition"
                    >
                      {t('evaluate.recordDialect')}
                    </button>
                    <button
                      onClick={() => { setDialectPicker(false); setSelectedDialect(''); }}
                      className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2 rounded-lg transition"
                    >
                      {t('evaluate.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {/* Nothing set at all yet — let the evaluator suggest one directly, no dead end */}
              {!dialectResolved.value && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('evaluate.dialectPickerPrompt')}
                  </label>
                  <select
                    value={selectedDialect}
                    onChange={(e) => setSelectedDialect(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                    autoFocus
                  >
                    <option value="">{t('evaluate.dialectPickerPlaceholder')}</option>
                    {DIALECT_VALUES.map((d) => (
                      <option key={d} value={d}>{translateValue(t, 'dialect', d)}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={suggestDialect}
                      disabled={!selectedDialect || voting}
                      className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition"
                    >
                      {t('evaluate.suggestDialect')}
                    </button>
                    <button
                      onClick={skip}
                      disabled={voting}
                      className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2 rounded-lg transition"
                    >
                      {t('evaluate.skip')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vote buttons — hidden while the dialect correction picker, the dialect
              "suggest one from scratch" picker, or the transcription correction
              step (each of which has its own action row) is the active UI */}
          {!dialectPicker && !(dimension === 'dialect' && !dialectResolved.value) && !(dimension === 'transcription' && transcriptionCorrecting) && (
            <div className="flex gap-3">
              <button
                onClick={() => vote(1)}
                disabled={voting || (dimension === 'transcription' && !originalText.trim()) || (dimension === 'gender' && !genderResolved.value)}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold py-3 px-2 rounded-xl transition flex items-center justify-center gap-2 text-sm sm:text-base leading-tight text-center"
              >
                {correctLabel}
              </button>
              <button
                onClick={() => vote(-1)}
                disabled={voting || (dimension === 'transcription' && !originalText.trim()) || (dimension === 'gender' && !genderResolved.value)}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white font-semibold py-3 px-2 rounded-xl transition flex items-center justify-center gap-2 text-sm sm:text-base leading-tight text-center"
              >
                {incorrectLabel}
              </button>
              <button
                onClick={skip}
                disabled={voting}
                className="px-6 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-3 rounded-xl transition"
              >
                {t('evaluate.skip')}
              </button>
            </div>
          )}

          {/* Not relevant flag + report an issue */}
          <div className="flex justify-center items-center gap-4">
            <button
              onClick={() => setIrrelevantPicker((o) => !o)}
              disabled={voting}
              className="text-xs text-orange-500 hover:text-orange-700 hover:underline disabled:opacity-40"
              title={t('evaluate.notRelevantTitle')}
            >
              {t('evaluate.notRelevant')}
            </button>
            <button
              onClick={() => setReportOpen((o) => !o)}
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
              title={t('evaluate.reportIssueTitle')}
            >
              {t('evaluate.reportIssue')}
            </button>
          </div>

          {irrelevantPicker && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('evaluate.irrelevantReasonPrompt')}
              </label>
              <select
                value={irrelevantReason}
                onChange={(e) => setIrrelevantReason(e.target.value as IrrelevantReason)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-300"
                autoFocus
              >
                {IRRELEVANT_REASONS.map((r) => (
                  <option key={r} value={r}>{translateValue(t, 'irrelevantReason', r)}</option>
                ))}
              </select>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={confirmFlagIrrelevant}
                  disabled={voting}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition"
                >
                  {t('evaluate.flagIrrelevantConfirm')}
                </button>
                <button
                  onClick={() => { setIrrelevantPicker(false); setIrrelevantReason('not_catalan'); }}
                  className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2 rounded-lg transition"
                >
                  {t('evaluate.cancel')}
                </button>
              </div>
            </div>
          )}

          {reportOpen && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value.slice(0, 1000))}
                maxLength={1000}
                rows={3}
                placeholder={t('evaluate.reportIssuePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
                autoFocus
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">{reportText.length}/1000</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setReportOpen(false); setReportText(''); }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    {t('evaluate.cancel')}
                  </button>
                  <button
                    onClick={submitIssueReport}
                    disabled={!reportText.trim() || reportSubmitting}
                    className="text-xs bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium transition"
                  >
                    {t('evaluate.reportIssueSubmit')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {reportSubmitted && (
            <p className="text-center text-sm text-green-600">{t('evaluate.reportIssueThanks')}</p>
          )}

          {userVoteForDimension && (
            <p className="text-center text-sm text-gray-400">
              {userCorrectedDimension
                ? t('evaluate.correctedDimension', {
                    dimension: t(`dimension.${dimension}`),
                    value: dimension === 'gender'
                      ? translateValue(t, 'gender', dimResolvedValue)
                      : translateValue(t, 'dialect', dimResolvedValue),
                  })
                : t('evaluate.alreadyVoted', {
                    emoji: userVoteForDimension.value === 1 ? '👍' : '👎',
                    dimension: t(`dimension.${dimension}`),
                  })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
