// Settings › Posting, per account: the composer's defaults, the weekly
// queue, the default timer and the post adviser. The last three need Virga's
// server, so an account without a long session sees why instead. With more
// than one account signed in, the reader picks whose settings these are.

import { useId, useState } from 'react';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { accountName } from '../session/accounts.js';
import ComposerDefaults from './ui/ComposerDefaults.jsx';
import QueueSettings from './ui/QueueSettings.jsx';
import LifespanDefaults from './ui/LifespanDefaults.jsx';
import AdviserSettings from './ui/AdviserSettings.jsx';
import NeedsBackend from './ui/NeedsBackend.jsx';
import { SettingsCard, SettingsRow } from './ui/SettingsParts.jsx';
import './posting.css';

export default function PostingSettingsSection() {
  const { did: activeDid, accounts, capabilitiesFor } = useAtprotoSession();
  const [chosen, setChosen] = useState(null);
  const pickId = useId();
  const choices = accounts.filter((a) => a.status !== 'needsSignIn' || a.did === activeDid);
  const did = choices.some((a) => a.did === chosen) ? chosen : activeDid;
  const server = Boolean(did && capabilitiesFor(did).canSchedule);

  return (
    <>
      {choices.length > 1 && (
        <SettingsCard title="Whose settings" sub="Each account keeps its own posting settings, in this browser.">
          <SettingsRow label="Account" htmlFor={pickId}>
            <select id={pickId} className="input" value={did || ''} onChange={(e) => setChosen(e.target.value)}>
              {choices.map((a) => (
                <option key={a.did} value={a.did}>
                  {accountName(a)}
                  {a.handle && a.displayName ? ` (@${a.handle})` : ''}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsCard>
      )}
      <ComposerDefaults key={`defaults:${did}`} did={did} />
      {server ? (
        <>
          <QueueSettings key={`queue:${did}`} did={did} />
          <LifespanDefaults key={`lifespan:${did}`} did={did} />
          <AdviserSettings key={`adviser:${did}`} did={did} />
        </>
      ) : (
        <NeedsBackend did={did} />
      )}
    </>
  );
}
