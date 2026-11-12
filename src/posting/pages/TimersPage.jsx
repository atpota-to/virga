import PostingHeader from '../ui/PostingHeader.jsx';

/** The timers page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function TimersPage({ did }) {
  return (
    <>
      <PostingHeader page="timers" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">Posts on a timer show here.</p>
        </div>
      </div>
    </>
  );
}
