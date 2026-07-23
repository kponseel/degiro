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
