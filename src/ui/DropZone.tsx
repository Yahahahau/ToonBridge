import { useRef, useState, type DragEvent } from 'react';
import { Icon } from './Icon';
import { formatBytes } from '../lib/format';

export interface PickedFile { name: string; size: number; kind: string; }
const OK_EXT = /\.(zip|xfl|fla)$/i;

export function kindOf(name: string): string {
  if (/\.fla$/i.test(name)) return 'FLA (ZIP-based)';
  return 'XFL project (ZIP)';
}

interface Props {
  file: PickedFile | null;
  busy: boolean;
  error: string | null;
  onFile: (f: File) => void;
  onReject: (msg: string) => void;
  onRemove: () => void;
}

export function DropZone({ file, busy, error, onFile, onReject, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const open = () => { if (!busy) input.current?.click(); };

  const take = (files: FileList | null, items?: DataTransferItemList) => {
    if (busy) return;
    if (items) {
      for (const it of Array.from(items)) {
        const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.();
        if (entry?.isDirectory) { onReject('Folders can\'t be imported directly. Zip your XFL folder first, then drop the ZIP here.'); return; }
      }
    }
    const f = files?.[0];
    if (!f) return;
    if (!OK_EXT.test(f.name)) { onReject(`"${f.name}" isn't a supported file. Import a ZIP of an XFL project, or a ZIP-based .fla.`); return; }
    onFile(f);
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer.files, e.dataTransfer.items); };
  const dragProps = {
    onDragEnter: (e: DragEvent) => { e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop,
  };

  const hidden = (
    <input ref={input} type="file" accept=".zip,.xfl,.fla" hidden aria-label="Choose a project file"
      onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
  );

  if (file) {
    return (
      <section className={`filecard panel ${over ? 'over' : ''}`} aria-label="Selected file" {...dragProps}>
        {hidden}
        <span className="file-ico"><Icon name="file" size={26} /></span>
        <div className="file-meta">
          <b className="file-name" title={file.name}>{file.name}</b>
          <small>{file.kind} · {formatBytes(file.size)}</small>
        </div>
        <div className="file-actions">
          <button className="btn ghost" onClick={open} disabled={busy}><Icon name="replace" /><span>Replace</span></button>
          <button className="btn ghost" onClick={onRemove} disabled={busy} aria-label="Remove file"><Icon name="x" /><span>Remove</span></button>
        </div>
        {over && <div className="drop-hint">Drop to replace</div>}
        {error && <p className="msg err" role="alert"><Icon name="alert" /> {error}</p>}
      </section>
    );
  }

  return (
    <section className="panel dropwrap" aria-label="Import">
      {hidden}
      <div
        className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0} aria-label="Import a project file. Drop it here or press Enter to browse."
        onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }} {...dragProps}
      >
        <span className="drop-ico"><Icon name="upload" size={30} /></span>
        <strong>{over ? 'Drop it here!' : 'Drop your project here'}</strong>
        <span className="drop-sub">or <u>browse files</u></span>
        <span className="chips"><i>XFL (.zip)</i><i>.fla (ZIP-based)</i></span>
      </div>
      {error && <p className="msg err" role="alert"><Icon name="alert" /> {error}</p>}
    </section>
  );
}
