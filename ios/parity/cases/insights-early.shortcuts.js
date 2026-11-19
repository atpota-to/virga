// What a key press means: the new-post shortcut ("n"), the command
// palette's (⌘K on a Mac, Ctrl K elsewhere), what counts as typing, and how
// the shortcut is written. Every modifier combination, against each kind of
// focus, in and out of a dialog. Swift: VirgaInsights/Shell/Shortcuts.swift
// (over its KeyEvent and KeyTarget).

import {
  isMacPlatform,
  isNewPostShortcut,
  isPaletteShortcut,
  isTypingTarget,
  paletteShortcutAria,
  paletteShortcutLabel,
} from '../../../src/shell/shortcuts.js';
import { each, grid } from './_helpers.js';

export const sources = ['src/shell/shortcuts.js'];

const TARGETS = {
  body: { tagName: 'BODY' },
  button: { tagName: 'BUTTON' },
  textarea: { tagName: 'TEXTAREA' },
  select: { tagName: 'SELECT' },
  text: { tagName: 'INPUT', type: 'text' },
  search: { tagName: 'INPUT', type: 'search' },
  blankType: { tagName: 'INPUT', type: '' },
  noType: { tagName: 'INPUT' },
  checkbox: { tagName: 'INPUT', type: 'checkbox' },
  editable: { tagName: 'DIV', isContentEditable: true },
  none: null,
};

const ELEMENTS = [
  ...Object.values(TARGETS),
  { tagName: 'textarea' },
  { tagName: 'Input', type: 'TEXT' },
  { tagName: 'INPUT', type: 'radio' },
  { tagName: 'INPUT', type: 'range' },
  { tagName: 'INPUT', type: 'button' },
  { tagName: 'INPUT', type: 'submit' },
  { tagName: 'INPUT', type: 'file' },
  { tagName: 'INPUT', type: 'color' },
  { tagName: 'INPUT', type: 'hidden' },
  ...[
    'email',
    'url',
    'tel',
    'password',
    'number',
    'date',
    'datetime-local',
    'month',
    'time',
    'week',
  ].map((type) => ({ tagName: 'INPUT', type })),
  { tagName: 'INPUT', type: ' text' },
  { tagName: 'DIV', isContentEditable: false },
  { tagName: 'BUTTON', isContentEditable: true },
  { tagName: 'SPAN' },
  { tagName: '' },
  {},
  { type: 'text' },
  // toLowerCase maps the Kelvin sign to k, so "WEE\u212A" is a week field;
  // the dotted capital I lower-cases to i and a combining dot, so it isn't
  // an INPUT; dotless i and the long s stay what they are.
  { tagName: 'INPUT', type: 'WEE\u212A' },
  { tagName: 'INPUT', type: 'DATE\u212A' },
  { tagName: '\u0130NPUT', type: 'text' },
  { tagName: 'INPUT', type: 'T\u0130ME' },
  { tagName: 'INPUT', type: '\u017FEARCH' },
  { tagName: 'TEXTAREA\u0301' },
  { tagName: 'SELECT', type: 'checkbox' },
  { tagName: 'TEXTAREA', isContentEditable: false },
  { tagName: 'INPUT', type: 'Datetime-Local' },
];

const MODIFIERS = grid({
  metaKey: [false, true],
  ctrlKey: [false, true],
  altKey: [false, true],
  shiftKey: [false, true],
});

const event = (key, mods, target, flags = {}) => ({
  key,
  ...mods,
  ...flags,
  target,
});

