import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const OPEN_STORAGE_KEY = 'garbellaveus:guidelinesOpen';

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_STORAGE_KEY) !== 'false'; } catch { return true; }
}

export function TranscriptionGuidelines() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(readOpen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_STORAGE_KEY, String(next)); } catch { /* storage unavailable */ }
  };

  const rules = t('guidelines.short', { returnObjects: true }) as string[];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t('guidelines.title')}
        </span>
        <span className="text-xs text-gray-400 hover:text-gray-600">
          {open ? t('guidelines.hide') : t('guidelines.show')} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="mt-3">
          <ul className="text-xs text-gray-600 list-disc list-inside space-y-1.5">
            {rules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
          <Link to="/guidelines" className="inline-block mt-3 text-xs text-brand-600 hover:underline">
            {t('guidelines.moreLink')} →
          </Link>
        </div>
      )}
    </div>
  );
}
