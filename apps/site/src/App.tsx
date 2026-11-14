import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Navbar } from './components/Navbar';
import { ProtocolSection } from './components/ProtocolSection';
import { QuickStartSection } from './components/QuickStartSection';
import { ShowcaseStage } from './components/ShowcaseStage';
import { I18nProvider } from './i18n/translations';

export function App() {
  return (
    <I18nProvider>
      <Navbar />
      <main className="shell">
        <Hero />
        <ShowcaseStage />
        <ProtocolSection />
        <QuickStartSection />
        <Footer />
      </main>
    </I18nProvider>
  );
}

export default App;