export default async function cases() {
  const newPostEvents = [
    ...grid({
      key: ['n', 'N', 'm'],
      mods: MODIFIERS,
      target: ['body', 'button', 'textarea', 'text', 'editable', 'none'],
      inDialog: [false, true],
    }).map(({ key, mods, target, inDialog }) => ({
      event: event(key, mods, TARGETS[target]),
      inDialog,
    })),
    ...['repeat', 'isComposing', 'defaultPrevented'].map((flag) => ({
      event: event('n', {}, TARGETS.body, { [flag]: true }),
      inDialog: false,
    })),
    { event: null, inDialog: false },
    { event: { key: 'n' }, inDialog: false },
    { event: { key: '\u212A', target: TARGETS.body }, inDialog: false },
  ];
  const paletteEvents = [
    ...grid({
      key: ['k', 'K', 'j'],
      mods: MODIFIERS,
      target: ['body', 'search', 'editable'],
      inDialog: [false, true],
      mac: [false, true],
    }).map(({ key, mods, target, inDialog, mac }) => ({
      event: event(key, mods, TARGETS[target]),
      inDialog,
      mac,
    })),
    ...grid({
      flag: ['repeat', 'isComposing', 'defaultPrevented'],
      mac: [false, true],
    }).map(({ flag, mac }) => ({
      event: event(
        'k',
        mac ? { metaKey: true } : { ctrlKey: true },
        TARGETS.body,
        { [flag]: true },
      ),
      inDialog: false,
      mac,
    })),
    { event: null, inDialog: false, mac: true },
    { event: { key: 'k', metaKey: true }, inDialog: false, mac: true },
    // The Kelvin sign is canonically the letter K (so Swift's == takes one
    // for the other), but it isn't K to ===.
    {
      event: { key: '\u212A', metaKey: true, target: TARGETS.body },
      inDialog: false,
      mac: true,
    },
    {
      event: { key: '\u212A', ctrlKey: true, target: TARGETS.body },
      inDialog: false,
      mac: false,
    },
  ];

  return [
    ...(await each(
      'isTypingTarget',
      ELEMENTS.map((el) => ({ el })),
      ({ el }) => isTypingTarget(el),
    )),
    ...(await each('isNewPostShortcut', newPostEvents, ({ event, inDialog }) =>
      isNewPostShortcut(event, { inDialog }),
    )),
    ...(await each(
      'isPaletteShortcut',
      paletteEvents,
      ({ event, inDialog, mac }) => isPaletteShortcut(event, { inDialog, mac }),
    )),
    ...(await each(
      'isMacPlatform',
      [
        { nav: { platform: 'MacIntel' } },
        { nav: { platform: 'iPhone' } },
        { nav: { platform: 'iPad' } },
        { nav: { platform: 'iPod touch' } },
        { nav: { platform: 'Win32' } },
        { nav: { platform: 'Linux x86_64' } },
        { nav: { platform: 'Linux armv8l' } },
        { nav: { platform: '' } },
        { nav: { platform: 'MACINTOSH' } },
        { nav: { platform: 'emacs' } },
        { nav: { userAgentData: { platform: 'macOS' } } },
        {
          nav: { userAgentData: { platform: 'Windows' }, platform: 'MacIntel' },
        },
        { nav: { userAgentData: { platform: '' }, platform: 'MacIntel' } },
        { nav: { userAgentData: { platform: 'Android' }, platform: 'iPhone' } },
        { nav: { userAgentData: {} } },
        // Only ASCII letters fold under /i without the u flag.
        { nav: { platform: '\u0131Phone' } },
        { nav: { platform: '\u0130PAD' } },
        { nav: { platform: 'MA\u0421' } },
        { nav: { platform: 'Ｍａｃ' } },
        { nav: { platform: 'I\u0307PHONE' } },
        { nav: { platform: 'iPad\u{1F44D}' } },
        { nav: { userAgentData: { platform: 'Mac\u212Aintosh' } } },
        { nav: {} },
        { nav: null },
      ],
      ({ nav }) => isMacPlatform(nav),
    )),
    ...(await each(
      'paletteShortcutLabel',
      [{ mac: true }, { mac: false }],
      ({ mac }) => paletteShortcutLabel(mac),
    )),
    ...(await each(
      'paletteShortcutAria',
      [{ mac: true }, { mac: false }],
      ({ mac }) => paletteShortcutAria(mac),
    )),
  ];
}
