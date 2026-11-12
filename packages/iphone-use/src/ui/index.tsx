import { PlaygroundThemeProvider } from '@midscene/device-manager-ui/shell/PlaygroundThemeProvider.tsx';
import { createRoot } from 'react-dom/client';
import { MultiDeviceApp } from './MultiDeviceApp';
import { useRoute } from './routes';
import './style.css';

function App() {
  return <MultiDeviceApp route={useRoute()} />;
}

createRoot(document.getElementById('root')!).render(
  <PlaygroundThemeProvider>
    <App />
  </PlaygroundThemeProvider>,
);
