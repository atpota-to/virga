import { PageHeader } from '../../shell/bits.jsx';
import { POSTING_PAGE_BY_KEY } from '../routes.js';
import AccessBadge from './AccessBadge.jsx';

/**
 * The header every posting page shares: Posting in the crumbs (except on
 * the overview), the page's title and line, what it touches, and the page's
 * own controls after the badges.
 */
export default function PostingHeader({ page: key, title = null, sub = null, actions = null, children = null }) {
  const page = POSTING_PAGE_BY_KEY[key] || POSTING_PAGE_BY_KEY.hub;
  return (
    <PageHeader
      crumbs={page.key === 'hub' ? null : [{ label: 'Posting', to: '/posting' }]}
      title={title || page.title}
      sub={sub ?? page.desc}
      actions={
        <>
          {page.access.map((kind) => (
            <AccessBadge key={kind} kind={kind} />
          ))}
          {actions}
        </>
      }
    >
      {children}
    </PageHeader>
  );
}
