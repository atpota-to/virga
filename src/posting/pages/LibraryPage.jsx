import PostingHeader from '../ui/PostingHeader.jsx';

/** The library page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function LibraryPage({ did }) {
  return (
    <>
      <PostingHeader page="library" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">Things to quote or attach show here.</p>
        </div>
      </div>
    </>
  );
}
