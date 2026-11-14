import { Fragment } from 'react';
import { Link } from '../lib/router.jsx';
import { resolveDocumentLink } from './documents.js';
import { outlineOf } from './markdown.js';

/**
 * A legal document, drawn from the blocks markdown.js read out of its
 * Markdown. `onOpenDocument(key)` takes a link from one document to the
 * other, for a place that shows them without changing the address (the
 * dialog on the agreement screen); without it such a link is an ordinary one.
 * `contents` lists the sections under the document's opening lines.
 * `skipTitle` leaves the first heading out, where a frame already says it.
 */
export default function LegalDocument({ document: doc, onOpenDocument = null, contents = false, skipTitle = false, headingOffset = 0 }) {
  const blocks = skipTitle ? doc.blocks.filter((block, index) => !(index === 0 && block.type === 'heading' && block.level === 1)) : doc.blocks;
  const firstSection = blocks.findIndex((block) => block.type === 'heading' && block.level === 2);
  const outline = contents ? outlineOf(blocks) : [];
  const lead = firstSection === -1 ? blocks : blocks.slice(0, firstSection);
  const rest = firstSection === -1 ? [] : blocks.slice(firstSection);

  const inline = (nodes) =>
    nodes.map((node, index) => {
      if (node.type === 'text') return <Fragment key={index}>{node.value}</Fragment>;
      if (node.type === 'code') return <code key={index}>{node.value}</code>;
      if (node.type === 'strong') return <strong key={index}>{inline(node.children)}</strong>;
      if (node.type === 'em') return <em key={index}>{inline(node.children)}</em>;
      const target = resolveDocumentLink(node.href);
      if (!target.href) return <Fragment key={index}>{inline(node.children)}</Fragment>;
      if (target.external) {
        return (
          <a key={index} href={target.href} target={target.href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">
            {inline(node.children)}
          </a>
        );
      }
      if (target.anchor) {
        return (
          <a key={index} href={target.href}>
            {inline(node.children)}
          </a>
        );
      }
      if (target.document && onOpenDocument) {
        return (
          <a
            key={index}
            href={target.href}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpenDocument(target.document);
            }}
          >
            {inline(node.children)}
          </a>
        );
      }
      return (
        <Link key={index} to={target.href}>
          {inline(node.children)}
        </Link>
      );
    });

  const list = (block, key) => {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}>
        {block.items.map((item, index) => (
          <li key={index}>
            {inline(item.children)}
            {item.sub && list(item.sub, 'sub')}
          </li>
        ))}
      </Tag>
    );
  };

  const draw = (block, index) => {
    if (block.type === 'heading') {
      const Tag = `h${Math.min(6, block.level + headingOffset)}`;
      return (
        <Tag key={index} id={block.id} className={`legal-h${block.level}`}>
          {inline(block.children)}
        </Tag>
      );
    }
    if (block.type === 'paragraph') return <p key={index}>{inline(block.children)}</p>;
    if (block.type === 'list') return list(block, index);
    if (block.type === 'rule') return <hr key={index} />;
    if (block.type === 'table') {
      return (
        // A wide table scrolls inside its own box, so the page never does.
        <div key={index} className="legal-table" role="region" aria-label="Table" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="legal-text">
      {lead.map(draw)}
      {outline.length > 1 && (
        <nav className="legal-contents" aria-label="Contents">
          <ol>
            {outline.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {rest.map((block, index) => draw(block, lead.length + index))}
    </div>
  );
}
