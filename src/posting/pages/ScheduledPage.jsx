import PostingHeader from '../ui/PostingHeader.jsx';

/** The scheduled page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function ScheduledPage({ did }) {
  return (
    <>
      <PostingHeader page="scheduled" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">Posts waiting to go out show here.</p>
        </div>
      </div>
    </>
  );
}
