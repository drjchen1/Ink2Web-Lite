import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { FIGURE_CSS } from './lib/exportHtml.ts';
import './styles.css';

// The preview uses exactly the same figure layout rules as the exported HTML.
const style = document.createElement('style');
style.textContent = FIGURE_CSS;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
