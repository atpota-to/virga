import { SettingsCard } from './SettingsParts.jsx';

/**
 * Settings › Posting: the post adviser. Off unless turned on; says what it
 * sends and to whom. A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function AdviserSettings({ open, onClose, did }) {
  return <SettingsCard title="Post adviser" sub="Off. When it’s on, a post is read before it goes out." />;
}
