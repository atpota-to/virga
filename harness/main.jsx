// Harness entry: the real app, with the session swapped for a made-up one
// (vite.harness.config.js does the swap). No StrictMode, so effects run once
// and screenshots are stable. Nothing here ships; see harness/README.md.

import ReactDOM from 'react-dom/client';
import '@fontsource-variable/mona-sans/wdth.css';
import { AtprotoSessionProvider } from '../src/session/useAtprotoSession.jsx';
import '../src/styles/theme.css';
import '../src/styles/base.css';
import '../src/styles/controls.css';
import '../src/styles/app.css';
// After the stylesheets above: a component's own stylesheet comes in with
// the component, and has to land later than the kit's to be able to adjust it.
import App from '../src/App.jsx';

// Flag the harness on the root element, so a screenshot is never mistaken
// for the real app.
document.documentElement.setAttribute('data-harness', '1');

ReactDOM.createRoot(document.getElementById('root')).render(
  <AtprotoSessionProvider>
    <App />
  </AtprotoSessionProvider>,
);
