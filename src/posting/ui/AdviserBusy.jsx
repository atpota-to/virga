import Button from '../../components/Button.jsx';

/** While the adviser reads a post: what it's checking, and the ways out. A placeholder. */
// eslint-disable-next-line no-unused-vars
export default function AdviserBusy({ goals, startedAt, onPublishAnyway, onKeepEditing }) {
  return (
    <div className="adviser-busy" role="status">
      <p>Reading the post before it goes out…</p>
      <div className="settings-actions">
        {onKeepEditing && <Button onClick={onKeepEditing}>Keep editing</Button>}
        {onPublishAnyway && <Button onClick={onPublishAnyway}>Publish anyway</Button>}
      </div>
    </div>
  );
}
