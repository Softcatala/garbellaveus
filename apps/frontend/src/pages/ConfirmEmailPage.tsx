import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ROUTES } from '../routes';

// The emailed link only opens this page; the click on the button is what
// confirms, so mail scanners that prefetch links cannot subscribe anyone.
export function ConfirmEmailPage() {
  const { t } = useTranslation();
  const token = useSearchParams()[0].get('token') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const confirm = async () => {
    setState('busy');
    try {
      await api.confirmEmail(token);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 space-y-4 text-center">
      <h2 className="text-xl font-bold text-gray-800">{t('emailConfirm.title')}</h2>
      {state === 'done' ? (
        <p role="status" className="text-gray-700">{t('emailConfirm.done')}</p>
      ) : (
        <>
          <p className="text-gray-600">{token ? t('emailConfirm.intro') : t('emailConfirm.incomplete')}</p>
          {state === 'error' && <p role="alert" className="text-red-700">{t('emailConfirm.error')}</p>}
          <button
            onClick={() => void confirm()}
            disabled={!token || state === 'busy'}
            className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {t('emailConfirm.button')}
          </button>
        </>
      )}
      <p>
        <Link to={ROUTES.evaluate} className="text-brand-600 underline">{t('emailConfirm.back')}</Link>
      </p>
    </div>
  );
}
