// The posting section: the page the address names, from POSTING_PAGES. A
// page that runs on Virga's server shows NeedsBackend instead for an
// account without a long session. None of this waits for the archive (the
// shell renders it before the archive opens); the Posted page waits for it
// by itself.

import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { POSTING_PAGE_BY_KEY } from './routes.js';
import NeedsBackend from './ui/NeedsBackend.jsx';
import PostingHeader from './ui/PostingHeader.jsx';
import HubPage from './pages/HubPage.jsx';
import DraftsPage from './pages/DraftsPage.jsx';
import ScheduledPage from './pages/ScheduledPage.jsx';
import WeeklySchedulePage from './pages/WeeklySchedulePage.jsx';
import TimersPage from './pages/TimersPage.jsx';
import PostedPage from './pages/PostedPage.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import './posting.css';

const PAGES = {
  hub: HubPage,
  drafts: DraftsPage,
  scheduled: ScheduledPage,
  schedule: WeeklySchedulePage,
  timers: TimersPage,
  posted: PostedPage,
  templates: TemplatesPage,
  library: LibraryPage,
};

/** `pageKey` is a POSTING_PAGES key; `id` the part of the address after it. */
export default function PostingPage({ pageKey, id = null, did }) {
  const { capabilitiesFor } = useAtprotoSession();
  const page = POSTING_PAGE_BY_KEY[pageKey];
  const Page = PAGES[pageKey];
  if (!page || !Page) return null;
  if (page.needsBackend && !capabilitiesFor(did).canSchedule) {
    return (
      <>
        <PostingHeader page={page.key} />
        <div className="page-body">
          <NeedsBackend did={did} />
        </div>
      </>
    );
  }
  // Keyed by account, so a switch never shows one account's page state
  // under another's name.
  return <Page key={did} did={did} id={id} />;
}
