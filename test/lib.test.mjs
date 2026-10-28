import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastQuote, lastPlan, planUsesModel, flowModel, videoPrompt } from '../lib.mjs';

const chat = `Would you like me to kick off this 1 video generation, costing 5 credits?
I'm going to generate an 8-second video using your image as the first frame with Veo 3.1 - Fast.
Would you like me to kick off this 1 video generation, costing 10 credits?
check
Approve`;

test('reads the newest quote', () => {
  assert.equal(lastQuote(chat), 10);
  assert.equal(lastQuote('costing 1,250 credits'), 1250);
  assert.equal(lastQuote('nothing quoted'), null);
});

test('reads the newest plan and checks its model', () => {
  const plan = lastPlan(chat);
  assert.match(plan, /first frame with Veo 3\.1 - Fast\.$/);
  assert.ok(planUsesModel(plan, 'Veo 3.1 - Fast'));
  assert.ok(!planUsesModel(plan, 'Veo 3.1 - Quality'));
});

test('maps API model ids to Flow labels', () => {
  assert.equal(flowModel('veo-3.1-fast-generate-preview'), 'Veo 3.1 - Fast');
  assert.equal(flowModel('veo-3.1-generate-preview'), 'Veo 3.1 - Quality');
  assert.equal(flowModel('Veo 3.1 - Lite'), 'Veo 3.1 - Lite');
});

test('names the model and each frame in the prompt', () => {
  const one = videoPrompt({ prompt: 'He sighs.', model: 'Veo 3.1 - Fast', aspect: '9:16', first: 'a.png' });
  assert.match(one, /^Generate one video with Veo 3\.1 - Fast, 9:16, 8 seconds\. Use the attached image as the exact first frame/);
  assert.match(one, /He sighs\.$/);
  const two = videoPrompt({ prompt: 'x', model: 'Veo 3.1 - Quality', aspect: '9:16', first: 'a.png', last: 'b.png' });
  assert.match(two, /second attached image as the exact last frame/);
  assert.doesNotMatch(videoPrompt({ prompt: 'x', model: 'm', aspect: '16:9' }), /attached/);
});

import { judgeQuote, labelMatches } from '../lib.mjs';

test('judges quotes with and without a plan', () => {
  const fast = 'Veo 3.1 - Fast';
  const plan = "I'm going to generate an 8-second video using your image as the first frame with Veo 3.1 - Fast.";
  assert.equal(judgeQuote({ credits: 10, plan, model: fast, max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 30, plan, model: fast, max: 20 }), /over --max-credits/);
  assert.match(judgeQuote({ credits: 5, plan: "I'm going to generate a video using Veo 3.1 - Lite.", model: fast, max: 20 }), /other than/);
  assert.equal(judgeQuote({ credits: 10, plan: '', model: fast, max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 5, plan: '', model: fast, max: 20 }), /not Veo 3\.1 - Fast's price/);
  assert.equal(judgeQuote({ credits: 15, plan: '', model: 'Veo 3.1 - Quality', max: 200 }), '');
  assert.equal(judgeQuote({ credits: null, plan: '', model: fast, max: 20 }), 'no quote');
});

test('matches labels with an icon name in front', () => {
  assert.ok(labelMatches('close\nReject', 'Reject'));
  assert.ok(labelMatches('check Approve', 'Approve'));
  assert.ok(labelMatches('Approve', 'Approve'));
  assert.ok(!labelMatches('Always approve', 'Approve'));
  assert.ok(!labelMatches('check Always approve', 'Approve'));
});

test('a 15-credit Fast quote with no plan is accepted (price seen 14 Oct 2026)', () => {
  assert.equal(judgeQuote({ credits: 15, plan: '', model: 'Veo 3.1 - Fast', max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 20, plan: '', model: 'Veo 3.1 - Fast', max: 20, first: true }), /not Veo 3.1 - Fast's price/);
});

test('a plan that names no model is judged by price', () => {
  const plan = "I'm going to generate a video of the capybara speaking, using your image as the first frame.";
  assert.equal(judgeQuote({ credits: 10, plan, model: 'Veo 3.1 - Fast', max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 5, plan, model: 'Veo 3.1 - Fast', max: 20, first: true }), /price/);
  assert.match(judgeQuote({ credits: 5, plan: "I'm going to generate one video with Veo 3.1 - Lite using your image as the first frame.", model: 'Veo 3.1 - Fast', max: 20, first: true }), /something other/);
});

test('"animating your illustration" counts as using the first frame', () => {
  const plan = "I'm going to generate an 8-second video animating your illustration using Veo 3.1 - Fast.";
  assert.equal(judgeQuote({ credits: 10, plan, model: 'Veo 3.1 - Fast', max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 10, plan: "I'm going to generate an 8-second video using Veo 3.1 - Fast.", model: 'Veo 3.1 - Fast', max: 20, first: true }), /first frame/);
});

test('"animating your crochet bouquet image" counts as using the first frame', () => {
  const plan = "I'm going to generate an 8-second 16:9 video animating your crochet bouquet image using Veo 3.1 - Fast with a slow cinematic push-in.";
  assert.equal(judgeQuote({ credits: 10, plan, model: 'Veo 3.1 - Fast', max: 20, first: true }), '');
  assert.match(judgeQuote({ credits: 10, plan: "I'm going to generate an 8-second video of a crochet bouquet using Veo 3.1 - Fast.", model: 'Veo 3.1 - Fast', max: 20, first: true }), /first frame/);
});

test('"the transition between your two images" counts as first and last frame', () => {
  const plan = "I'm going to generate your 8-second video using Veo 3.1 - Quality, animating the transition between your two images with the specific acting and style you've described.";
  assert.equal(judgeQuote({ credits: 100, plan, model: 'Veo 3.1 - Quality', max: 150, first: true }), '');
});
