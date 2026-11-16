import { PageHeader } from '../../shell/bits.jsx';
import { POSTING_PAGE_BY_KEY } from '../routes.js';

/**
 * The header every posting page shares: Posting in the crumbs (except on
 * the overview), the page's title and line, and what it touches under that
 * as one quiet line. `crumbs` replaces the usual ones (a page reached from
 * another, as the weekly schedule is from Scheduled posts); `showAccess`
 * is false where the page itself isn't shown (NeedsBackend), since there
 * is nothing there yet to touch anything. `actions` are drawn only when a
 * caller gives them.
 */
export default function PostingHeader({ page: key, title = null, sub = null, crumbs, showAccess = true, actions = null, children = null }) {
  const page = POSTING_PAGE_BY_KEY[key] || POSTING_PAGE_BY_KEY.hub;
  return (
    <PageHeader
      crumbs={crumbs !== undefined ? crumbs : page.key === 'hub' ? null : [{ label: 'Posting', to: '/posting' }]}
      title={title || page.title}
      sub={sub ?? page.desc}
      access={showAccess ? page.access : null}
      actions={actions}
    >
      {children}
    </PageHeader>
  );
}
