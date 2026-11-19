import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { REPO_URL } from '../links';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About ToonBridge" onClose={onClose}>
      <p>ToonBridge turns an Adobe Animate project (XFL) into a ToonSquid <code>.tsproj</code> file, right in your browser.</p>
      <ol className="steps">
        <li><b>Import</b> a ZIP of your XFL project, or a ZIP-based <code>.fla</code>.</li>
        <li><b>Convert</b> it. Every step is real and the result is checked before you can download it.</li>
        <li><b>Download</b> the <code>.tsproj</code> and open it in ToonSquid.</li>
      </ol>
      <p className="note-row"><Icon name="lock" /> <span>Your files stay on your device. Nothing is uploaded.</span></p>
      <p className="note-row"><Icon name="info" /> <span>Still experimental: converted files pass structural checks, but haven't been confirmed to open in the ToonSquid app yet. The conversion report lists everything that was approximated or left out.</span></p>
      <p><a className="btn primary" href={REPO_URL} target="_blank" rel="noopener noreferrer"><Icon name="github" /><span>View on GitHub</span></a></p>
    </Dialog>
  );
}
