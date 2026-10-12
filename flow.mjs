#!/usr/bin/env node
// Drive Google Flow (flow.google.com) in an already signed-in Chrome over the DevTools protocol, so a Google AI
// subscription's Veo can be used from scripts. See README.md.
//
//   node flow.mjs video --prompt "shot" --out clip.mp4 [--first start.png] [--last end.png]
//                       [--model "Veo 3.1 - Fast"] [--aspect 9:16] [--max-credits 20] [--project URL]
//                       [--account you@gmail.com] [--timeout 1500] [--resolution 720p]
//
// Prints the Flow project URL, the agent's plan and the quoted credits, then the saved path.
import { existsSync, readdirSync, renameSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { lastQuote, lastPlan, flowModel, videoPrompt, judgeQuote } from './lib.mjs';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const DOWNLOADS = process.env.FLOW_DOWNLOADS || join(homedir(), 'Downloads');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[flow]', ...a);
class FlowError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
// Throws, so `finally` blocks close the tab; the handler at the bottom prints it and sets the exit code.
const die = (msg, code = 1) => { throw new FlowError(msg, code); };

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else o._.push(a);
  }
  return o;
}

class Tab {
  static async open(url) {
    const t = await (await fetch(`${CDP_URL}/json/new`, { method: 'PUT' })).json();
    const tab = new Tab(t);
    await tab.connect();
    await tab.go(url);
    return tab;
  }
  constructor(t) { this.t = t; this.n = 0; this.wait = {}; this.events = []; }
  async connect() {
    this.ws = new WebSocket(this.t.webSocketDebuggerUrl);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.wait[d.id]) { this.wait[d.id](d); delete this.wait[d.id]; } else if (d.method) this.events.push(d);
    };
    for (const d of ['Page', 'DOM', 'Runtime']) await this.send(`${d}.enable`);
  }
  send(method, params = {}) {
    return new Promise((r) => { const id = ++this.n; this.wait[id] = r; this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async ev(expression) {
    const d = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || 'page error');
    return d.result?.result?.value;
  }
  async go(url) { await this.send('Page.navigate', { url }); await sleep(8000); }
  async click(x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  // Centre of the last visible element whose own text is exactly `text`, scrolled into view.
  async find(text, { tag = '*' } = {}) {
    // Same rule as labelMatches in lib.mjs: the exact text, or one Material icon name and then the text.
    return this.ev(`(()=>{const want=${JSON.stringify(text)}; const els=[...document.querySelectorAll(${JSON.stringify(tag)})].filter(e=>{
      const t=(e.innerText||'').trim().replace(/\\s+/g,' '); const ok=t===want||(t.endsWith(' '+want)&&/^[a-z_]+$/.test(t.slice(0,-want.length-1)));
      return ok && e.getBoundingClientRect().width>0});
      const e=els.pop(); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();
      return [Math.round(r.x+r.width/2), Math.round(r.y+r.height/2)]})()`);
  }
  async clickText(text, opts) {
    const p = await this.find(text, opts);
    if (!p) return false;
    await this.click(...p);
    return true;
  }
  text() { return this.ev('document.body.innerText'); }
  close() { this.ws.close(); return fetch(`${CDP_URL}/json/close/${this.t.id}`); }
}

// First-run screens Flow puts in the way: welcome, privacy notice (Continue unlocks after scrolling), changelogs.
async function clearPopups(tab) {
  for (let i = 0; i < 6; i++) {
    const t = await tab.text();
    if (/Review our privacy policy/.test(t)) {
      await tab.ev(`[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+20&&/Your data and Google Flow/.test(e.innerText)).forEach(e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'))})`);
      await sleep(800);
      await tab.clickText('Continue', { tag: 'button' });
    } else if (!(await tab.clickText('Get started', { tag: 'button' }))) return;
    await sleep(1500);
  }
}

async function openProject(o) {
  const account = o.account || process.env.FLOW_ACCOUNT;
  const q = account ? `?authuser=${encodeURIComponent(account)}` : '';
  const project = o.project || process.env.FLOW_PROJECT;
  const tab = await Tab.open(project ? project + q : `https://flow.google.com/${q}`);
  try {
    await clearPopups(tab);
    if (!project) {
      await tab.clickText('Next', { tag: 'button' }); // the welcome screen on a first visit
      await clearPopups(tab);
      if (!(await tab.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/New project/.test(b.innerText)); if(b) b.click(); return !!b})()`)))
        die('no "New project" button: is this Chrome signed in to an account with Flow?');
      await sleep(8000);
      await clearPopups(tab);
    }
    const url = await tab.ev('location.href');
    if (!/\/project\//.test(url)) die(`not in a Flow project: ${url}`);
    if (!/ULTRA|PRO/.test(await tab.text())) log('warning: no ULTRA/PRO badge on the page');
    console.log(`project ${url.split('?')[0]}`);
    return tab;
  } catch (e) { await tab.close(); throw e; }
}

// The composer's own "+" (the page has others), found next to the prompt box.
async function composerAdd(tab) {
  return tab.ev(`(()=>{const box=document.querySelector('textarea,[contenteditable=true]'); if(!box) return null;
    const br=box.getBoundingClientRect(); const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='add')
      .map(b=>[b,b.getBoundingClientRect()]).filter(([,r])=>r.y>br.y-20&&r.y<br.y+160&&r.x>br.x-80&&r.x<br.x+120).pop();
    return b?[Math.round(b[1].x+b[1].width/2),Math.round(b[1].y+b[1].height/2)]:null})()`);
}

// A reused project keeps whatever an earlier run left attached to the prompt box; remove it first.
async function clearComposer(tab) {
  for (let i = 0; i < 5; i++) {
    const x = await tab.ev(`(()=>{const box=document.querySelector('textarea,[contenteditable=true]'); if(!box) return null;
      const br=box.getBoundingClientRect(); const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='close')
        .map(b=>b.getBoundingClientRect()).find(r=>r.width>0&&r.y<br.y&&r.y>br.y-140&&r.x>br.x);
      return b?[Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]:null})()`);
    if (!x) return;
    await tab.click(...x);
    await sleep(800);
  }
}

async function attach(tab, file) {
  const name = basename(file);
  const plus = await composerAdd(tab);
  if (!plus) die('could not find the prompt box\'s + button');
  await tab.click(...plus);
  await sleep(2000);
  const up = await tab.find('Upload media');
  if (!up) die('no "Upload media" in the asset picker');
  await tab.send('Page.setInterceptFileChooserDialog', { enabled: true });
  tab.events.length = 0;
  await tab.click(...up);
  const t0 = Date.now(); let ev;
  while (!(ev = tab.events.find((e) => e.method === 'Page.fileChooserOpened')) && Date.now() - t0 < 10000) await sleep(200);
  if (!ev) die('the file chooser never opened');
  await tab.send('DOM.setFileInputFiles', { files: [resolve(file)], backendNodeId: ev.params.backendNodeId });
  await tab.send('Page.setInterceptFileChooserDialog', { enabled: false });
  await sleep(2000);
  await tab.clickText('I agree', { tag: 'button' }); // "Rights to use this image", shown on uploads
  // Wait for the newest row with this file name to have a loaded thumbnail, then pick it.
  const row = `[...document.querySelectorAll('button')].filter(b=>b.innerText.split('\\n')[0].trim()===${JSON.stringify(name)})[0]`;
  for (let i = 0; i < 60; i++) {
    const ready = await tab.ev(`(()=>{const b=${row}; const img=b&&b.querySelector('img'); return !!(img&&img.complete&&img.naturalWidth>0)})()`);
    if (ready) break;
    if (i === 59) die(`upload of ${name} never finished`);
    await sleep(2000);
  }
  await tab.ev(`${row}.click()`);
  await sleep(1500);
  // Clicking the row either previews it (then "Add to prompt") or attaches it at once and closes the picker.
  const pickerOpen = async () => !!(await tab.find('Upload media'));
  if (await pickerOpen()) {
    if (!(await tab.clickText('Add to prompt', { tag: 'button' }))) die('no "Add to prompt" button');
    await sleep(1500);
    if (await pickerOpen()) die(`${name} did not attach: the asset picker is still open`);
  }
  log(`attached ${name}`);
}

async function ask(tab, prompt) {
  const before = (await tab.text()).match(/costing\s+[\d,]+\s+credits?/gi)?.length || 0;
  const ok = await tab.ev(`(()=>{const el=document.querySelector('textarea,[contenteditable=true]'); if(!el) return false; el.focus();
    return document.execCommand('insertText', false, ${JSON.stringify(prompt)})})()`);
  if (!ok) die('could not type into the prompt box');
  const send = await tab.ev(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='arrow_forward').pop();
    if(!b) return null; const r=b.getBoundingClientRect(); return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`);
  if (!send) die('no send button');
  await tab.click(...send);
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const t = await tab.text();
    if ((t.match(/costing\s+[\d,]+\s+credits?/gi)?.length || 0) > before) return { credits: lastQuote(t), plan: lastPlan(t) };
  }
  die('the agent never quoted a cost; read the chat in the Flow tab');
}

