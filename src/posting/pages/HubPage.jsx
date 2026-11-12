import { SquarePen } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { Link } from '../../lib/router.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import { POSTING_PAGES } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';

/** The posting overview. A placeholder that lists the pages until it is built. */
export default function HubPage({ did }) {
  const composer = useComposer();
  return (
    <>
      <PostingHeader
        page="hub"
        actions={
          <Button onClick={() => composer.open({ asDid: did })}>
            <SquarePen size={15} aria-hidden="true" />
            New post
          </Button>
        }
      />
      <div className="page-body">
        <div className="posting-tiles">
          {POSTING_PAGES.filter((p) => p.key !== 'hub').map((p) => {
            const Icon = p.icon;
            return (
              <Link key={p.key} to={p.path} className="card posting-tile">
                <span className="posting-tile-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="posting-tile-text">
                  <span className="posting-tile-name">{p.label}</span>
                  <span className="posting-tile-desc">{p.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
