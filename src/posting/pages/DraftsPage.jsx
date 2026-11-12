import PostingHeader from '../ui/PostingHeader.jsx';

/** The drafts page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function DraftsPage({ did }) {
  return (
    <>
      <PostingHeader page="drafts" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">Your drafts show here.</p>
        </div>
      </div>
    </>
  );
}
