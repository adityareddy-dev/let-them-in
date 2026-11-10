// Builds the demo video from real recordings: title cards, the shoppers' own browser videos sped up,
// and a scroll through the report. Captions are burned in and also written as an .srt file.
// Usage: tsx scripts/video.ts <story.json> <out.mp4>

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const W = 1280;
const H = 720;
const FONT = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf';

type Caption = { at: number; dur: number; text: string };
type Segment =
  | { kind: 'card'; title: string; lines?: string[]; seconds: number; captions?: Caption[] }
  | { kind: 'clip'; file: string; from?: number; to?: number; speed: number; label: string; captions?: Caption[] }
  | { kind: 'page'; file: string; seconds: number; scrollTo: { selector: string; at: number }[]; captions?: Caption[] };

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const probe = (f: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
const encode = ['-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const dt = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%');

function cardHtml(title: string, lines: string[]): string {
  return `<!doctype html><html lang="en"><body style="margin:0;width:${W}px;height:${H}px;background:#16182d;color:#fff;font-family:'Noto Sans',sans-serif;display:flex;align-items:center;justify-content:center">
<div style="max-width:1040px">
<div style="display:flex;align-items:center;gap:18px;margin-bottom:28px">
<svg width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="12" fill="#c2410c"/><path d="M20 50V14h24v36" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M20 14l14 5v35l-14-4z" fill="#fff"/><circle cx="30" cy="34" r="2.2" fill="#c2410c"/></svg>
<span style="font-size:30px;font-weight:700;letter-spacing:.5px">Let Them In</span></div>
<h1 style="font-size:54px;line-height:1.15;margin:0 0 22px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:28px;line-height:1.4;margin:0 0 10px;color:#d9dbea">${esc(l)}</p>`).join('')}
</div></body></html>`;
}

async function renderCard(seg: Extract<Segment, { kind: 'card' }>, out: string, tmp: string) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(cardHtml(seg.title, seg.lines ?? []));
  const png = join(tmp, 'card.png');
  await p.screenshot({ path: png });
  await b.close();
  ff(['-loop', '1', '-t', String(seg.seconds), '-i', png, '-vf', `scale=${W}:${H}`, ...encode, out]);
}

function renderClip(seg: Extract<Segment, { kind: 'clip' }>, out: string) {
  const from = seg.from ?? 0;
  const len = (seg.to ?? probe(seg.file)) - from;
  const label = `drawtext=fontfile=${FONT}:text='${dt(seg.label)}':x=20:y=20:fontsize=26:fontcolor=white:box=1:boxcolor=0x16182dcc:boxborderw=12`;
  ff([
    '-ss', String(from), '-t', String(len), '-i', seg.file,
    '-vf', `setpts=PTS/${seg.speed},fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x16182d,${label}`,
    ...encode, out,
  ]);
}

async function renderPage(seg: Extract<Segment, { kind: 'page' }>, out: string, tmp: string) {
  const vdir = join(tmp, 'page-video');
  rmSync(vdir, { recursive: true, force: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  await p.goto('file://' + resolve(seg.file));
  await p.waitForTimeout(600);
  const t0 = Date.now();
  for (const s of seg.scrollTo) {
    const wait = s.at * 1000 - (Date.now() - t0);
    if (wait > 0) await p.waitForTimeout(wait);
    await p.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), s.selector);
  }
  const rest = seg.seconds * 1000 - (Date.now() - t0);
  if (rest > 0) await p.waitForTimeout(rest);
  await ctx.close();
  await b.close();
  const webm = readdirSync(vdir).find((f) => f.endsWith('.webm'))!;
  // skip the blank first moment while the page loads
  ff(['-ss', '0.6', '-t', String(seg.seconds), '-i', join(vdir, webm), '-vf', `fps=30,scale=${W}:${H}`, ...encode, out]);
}

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

async function main() {
  const [storyFile, outFile] = process.argv.slice(2);
  const story = JSON.parse(readFileSync(storyFile, 'utf8')) as { segments: Segment[] };
  const tmp = join(dirname(resolve(outFile)), '.video-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const parts: string[] = [];
  const subs: { start: number; end: number; text: string }[] = [];
  let clock = 0;
  for (const [i, seg] of story.segments.entries()) {
    const out = join(tmp, `seg-${String(i).padStart(2, '0')}.mp4`);
    if (seg.kind === 'card') await renderCard(seg, out, tmp);
    else if (seg.kind === 'clip') renderClip(seg, out);
    else await renderPage(seg, out, tmp);
    const d = probe(out);
    for (const c of seg.captions ?? []) subs.push({ start: clock + c.at, end: clock + Math.min(d, c.at + c.dur), text: c.text });
    parts.push(out);
    console.log(`segment ${i} ${seg.kind}: ${d.toFixed(1)} s`);
    clock += d;
  }
  const list = join(tmp, 'list.txt');
  writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n') + '\n');
  const joined = join(tmp, 'joined.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const srt = outFile.replace(/\.mp4$/, '.srt');
  writeFileSync(srt, subs.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n'));
  const style = 'FontName=Noto Sans,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&HC02D1816,BorderStyle=4,Outline=0,Shadow=0,MarginV=28,Bold=1';
  ff(['-i', joined, '-vf', `subtitles=${srt.replace(/:/g, '\\:')}:force_style='${style}'`, ...encode, '-movflags', '+faststart', outFile]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${outFile}: ${probe(outFile).toFixed(1)} s, captions in ${srt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

