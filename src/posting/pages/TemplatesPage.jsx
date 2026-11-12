import PostingHeader from '../ui/PostingHeader.jsx';

/** The templates page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function TemplatesPage({ did }) {
  return (
    <>
      <PostingHeader page="templates" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">Your templates show here.</p>
        </div>
      </div>
    </>
  );
}