const failures = (text) => (text.match(/Something went wrong/g) || []).length;

const tiles = (tab, kind) => tab.ev(`[...document.querySelectorAll('flow-${kind}-tile')].map(t=>{
  const c=t.closest('[aria-label]'); const img=t.querySelector('img'); const r=t.getBoundingClientRect();
  return {label:c?c.getAttribute('aria-label'):'', ready:!!(img&&img.complete&&img.naturalWidth>0)&&!/\\d+%/.test(t.innerText),
    x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}})`);

async function download(tab, tile, out, resolution, ext) {
  const start = Date.now();
  await tab.click(tile.x, tile.y);
  await sleep(5000);
  if (!(await tab.clickText('download', { tag: 'button' }))) die('no download button in the editor');
  await sleep(1500);
  if (!(await tab.clickText(resolution))) die(`no "${resolution}" in the download menu`);
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const f = readdirSync(DOWNLOADS).filter((n) => n.endsWith(ext)).map((n) => join(DOWNLOADS, n))
      .find((p) => statSync(p).mtimeMs >= start - 1000);
    if (f && statSync(f).size > 10000) {
      try { renameSync(f, out); } catch { copyFileSync(f, out); unlinkSync(f); }
      return out;
    }
  }
  die(`nothing arrived in ${DOWNLOADS}; set FLOW_DOWNLOADS if Chrome saves elsewhere`);
}

