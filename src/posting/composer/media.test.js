import { describe, expect, it } from 'vitest';
import {
  pastedImageFiles,
  sortIncomingFiles,
  formatDuration,
  missingAltCount,
} from './media.js';

const file = (name, type) => ({ name, type, size: 10 });
const NOW = () => new Date('2026-11-12T10:00:00Z');

function clipboard({ text = '', items = [] }) {
  return { items, getData: (t) => (t === 'text/plain' ? text : '') };
}

describe('pastedImageFiles', () => {
  it('takes pasted images and names them', () => {
    const img = new File(['x'], 'image.png', { type: 'image/png' });
    const out = pastedImageFiles(
      clipboard({
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => img }],
      }),
      { now: NOW },
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('pasted-image-2026-11-12T10-00-00-000Z.png');
    expect(out[0].type).toBe('image/png');
  });
  it('leaves a paste with text alone, even with a picture beside it', () => {
    const items = [
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }),
      },
    ];
    expect(pastedImageFiles(clipboard({ text: 'words', items }))).toEqual([]);
  });
  it('skips string entries and empty clipboards', () => {
    expect(
      pastedImageFiles(
        clipboard({ items: [{ kind: 'string', type: 'image/png' }] }),
      ),
    ).toEqual([]);
    expect(pastedImageFiles(null)).toEqual([]);
  });
});

describe('sortIncomingFiles', () => {
  it('takes up to four images', () => {
    const r = sortIncomingFiles(
      [1, 2, 3, 4, 5].map((n) => file(`${n}.jpg`, 'image/jpeg')),
    );
    expect(r.images).toHaveLength(4);
    expect(r.notes[0]).toMatch(/only 4 more were added/);
  });
  it('fills only the room left', () => {
    const r = sortIncomingFiles(
      [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')],
      { imageCount: 3 },
    );
    expect(r.images).toHaveLength(1);
    expect(r.notes[0]).toMatch(/only 1 more was added/);
  });
  it('takes one video into a post with no images', () => {
    const r = sortIncomingFiles([
      file('v.mp4', 'video/mp4'),
      file('w.mp4', 'video/mp4'),
    ]);
    expect(r.video.name).toBe('v.mp4');
    expect(r.notes[0]).toMatch(/one video/);
  });
  it('refuses a video beside images, and on a drop', () => {
    expect(
      sortIncomingFiles([file('v.mp4', 'video/mp4')], { imageCount: 1 }).video,
    ).toBeNull();
    const drop = sortIncomingFiles([file('v.mp4', 'video/mp4')], {
      allowVideo: false,
    });
    expect(drop.video).toBeNull();
    expect(drop.notes[0]).toMatch(/video button/);
  });
  it('refuses images while the post has a video', () => {
    const r = sortIncomingFiles([file('a.jpg', 'image/jpeg')], {
      hasVideo: true,
    });
    expect(r.images).toEqual([]);
    expect(r.notes[0]).toMatch(/has a video/);
  });
  it('says what wasn’t an image', () => {
    expect(sortIncomingFiles([file('a.pdf', 'application/pdf')]).notes).toEqual(
      ['One file wasn’t an image.'],
    );
  });
  it('refuses a video type the service can’t take', () => {
    expect(
      sortIncomingFiles([file('a.avi', 'video/x-msvideo')]).notes[0],
    ).toMatch(/MP4/);
  });
});

describe('formatDuration and missingAltCount', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(83)).toBe('1:23');
    expect(formatDuration(0)).toBe('0:00');
  });
  it('counts images without alt text', () => {
    expect(missingAltCount({ images: [{ alt: 'x' }, { alt: ' ' }, {}] })).toBe(
      2,
    );
  });
});
