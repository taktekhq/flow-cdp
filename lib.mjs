// Pure helpers, kept apart from the browser code so they can be tested without Chrome.

// Flow's agent quotes a cost before it spends anything: "... costing 10 credits?"
export function lastQuote(text) {
  const all = [...text.matchAll(/costing\s+([\d,]+)\s+credits?/gi)];
  return all.length ? Number(all[all.length - 1][1].replace(/,/g, '')) : null;
}

// What the agent said it will do, e.g. "I'm going to generate an 8-second video using your image as the first
// frame with Veo 3.1 - Fast." Returned so the caller can check the model and frame use before approving.
export function lastPlan(text) {
  const all = [...text.matchAll(/(I'm going to [^\n]*?\.)\s/g)];
  return all.length ? all[all.length - 1][1] : '';
}

// The agent's plan must name the model asked for, or it quietly picked another one (it chose "Veo 3.1 - Lite"
// once when no model was named).
export function planUsesModel(plan, model) {
  return plan.toLowerCase().includes(model.toLowerCase());
}

const MODELS = {
  'veo-3.1-fast-generate-preview': 'Veo 3.1 - Fast',
  'veo-3.1-generate-preview': 'Veo 3.1 - Quality',
  'veo-3.1-lite': 'Veo 3.1 - Lite',
};
// Accept the API model ids that older scripts pass, or Flow's own label.
export function flowModel(name) {
  return MODELS[name] || name;
}

// The prompt Flow's agent gets. Explicit about the model and each image's role, since the agent decides
// otherwise. Flow makes 8 s clips; a shorter --seconds is trimmed afterwards by the caller.
export function videoPrompt({ prompt, model, aspect, first, last }) {
  const frames = last
    ? 'Use the first attached image as the exact first frame and the second attached image as the exact last frame (frames to video). Do not redraw them.'
    : first
      ? 'Use the attached image as the exact first frame (frames to video). Do not redraw it.'
      : '';
  return [`Generate one video with ${model}, ${aspect}, 8 seconds.`, frames, prompt].filter(Boolean).join(' ');
}

// An Omni edit of an uploaded clip: name the change, and pin everything else so the edit does not re-animate it.
export function editPrompt({ prompt }) {
  return `Edit the attached video with Omni. ${prompt} Keep everything else exactly as it is: the same motion, timing, framing, characters, colours, sound and length.`;
}

// An edit has no fixed price yet; only the ceiling is checked.
export function judgeEditQuote({ credits, max }) {
  if (credits == null) return 'no quote';
  if (credits > max) return `quote ${credits} credits is over --max-credits ${max}`;
  return '';
}

export function imagePrompt({ prompt, model, aspect, refs }) {
  const r = refs ? `Use the ${refs} attached image${refs > 1 ? 's' : ''} as references for the characters and the scene.` : '';
  return [`Generate one image with ${model}, ${aspect}.`, r, prompt].filter(Boolean).join(' ');
}

// Credits Flow charged for one 8 s clip, seen 12 Oct 2026. When the agent quotes without a plan sentence, the
// price is the only sign of which model it picked.
// Known prices in credits. Fast went from 10 to 15 per 8 s clip with a first frame (seen 14 Oct 2026 on Ultra).
const PRICE = { 'Veo 3.1 - Lite': [5], 'Veo 3.1 - Fast': [10, 15] };

// Why a quote should be refused, or '' to approve.
export function judgeQuote({ credits, plan, model, max, first }) {
  if (credits == null) return 'no quote';
  if (credits > max) return `quote ${credits} credits is over --max-credits ${max}`;
  if (plan && first && !/first frame|frames? to video|start(ing)? frame|(animat\w+|bring\w*) (your|the attached)( [\w-]+){0,4} (image|illustration|picture|drawing|photo)|between (your|the) two( [\w-]+){0,2} (images|frames)/i.test(plan)) return 'the agent did not say it will use the image as the first frame';
  // A plan that names a Veo model must name ours. A plan that names none ("I'm going to generate a video of the
  // capybara speaking, using your image as the first frame.", 14 Oct 2026) is judged by its price instead.
  if (/veo/i.test(plan)) {
    if (!planUsesModel(plan, model)) return `the agent planned something other than ${model}: ${plan}`;
  } else if (PRICE[model] && !PRICE[model].includes(credits)) {
    return `no plan given and ${credits} credits is not ${model}'s price (${PRICE[model].join(' or ')})`;
  }
  return '';
}

// An element's text as the page shows it, with a leading Material icon name allowed ("check Approve",
// "close Reject").
export function labelMatches(shown, text) {
  const t = shown.trim().replace(/\s+/g, ' ');
  return t === text || (t.endsWith(' ' + text) && /^[a-z_]+$/.test(t.slice(0, -text.length - 1)));
}
