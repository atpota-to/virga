import './charts.css';

/**
 * A small line for a figure's trend: no axes, no labels (the figure beside
 * it is the number). Drawn in a 100×30 box stretched to fit, with a stroke
 * that keeps its width. Decorative to a screen reader: the figure says it.
 */
export default function Sparkline({ values, area = true, className = '' }) {
  const pts = (values || []).filter((v) => v != null && Number.isFinite(v));
  if (pts.length < 2) return <svg className={`sparkline ${className}`.trim()} aria-hidden="true" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i) => (i / (pts.length - 1)) * 100;
  const y = (v) => 28 - ((v - min) / span) * 26;
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
  return (
    <svg className={`sparkline ${className}`.trim()} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      {area && <path className="sparkline-area" d={`${line}L100,30L0,30Z`} />}
      <path className="sparkline-line" d={line} />
    </svg>
  );
}
