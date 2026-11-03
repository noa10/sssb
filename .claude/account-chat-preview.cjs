'use strict';

// Isolated browser fixture: no database, real customer accounts or AI provider.
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
const example = { name: 'Alex Example', email: 'alex@example.test', phone: '0123456789', company: 'Example Company' };
const welcome = [{ id: '1', role: 'assistant', content: 'Welcome!', status: 'answered' }];
let state;
function reset(scenario) {
  const partial = scenario === 'partial';
  const signedIn = partial || scenario === 'complete';
  const legacy = scenario === 'guest';
  state = {
    account: signedIn ? { ...example, ...(partial ? { company: '' } : {}) } : null,
    signedIn,
    conversation: null,
    guest: legacy ? { id: 'guest-chat', ...example } : null,
    startCount: 0,
    lastStart: null
  };
}
reset('new');
function current() {
  if (state.signedIn) return state.conversation
    ? { active: true, customer: state.account, conversation: state.conversation, messages: welcome }
    : { active: false, customer: state.account };
  return state.guest ? { active: false, customer: null, guestConversation: state.guest } : { active: false, customer: null };
}
function linkGuest(email) {
  if (!state.guest) return true;
  if (state.guest.email !== email) return false;
  state.conversation = state.guest;
  state.guest = null;
  return true;
}
app.get('/__preview/scenario/:name', (req, res) => { reset(req.params.name); res.json({ ok: true }); });
app.get('/__preview/state', (req, res) => res.json(state));
app.get('/api/public/config', (req, res) => res.json({}));
app.get('/api/csrf', (req, res) => res.json({ csrfToken: 'isolated-preview' }));
app.get('/api/chat/current', (req, res) => res.json(current()));
app.post('/api/customer/register', (req, res) => {
  const { name, email, phone, company } = req.body;
  if (!linkGuest(email)) return res.status(409).json({ error: 'This browser has an open chat with a different email. End that chat or use its email to sign in.' });
  state.account = { name, email, phone, company };
  state.signedIn = true;
  res.status(201).json({ authenticated: true, customer: state.account });
});
app.post('/api/customer/login', (req, res) => {
  if (!state.account || state.account.email !== req.body.email) return res.status(401).json({ error: 'Invalid email or password.' });
  if (!linkGuest(req.body.email)) return res.status(409).json({ error: 'This browser has an open chat with a different email. End that chat or use its email to sign in.' });
  state.signedIn = true;
  res.json({ authenticated: true, customer: state.account });
});
app.post('/api/customer/logout', (req, res) => { state.signedIn = false; res.json({ ok: true }); });
app.post('/api/customer/profile', (req, res) => {
  if (!state.signedIn) return res.status(401).json({ error: 'Sign in to update your account.' });
  const { name, phone, company } = req.body;
  if (!name || !phone || !company) return res.status(400).json({ error: 'Enter your name, phone number and company.' });
  state.account = { ...state.account, name, phone, company };
  res.json({ authenticated: true, customer: state.account });
});
app.post('/api/chat/start', (req, res) => {
  if (!state.signedIn) return res.status(401).json({ error: 'Sign in or create an account to start a chat.' });
  if (req.body.consent !== true) return res.status(400).json({ error: 'Please agree to the notice before starting a chat.' });
  if (state.conversation) return res.status(409).json({ error: 'An active conversation already exists.' });
  if (!state.account.name || !state.account.phone || !state.account.company) return res.status(409).json({ error: 'Complete your account details before starting a chat.', code: 'PROFILE_INCOMPLETE' });
  state.lastStart = req.body;
  state.startCount += 1;
  state.conversation = { id: 'mock-chat-' + state.startCount, ...state.account };
  res.status(201).json({ active: true, customer: state.account, conversation: state.conversation, messages: welcome });
});
app.post('/api/chat/close', (req, res) => { if (state.signedIn) state.conversation = null; else state.guest = null; res.json({ ok: true }); });
app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(3199, () => console.log('Isolated account chat preview on port 3199'));
