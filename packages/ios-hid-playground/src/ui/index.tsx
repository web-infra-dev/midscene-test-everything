import { PlaygroundThemeProvider } from '@midscene/arm-kit-playground/shell/PlaygroundThemeProvider.tsx';
import { createRoot } from 'react-dom/client';
import { MultiDeviceApp } from './MultiDeviceApp';
import { useRoute } from './routes';
import './style.css';
function App() {
  const route = useRoute();
  return <MultiDeviceApp route={route} />;
}
createRoot(document.getElementById('root')!).render(
  <PlaygroundThemeProvider>
    <App />
  </PlaygroundThemeProvider>,
);
