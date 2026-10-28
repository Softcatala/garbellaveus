import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ROUTES } from '../routes';

export function UnsubscribeEmailPage() {
  const { t } = useTranslation();
  const token = useSearchParams()[0].get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const unsubscribe = async () => {
    setState('busy');
    try {
      await api.unsubscribeEmail(token);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 space-y-4 text-center">
      <h2 className="text-xl font-bold text-gray-800">{t('emailUnsubscribe.title')}</h2>
      {state === 'done' ? (
        <p role="status" className="text-gray-700">{t('emailUnsubscribe.done')}</p>
      ) : (
        <>
          <p className="text-gray-600">{token ? t('emailUnsubscribe.intro') : t('emailUnsubscribe.incomplete')}</p>
          {state === 'error' && <p role="alert" className="text-red-700">{t('emailUnsubscribe.error')}</p>}
          <button
            onClick={() => void unsubscribe()}
            disabled={!token || state === 'busy'}
            className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('emailUnsubscribe.button')}
          </button>
        </>
      )}
      <p>
        <Link to={ROUTES.home} className="text-brand-600 underline">{t('emailUnsubscribe.back')}</Link>
      </p>
    </div>
  );
}
