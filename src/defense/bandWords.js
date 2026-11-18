// What each band is called on screen, and what it means, in the words of the
// table in docs/DEFENSE.md. The bands themselves are score.js's.

export const BAND_WORD = Object.freeze({
  PROTECTED: 'Protected',
  CONNECTED: 'Connected',
  PERIPHERAL: 'Peripheral',
  NOTABLE: 'Notable',
  UNKNOWN: 'No connection',
});

export const BAND_MEANS = Object.freeze({
  PROTECTED: 'You follow them, or they’re one of your own accounts. Nothing will ever add them to a list.',
  CONNECTED: '3 or more of the people you follow follow them, or 1 does and they have 5,000 followers or more.',
  PERIPHERAL: '1 or 2 of the people you follow follow them.',
  NOTABLE: 'Nobody you follow follows them, but they have 10,000 followers or more, or post a lot to a real audience.',
  UNKNOWN: 'No connection to you at all. Most of any pile-on.',
});
