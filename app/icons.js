// Hand-drawn 24×24 stroke icons (inline SVG, no icon font, no CDN).
const P = {
  tonight: '<path d="M3 18.5h18"/><path d="M5 18.5a7 7 0 0 1 14 0"/><path d="M12 11.5V9.5"/><path d="M10.5 9.5h3"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7.5 14h2"/><path d="M11 14h2"/><path d="M14.5 14h2"/><path d="M7.5 17h2"/>',
  list: '<path d="M10 6.5h10"/><path d="M10 12h10"/><path d="M10 17.5h10"/><path d="M4 6.5l1.2 1.2L7.5 5.3"/><path d="M4 12l1.2 1.2 2.3-2.4"/><path d="M4.5 17.5h2"/>',
  pantry: '<path d="M8 3.5h8"/><path d="M8.5 3.5v2.6C6.5 7 5.5 8.6 5.5 10.6V18a2.5 2.5 0 0 0 2.5 2.5h8a2.5 2.5 0 0 0 2.5-2.5v-7.4c0-2-1-3.6-3-4.5V3.5"/><path d="M5.5 12h13"/><path d="M5.5 16.5h13"/>',
  recipes: '<path d="M12 6.2C10 4.7 7 4.2 4 4.7V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.7c-3-.5-6 0-8 1.5z"/><path d="M12 6.2v14.3"/>',
  budget: '<path d="M3.5 8h15a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18.5 20h-12A3 3 0 0 1 3.5 17z"/><path d="M3.5 8.5V7a2.5 2.5 0 0 1 2-2.4L15.5 3l1 5"/><path d="M16.5 14h1.5"/>',
  family: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.2 14.3c2.7.3 4.8 2.5 4.8 5.7"/>',
  swap: '<path d="M4 8h14"/><path d="M14.5 4.5L18 8l-3.5 3.5"/><path d="M20 16H6"/><path d="M9.5 12.5L6 16l3.5 3.5"/>',
  away: '<path d="M3.5 11.5L12 4.5l8.5 7"/><path d="M5.5 10v10h6.5"/><path d="M15 16h6.5"/><path d="M18.5 13l3 3-3 3"/>',
  home: '<path d="M3.5 11.5L12 4.5l8.5 7"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16.2 9.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10.2a5 5 0 0 1-10 0c0-2.6 1.4-4.2 2.6-5.2.2 1.7 1 2.7 2.1 3.1C11 8.6 11 6 12 3z"/>',
  blackstone: '<path d="M3 11h18v2.5H3z"/><path d="M5.5 13.5V20"/><path d="M18.5 13.5V20"/><path d="M8 8c0-1.2 1.2-1.3 1.2-2.6"/><path d="M12 8c0-1.2 1.2-1.3 1.2-2.6"/><path d="M16 8c0-1.2 1.2-1.3 1.2-2.6"/>',
  microwave: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><rect x="5.5" y="8" width="9.5" height="8" rx="1"/><path d="M18 9v.01"/><path d="M18 12v.01"/><path d="M18 15v.01"/>',
  airfryer: '<path d="M6 20.5h12"/><path d="M7 20.5V9.5a5 5 0 0 1 10 0v11"/><path d="M9.5 13h5v4h-5z"/><path d="M12 6.5v.01"/>',
  stovetop: '<path d="M4 10.5h16"/><path d="M5.5 10.5v6.5a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3v-6.5"/><path d="M2.5 10.5H4"/><path d="M20 10.5h1.5"/><path d="M9.5 7c0-1.2 1.2-1.3 1.2-2.6"/><path d="M13.5 7c0-1.2 1.2-1.3 1.2-2.6"/>',
  grill: '<path d="M4 10h16a8 8 0 0 1-16 0z"/><path d="M8.5 17.5L6.5 21"/><path d="M15.5 17.5l2 3.5"/><path d="M8.5 6.5v1"/><path d="M12 5.5v2"/><path d="M15.5 6.5v1"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  up_vote: '<path d="M7.5 10.5v9.5H4.5v-9.5z"/><path d="M7.5 10.5l3.6-6.3c.9-.4 2.3.2 2.3 1.6l-.6 3.7H18a2 2 0 0 1 2 2.3l-1.1 6.2a2.4 2.4 0 0 1-2.4 2H7.5"/>',
  down_vote: '<path d="M7.5 13.5V4H4.5v9.5z"/><path d="M7.5 13.5l3.6 6.3c.9.4 2.3-.2 2.3-1.6l-.6-3.7H18a2 2 0 0 0 2-2.3l-1.1-6.2A2.4 2.4 0 0 0 16.5 4H7.5"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  share: '<path d="M12 4v11"/><path d="M8 7.5L12 4l4 3.5"/><path d="M6 11.5v7a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-7"/>',
  print: '<path d="M7 8.5V4h10v4.5"/><rect x="3.5" y="8.5" width="17" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  undo: '<path d="M8.5 5L4.5 9l4 4"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>',
  edit: '<path d="M14.5 5.5l4 4"/><path d="M4.5 19.5l1-4.5L16 4.5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9 18.5z"/>',
  store: '<path d="M4 9.5L5.5 4.5h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12v8h13v-8"/><path d="M10 20v-4.5h4V20"/>',
  snow: '<path d="M12 3v18"/><path d="M4.2 7.5l15.6 9"/><path d="M19.8 7.5l-15.6 9"/><path d="M9.5 4.5L12 6l2.5-1.5"/><path d="M9.5 19.5L12 18l2.5 1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1-.5 8.9z"/>',
  cloudOff: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 1.2-2.6"/><path d="M10.5 4.4A6 6 0 0 1 18 9.6a4.5 4.5 0 0 1 2.2 7.6"/><path d="M17.5 18.5H7"/><path d="M4 4l16 16"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  more: '<path d="M5.5 12h.01"/><path d="M12 12h.01"/><path d="M18.5 12h.01"/>',
  sparkle: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  move: '<path d="M4 12h12"/><path d="M12 7.5l4.5 4.5-4.5 4.5"/><path d="M20 5v14"/>',
  leaf: '<path d="M5 19c0-8 5-13.5 14-14 .4 8.6-5 14-12.5 14z"/><path d="M5 19l7-7"/>',
  cart: '<path d="M3.5 4.5h2l2.2 10.5h10l2-7.5H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  receipt: '<path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5z"/><path d="M9 8h6"/><path d="M9 11.5h6"/><path d="M9 15h3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="M5.3 5.3l1.4 1.4"/><path d="M17.3 17.3l1.4 1.4"/><path d="M5.3 18.7l1.4-1.4"/><path d="M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  drag: '<path d="M9 6h.01"/><path d="M15 6h.01"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M9 18h.01"/><path d="M15 18h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bowl: '<path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z"/><path d="M8 20.5h8"/>',
  lunch: '<path d="M4.5 9.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/><path d="M9 9.5V7a3 3 0 0 1 6 0v2.5"/><path d="M4.5 13.5h15"/><path d="M11 13.5v2h2v-2"/>',
  textSize: '<path d="M4 18L8.5 6 13 18"/><path d="M5.6 14h5.8"/><path d="M15 18l2.8-7.5 2.7 7.5"/><path d="M15.9 15.8h3.8"/>',
  // v3 additions (docs/spec/19-design.md): the PossibleCooker, and a few for the newer screens.
  cooker: '<path d="M5 10.5h14v6a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 16.5z"/><path d="M7.5 10.5c.3-2.4 2.2-4 4.5-4s4.2 1.6 4.5 4"/><path d="M12 6.5V5"/><path d="M2.5 13H5"/><path d="M19 13h2.5"/><path d="M10.5 16h3"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7"/><path d="M12 17v3.5"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-9"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.2 1.6"/><path d="M10 3.5h4"/><path d="M12 3.5v3"/>',
  bin: '<path d="M5 8h14l-1.2 11a1.7 1.7 0 0 1-1.7 1.5H7.9A1.7 1.7 0 0 1 6.2 19z"/><path d="M4 8l1.2-3h13.6L20 8"/><path d="M10 12v5"/><path d="M14 12v5"/>',
};

