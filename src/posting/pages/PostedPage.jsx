import PostingHeader from '../ui/PostingHeader.jsx';

/** The posted page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function PostedPage({ did }) {
  return (
    <>
      <PostingHeader page="posted" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">What you’ve posted shows here.</p>
        </div>
      </div>
    </>
  );
}
