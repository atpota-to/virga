// A small Markdown reader for Virga's own legal documents
// (TERMS_OF_SERVICE.md and PRIVACY_POLICY.md at the repo's root). The
// documents are written once, as Markdown, and the pages draw them from that
// same text, so the page and the file can't say different things.
//
// It reads only what those documents use: headings (#, ##, ###), paragraphs,
// lists (- and 1., nested by indentation), tables, a rule, and inline bold,
// emphasis, code and links. Anything else is reported in `problems` rather
// than guessed at, and documents.test.js holds both documents to an empty
// list. The result is a plain tree: nothing here builds HTML, so nothing in a
// document can turn into markup.
//
//   block   { type: 'heading', level, id, children }
//           { type: 'paragraph', children }
//           { type: 'list', ordered, start, items: [{ children, sub }] }
//           { type: 'table', head: [children], rows: [[children]] }
//           { type: 'rule' }
//   inline  { type: 'text', value } | { type: 'code', value }
//           { type: 'strong' | 'em', children }
//           { type: 'link', href, children }

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_DIVIDER = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;
// What a backslash may escape: the characters that mean something here.
const ESCAPABLE = /[\\`*_[\]()|#<>!.+-]/;
// The deepest heading the documents may use, and the page styles.
const MAX_HEADING_LEVEL = 3;

const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
const isBlank = (line) => line.trim() === '';

/**
 * Whether a link may be followed. https and mailto, a path on this site, a
 * place on this page, or one of the documents by its file name (which
 * documents.js turns into the page's address). Anything else, a `javascript:`
 * address included, is drawn as plain words.
 */
export function isSafeHref(href) {
  const value = String(href || '');
  if (/[\s<>"'`\\]/.test(value)) return false;
  if (/^https:\/\/[^/]/i.test(value)) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true;
  if (/^\/(?!\/)/.test(value)) return true;
  if (/^#[\w-]+$/.test(value)) return true;
  return /^[A-Z][A-Z_]*\.md(?:#[\w-]+)?$/.test(value);
}

/** The words of a run of inline nodes, without their markup. */
export function inlineText(children) {
  return (children || [])
    .map((node) => (node.type === 'text' || node.type === 'code' ? node.value : inlineText(node.children)))
    .join('');
}

/**
 * A heading's words as an anchor, made the way GitHub makes one: lower case,
 * punctuation dropped, a hyphen for each space. The documents are read there
 * as files too, and a link from one to a section of the other
 * (PRIVACY_POLICY.md#your-choices-and-rights) has to land in both places.
 */
export function slugify(text) {
  return (
    String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-') || 'section'
  );
}

function pushText(out, value) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

/**
 * The index of the `*` that closes an emphasis opened at `from - 1`: the next
 * single asterisk with a word character before it. -1 when there is none.
 */
function closingAsterisk(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] !== '*') continue;
    if (text[i + 1] === '*') {
      i++;
      continue;
    }
    if (i > from && !/\s/.test(text[i - 1])) return i;
  }
  return -1;
}

/** The index of the next `**` at or after `from` that isn't escaped, or -1. */
function closingBold(text, from) {
  for (let i = from; i < text.length - 1; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '*' && text[i + 1] === '*' && i > from) return i;
  }
  return -1;
}

/**
 * One line's inline markup, as nodes. `note(problem)` hears about anything it
 * had to leave as plain words.
 */
export function parseInline(text, note = () => {}) {
  const out = [];
  const source = String(text || '');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const rest = source.slice(i);

    if (ch === '\\' && i + 1 < source.length && ESCAPABLE.test(source[i + 1])) {
      pushText(out, source[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        out.push({ type: 'code', value: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      note('a backtick with no partner');
    }

    if (rest.startsWith('**')) {
      const end = closingBold(source, i + 2);
      if (end !== -1 && !/\s/.test(source[i + 2] || ' ')) {
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end), note) });
        i = end + 2;
        continue;
      }
      note('bold that never closes');
      pushText(out, '**');
      i += 2;
      continue;
    }

    if (ch === '*') {
      const end = /\S/.test(source[i + 1] || '') ? closingAsterisk(source, i + 1) : -1;
      if (end !== -1) {
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end), note) });
        i = end + 1;
        continue;
      }
      note('an asterisk that isn’t emphasis (write \\* for a plain one)');
    }

    if (ch === '!' && source[i + 1] === '[') note('an image');

    if (ch === '[') {
      const link = /^\[((?:[^\]\\]|\\.)+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/.exec(rest);
      if (link) {
        const children = parseInline(link[1], note);
        if (isSafeHref(link[2])) out.push({ type: 'link', href: link[2], children });
        else {
          note(`a link this reader won’t follow: ${link[2]}`);
          for (const child of children) {
            if (child.type === 'text') pushText(out, child.value);
            else out.push(child);
          }
        }
        i += link[0].length;
        continue;
      }
    }

    if (ch === '<' && /^<\/?[a-z!]/i.test(rest)) note('raw HTML');

    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** A table row's cells, split on the bars that aren't escaped. */
function tableCells(line) {
  const cells = [];
  let cell = '';
  const text = line.trim();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (text[i] === '|') {
      cells.push(cell);
      cell = '';
    } else cell += text[i];
  }
  cells.push(cell);
  if (text.startsWith('|')) cells.shift();
  if (text.endsWith('|') && !text.endsWith('\\|')) cells.pop();
  return cells.map((c) => c.trim());
}

