import PostingHeader from '../ui/PostingHeader.jsx';

/** The schedule page. A placeholder until the page itself is built. */
// eslint-disable-next-line no-unused-vars
export default function WeeklySchedulePage({ did }) {
  return (
    <>
      <PostingHeader page="schedule" />
      <div className="page-body">
        <div className="card empty-page">
          <p className="card-sub">The queue’s weekly times show here.</p>
        </div>
      </div>
    </>
  );
}
