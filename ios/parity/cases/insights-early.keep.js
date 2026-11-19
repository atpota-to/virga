// The accounts a tool is told to leave alone, per account and tool, kept in
// localStorage. Swift: VirgaInsights/Tools/Keep.swift (KeepListModel).
//
// useKeepList is a hook. It is run here as React runs it, in a component
// rendered with react-dom/server: each step mounts it afresh (reading what
// is stored), records what it says, then calls one of its methods, which
// writes the new list. So each step's `size`, `has` and `stored` are what
// the hook would hold and write in a browser, as long as the write goes
// through (KeepModelTests covers a refused one).

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { keepKey, useKeepList } from '../../../src/tools/keep.js';
import { each } from './_helpers.js';

export const sources = ['src/tools/keep.js'];

function withStorage(items, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (items.has(key) ? items.get(key) : null),
      setItem: (key, value) => void items.set(key, String(value)),
      removeItem: (key) => void items.delete(key),
    },
  });
  try {
    return fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}

function mount(did, name) {
  let api = null;
  function Probe() {
    api = useKeepList(did, name);
    return null;
  }
  renderToString(createElement(Probe));
  return api;
}

const PROBES = ['did:plc:a', 'did:plc:b', 'did:plc:c', 'did:web:x.example', ''];

function run({ did, name, stored, others = {}, steps, probes = PROBES }) {
  const key = keepKey(did, name);
  const items = new Map(Object.entries(others));
  if (stored !== null) items.set(key, stored);
  return withStorage(items, () => {
    const look = () => {
      const api = mount(did, name);
      return {
        api,
        state: {
          size: api.size,
          has: Object.fromEntries(probes.map((d) => [d, api.has(d)])),
          stored: items.has(key) ? items.get(key) : null,
        },
      };
    };
    const states = [];
    let { api, state } = look();
    states.push(state);
    for (const step of steps) {
      if (step.op === 'add') api.add(step.dids);
      else if (step.op === 'remove') api.remove(step.dids);
      else api.clear();
      ({ api, state } = look());
      states.push(state);
    }
    return {
      key,
      states,
      others: Object.fromEntries([...items].filter(([k]) => k !== key)),
    };
  });
}

const STEPS = [
  { op: 'add', dids: ['did:plc:a'] },
  { op: 'add', dids: ['did:plc:b', 'did:plc:a', 'did:plc:c'] },
  { op: 'remove', dids: ['did:plc:a', 'did:plc:zz'] },
  { op: 'add', dids: ['did:plc:a'] },
  { op: 'remove', dids: [] },
  { op: 'clear' },
  { op: 'add', dids: [] },
];

export default async function cases() {
  return [
    ...(await each(
      'keepKey',
      [
        { did: 'did:plc:abc', name: 'cleanup' },
        { did: 'did:plc:abc', name: 'followback' },
        { did: 'did:web:example.com', name: 'cleanup' },
        { did: '', name: '' },
        { did: 'did:plc:a:b', name: 'x:y' },
        { did: 'did:plc:é', name: 'naïve 👍' },
      ],
      ({ did, name }) => keepKey(did, name),
    )),
    ...(await each(
      'useKeepList',
      [
        null,
        '',
        '[]',
        '["did:plc:a","did:plc:b"]',
        '["did:plc:b","did:plc:a","did:plc:b"]',
        '["did:plc:a",1,null,{"x":1},"did:plc:c",["did:plc:b"]]',
        'not json',
        '{"did:plc:a":true}',
        '"did:plc:a"',
        '5',
        'null',
        '["did:web:x.example","", "\\u00e9"]',
      ]
        .map((stored) => ({
          did: 'did:plc:me',
          name: 'cleanup',
          stored,
          steps: STEPS,
        }))
        .concat([
          {
            // What JSON.stringify escapes in a DID, and what it leaves.
            $id: 'escapes',
            did: 'did:plc:me',
            name: 'cleanup',
            stored: '["did:plc:a","\\u0007\\n\\"q\\"\\\\"]',
            steps: [
              {
                op: 'add',
                dids: [
                  'did:plc:b',
                  'tab\there',
                  '\u2028\u2029\u007f\u0000\u001f',
                  'é 👍🏽 </script>',
                  '\b\f\r',
                ],
              },
              { op: 'remove', dids: ['did:plc:a'] },
            ],
          },
          {
            // Two ways to write é: a Set holds both, as JavaScript compares
            // strings by code unit (Swift's == says they are the same).
            $id: 'canonically-equivalent',
            did: 'did:plc:me',
            name: 'cleanup',
            stored: JSON.stringify(['caf\u00e9', 'cafe\u0301', 'caf\u00e9']),
            probes: ['caf\u00e9', 'x'],
            steps: [
              { op: 'add', dids: ['cafe\u0301', 'x'] },
              { op: 'remove', dids: ['caf\u00e9'] },
              { op: 'add', dids: ['caf\u00e9'] },
              { op: 'remove', dids: ['cafe\u0301'] },
            ],
          },
          {
            $id: 'other-account-and-tool-untouched',
            did: 'did:plc:me',
            name: 'followback',
            stored: '["did:plc:c"]',
            others: {
              'virga:keep:cleanup:did:plc:me': '["did:plc:a"]',
              'virga:keep:followback:did:plc:other': '["did:plc:b"]',
            },
            steps: [
              { op: 'add', dids: ['did:plc:a'] },
              { op: 'remove', dids: ['did:plc:c'] },
            ],
          },
        ]),
      (input) => run(input),
    )),
  ];
}
