const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'glyph' };

export const IconOverview = () => (
  <svg {...base}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
);
export const IconExposure = () => (
  <svg {...base}><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12V2a10 10 0 0 1 10 10Z" /></svg>
);
export const IconHistory = () => (
  <svg {...base}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>
);
export const IconSettings = () => (
  <svg {...base}><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.5" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2.5" /></svg>
);
export const IconAI = () => (
  <svg {...base}><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" /><path d="M18 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" /></svg>
);
export const IconDividends = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-2.5 1-2.5 2s.8 1.6 2.5 2 2.5 1 2.5 2-1 2-2.5 2a3 3 0 0 1-3-1.5" /><path d="M12 6.5v11" /></svg>
);
export const IconAdmin = () => (
  <svg {...base}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M18 4l.9 2.1 2.1.9-2.1.9L18 10l-.9-2.1L15 7l2.1-.9z" /></svg>
);
export const IconHelp = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M9.2 9a2.8 2.8 0 0 1 5.5.8c0 1.9-2.7 2.3-2.7 4" /><line x1="12" y1="17.5" x2="12" y2="17.5" /></svg>
);
export const IconNews = () => (
  <svg {...base}><path d="M4 4h13v16H5a1 1 0 0 1-1-1z" /><path d="M17 8h3v9a3 3 0 0 1-3 3" /><line x1="7" y1="8" x2="13" y2="8" /><line x1="7" y1="12" x2="13" y2="12" /><line x1="7" y1="16" x2="11" y2="16" /></svg>
);
// Bascule de thème : l'icône montre la DESTINATION (soleil quand l'écran est
// sombre), convention la plus répandue et la moins ambiguë au survol.
export const IconTheme = ({ dark }) => (dark ? (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
) : (
  <svg {...base}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></svg>
));