async function video(o) {
  if (!o.prompt || !o.out) die('video needs --prompt and --out');
  for (const f of [o.first, o.last].filter(Boolean)) if (!existsSync(f)) die(`no such file: ${f}`);
  const model = flowModel(o.model || 'Veo 3.1 - Fast');
  const max = Number(o['max-credits'] || 20);
  const tab = await openProject(o);
  try {
    await clearComposer(tab);
    if (o.first) await attach(tab, o.first);
    if (o.last) await attach(tab, o.last);
    const seen = new Set((await tiles(tab, 'video')).map((t) => t.label));
    const before = (await tiles(tab, 'video')).length;
    const { credits, plan } = await ask(tab, videoPrompt({ prompt: o.prompt, model, aspect: o.aspect || '9:16', first: o.first, last: o.last }));
    console.log(`plan ${plan}`);
    console.log(`credits ${credits}`);
    const problem = judgeQuote({ credits, plan, model, max, first: !!o.first });
    if (problem) {
      if (!(await tab.clickText('Reject'))) log('could not click Reject; the quote is left unanswered');
      die(`rejected: ${problem}`, 3);
    }
    const failsBefore = failures(await tab.text());
    if (!(await tab.clickText('Approve'))) die('no Approve control');
    log('approved; waiting for the clip');
    const deadline = Date.now() + Number(o.timeout || 1500) * 1000;
    let lastReload = Date.now();
    let failedAt = 0;
    for (;;) {
      await sleep(15000);
      // Flow's chat can keep saying "waiting in the queue" after the clip is done; a reload shows the tile.
      if (Date.now() - lastReload > 120000) { await tab.go(await tab.ev('location.href')); lastReload = Date.now(); }
      const now = await tiles(tab, 'video');
      const fresh = now.find((t) => !seen.has(t.label)) || (now.length > before ? now[0] : null);
      if (fresh?.ready) { console.log(`saved ${await download(tab, fresh, resolve(o.out), o.resolution || '720p', '.mp4')}`); return; }
      const t = await tab.text();
      if (/couldn.t generate|failed to generate|violat|policy/i.test(t.slice(-1500))) die(`Flow refused: ${t.slice(-400).replace(/\s+/g, ' ')}`, 4);
      // A "Failed / Something went wrong" card can sit next to "it's waiting in the queue"; on 12 Oct no clip
      // followed it, so give it 3 minutes and then report it (exit 4: worth a retry).
      if (!failedAt && failures(t) > failsBefore) { failedAt = Date.now(); log('Flow says "Something went wrong"'); }
      if (failedAt && Date.now() - failedAt > 180000) die('Flow failed the generation ("Something went wrong"); retry', 4);
      if (Date.now() > deadline) die('timed out waiting for the clip; it may still finish in the Flow project', 5);
    }
  } finally {
    await tab.close();
  }
}

const o = args(process.argv.slice(2));
try {
  if (o._[0] === 'video') await video(o);
  else die('usage: node flow.mjs video --prompt "..." --out clip.mp4 [--first img] [--last img] (see README.md)', 2);
} catch (e) {
  console.error(`flow: ${e.message}`);
  process.exit(e.code || 1);
}
