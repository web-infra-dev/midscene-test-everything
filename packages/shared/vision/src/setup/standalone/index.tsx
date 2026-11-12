import '../../ui/screen-setup.less';
import { createRoot } from 'react-dom/client';
import { CameraSetup } from '../../ui/CameraSetup.js';
import '../../ui/styles.css';
createRoot(document.getElementById('root')!).render(
  <CameraSetup baseUrl={location.pathname.replace(/\/$/, '')} />,
);
