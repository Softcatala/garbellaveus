import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Example { audio: string; wrong: string; right: string }
interface Rule { title: string; text: string; why: string; examples: Example[] }

const SECTION_TITLE = 'text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2';

export function GuidelinesPage() {
  const { t } = useTranslation();
  const rules = t('guidelines.rules', { returnObjects: true }) as Rule[];
  const scoring = t('guidelines.scoring', { returnObjects: true }) as string[];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-end mb-6">
        <Link
          to="/evaluate"
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition"
        >
          {t('guidelines.back')}
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-800 mb-4">{t('guidelines.pageTitle')}</h1>
      <p className="text-gray-700 leading-relaxed mb-8">{t('guidelines.pageIntro')}</p>

      <div className="space-y-8 text-gray-700 leading-relaxed">
        <section>
          <h2 className={SECTION_TITLE}>{t('guidelines.rulesTitle')}</h2>
          <ol className="space-y-6 mt-3">
            {rules.map((rule, i) => (
              <li key={rule.title} className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-800 mb-2">{i + 1}. {rule.title}</h3>
                <p>{rule.text}</p>
                <p className="mt-2 text-sm text-gray-500">
                  <strong className="text-gray-600">{t('guidelines.whyLabel')}</strong> {rule.why}
                </p>
                {rule.examples.map((ex) => (
                  <dl key={ex.audio} className="mt-3 text-sm rounded-lg bg-gray-50 p-3 space-y-1.5">
                    <div>
                      <dt className="inline text-gray-400">🔊 {t('guidelines.audioLabel')}: </dt>
                      <dd className="inline italic text-gray-700">«{ex.audio}»</dd>
                    </div>
                    {ex.wrong && (
                      <div>
                        <dt className="inline text-red-600">👎 {t('guidelines.wrongLabel')}: </dt>
                        <dd className="inline text-gray-700">{ex.wrong}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline text-green-700">👍 {t('guidelines.rightLabel')}: </dt>
                      <dd className="inline text-gray-700">{ex.right}</dd>
                    </div>
                  </dl>
                ))}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className={SECTION_TITLE}>{t('guidelines.scoringTitle')}</h2>
          <ul className="list-disc list-inside space-y-2">
            {scoring.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </section>

        <section>
          <h2 className={SECTION_TITLE}>{t('guidelines.imperfectTitle')}</h2>
          <p>{t('guidelines.imperfectText')}</p>
        </section>
      </div>
    </div>
  );
}
