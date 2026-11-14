// The pieces Settings › Posting is built from, in the same markup as the rest
// of Settings (src/settings/settings.css), for the settings components the
// posting section mounts there.

/** A card with a title and an optional line under it. */
export function SettingsCard({ title, sub = null, tone = null, children }) {
  return (
    <section className="card settings-section" data-tone={tone || undefined}>
      <div className="settings-section-head">
        <h2 className="card-title">{title}</h2>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

/** A row: the label and its hint on the left, the control on the right. */
export function SettingsRow({ label, hint = null, htmlFor = null, children }) {
  return (
    <div className="settings-row">
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
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
