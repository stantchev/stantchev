#!/usr/bin/env node
/**
 * terminal-stats.js
 * Generates an animated, terminal-style SVG of your GitHub stats.
 * Zero dependencies. Requires Node 18+ (uses global fetch).
 *
 * Usage:
 *   node terminal-stats.js --user <username> [--out assets/github_stats.svg] [--config config.json]
 *
 * Auth (optional but recommended in CI, raises rate limits):
 *   GITHUB_TOKEN=... node terminal-stats.js --user octocat
 */

'use strict';

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ themes */

const THEMES = {
  dracula:    { bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9', green: '#50fa7b', yellow: '#f1fa8c', red: '#ff5555', dim: '#6272a4' },
  tokyonight: { bg: '#1a1b26', fg: '#a9b1d6', accent: '#7aa2f7', green: '#9ece6a', yellow: '#e0af68', red: '#f7768e', dim: '#565f89' },
  catppuccin: { bg: '#24273a', fg: '#cad3f5', accent: '#c6a0f6', green: '#a6da95', yellow: '#eed49f', red: '#ed8796', dim: '#6e738d' },
  nord:       { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0', green: '#a3be8c', yellow: '#ebcb8b', red: '#bf616a', dim: '#4c566a' },
  gruvbox:    { bg: '#282828', fg: '#ebdbb2', accent: '#fe8019', green: '#b8bb26', yellow: '#fabd2f', red: '#fb4934', dim: '#928374' },
  monokai:    { bg: '#272822', fg: '#f8f8f2', accent: '#f92672', green: '#a6e22e', yellow: '#e6db74', red: '#f92672', dim: '#75715e' },
  hacker:     { bg: '#000000', fg: '#00ff00', accent: '#00ff00', green: '#00ff00', yellow: '#7fff00', red: '#00cc00', dim: '#008800' },
  github:     { bg: '#ffffff', fg: '#24292e', accent: '#0366d6', green: '#22863a', yellow: '#b08800', red: '#d73a49', dim: '#6a737d' },
  ubuntu:     { bg: '#300a24', fg: '#eeeeec', accent: '#df4b1f', green: '#4e9a06', yellow: '#c4a000', red: '#cc0000', dim: '#a89f9b' },
};

/* ------------------------------------------------------------------ config */

const DEFAULTS = {
  theme: 'tokyonight',
  headerStyle: 'mac',        // mac | windows | retro
  hostname: 'github.com',
  typingSpeed: 55,           // ms per character
  linePause: 320,            // ms pause after each command's output
  commands: ['whoami', 'neofetch', 'languages', 'top-repos', 'uptime', 'exit'],
  customCommands: {},        // { "cat bio.txt": "Full Stack Dev" }
  width: 840,
  fontSize: 14,
  loop: true,
};

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

/* ------------------------------------------------------------- data layer */

const API = 'https://api.github.com';

async function gh(url) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'terminal-stats-generator',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GHT;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchStats(username) {
  const user = await gh(`${API}/users/${encodeURIComponent(username)}`);

  const repos = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh(`${API}/users/${encodeURIComponent(username)}/repos?per_page=100&page=${page}&type=owner`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const own = repos.filter(r => !r.fork);
  const stars = own.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const forks = own.reduce((s, r) => s + (r.forks_count || 0), 0);

  const langCount = {};
  for (const r of own) {
    if (!r.language) continue;
    langCount[r.language] = (langCount[r.language] || 0) + 1;
  }
  const langTotal = Object.values(langCount).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => ({ name, pct: (n / langTotal) * 100 }));

  const topRepos = own
    .slice()
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5)
    .map(r => ({ name: r.name, stars: r.stargazers_count || 0, lang: r.language || '-' }));

  const created = new Date(user.created_at);
  const ms = Date.now() - created.getTime();
  const days = Math.floor(ms / 86400000);

  return {
    login: user.login,
    name: user.name || user.login,
    bio: user.bio || '',
    company: user.company || '',
    location: user.location || '',
    followers: user.followers,
    following: user.following,
    publicRepos: user.public_repos,
    publicGists: user.public_gists,
    stars, forks,
    languages,
    topRepos,
    createdAt: created,
    ageYears: Math.floor(days / 365),
    ageDays: days % 365,
    totalDays: days,
  };
}

/* ------------------------------------------------------- command renderers */
/* Each returns an array of "lines". A line is either:
 *   { segs: [{ text, color }] }        -- a text line
 *   { bar: [{ pct, color, label }] }   -- a stacked bar line
 */

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n);

