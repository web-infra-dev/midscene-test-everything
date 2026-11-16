import { useEffect } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Navbar } from './components/Navbar';
import { QuickStartSection } from './components/QuickStartSection';
import { ShowcaseStage } from './components/ShowcaseStage';
import { I18nProvider } from './i18n/translations';
import { ApiPage } from './pages/ApiPage';
import { CustomArmPage } from './pages/CustomArmPage';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return null;
}

function HomePage() {
  return (
    <>
      <Hero />
      <ShowcaseStage />
      <QuickStartSection />
    </>
  );
}

export function App() {
  return (
    <I18nProvider>
      <HashRouter>
        <ScrollToTop />
        <Navbar />
        <main className="shell">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/api" element={<ApiPage />} />
            <Route path="/custom-arm" element={<CustomArmPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Footer />
        </main>
      </HashRouter>
    </I18nProvider>
  );
}

export default App;
