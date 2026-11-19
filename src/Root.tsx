import { useEffect, useState } from 'react';
import { App } from './App';
import { useBoot } from './hooks/useBoot';
import { Splash } from './ui/Splash';

/** Shows the splash until fonts + engine are really ready, then fades into the app. */
export function Root() {
  const boot = useBoot();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!boot.ready) return;
    const t = setTimeout(() => setGone(true), 320);
    return () => clearTimeout(t);
  }, [boot.ready]);
  return (
    <>
      {boot.ready && <App />}
      {!gone && <Splash boot={boot} leaving={boot.ready} />}
    </>
  );
}