const OCTO = [
  '        ,,,,,,,        ',
  '     .:;;;;;;;;;:.     ',
  '   .;;;         ;;;.   ',
  '  ;;;    o   o    ;;;  ',
  '  ;;;      <      ;;;  ',
  '   ;;;.  \\___/  .;;;   ',
  '    `;;;;;;;;;;;;;`    ',
  '       `\\;;;;;/`       ',
];

function cmdWhoami(d, t) {
  return [
    { segs: [{ text: d.name, color: t.fg }] },
    ...(d.bio ? [{ segs: [{ text: d.bio, color: t.dim }] }] : []),
  ];
}

function cmdNeofetch(d, t) {
  const info = [
    [`${d.login}`, `@${DEFAULTS._hostname || 'github.com'}`],
    null,
    ['Repos', `${d.publicRepos}`],
    ['Stars', `${d.stars}`],
    ['Forks', `${d.forks}`],
    ['Followers', `${d.followers}`],
    ['Following', `${d.following}`],
    ['Gists', `${d.publicGists}`],
  ];
  if (d.location) info.push(['Location', d.location]);
  if (d.company) info.push(['Company', d.company]);

  const rows = Math.max(OCTO.length, info.length);
  const lines = [];
  for (let i = 0; i < rows; i++) {
    const art = OCTO[i] || ' '.repeat(OCTO[0].length);
    const COL_K = OCTO[0].length + 3;   // key column
    const COL_V = COL_K + 13;           // value column
    const segs = [{ text: art, color: t.accent, col: 0 }];
    const item = info[i];
    if (item === null) {
      segs.push({ text: '-'.repeat(24), color: t.dim, col: COL_K });
    } else if (item) {
      if (i === 0) {
        segs.push({ text: item[0] + item[1], color: t.green, col: COL_K });
      } else {
        segs.push({ text: item[0] + ':', color: t.accent, col: COL_K });
        segs.push({ text: item[1], color: t.fg, col: COL_V });
      }
    }
    lines.push({ segs });
  }
  return lines;
}

function cmdLanguages(d, t) {
  if (!d.languages.length) return [{ segs: [{ text: 'no language data', color: t.dim }] }];
  const palette = [t.accent, t.green, t.yellow, t.red, t.dim];
  const lines = [];
  lines.push({ bar: d.languages.map((l, i) => ({ pct: l.pct, color: palette[i % palette.length] })) });
  lines.push({ segs: [{ text: '' }] });
  d.languages.forEach((l, i) => {
    lines.push({
      segs: [
        { text: '\u25CF', color: palette[i % palette.length], col: 2 },
        { text: l.name, color: t.fg, col: 5 },
        { text: l.pct.toFixed(1) + '%', color: t.dim, col: 26 },
      ],
    });
  });
  return lines;
}

function cmdTopRepos(d, t) {
  if (!d.topRepos.length) return [{ segs: [{ text: 'no repositories', color: t.dim }] }];
  const C = { name: 2, lang: 36, stars: 54 };
  const lines = [];
  lines.push({ segs: [
    { text: 'REPOSITORY', color: t.dim, col: C.name },
    { text: 'LANGUAGE', color: t.dim, col: C.lang },
    { text: 'STARS', color: t.dim, col: C.stars },
  ] });
  lines.push({ segs: [{ text: '-'.repeat(58), color: t.dim, col: 2 }] });
  for (const r of d.topRepos) {
    lines.push({ segs: [
      { text: r.name.slice(0, 32), color: t.fg, col: C.name },
      { text: r.lang.slice(0, 16), color: t.accent, col: C.lang },
      { text: '\u2605 ' + r.stars, color: t.yellow, col: C.stars },
    ] });
  }
  return lines;
}

function cmdPs(d, t) {
  const C = { pid: 2, cmd: 12, stat: 48 };
  const lines = [{ segs: [
    { text: 'PID', color: t.dim, col: C.pid },
    { text: 'COMMAND', color: t.dim, col: C.cmd },
    { text: 'STAT', color: t.dim, col: C.stat },
  ] }];
  d.topRepos.forEach((r, i) => {
    lines.push({ segs: [
      { text: String(1000 + i * 137), color: t.dim, col: C.pid },
      { text: r.name.slice(0, 34), color: t.fg, col: C.cmd },
      { text: 'running', color: t.green, col: C.stat },
    ] });
  });
  return lines;
}

