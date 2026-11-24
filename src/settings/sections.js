// The sections of Settings, in the order they are listed, each with the
// line that goes under its title. A file of its own, so the sidebar and the
// command palette can list them without loading the page.

export const SECTIONS = Object.freeze([
  { key: 'account', label: 'Account', desc: 'Who’s signed in here, and for how long.' },
  { key: 'data', label: 'Data and sync', desc: 'Your archive on this device: sync, export and delete.' },
  { key: 'dashboards', label: 'Dashboards', desc: 'Your sets of reports.' },
  { key: 'posting', label: 'Posting', desc: 'New post defaults, the queue, timers and the adviser.' },
  { key: 'appearance', label: 'Appearance', desc: 'How Virga looks on this device.' },
  { key: 'permissions', label: 'Permissions', desc: 'What signing in lets Virga do, and what it can’t.' },
  { key: 'about', label: 'About', desc: 'Terms, privacy and where the data comes from.' },
]);
