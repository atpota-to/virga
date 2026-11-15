// The sky for a setting (phase.js), kept up to date. When it follows the
// clock the hour is looked at again each minute, and the page is only drawn
// again when that changes the sky.

import { useEffect, useState } from 'react';
import { hourOf, phaseAtHour, skyPhase } from './phase.js';

export function useSkyPhase({ skyTime, theme, built }) {
  const [hour, setHour] = useState(() => hourOf());

  useEffect(() => {
    if (skyTime !== 'clock') return undefined;
    const look = () => {
      const now = hourOf();
      setHour((was) => (phaseAtHour(was) === phaseAtHour(now) ? was : now));
    };
    look();
    const timer = window.setInterval(look, 60_000);
    return () => window.clearInterval(timer);
  }, [skyTime]);

  return skyPhase({ skyTime, theme, built, hour });
}
