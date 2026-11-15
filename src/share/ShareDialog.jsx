// "Post this chart": a card as a picture, with its description written from
// the chart's own numbers, ready to go into a post or to save. Nothing is
// posted from here; the composer opens with the picture attached and its
// alt text filled in, for the writer to finish.

import { useEffect, useMemo, useState } from 'react';
import { Download, SquarePen } from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { useComposer } from '../posting/composer/ComposerContext.jsx';
import { readAnnotations } from '../reports/annotations.js';
import { SHARE_HEIGHT, SHARE_WIDTH, renderShareImage } from './chartImage.js';
import { ALT_TEXT_MAX, shareAltText, sharePostText, shareSpec } from './shareSpec.js';
import './share.css';

/**
 * `share` is `{ type, options }` for the card to draw (null closes the
 * dialog); `archive`, `period` and `nowMs` are what the card itself reads.
 */
export default function ShareDialog({ share, archive, period, nowMs, onClose }) {
  const composer = useComposer();
  const spec = useMemo(
    () => (share ? shareSpec(share.type, archive, period, nowMs, { ...share.options, notes: readAnnotations(archive.did) }) : null),
    [share, archive, period, nowMs],
  );
  const [picture, setPicture] = useState(null); // { file, url }
  const [failed, setFailed] = useState(null);
  const [alt, setAlt] = useState('');

  useEffect(() => {
    setPicture(null);
    setFailed(null);
    setAlt(spec ? shareAltText(spec) : '');
    if (!spec) return undefined;
    let gone = false;
    let url = null;
    renderShareImage(spec)
      .then((file) => {
        if (gone) return;
        url = URL.createObjectURL(file);
        setPicture({ file, url });
      })
      .catch((err) => !gone && setFailed(err?.message || 'The picture couldn’t be made.'));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [spec]);

  const open = Boolean(share);
  const save = () => {
    if (!picture) return;
    const a = document.createElement('a');
    a.href = picture.url;
    a.download = `${(archive.handle || 'virga').replace(/[^a-z0-9.-]+/gi, '-')}-${share.type}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const write = () => {
    if (!picture) return;
    composer.open({ asDid: archive.did, text: sharePostText(spec, period), images: [{ file: picture.file, alt: alt.trim() }] });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Post this chart"
      className="share-dialog"
      actions={
        <>
          <Button onClick={save} disabled={!picture}>
            <Download size={15} aria-hidden="true" />
            Save the picture
          </Button>
          <Button variant="primary" onClick={write} disabled={!picture}>
            <SquarePen size={15} aria-hidden="true" />
            Write a post with it
          </Button>
        </>
      }
    >
      {open && !spec && <p className="empty">There’s nothing on this card to draw yet.</p>}
      {open && spec && (
        <div className="share">
          <div className="share-preview" style={{ aspectRatio: `${SHARE_WIDTH} / ${SHARE_HEIGHT}` }}>
            {picture ? <img src={picture.url} alt={alt} width={SHARE_WIDTH} height={SHARE_HEIGHT} /> : <p className="muted" role="status">{failed || 'Drawing the picture…'}</p>}
          </div>
          <label className="field">
            <span className="field-label">Description (alt text)</span>
            <textarea className="input share-alt" rows={5} value={alt} maxLength={2000} onChange={(e) => setAlt(e.target.value)} />
            <span className={`field-hint${alt.length > ALT_TEXT_MAX ? ' is-over' : ''}`}>
              Written from the chart’s own numbers, so someone who can’t see the picture gets what it shows. Change it as you like; it goes
              with the picture into the post.
            </span>
          </label>
          <p className="field-hint">Nothing is posted yet. The composer opens with the picture attached, and you can save a draft, schedule it or post it from there.</p>
        </div>
      )}
    </Dialog>
  );
}
