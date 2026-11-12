/**
 * How long a post stays up: off, a time, or a condition. `value` is a
 * TimerRule (timers/selfDestruct.js). A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function LifespanEditor({ value, onChange, fit, publishAt, limits }) {
  return <p className="field-hint">{value?.enabled ? 'This post has a timer.' : 'No timer.'}</p>;
}
