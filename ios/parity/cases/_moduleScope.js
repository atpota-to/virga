// A web module's top-level declarations, read from its own source, for the
// generators of modules that keep what the Swift port needs to itself
// (src/hillside/scene.js exports only createHillside; clouds.js keeps its
// cloud kinds and generators). The module is parsed with acorn, every
// top-level declaration is taken from the source as written (imports
// left out: the caller gives what they would bind, real or a stand-in),
// and the lot is run in a fresh `vm` context. Asking for a name the
// module doesn't declare at its top level throws, so a renamed constant
// fails `npm run parity:write` instead of leaving a fixture quietly
// recording something else.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function declaredNames(node) {
  if (node.type === 'VariableDeclaration')
    return node.declarations.flatMap((d) =>
      d.id.type === 'Identifier' ? [d.id.name] : [],
    );
  if (
    (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
    node.id
  )
    return [node.id.name];
  return [];
}

/**
 * `names` of the module at `file` (relative to the repository root),
 * evaluated with `globals` as the context's own: the bindings its imports
 * would have made, and anything else it reads from the page (`window`,
 * `document`, `requestAnimationFrame`).
 */
export function moduleScope(file, names, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const parts = [];
  const declared = new Set();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') continue;
    const decl =
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportDefaultDeclaration'
        ? node.declaration
        : node;
    if (!decl) continue;
    for (const name of declaredNames(decl)) declared.add(name);
    parts.push(source.slice(decl.start, decl.end));
  }
  for (const name of names) {
    if (!declared.has(name))
      throw new Error(`${file} declares no top-level ${name}`);
  }
  const script = `${parts.join('\n')}\n;({ ${names.join(', ')} })`;
  const context = vm.createContext({ ...globals });
  return vm.runInContext(script, context, { filename: file });
}
