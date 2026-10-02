import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ca from './locales/ca.json';

// GarbellaVeus is Catalan-only. The platform is i18n-ready for other
// communities: set this to null to re-enable automatic language detection and
// the footer language selector.
export const FORCED_LANGUAGE: string | null = 'ca';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: FORCED_LANGUAGE ?? undefined,
    resources: { en: { translation: en }, ca: { translation: ca } },
    fallbackLng: 'ca',
    supportedLngs: ['en', 'ca'],
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'catvoice:language',
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
