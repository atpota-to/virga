// Text other people wrote, as data the model must not take instructions
// from: wrapped in a tag it can't close, with backticks that could start a
// code span turned into quotes. The agent's prompt says what the tags mean.

export function untrusted(label, text) {
  const source = String(label ?? '').replace(/[^\w:.-]/g, '');
  const clean = String(text ?? '')
    .replace(/`/g, "'")
    .replace(/</g, '&lt;');
  return `<untrusted source="${source}">\n${clean}\n</untrusted>`;
}
