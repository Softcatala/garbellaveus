import { useEffect, useState } from 'react';
import { FLAGS, isEnabled, setFlag, type FlagName } from '../flags';

const NAMES = Object.keys(FLAGS) as FlagName[];

// Deliberately not linked from anywhere and not translated: an internal switch
// board for the maintainers.
export function FlagsPage() {
  const [state, setState] = useState(() => Object.fromEntries(NAMES.map((n) => [n, isEnabled(n)])) as Record<FlagName, boolean>);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const toggle = (name: FlagName) => {
    setFlag(name, !state[name]);
    setState({ ...state, [name]: !state[name] });
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 space-y-4">
      <h2 className="text-xl font-bold text-gray-800">Banderes de funcionalitats</h2>
      <p className="text-sm text-gray-500">Només afecten aquest navegador.</p>
      <ul className="space-y-3">
        {NAMES.map((name) => (
          <li key={name}>
            <label className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-4">
              <input
                type="checkbox"
                checked={state[name]}
                onChange={() => toggle(name)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-500"
              />
              <span>
                <span className="font-medium text-gray-800">{FLAGS[name].label}</span>
                <span className="block text-sm text-gray-500">{FLAGS[name].description}</span>
                <code className="text-xs text-gray-400">{name}</code>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
