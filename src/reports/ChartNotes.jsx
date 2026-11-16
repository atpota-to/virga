// The notes card: write a day and a few words, and it is marked on every
// chart over time, on the reports and on the dashboards.

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import Button from '../components/Button.jsx';
import { formatDateShort } from '../lib/time.js';
import { dayStartMs } from '../lib/periods.js';
import { ANNOTATION_LABEL_MAX, todayKey } from './annotations.js';
import { useAnnotations } from './useAnnotations.js';
import { Card } from './parts.jsx';

export default function ChartNotes({ did }) {
  const { list, add, remove } = useAnnotations(did);
  const today = todayKey();
  const [day, setDay] = useState(today);
  const [label, setLabel] = useState('');
  const ready = Boolean(label.trim()) && Number.isFinite(dayStartMs(day));
  return (
    <Card title="Notes on your charts" sub="A day and a few words, marked on every chart over time. Kept in this browser.">
      <form
        className="chart-notes-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          add(day, label);
          setLabel('');
        }}
      >
        <label className="field">
          <span className="field-label">Day</span>
          <input className="input" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="field chart-notes-what">
          <span className="field-label">What happened</span>
          <input
            className="input"
            value={label}
            maxLength={ANNOTATION_LABEL_MAX}
            placeholder="Changed my handle, a post went round, a week away…"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={!ready}>
          <Plus size={15} aria-hidden="true" />
          Add note
        </Button>
      </form>
      {list.length > 0 ? (
        <ul className="chart-notes-list">
          {[...list].reverse().map((a) => (
            <li key={a.id}>
              <span className="chart-notes-day num">{formatDateShort(dayStartMs(a.day))}</span>
              <span className="chart-notes-label">{a.label}</span>
              <Button variant="ghost" size="sm" icon aria-label={`Remove the note “${a.label}”`} title="Remove" onClick={() => remove(a.id)}>
                <X size={15} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No notes yet. Follower milestones are marked on the follower charts by themselves.</p>
      )}
    </Card>
  );
}
