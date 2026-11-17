// The pieces Settings › Posting is built from, in the same markup as the rest
// of Settings (src/settings/settings.css): a band with its heading, a rule in
// ink under it, and its rows between hairlines. The settings components the
// posting section mounts there all use these, so the page reads as one with
// Settings › Appearance.

/**
 * A band of the page: a title, an optional line under it, then its rows.
 * What isn't a row (a paragraph, an editor) gets a row's air and a hairline
 * under it from settings.css.
 */
export function SettingsCard({ title, sub = null, tone = null, children }) {
  return (
    <section className="settings-section" data-tone={tone || undefined}>
      <div className="settings-section-head card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/**
 * A row: the label and its hint on the left, the control on the right, on
 * the label's first line. A `block` row puts its control on a line of its
 * own under them, for one wider than a short column (an editor, a row of
 * tiles). A block row with no label is the control alone, as a row.
 */
export function SettingsRow({ label = null, hint = null, htmlFor = null, block = false, children }) {
  return (
    <div className={block ? 'settings-row settings-row--block' : 'settings-row'}>
      {label && (
        <div className="settings-row-text">
          {htmlFor ? (
            <label className="settings-row-label" htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <div className="settings-row-label">{label}</div>
          )}
          {hint && <div className="settings-row-hint">{hint}</div>}
        </div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}