/**
 * A table starts with a row of headings and, under it, a row of dashes with
 * as many cells. The bars are required on the dashes, so a paragraph that
 * happens to hold a bar, followed by a rule, stays a paragraph.
 */
function startsTable(lines, i) {
  if (!lines[i].includes('|') || i + 1 >= lines.length) return false;
  const divider = lines[i + 1];
  if (!divider.includes('|') || !TABLE_DIVIDER.test(divider)) return false;
  return tableCells(divider).length === tableCells(lines[i]).length;
}

/**
 * Read a list starting at `lines[start]`, whose items sit at `indent`.
 * Returns the block and the index of the first line after it.
 */
function readList(lines, start, indent, note) {
  const first = LIST_ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const list = { type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) : null, items: [] };
  let i = start;
  let text = null;
  let sub = null;

  const close = () => {
    if (text === null) return;
    list.items.push({ children: parseInline(text, note), sub });
    text = null;
    sub = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // A blank line stays inside the list only when the list carries on
      // after it: another item here, or something indented under this one.
      let next = i + 1;
      while (next < lines.length && isBlank(lines[next])) next++;
      if (next >= lines.length) break;
      const item = LIST_ITEM.exec(lines[next]);
      const carriesOn = item ? indentOf(lines[next]) >= indent && (indentOf(lines[next]) > indent || /\d/.test(item[2]) === ordered) : indentOf(lines[next]) > indent;
      if (!carriesOn) break;
      i = next;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const depth = indentOf(line);
    if (item && depth < indent) break;
    if (item && depth >= indent + 2) {
      if (text === null) break;
      const nested = readList(lines, i, depth, note);
      if (sub) note('two lists under one item');
      else sub = nested.block;
      i = nested.next;
      continue;
    }
    if (item) {
      // A change of marker (a bullet after a number) starts another list.
      if (/\d/.test(item[2]) !== ordered) break;
      close();
      text = item[3];
      i++;
      continue;
    }
    // Words that carry an item on to the next line, indented under it.
    if (depth > indent && text !== null && !sub) {
      text += ` ${line.trim()}`;
      i++;
      continue;
    }
    break;
  }
  close();
  return { block: list, next: i };
}

/**
 * Read a document. Returns `{ title, blocks, problems }`: the first level-one
 * heading's words, the blocks in order, and everything it didn't understand
 * (each `{ line, problem }`, the line counted from 1).
 */
export function parseMarkdown(source) {
  const lines = String(source || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const blocks = [];
  const problems = [];
  const used = new Map();
  let title = null;
  let i = 0;

  const noteAt = (line) => (problem) => problems.push({ line: line + 1, problem });

  const anchor = (text) => {
    // A second heading with the same words gets -1, a third -2, as GitHub's do.
    const base = slugify(text);
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);
    return seen ? `${base}-${seen}` : base;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const note = noteAt(i);

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level > MAX_HEADING_LEVEL) note(`a level-${level} heading (the pages style three levels)`);
      const children = parseInline(heading[2], note);
      const text = inlineText(children);
      if (level === 1 && title === null) title = text;
      blocks.push({ type: 'heading', level: Math.min(level, MAX_HEADING_LEVEL), id: anchor(text), children });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (startsTable(lines, i)) {
      const head = tableCells(line).map((cell) => parseInline(cell, note));
      const rows = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = tableCells(lines[i]).map((cell) => parseInline(cell, noteAt(i)));
        if (cells.length !== head.length) noteAt(i)(`a table row with ${cells.length} cells under ${head.length} headings`);
        rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = readList(lines, i, indentOf(line), note);
      blocks.push(block);
      i = next;
      continue;
    }

    if (/^[ \t]*>/.test(line)) note('a block quote');

    // A fenced block isn't something the documents use. It is kept whole, as
    // code, so nothing inside it is read as markup.
    const fence = /^[ \t]*(```|~~~)/.exec(line);
    if (fence) {
      note('a code block');
      const inside = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) inside.push(lines[i++]);
      i++;
      blocks.push({ type: 'paragraph', children: [{ type: 'code', value: inside.join('\n') }] });
      continue;
    }

    // A paragraph: the lines up to a blank one, or to whatever starts
    // another kind of block.
    const words = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !HEADING.test(lines[i]) && !RULE.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !startsTable(lines, i)) {
      words.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(words.join(' '), note) });
  }

  return { title, blocks, problems };
}

/** The headings to list as a document's contents: each `{ id, text, level }`. */
export function outlineOf(blocks, { level = 2 } = {}) {
  return (blocks || []).filter((b) => b.type === 'heading' && b.level === level).map((b) => ({ id: b.id, text: inlineText(b.children), level: b.level }));
}
