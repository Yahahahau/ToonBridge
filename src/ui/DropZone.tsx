import { useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon';
import { Button } from './kit';
import { formatBytes } from '../lib/format';
import type { PickedFile } from '../state/converter';

const OK_EXT = /\.(zip|xfl|fla)$/i;

interface Props { file: PickedFile | null; busy: boolean; error: string | null; onFile: (f: File) => void; onReject: (msg: string) => void; onRemove: () => void; }

/** Drag-and-drop + native picker. Rejects folders and unsupported extensions with a clear message. */
export function DropZone({ file, busy, error, onFile, onReject, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const open = () => { if (!busy) input.current?.click(); };

  const take = (files: FileList | null, items?: DataTransferItemList) => {
    if (busy) return;
    if (items) for (const it of Array.from(items)) {
      const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
      if (entry?.isDirectory) { onReject('Folders can\'t be imported directly. Zip your XFL folder first, then drop the ZIP here.'); return; }
    }
    const f = files?.[0];
    if (!f) return;
    if (!OK_EXT.test(f.name)) { onReject(`"${f.name}" isn't a supported file. Import a ZIP of an XFL project, or a ZIP-based .fla.`); return; }
    onFile(f);
  };
  const drag = {
    onDragEnter: (e: DragEvent) => { e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer.files, e.dataTransfer.items); },
  };
  const hidden = <input ref={input} type="file" accept=".zip,.xfl,.fla" hidden aria-label="Choose a project file" onChange={(e) => { take(e.target.files); e.target.value = ''; }} />;

  if (file) {
    return (
      <div className={`filerow-wrap ${over ? 'over' : ''}`} {...drag}>
        {hidden}
        <div className="filerow">
          <span className="filerow-icon"><Icon name="file" size={20} /></span>
          <div className="filerow-main">
            <strong title={file.name}>{file.name}</strong>
            <span className="muted">{file.kind} · {formatBytes(file.size)}</span>
          </div>
          <div className="filerow-actions">
            <Button size="sm" icon="replace" onClick={open} disabled={busy}>Replace</Button>
            <Button size="sm" variant="invisible" icon="x" onClick={onRemove} disabled={busy} aria-label="Remove file">Remove</Button>
          </div>
        </div>
        {over && <div className="drop-hint">Drop to replace</div>}
      </div>
    );
  }
  return (
    <div>
      {hidden}
      <div className={`drop ${over ? 'over' : ''} ${error ? 'has-error' : ''}`} role="button" tabIndex={0}
        aria-label="Import a project file. Drop it here or press Enter to browse." aria-describedby="drop-formats"
        onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} {...drag}>
        <span className="drop-icon"><Icon name="upload" size={26} /></span>
        <strong>{over ? 'Drop it here' : 'Drag your Animate project here'}</strong>
        <span className="muted">Files stay on this device</span>
        <span className="btn btn-primary btn-md drop-browse" aria-hidden="true"><Icon name="file" size={16} />Browse files</span>
        <span id="drop-formats" className="drop-formats"><span className="label label-neutral">XFL in a .zip</span><span className="label label-neutral">.fla (CS5 and newer)</span></span>
      </div>
    </div>
  );
}
