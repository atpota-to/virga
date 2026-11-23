import { Check, KeyRound, Server, Ticket, UserRound, X } from 'lucide-react';
import Dialog from '../components/Dialog.jsx';
import { APP_NAME } from '../config.js';
import { LogoMark } from '../shell/bits.jsx';

// What a sign-in lets Virga do, in a line each. Settings › Permissions has
// every permission with its reason (PERMISSION_GROUPS, src/config.js); these
// are the same things, said shorter, and none is left out: the sentence
// above the list says there is nothing else.
const CAN = [
  'Read your follower list and your notifications',
  'Follow or unfollow, when you press the button',
  'Post, reply and delete posts, and set who can reply or quote, when you ask it to',
  'Upload the pictures and video in your posts',
  'Keep your drafts and post templates',
  'Read your saved posts and reply settings, and search posts, for the composer',
];

const CANNOT = ['See your password', 'Like, repost or read your messages', 'Change your handle, email or profile', 'Delete your account'];

/**
 * What happens when you sign in, for someone who hasn’t met this kind of
 * sign-in: the password goes to the account’s own host and stops there;
 * Virga gets a pass.
 */
export default function HowSigningInWorks({ open, onClose, longSession = false }) {
  return (
    <Dialog open={open} onClose={onClose} title="How signing in works" className="signin-how">
      <div className="signin-how-body">
        <p>It works like “Sign in with Google”: the same open standard, with your account’s host where Google would be.</p>
        <div className="signin-how-flow" role="img" aria-label={`Your password goes only to your host. Your host gives ${APP_NAME} a pass, which you approve.`}>
          <div className="signin-how-stop">
            <span className="signin-how-glyph">
              <UserRound size={18} aria-hidden="true" />
            </span>
            <span>You</span>
          </div>
          <div className="signin-how-link">
            <KeyRound size={14} aria-hidden="true" />
          </div>
          <div className="signin-how-stop">
            <span className="signin-how-glyph">
              <Server size={18} aria-hidden="true" />
            </span>
            <span>Your host</span>
          </div>
          <div className="signin-how-link">
            <Ticket size={14} aria-hidden="true" />
          </div>
          <div className="signin-how-stop">
            <span className="signin-how-glyph signin-how-glyph--mark">
              <LogoMark size={22} />
            </span>
            <span>{APP_NAME}</span>
          </div>
        </div>
        <p>
          You type your password on your host’s own page, and it stays there. {APP_NAME} gets a pass that you approve on that page, for the things
          listed here and nothing else.
        </p>
        <div className="signin-how-asks">
          <div>
            <h3>{APP_NAME} can</h3>
            <ul>
              {CAN.map((line) => (
                <li key={line}>
                  <Check size={14} aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>It can’t</h3>
            <ul>
              {CANNOT.map((line) => (
                <li key={line}>
                  <X size={14} aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="note">
          {longSession
            ? `${APP_NAME}’s server keeps the pass, so you stay signed in for longer and scheduled posts can go out while Virga is closed. Signing out of the last device or browser you use it on ends it.`
            : 'The pass is kept in this browser. Signing out ends it.'}{' '}
          Your posts and everything else in your account stay with your host.
        </p>
      </div>
    </Dialog>
  );
}
