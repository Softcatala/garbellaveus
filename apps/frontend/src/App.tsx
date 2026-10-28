import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ListPage } from './pages/ListPage';
import { EvaluatePage } from './pages/EvaluatePage';
import { ClipDetailPage } from './pages/ClipDetailPage';
import { AboutPage } from './pages/AboutPage';
import { GuidelinesPage } from './pages/GuidelinesPage';
import { ConfirmEmailPage } from './pages/ConfirmEmailPage';
import { UnsubscribeEmailPage } from './pages/UnsubscribeEmailPage';
import { FlagsPage } from './pages/FlagsPage';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ROUTES, LEGACY_ROUTES } from './routes';

const USERNAME_KEY = 'catvoice:username';

function getOrCreateUsername(): string {
  const existing = localStorage.getItem(USERNAME_KEY);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  localStorage.setItem(USERNAME_KEY, generated);
  return generated;
}

function App() {
  const [username] = useState<string>(getOrCreateUsername);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <div className="flex-1">
          <Routes>
            <Route path={ROUTES.home} element={<HomePage />} />
            <Route path={ROUTES.list} element={<ListPage />} />
            <Route path={ROUTES.evaluate} element={<EvaluatePage username={username} />} />
            <Route path={ROUTES.clip(':id')} element={<ClipDetailPage />} />
            <Route path={ROUTES.about} element={<AboutPage />} />
            <Route path={ROUTES.guidelines} element={<GuidelinesPage />} />
            <Route path={ROUTES.confirmEmail} element={<ConfirmEmailPage />} />
            <Route path={ROUTES.unsubscribeEmail} element={<UnsubscribeEmailPage />} />
            <Route path={ROUTES.flags} element={<FlagsPage />} />
            {/* Legacy English paths, kept for backwards compatibility */}
            <Route path={LEGACY_ROUTES.list} element={<ListPage />} />
            <Route path={LEGACY_ROUTES.evaluate} element={<EvaluatePage username={username} />} />
            <Route path={LEGACY_ROUTES.about} element={<AboutPage />} />
            <Route path={LEGACY_ROUTES.guidelines} element={<GuidelinesPage />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

export default App;
