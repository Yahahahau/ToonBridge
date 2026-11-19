import { Mascot } from './Mascot';
import { MASCOT_SOURCE } from './config';

/**
 * The reserved mascot area in the conversion panel. It renders nothing (and takes no space) until assets are configured
 * and an animation is chosen by the caller. No animation names or triggers are defined here on purpose.
 */
export function MascotSlot({ animation }: { animation?: string }) {
  if (!MASCOT_SOURCE) return null;
  return <div className="mascot-slot" aria-hidden="true"><Mascot source={MASCOT_SOURCE} animation={animation} height={140} /></div>;
}
