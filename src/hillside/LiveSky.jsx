// The live sky: the 3D scene from Virga's first version (scene.js), drawn in
// the sky at the top of the page instead of the flat wash. Only its sky and
// its clouds show: the scene is set tall enough that the hill sits below
// the fold of this band, and the band fades into the page as the wash does.
// It is the page's sky, so it shows whichever of the four the page is
// under, and it scrolls away with the page.
//
// Off unless Settings › Appearance (or five taps on the mark) turns it on,
// and never in high contrast, where there is no sky at all.

import Hillside from './Hillside.jsx';
import { usePreferences } from '../lib/preferences.jsx';

export default function LiveSky() {
  const { effectiveSky, effectiveContrast } = usePreferences();
  if (effectiveContrast === 'high') return null;
  return (
    <div className="live-sky" aria-hidden="true">
      <div className="live-sky-scene">
        <Hillside phase={effectiveSky} depth={0.55} soft={false} />
      </div>
    </div>
  );
}
