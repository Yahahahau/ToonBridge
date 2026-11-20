import type { SkewMode } from '../engine';
import { Box, Button } from '../ui/kit';
import { PageHead } from '../ui/Shell';
import type { Settings } from '../state/settings';
import type { ThemePref } from '../state/theme';

export function SettingsPage({ s, set, reset, theme, setTheme, clearHistory }: { s: Settings; set: (p: Partial<Settings>) => void; reset: () => void; theme: ThemePref; setTheme: (t: ThemePref) => void; clearHistory: () => void }) {
  return (
    <>
      <PageHead crumbs={[{ label: 'Workspace', href: '#/convert' }, { label: 'Settings' }]} title="Settings" description="Saved in this browser and applied automatically." />
      <div className="stack narrow">
        <Box title="Appearance">
          <fieldset className="field"><legend>Theme</legend>
            <div className="seg-control" role="radiogroup" aria-label="Theme">
              {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
                <label key={t} className={theme === t ? 'on' : ''}><input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />{t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}</label>
              ))}
            </div>
          </fieldset>
        </Box>
        <Box title="Conversion defaults">
          <label className="field-row" htmlFor="skew-default">
            <span><strong>Skewed artwork</strong><span className="muted">How skew in Animate transforms is written.</span></span>
            <select id="skew-default" className="select" value={s.skewMode} onChange={(e) => set({ skewMode: e.target.value as SkewMode })}>
              <option value="bake">Bake into paths (recommended)</option>
              <option value="perspective">Perspective effect (experimental)</option>
              <option value="off">Ignore skew</option>
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.seamUnderlay} onChange={(e) => set({ seamUnderlay: e.target.checked })} />
            <span><strong>Hide hairline seams</strong><span className="muted">Adds thin underlays below fills. Files get a little bigger.</span></span>
          </label>
        </Box>
        <Box title="History and privacy">
          <label className="check-row">
            <input type="checkbox" checked={s.keepHistory} onChange={(e) => set({ keepHistory: e.target.checked })} />
            <span><strong>Keep a conversion history</strong><span className="muted">Only names, dates and results are saved in this browser, never your files.</span></span>
          </label>
          <div className="btn-row"><Button icon="trash" onClick={clearHistory}>Clear history</Button><Button variant="invisible" onClick={reset}>Restore default settings</Button></div>
        </Box>
      </div>
    </>
  );
}
