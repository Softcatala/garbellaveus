import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { dismissForever, snooze } from '../emailPrompt';

interface Props {
  username: string;
  validations: number;
  onDone: () => void;
}

export function EmailPrompt({ username, validations, onDone }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.requestEmailConfirmation(email.trim(), username);
      // If they never open the link, ask again later rather than straight away.
      snooze(validations);
      setSent(true);
    } catch (err) {
      setError(String(err).startsWith('Error: 429') ? t('emailPrompt.tooMany') : t('emailPrompt.error'));
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    snooze(validations);
    onDone();
  };

  const never = () => {
    dismissForever();
    onDone();
  };

  if (sent) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-bold text-gray-800 mb-2">{t('emailPrompt.sentTitle')}</h2>
        <p className="text-gray-600 mb-6">{t('emailPrompt.sentBody', { email })}</p>
        <button onClick={onDone} className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">
          {t('emailPrompt.continue')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <h2 className="text-xl font-bold text-gray-800 mb-2 text-center">{t('emailPrompt.title')}</h2>
      <p className="text-gray-600 mb-6 text-center">{t('emailPrompt.intro', { count: validations })}</p>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">{t('emailPrompt.emailLabel')}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <p className="text-sm text-gray-500">{t('emailPrompt.frequency')}</p>
        <p className="text-sm text-gray-500">
          {t('emailPrompt.privacy')}{' '}
          <a
            href="https://www.softcatala.org/avis-legal/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-700"
          >
            {t('emailPrompt.legalLink')}
          </a>
          .
        </p>
        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
          />
          <span>{t('emailPrompt.consent')}</span>
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !consent || !email}
          className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {t('emailPrompt.submit')}
        </button>
      </form>
      <div className="mt-6 flex justify-center gap-6 text-sm">
        <button onClick={notNow} className="text-gray-600 underline hover:text-gray-800">
          {t('emailPrompt.notNow')}
        </button>
        <button onClick={never} className="text-gray-500 underline hover:text-gray-700">
          {t('emailPrompt.never')}
        </button>
      </div>
    </div>
  );
}
