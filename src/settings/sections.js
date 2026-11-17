// The sections of Settings, in the order they are listed, each with the
// line that goes under its title. A file of its own, so the sidebar and the
// command palette can list them without loading the page.

export const SECTIONS = Object.freeze([
  { key: 'account', label: 'Account', desc: 'The accounts signed in on this browser, and how long each sign-in lasts.' },
  { key: 'data', label: 'Data and sync', desc: 'What Virga keeps in this browser, how fresh it is, and how to take it with you.' },
  { key: 'dashboards', label: 'Dashboards', desc: 'Your sets of reports, and where they’re kept.' },
  { key: 'posting', label: 'Posting', desc: 'How a new post starts, the weekly queue, timers and the post adviser.' },
  { key: 'appearance', label: 'Appearance', desc: 'How Virga looks in this browser. Changes show straight away.' },
  { key: 'permissions', label: 'Permissions', desc: 'What signing in lets Virga do, and what it can’t.' },
  { key: 'about', label: 'About', desc: 'What Virga is, its terms, and where its numbers come from.' },
]);
