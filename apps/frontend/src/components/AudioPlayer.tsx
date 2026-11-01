import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEnabled } from '../flags';

interface Props {
  src: string;
  autoPlay?: boolean;
  // Called when the audio starts or stops failing to load, so the page can
  // hold back anything that assumes the evaluator heard the clip.
  onFailedChange?: (failed: boolean) => void;
}

// Not decodable audio: the element raises a real error event, like a failed fetch would.
const SIMULATED_ERROR_SRC = 'data:audio/wav;base64,AAAA';

export function AudioPlayer({ src, autoPlay, onFailedChange }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const onFailedChangeRef = useRef(onFailedChange);
  onFailedChangeRef.current = onFailedChange;

  const effectiveSrc = isEnabled('simulateAudioError') ? SIMULATED_ERROR_SRC : src;

  const update = (next: boolean) => {
    setFailed(next);
    onFailedChangeRef.current?.(next);
  };

  useEffect(() => {
    update(false);
    if (ref.current && autoPlay) {
      ref.current.load();
      ref.current.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSrc, autoPlay]);

  const retry = () => {
    update(false);
    if (!ref.current) return;
    ref.current.load();
    ref.current.play().catch(() => {});
  };

  return (
    <>
      <audio
        ref={ref}
        controls
        className="w-full rounded-lg"
        src={effectiveSrc}
        preload="metadata"
        onError={() => update(true)}
        onLoadedMetadata={() => update(false)}
      >
        {t('audioPlayer.fallback')}
      </audio>
      {failed && (
        <div role="alert" className="text-sm text-amber-700 text-center mt-2 space-y-2">
          <p>{t('audioPlayer.error')}</p>
          <button
            type="button"
            onClick={retry}
            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 rounded-lg font-medium transition"
          >
            {t('audioPlayer.retry')}
          </button>
        </div>
      )}
    </>
  );
}
