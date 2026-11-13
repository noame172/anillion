// Generates the placeholder hero artwork: one original SVG per form.
// Replace the files in public/hero/<form>/hero.svg with final artwork at any time;
// keep the same file names and a 240x320 portrait canvas.
import fs from 'node:fs';
import path from 'node:path';

const forms = {
  base: {
    hair: '#2b2140', hairHi: '#4a3a6b', eye: '#1d1730', trim: '#ff7a1a', glow: 'none',
    hairPath: 'M70 96 L62 60 L84 74 L88 40 L108 66 L122 30 L134 66 L156 42 L156 76 L180 62 L170 98 Z',
  },
  ascended: {
    hair: '#ffc21a', hairHi: '#fff1a8', eye: '#0f8f7a', trim: '#ffd23f', glow: '#ffd23f',
    hairPath: 'M68 98 L50 52 L80 70 L78 20 L106 58 L120 4 L136 58 L164 18 L160 70 L192 50 L172 98 Z',
  },
  azure: {
    hair: '#1e9bff', hairHi: '#a8e4ff', eye: '#0b63c9', trim: '#2aa8ff', glow: '#2aa8ff',
    hairPath: 'M68 98 L46 56 L78 70 L72 14 L104 56 L120 0 L138 56 L170 12 L162 70 L196 54 L172 98 Z',
  },
  ultra: {
    hair: '#e8eef7', hairHi: '#ffffff', eye: '#9fb4d0', trim: '#cfe3ff', glow: '#ffffff',
    hairPath: 'M70 98 L56 62 L82 74 L84 34 L108 64 L122 22 L134 64 L158 36 L158 74 L184 64 L170 98 Z',
  },
};

const svg = (f, name) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" role="img" aria-label="Anillion hero, ${name} form">
  <defs>
    <linearGradient id="jacket" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#27346b"/><stop offset="1" stop-color="#161d45"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${f.hairHi}"/><stop offset="0.6" stop-color="${f.hair}"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <ellipse cx="120" cy="306" rx="62" ry="8" fill="#000" opacity="0.35"/>
  <!-- legs -->
  <path d="M92 214 L78 296 L104 296 L118 232 L136 296 L162 296 L148 214 Z" fill="#141a3c"/>
  <path d="M74 292 h34 v12 h-38 z M132 292 h34 v12 h-34 z" fill="${f.trim}"/>
  <!-- torso -->
  <path d="M82 132 Q120 116 158 132 L152 220 Q120 232 88 220 Z" fill="url(#jacket)"/>
  <path d="M120 126 L104 220 L136 220 Z" fill="#f4f1ea"/>
  <path d="M100 128 L120 176 L140 128 L132 124 L120 150 L108 124 Z" fill="${f.trim}"/>
  <path d="M86 206 h68 v14 h-68 z" fill="${f.trim}"/>
  <path d="M128 206 l22 38 l-12 4 l-18 -40 z" fill="${f.trim}" opacity="0.85"/>
  <!-- arms -->
  <path d="M82 134 L52 176 L66 210 L84 200 L76 178 L94 158 Z" fill="url(#jacket)"/>
  <path d="M158 134 L188 176 L174 210 L156 200 L164 178 L146 158 Z" fill="url(#jacket)"/>
  <circle cx="72" cy="210" r="13" fill="#f2c6a0"/><circle cx="168" cy="210" r="13" fill="#f2c6a0"/>
  <path d="M60 196 h24 v8 h-24 z M156 196 h24 v8 h-24 z" fill="${f.trim}"/>
  <!-- head -->
  <path d="M108 118 h24 v16 h-24 z" fill="#e0b08a"/>
  <path d="M84 84 Q84 126 120 128 Q156 126 156 84 Q156 60 120 60 Q84 60 84 84 Z" fill="#f2c6a0"/>
  <path d="M${'96 92 l20 5 l0 4 l-20 -3 z'} M144 92 l-20 5 l0 4 l20 -3 z" fill="${f.hair === '#e8eef7' ? '#8fa3bf' : f.hair}"/>
  <path d="M98 102 q9 -4 16 1 q-8 7 -16 -1 z M142 102 q-9 -4 -16 1 q8 7 16 -1 z" fill="#fff"/>
  <circle cx="107" cy="103" r="3.6" fill="${f.eye}"/><circle cx="133" cy="103" r="3.6" fill="${f.eye}"/>
  <path d="M110 116 q10 5 20 0" stroke="#7a4a35" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <!-- hair -->
  <g ${f.glow === 'none' ? '' : 'filter="url(#glow)"'}>
    <path d="${f.hairPath}" fill="url(#hair)" stroke="${f.hair}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M84 90 L80 112 L94 96 Z M156 90 L160 112 L146 96 Z" fill="${f.hair}"/>
  </g>
</svg>
`;

for (const [name, f] of Object.entries(forms)) {
  const dir = path.join('public', 'hero', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hero.svg'), svg(f, name));
}
console.log('hero art written for', Object.keys(forms).join(', '));
