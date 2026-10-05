import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts ship with the app (it runs offline): Cinzel for titles, Barlow for UI, Barlow Condensed for numbers.
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './index.css';
import App from './App';
import { KillCounterView } from './views/KillCounterView';
import { MomentsView } from './views/MomentsView';
import { SessionBoardView } from './views/SessionBoardView';
import { GrailOverlayView, OverlayView, parseGrailOverlayOptions, parseOverlayOptions } from './views/OverlayView';
import { ValuesContext, useValuesLoader } from './lib/values';

// The app was called Hellforge before its first release: carry its saved settings over.
try {
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith('hellforge.'))) {
    const renamed = `horazon.${key.slice('hellforge.'.length)}`;
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
} catch {
  // storage unavailable
}

function WithValues({ children }: { children: ReactNode }) {
  const values = useValuesLoader();
  return <ValuesContext.Provider value={values}>{children}</ValuesContext.Provider>;
}

const path = location.pathname.replace(/\/$/, '');

const page =
  path === '/overlay' ? (
    <WithValues>
      <OverlayView options={parseOverlayOptions(location.search)} />
    </WithValues>
  ) : path === '/overlay/grail' ? (
    <WithValues>
      <GrailOverlayView options={parseGrailOverlayOptions(location.search)} />
    </WithValues>
  ) : path === '/overlay/moments' ? (
    <WithValues>
      <MomentsView />
    </WithValues>
  ) : path === '/overlay/session' ? (
    <WithValues>
      <SessionBoardView />
    </WithValues>
  ) : path === '/killcounter' ? (
    <KillCounterView />
  ) : (
    <App />
  );

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
