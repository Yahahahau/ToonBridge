import { useCallback, useState } from 'react';
import { useConverter } from './state/converter';
import { useHistory } from './state/history';
import { useRoute } from './state/route';
import { useSettings } from './state/settings';
import { useTheme } from './state/theme';
import { Shell } from './ui/Shell';
import { ConvertPage } from './pages/ConvertPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';

export function App() {
  const [route, go] = useRoute();
  const [theme, setTheme] = useTheme();
  const [settings, setSettings, resetSettings] = useSettings();
  const history = useHistory();
  const [navOpen, setNavOpen] = useState(false);

  const onDone = useCallback<Parameters<typeof useConverter>[0]>((out, url, opts) => {
    const d = out.report.diagnostics;
    history.add({
      id: `${Date.now()}-${out.report.output.sha1.slice(0, 8)}`, at: new Date().toISOString(), source: out.report.source.fileName, output: out.fileName,
      bytes: out.bytes.length, sha1: out.report.output.sha1, ok: out.report.ok, lost: d.filter((x) => x.severity === 'loss').length,
      approx: d.filter((x) => x.severity === 'approx').length, warnings: d.filter((x) => x.severity === 'warn').length,
      skewMode: opts.skewMode, seams: opts.seamUnderlay, canvas: `${out.report.project.width}×${out.report.project.height}`, fps: out.report.project.fps,
    }, url, settings.keepHistory);
  }, [history, settings.keepHistory]);
  const c = useConverter(onDone);

  return (
    <Shell route={route} go={go} theme={theme} setTheme={setTheme} navOpen={navOpen} setNavOpen={setNavOpen} historyCount={history.items.length} busy={c.phase === 'converting'}>
      <div className="page" key={route}>
        {route === 'convert' && <ConvertPage c={c} opts={settings} setOpts={setSettings} />}
        {route === 'history' && <HistoryPage h={history} keep={settings.keepHistory} />}
        {route === 'settings' && <SettingsPage s={settings} set={setSettings} reset={resetSettings} theme={theme} setTheme={setTheme} clearHistory={history.clear} />}
        {route === 'about' && <AboutPage />}
      </div>
    </Shell>
  );
}
