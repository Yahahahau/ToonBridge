import { Icon } from '../ui/Icon';
import { Box, Label, LinkButton } from '../ui/kit';
import { PageHead } from '../ui/Shell';
import { REPO_URL } from '../links';

export function AboutPage() {
  return (
    <>
      <PageHead crumbs={[{ label: 'Workspace', href: '#/convert' }, { label: 'About' }]} title="About ToonBridge"
        description="An independent tool that converts Adobe Animate projects into ToonSquid projects, in your browser."
        actions={<LinkButton icon="github" href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</LinkButton>} />
      <div className="about-grid">
        <div className="stack">
          <Box title="How it works">
            <ol className="numbered">
              <li><strong>Import</strong> a ZIP of an XFL project, or a ZIP-based <code>.fla</code> (Animate CS5 and newer).</li>
              <li><strong>Convert.</strong> Shapes, symbols, keyframes, tweens, blend modes and filters are mapped to ToonSquid. The result is read back and checked before you can download it.</li>
              <li><strong>Download</strong> the <code>.tsproj</code> and open it in ToonSquid. The report lists anything approximated or left out.</li>
            </ol>
          </Box>
          <Box title="Reliability">
            <p>ToonSquid's file format isn't public, so everything is derived from real files made by the app. Converted files pass structural checks, but are still <Label tone="attention">Experimental</Label> until confirmed in the app.</p>
            <p className="muted">Older binary <code>.fla</code> files (CS4 and earlier) aren't supported yet. Open them in Animate and save as XFL first.</p>
          </Box>
        </div>
        <aside className="stack">
          <Box title="Privacy"><p><Icon name="lock" size={14} /> Nothing is uploaded. Conversion runs entirely on this device.</p></Box>
          <Box title="Links">
            <ul className="link-list">
              <li><a href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer"><Icon name="report" size={16} />Documentation</a></li>
              <li><a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer"><Icon name="alert" size={16} />Report a problem</a></li>
              <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer"><Icon name="github" size={16} />Repository</a></li>
            </ul>
          </Box>
          <p className="muted small">ToonBridge is unofficial. ToonSquid and Adobe Animate belong to their respective owners.</p>
        </aside>
      </div>
    </>
  );
}
