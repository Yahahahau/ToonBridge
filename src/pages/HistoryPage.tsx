import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { Banner, Box, Button, EmptyState, Label, LinkButton } from '../ui/kit';
import { Dialog } from '../ui/Dialog';
import { PageHead } from '../ui/Shell';
import { formatBytes } from '../lib/format';
import type { HistoryApi } from '../state/history';

export function HistoryPage({ h, keep }: { h: HistoryApi; keep: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <PageHead crumbs={[{ label: 'Workspace', href: '#/convert' }, { label: 'Conversion history' }]} title="Conversion history"
        description="Conversions made in this browser. Files you convert during this visit can be downloaded again until you close the tab."
        actions={h.items.length > 0 && <Button icon="trash" onClick={() => setConfirm(true)}>Clear history</Button>} />
      {confirm && (
        <Dialog title="Clear conversion history?" onClose={() => setConfirm(false)}
          footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" icon="trash" onClick={() => { h.clear(); setConfirm(false); }}>Clear {h.items.length} entries</Button></>}>
          <p>This removes the list from this browser. Files you already downloaded are not affected.</p>
        </Dialog>
      )}
      {!keep && <Banner tone="info" actions={<a className="link-sm" href="#/settings">Settings</a>}>History is not being saved. New conversions only appear here until you reload.</Banner>}
      <Box flush title={<>Conversions <span className="counter">{h.items.length}</span></>}>
        {h.items.length === 0 ? (
          <EmptyState icon="history" title="No conversions yet" action={<LinkButton variant="primary" icon="bolt" href="#/convert">Convert a project</LinkButton>}>Your converted projects will be listed here.</EmptyState>
        ) : (
          <ul className="rows">
            {h.items.map((e) => {
              const url = h.fileUrl(e.id);
              return (
                <li key={e.id} className="row row-history">
                  <Icon name="file" size={16} className="row-icon" />
                  <div className="row-stack">
                    <span className="row-title"><strong>{e.output}</strong> <Label tone={e.ok ? 'success' : 'danger'}>{e.ok ? 'Passed' : 'Failed'}</Label>{e.lost > 0 && <Label tone="danger">{e.lost} lost</Label>}{e.approx > 0 && <Label tone="attention">{e.approx} approximated</Label>}</span>
                    <span className="muted small">from {e.source} · {new Date(e.at).toLocaleString()} · {formatBytes(e.bytes)} · {e.canvas} @ {e.fps} fps · skew: {e.skewMode}{e.seams ? ' · seam hiding' : ''}</span>
                  </div>
                  <div className="row-actions">
                    {url ? <LinkButton size="sm" icon="download" href={url} download={e.output}>Download</LinkButton>
                      : <span className="muted small" data-tip="Files are kept only for the visit in which they were made" data-tip-side="left">Not available</span>}
                    <Button size="sm" variant="invisible" icon="trash" aria-label={`Remove ${e.output} from history`} onClick={() => h.remove(e.id)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Box>
    </>
  );
}
