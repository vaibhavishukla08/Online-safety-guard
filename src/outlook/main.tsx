import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OutlookTaskPane } from './OutlookTaskPane';
import '../index.css';

// Office.js is loaded by outlook/taskpane.html before this bundle; the pane
// waits for Office.onReady itself and degrades gracefully outside Outlook.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OutlookTaskPane />
  </StrictMode>,
);
