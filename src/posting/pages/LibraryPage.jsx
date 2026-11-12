import { useState } from 'react';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import { useLibrary } from '../library/useLibrary.js';
import LibraryPanel from '../library/LibraryPanel.jsx';
import TemplateEditor from '../library/TemplateEditor.jsx';
import PostingHeader from '../ui/PostingHeader.jsx';
import './hub.css';

/**
 * The library as a page: every shelf (templates, your posts and replies,
 * saved posts, links, feeds, lists, and search), to browse on its own.
 * Using something starts a new post with it in.
 */
export default function LibraryPage({ did }) {
  const composer = useComposer();
  const { accounts } = useAtprotoSession();
  const handle = accounts.find((a) => a.did === did)?.handle || null;
  const lib = useLibrary({ did, isOpen: true, reply: null, selfHandle: handle });
  const [newTemplate, setNewTemplate] = useState(false);

  const onUse = async (item, answers) => {
    // The composer counts a template's use as it applies the plan.
    const plan = await lib.planFor(item, answers);
    composer.open({ asDid: did, attach: plan });
  };

  return (
    <>
      <PostingHeader page="library" />
      <div className="page-body hub">
        <LibraryPanel
          lib={lib}
          mode="page"
          initialShelf="templates"
          verb="Use in a new post"
          onUse={onUse}
          onNewTemplate={() => setNewTemplate(true)}
        />
      </div>
      <TemplateEditor open={newTemplate} did={did} onClose={() => setNewTemplate(false)} />
    </>
  );
}
