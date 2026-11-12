import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/mona-sans/wdth.css';
import { AtprotoSessionProvider } from './session/useAtprotoSession.jsx';
import './styles/theme.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/app.css';
// After the stylesheets above: a component's own stylesheet comes in with
// the component, and has to land later than the kit's to be able to adjust it.
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AtprotoSessionProvider>
      <App />
    </AtprotoSessionProvider>
  </StrictMode>,
);
