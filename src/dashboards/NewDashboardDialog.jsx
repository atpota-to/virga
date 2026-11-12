import { useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { TEMPLATES } from './layouts.js';

/** Name a new dashboard and pick what it starts with: nothing, or a template. */
export default function NewDashboardDialog({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setTemplate('');
    }
  }, [open]);
  const options = [
    { value: '', label: 'Empty', desc: 'Start blank and add reports from the library.' },
    ...Object.entries(TEMPLATES).map(([key, t]) => ({ value: key, label: t.name, desc: `${t.widgets.length} reports to start from.` })),
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New dashboard"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-dashboard-form">
            Create
          </Button>
        </>
      }
    >
      <form
        id="new-dashboard-form"
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          const label = name.trim() || (template ? TEMPLATES[template].name : 'New dashboard');
          onCreate(label, template || null);
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly check-in" maxLength={60} autoFocus />
        </label>
        <fieldset className="field choice-list">
          <legend className="field-label">Start from</legend>
          {options.map((o) => (
            <label key={o.value || 'empty'} className="choice" data-on={template === o.value || undefined}>
              <input type="radio" name="template" value={o.value} checked={template === o.value} onChange={() => setTemplate(o.value)} />
              <span>
                <span className="choice-label">{o.label}</span>
                <span className="choice-desc">{o.desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Dialog>
  );
}
