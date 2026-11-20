import type { ProjectInfo } from '../engine';
import { Icon } from '../ui/Icon';
import { Box, Label } from '../ui/kit';
import { plural } from '../lib/format';

export function ProjectDetails({ info }: { info: ProjectInfo }) {
  return (
    <div className="stack">
      {info.scenes.map((s, i) => (
        <Box key={i} flush title={<>{s.name || `Scene ${i + 1}`} <Label>{plural(s.frames, 'frame')}</Label></>}>
          <ul className="rows">
            {s.layers.map((l, j) => (
              <li key={j} className="row">
                <Icon name="layers" size={16} className="row-icon" />
                <span className="row-name">{l.name || '(unnamed)'}</span>
                <span className="row-meta">
                  {l.kind !== 'normal' && <Label tone="attention">{l.kind}</Label>}
                  {!l.visible && <Label>hidden</Label>}
                  <span>{plural(l.keyframes, 'keyframe')}</span>
                  {l.tweens > 0 && <span>{plural(l.tweens, 'tween')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Box>
      ))}
      {info.symbols.length > 0 && (
        <Box flush title={<>Symbols <Label>{info.symbols.length}</Label></>}>
          <ul className="rows">
            {info.symbols.map((s) => (
              <li key={s.name} className="row">
                <Icon name="file" size={16} className="row-icon" />
                <span className="row-name">{s.name}</span>
                <span className="row-meta"><Label tone="info">{s.type}</Label><span>{plural(s.frames, 'frame')}</span><span>{plural(s.layers, 'layer')}</span></span>
              </li>
            ))}
          </ul>
        </Box>
      )}
    </div>
  );
}
