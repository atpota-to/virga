import Button from '../../components/Button.jsx';

/** A template's questions, asked before it fills a post. A placeholder until it is built. */
// eslint-disable-next-line no-unused-vars
export default function TemplateQuestions({ template, context, onDone, onCancel }) {
  return (
    <div className="template-questions">
      <p>This template has no questions to ask.</p>
      <div className="settings-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onDone?.({})}>
          Use it
        </Button>
      </div>
    </div>
  );
}