// Larger glyphs for photo placeholders (48×48 viewBox).
const G = {
  Burgers: '<path d="M9 20c0-7 6.5-11 15-11s15 4 15 11z"/><path d="M8 25.5h32"/><path d="M8.5 31h31"/><path d="M9 31c0 5 3.5 8 15 8s15-3 15-8"/><path d="M18 15h.01"/><path d="M24 13h.01"/><path d="M30 15h.01"/>',
  'Asian-inspired': '<path d="M6 25h36a18 18 0 0 1-36 0z"/><path d="M16 43h16"/><path d="M27 21L41 5"/><path d="M31 22L44 9"/><path d="M14 19c0-2 2-2 2-4"/><path d="M20 19c0-2 2-2 2-4"/>',
  Pasta: '<path d="M24 4v14"/><path d="M19 4v8a5 5 0 0 0 10 0V4"/><path d="M24 18v8"/><ellipse cx="24" cy="34" rx="15" ry="7"/><path d="M14 33c3-3 6 2 10-1s7 2 10-1"/>',
  'Tex-Mex': '<path d="M5 34a19 19 0 0 1 38 0z"/><path d="M12 27c2-3 5-2 7 0s5 2 7 0 5-2 7 0 4 1 6 0"/><path d="M5 34h38"/>',
  Grill: '<path d="M7 20h34a17 17 0 0 1-34 0z"/><path d="M15 34l-4 9"/><path d="M33 34l4 9"/><path d="M17 14v-4"/><path d="M24 13V7"/><path d="M31 14v-4"/>',
  Comfort: '<path d="M8 20h32v12a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z"/><path d="M4 20h4"/><path d="M40 20h4"/><path d="M8 20c0-3 7-5 16-5s16 2 16 5"/><path d="M18 10c0-2.5 2-2.5 2-5"/><path d="M27 10c0-2.5 2-2.5 2-5"/>',
  Salads: '<path d="M5 24h38a19 19 0 0 1-38 0z"/><path d="M14 24c-2-6 2-12 8-12 0 6-4 10-8 12z"/><path d="M24 24c0-7 5-12 12-12-1 7-5 11-12 12z"/><path d="M30 24c2-3 5-4 8-4"/>',
  Pizza: '<path d="M24 44L6 10c11-6 25-6 36 0z"/><path d="M9 16c10-5 20-5 30 0"/><circle cx="20" cy="22" r="2.5"/><circle cx="28" cy="27" r="2.5"/><circle cx="23" cy="33" r="2"/>',
  'lunch-main': '<path d="M6 22c0-8 8-13 18-13s18 5 18 13z"/><path d="M6 26h36"/><path d="M7 26c2 3 5 2 7 0s5-2 7 0 5 2 7 0 5-2 7 0 4 2 6 0"/><path d="M6 31h36v5a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/>',
  'lunch-side': '<path d="M12 8h24l-2 6 3 26H11l3-26z"/><path d="M14 14h20"/><path d="M19 24l4 4 6-7"/>',
  'lunch-snack': '<circle cx="24" cy="24" r="16"/><circle cx="18" cy="19" r="1.8"/><circle cx="28" cy="17" r="1.8"/><circle cx="30" cy="27" r="1.8"/><circle cx="20" cy="30" r="1.8"/>',
  'lunch-drink': '<path d="M16 10h16l-2 32H18z"/><path d="M15 18h18"/><path d="M26 10l4-6h6"/>',
  side: '<path d="M5 26h38a19 19 0 0 1-38 0z"/><path d="M17 20c0-4 3-7 7-7s7 3 7 7"/><path d="M14 43h20"/>',
  shelf: '<path d="M14 8h20"/><path d="M15 8v4c-3 1.5-4 3.6-4 6.3V38a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V18.3c0-2.7-1-4.8-4-6.3V8"/><path d="M11 22h26"/><path d="M11 32h26"/>',
};

export function icon(name, { size = 22, label = '', cls = '' } = {}) {
  const body = P[name] || P.info;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

export function glyph(category, { size = 56 } = {}) {
  const body = G[category] || G.Comfort;
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const EQUIPMENT_ICON = {
  stovetop: 'stovetop', blackstone: 'blackstone', 'electric grill': 'grill', 'outdoor grill': 'grill', 'air fryer': 'airfryer', microwave: 'microwave', 'possible cooker': 'cooker',
};
