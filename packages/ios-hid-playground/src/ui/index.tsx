import { PlaygroundThemeProvider } from '@midscene/arm-kit-playground/shell/PlaygroundThemeProvider.tsx';
import { createRoot } from 'react-dom/client';
import { MultiDeviceApp } from './MultiDeviceApp';
import { WorkspacePrototypes } from './WorkspacePrototypes';
import { useRoute } from './routes';
import './style.css';
function App() {
  const route = useRoute();
  if (route.startsWith('prototype-'))
    return <WorkspacePrototypes variant={route.slice(-1) as 'a' | 'b' | 'c'} />;
  return <MultiDeviceApp route={route} />;
}
createRoot(document.getElementById('root')!).render(
  <PlaygroundThemeProvider>
    <App />
  </PlaygroundThemeProvider>,
);
