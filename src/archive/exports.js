// Downloads: the archive as JSON, the posts as CSV. Each reads the archive
// already in memory, the same rows the charts draw, so a file always matches
// what the screen is showing.

import { archiveJson, exportFilename, postsCsv } from '../lib/analyticsExport.js';

/** The handle for a file name, or the DID with its colons made safe. */
function fileStem(archive) {
  return String(archive.handle || archive.did || 'archive').replace(/[^a-z0-9.-]+/gi, '-');
}

export function exportArchive(archive) {
  const now = Date.now();
  const json = archiveJson(archive, { did: archive.did, handle: archive.handle, actors: archive.actors, now });
  downloadText(json, exportFilename(fileStem(archive), 'analytics', 'json', now), 'application/json');
}

export function exportPosts(archive, posts = archive.posts) {
  const now = Date.now();
  const csv = postsCsv(posts, { did: archive.did, handle: archive.handle });
  downloadText(csv, exportFilename(fileStem(archive), 'posts', 'csv', now), 'text/csv;charset=utf-8');
}

/** Any table as CSV: `rows` are arrays, the first one the header. */
export function exportRows(archive, what, rows) {
  const now = Date.now();
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  downloadText(csv, exportFilename(fileStem(archive), what, 'csv', now), 'text/csv;charset=utf-8');
}

export function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The download starts after the click returns, and Safari can still be
  // reading the blob well after that; revoking at once can cut it off.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
