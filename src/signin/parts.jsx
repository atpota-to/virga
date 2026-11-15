import Avatar from '../components/Avatar.jsx';
import { identityMeta, identityName } from './flow.js';

/**
 * An account, as the sign-in shows it: picture, name, and the handle (or DID)
 * under it. `action` sits at the row's end, for a control that acts on this
 * account. `{ did, handle, displayName, avatar }`.
 */
export function IdentityRow({ identity, action = null }) {
  const name = identityName(identity);
  const meta = identityMeta(identity);
  return (
    <div className="signin-identity signin-identity--arriving">
      <Avatar src={identity.avatar} name={name} size="lg" />
      <span className="signin-identity-text">
        <span className="signin-identity-name">{name}</span>
        {meta && <span className="signin-identity-meta">{meta}</span>}
      </span>
      {action}
    </div>
  );
}

/** Bones in the account row's own shape, so nothing moves when the account arrives. */
export function IdentityBones() {
  return (
    <div className="signin-identity signin-identity--bones" aria-hidden="true">
      <span className="signin-bone signin-bone--avatar" />
      <span className="signin-identity-text">
        <span className="signin-bone signin-bone--name" />
        <span className="signin-bone signin-bone--meta" />
      </span>
    </div>
  );
}