function cmdUptime(d, t) {
  const since = d.createdAt.toISOString().slice(0, 10);
  return [{
    segs: [
      { text: '  up ', color: t.dim },
      { text: `${d.ageYears} years, ${d.ageDays} days`, color: t.green },
      { text: `   (since ${since})`, color: t.dim },
    ],
  }];
}

function cmdExit(d, t) {
  return [{ segs: [{ text: 'logout', color: t.dim }] }];
}

const BUILTINS = {
  whoami: cmdWhoami,
  neofetch: cmdNeofetch,
  languages: cmdLanguages,
  'top-repos': cmdTopRepos,
  ps: cmdPs,
  uptime: cmdUptime,
  exit: cmdExit,
};

/* --------------------------------------------------------------- svg build */

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function buildSVG(d, cfg) {
  const t = THEMES[cfg.theme] || THEMES.tokyonight;
  DEFAULTS._hostname = cfg.hostname;

  const FS = cfg.fontSize;
  const CH = FS * 0.6;              // monospace advance width
  const LH = Math.round(FS * 1.55); // line height
  const PADX = 22;
  const HEADER = 38;
  const PADY = 16;

  // Build the full timeline of rows.
  const rows = [];   // { kind:'cmd'|'out', ... , start, dur }
  let clock = 400;

  for (const raw of cfg.commands) {
    const name = String(raw).trim();
    if (!name) continue;

    const prompt = `${d.login}@${cfg.hostname}:~$ `;
    const typeDur = name.length * cfg.typingSpeed;
    rows.push({ kind: 'cmd', prompt, cmd: name, start: clock, dur: typeDur });
    clock += typeDur + 260;

    let outLines = [];
    if (BUILTINS[name]) outLines = BUILTINS[name](d, t);
    else if (cfg.customCommands && cfg.customCommands[name] != null) {
      outLines = String(cfg.customCommands[name]).split('\n').map(x => ({ segs: [{ text: x, color: t.fg }] }));
    } else {
      outLines = [{ segs: [{ text: `bash: ${name}: command not found`, color: t.red }] }];
    }

    for (const l of outLines) {
      rows.push({ kind: 'out', line: l, start: clock });
      clock += 45;
    }
    clock += cfg.linePause;
  }

  clock += 900; // tail pause before loop
  const TOTAL = clock;

  const height = HEADER + PADY * 2 + rows.length * LH + LH;
  const width = cfg.width;

  const pct = ms => ((ms / TOTAL) * 100).toFixed(4);

  const css = [];
  const body = [];

  rows.forEach((r, i) => {
    const y = HEADER + PADY + (i + 1) * LH;

    if (r.kind === 'cmd') {
      const promptW = r.prompt.length * CH;
      const n = Math.max(r.cmd.length, 1);
      const p0 = pct(r.start);
      const p1 = pct(r.start + r.dur);
      const pShow = pct(Math.max(r.start - 120, 0));

      css.push(
        `@keyframes p${i}{0%{opacity:0}${pShow}%{opacity:0}${pct(r.start)}%{opacity:1}100%{opacity:1}}`,
        `@keyframes t${i}{0%{clip-path:inset(0 100% 0 0)}` +
        `${p0}%{clip-path:inset(0 100% 0 0);animation-timing-function:steps(${n},end)}` +
        `${p1}%{clip-path:inset(0 0 0 0)}100%{clip-path:inset(0 0 0 0)}}`
      );

      body.push(
        `<text x="${PADX}" y="${y}" class="ln" fill="${t.green}" style="animation-name:p${i}">${esc(r.prompt)}</text>`,
        `<text x="${PADX + promptW}" y="${y}" class="ln typed" fill="${t.fg}" style="animation-name:t${i}">${esc(r.cmd)}</text>`
      );
      return;
    }

    // output row
    const p0 = pct(r.start);
    const pBefore = pct(Math.max(r.start - 1, 0));
    css.push(`@keyframes p${i}{0%{opacity:0}${pBefore}%{opacity:0}${p0}%{opacity:1}100%{opacity:1}}`);

    if (r.line.bar) {
      const barW = width - PADX * 2 - 20;
      let x = PADX + 10;
      const rects = r.line.bar.map(seg => {
        const w = Math.max((seg.pct / 100) * barW, 2);
        const el = `<rect x="${x.toFixed(1)}" y="${(y - FS + 2).toFixed(1)}" width="${w.toFixed(1)}" height="${(FS * 0.78).toFixed(1)}" rx="2" fill="${seg.color}"/>`;
        x += w;
        return el;
      }).join('');
      body.push(`<g class="ln" style="animation-name:p${i}">${rects}</g>`);
      return;
    }

    const tspans = r.line.segs.map(s => {
      const xAttr = (s.col != null) ? ` x="${(PADX + s.col * CH).toFixed(1)}"` : '';
      return `<tspan${xAttr} fill="${s.color || t.fg}" xml:space="preserve">${esc(s.text)}</tspan>`;
    }).join('');
    body.push(`<text x="${PADX}" y="${y}" class="ln" style="animation-name:p${i}" xml:space="preserve">${tspans}</text>`);
  });

  // Blinking cursor parked at the end
  const lastY = HEADER + PADY + rows.length * LH;
  css.push(`@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}`);

  // Window chrome
  let chrome = '';
  const title = `${d.login}@${cfg.hostname}`;
  if (cfg.headerStyle === 'mac') {
    chrome =
      `<circle cx="${PADX}" cy="${HEADER / 2}" r="6" fill="#ff5f56"/>` +
      `<circle cx="${PADX + 20}" cy="${HEADER / 2}" r="6" fill="#ffbd2e"/>` +
      `<circle cx="${PADX + 40}" cy="${HEADER / 2}" r="6" fill="#27c93f"/>`;
  } else if (cfg.headerStyle === 'windows') {
    const bx = width - PADX - 46;
    chrome =
      `<text x="${bx}" y="${HEADER / 2 + 5}" class="ln vis" fill="${t.dim}" ` +
      `font-size="${FS}">_  \u25A1  \u2715</text>`;
  }

  const headerBlock = cfg.headerStyle === 'retro' ? '' :
    `<rect x="0" y="0" width="${width}" height="${HEADER}" rx="8" fill="${t.bg}"/>` +
    `<rect x="0" y="${HEADER - 8}" width="${width}" height="8" fill="${t.bg}"/>` +
    `<line x1="0" y1="${HEADER}" x2="${width}" y2="${HEADER}" stroke="${t.dim}" stroke-opacity="0.35"/>` +
    chrome +
    `<text x="${width / 2}" y="${HEADER / 2 + 5}" text-anchor="middle" class="ln vis" fill="${t.dim}" font-size="${FS - 1}">${esc(title)}</text>`;

  const iter = cfg.loop ? 'infinite' : '1';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace">
<style>
.ln{font-size:${FS}px;animation-duration:${(TOTAL / 1000).toFixed(2)}s;animation-iteration-count:${iter};animation-fill-mode:both;animation-timing-function:linear}
.ln.vis{animation:none;opacity:1}
.typed{white-space:pre}
.cursor{animation:blink 1s steps(1) infinite}
</style>
<style>
${css.join('\n')}
</style>
<rect width="${width}" height="${height}" rx="10" fill="${t.bg}"/>
<rect width="${width}" height="${height}" rx="10" fill="none" stroke="${t.dim}" stroke-opacity="0.4"/>
${headerBlock}
${body.join('\n')}
<rect class="cursor" x="${PADX}" y="${lastY + LH - FS + 1}" width="${(CH).toFixed(1)}" height="${FS}" fill="${t.accent}"/>
</svg>
`;
}

/* -------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv);
  const cfg = Object.assign({}, DEFAULTS);

  const configPath = args.config || '.github-stats-config.json';
  if (fs.existsSync(configPath)) {
    Object.assign(cfg, JSON.parse(fs.readFileSync(configPath, 'utf8')));
    console.log(`config: loaded ${configPath}`);
  }

  const username = args.user || cfg.username;
  if (!username) {
    console.error('error: pass --user <github-username> (or set "username" in the config file)');
    process.exit(1);
  }

  if (args.theme) cfg.theme = args.theme;
  if (args.out) cfg.out = args.out;
  const outPath = cfg.out || 'assets/github_stats.svg';

  console.log(`fetching stats for ${username} ...`);
  const data = await fetchStats(username);
  console.log(`  ${data.publicRepos} repos, ${data.stars} stars, ${data.followers} followers`);

  const svg = buildSVG(data, cfg);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, svg, 'utf8');
  console.log(`wrote ${outPath} (${(svg.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
