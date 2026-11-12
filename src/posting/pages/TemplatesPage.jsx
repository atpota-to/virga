import { useMemo, useState } from 'react';
import { LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { useToast } from '../../shell/bits.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { requestReauth } from '../../accounts/accountCopy.js';
import { useComposer } from '../composer/ComposerContext.jsx';
import { CONTEXT_LABELS, TEMPLATE_COLLECTION, describeTemplate, splitTemplateText } from '../templates/postTemplates.js';
import { templateEmbedKind } from '../templates/editorDrafts.js';
import { readTemplateUsage, sortTemplatesForShelf } from '../templates/templateUsage.js';
import { useTemplates } from '../templates/useTemplates.js';
import TemplateEditor from '../library/TemplateEditor.jsx';
import PostingHeader from '../ui/PostingHeader.jsx';
import { ConfirmDialog, LoadError, RowSkeleton } from './hubParts.jsx';
import './hub.css';

const USE_WORDS = { reply: 'For replies', post: 'For new posts', any: 'For posts and replies' };
const ATTACH_WORDS = { post: 'Quotes a post', feed: 'Attaches a feed', list: 'Attaches a list', link: 'Attaches a link card', unsupported: 'Attaches pictures' };

function TemplateText({ text }) {
  const parts = splitTemplateText(text);
  if (!parts.length) return <span className="muted">No text: it only attaches something.</span>;
  return parts.map((p, i) =>
    p.type === 'text' ? (
      <span key={i}>{p.value}</span>
    ) : (
      <span key={i} className="tpl-chip" title={CONTEXT_LABELS[p.key] ? 'Filled in for you' : 'Asked when it’s used'}>
        {CONTEXT_LABELS[p.key] || p.key}
      </span>
    ),
  );
}

function usedLine(entry) {
  if (!entry?.count) return 'Not used here yet';
  return `Used ${entry.count === 1 ? 'once' : `${entry.count.toLocaleString('en-US')} times`} in this browser`;
}

/**
 * The account's templates: the posts and replies it starts from, grouped as
 * the library shows them, most used first. Make, change and delete them
 * here; Use starts a post from one. They're records in the account's repo,
 * which anyone can read, and Anisota reads the same ones.
 */
export default function TemplatesPage({ did }) {
  const composer = useComposer();
  const toast = useToast();
  const { capabilitiesFor } = useAtprotoSession();
  const caps = capabilitiesFor(did);
  const { templates, loading, error, ready, reload, remove } = useTemplates(did);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // Read again whenever the list changes, so a use made in the composer shows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const usage = useMemo(() => readTemplateUsage(did), [did, templates]);
  const sorted = useMemo(() => sortTemplatesForShelf(templates, usage), [templates, usage]);
  const canWrite = !caps.missing.some((t) => t.startsWith(`repo:${TEMPLATE_COLLECTION}`));

  const groups = useMemo(() => {
    const out = [];
    for (const t of sorted) {
      const name = String(t.group || '').trim();
      const last = out[out.length - 1];
      if (last && last.name === name) last.items.push(t);
      else out.push({ name, items: [t] });
    }
    return out;
  }, [sorted]);
  const anyGroup = groups.some((g) => g.name);

  return (
    <>
      <PostingHeader
        page="templates"
        actions={
          <Button variant="primary" onClick={() => setEditing({ template: null })} disabled={!canWrite}>
            <Plus size={15} aria-hidden="true" />
            New template
          </Button>
        }
      />
      <div className="page-body hub">
        <p className="note">
          Templates are saved in your repo as <span className="mono">{TEMPLATE_COLLECTION}</span> records, where anyone can read them, and
          Anisota uses the same ones. Keep anything private out of them. In the composer, type a template’s shortcut after a slash, or find it
          in the library.
        </p>
        {!canWrite && (
          <div className="callout callout--warn" role="status">
            <span>Virga needs permission to save templates in your repo. Sign in again to grant it.</span>
            <Button size="sm" variant="primary" onClick={() => requestReauth(did, { immediate: true })}>
              <LogIn size={14} aria-hidden="true" />
              Sign in again
            </Button>
          </div>
        )}
        {error && templates.length > 0 && (
          <LoadError message="Your templates couldn’t be read again from your repo; these are the last ones seen." onRetry={reload} />
        )}

        {loading && !templates.length ? (
          <section className="card card--flush hub-card" aria-label="Templates">
            <RowSkeleton rows={3} actions={2} />
          </section>
        ) : error && !templates.length ? (
          <LoadError message="Your templates couldn’t be read from your repo." onRetry={reload} />
        ) : !templates.length && ready ? (
          <section className="card hub-empty">
            <p className="empty">
              No templates yet. A template is a post or reply to start from, with blanks it asks you to fill in, such as the name of the person
              you’re answering.
            </p>
            <Button variant="primary" onClick={() => setEditing({ template: null })} disabled={!canWrite}>
              <Plus size={15} aria-hidden="true" />
              Make your first template
            </Button>
          </section>
        ) : (
          groups.map((group) => (
            <section key={group.name || '-'} className="card card--flush hub-card" aria-label={group.name || 'Templates'}>
              {(anyGroup || group.name) && (
                <div className="card-head">
                  <h2 className="card-title">{group.name || 'Other templates'}</h2>
                </div>
              )}
              <ul className="hub-list hub-list--rows">
                {group.items.map((t) => {
                  const facts = describeTemplate(t, null);
                  const attach = templateEmbedKind(t.embed);
                  return (
                    <li key={t.rkey} className="hub-row tpl-row-item">
                      <div className="hub-row-main">
                        <p className="tpl-name">
                          {t.name}
                          {t.shortcut && <span className="mono tpl-shortcut-chip">/{t.shortcut}</span>}
                        </p>
                        <p className="hub-row-text">
                          <TemplateText text={t.text} />
                        </p>
                        <p className="hub-row-meta">
                          {[
                            USE_WORDS[t.use] || USE_WORDS.any,
                            facts.questions ? `Asks ${facts.questions === 1 ? 'a question' : `${facts.questions} questions`}` : '',
                            attach ? ATTACH_WORDS[attach] : '',
                            t.keywords?.length ? `Suggested for ${t.keywords.slice(0, 4).join(', ')}` : '',
                            usedLine(usage[t.rkey]),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="hub-row-actions">
                        <Button size="sm" variant="primary" onClick={() => composer.open({ asDid: did, templateId: t.rkey })} disabled={!caps.canPost}>
                          Use
                        </Button>
                        <Button size="sm" onClick={() => setEditing({ template: t })} disabled={!canWrite}>
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon
                          className="hub-danger"
                          aria-label={`Delete “${t.name}”`}
                          title="Delete this template"
                          disabled={!canWrite}
                          onClick={() => setDeleting(t)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <TemplateEditor open={Boolean(editing)} did={did} template={editing?.template || null} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this template?"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await remove(deleting.rkey);
          toast?.('Template deleted.');
        }}
      >
        <p>
          “{deleting?.name}” goes from your repo, so every app that reads your templates loses it, Anisota included. This can’t be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
