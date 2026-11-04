'use strict';

// Isolated browser fixture: no database, real customer accounts or AI provider.
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
const example = { name: 'Alex Example', email: 'alex@example.test', phone: '0123456789', company: 'Example Company' };
const welcome = [{ id: '1', role: 'assistant', content: 'Hello! I’m Haji, your Semenanjung Selatan assistant. I can help with questions about our company, products and services. You can also select Request a quotation in this chat to send a request to our team. What would you like to know?', status: 'answered' }];
let state;
function reset(scenario) {
  const partial = scenario === 'partial' || scenario === 'existing-partial';
  const existing = scenario === 'existing' || scenario === 'existing-fail' || scenario === 'existing-partial';
  const signedIn = partial || existing || scenario === 'complete' || scenario === 'fail-start' || scenario === 'closed-after-start';
  const legacy = scenario === 'guest';
  state = {
    account: signedIn ? { ...example, ...(partial ? { company: '' } : {}) } : null,
    signedIn,
    conversation: existing ? { id: '11111111-1111-4111-8111-111111111111', ...example } : null,
    messages: existing ? welcome.concat([
      { id: '2', role: 'user', content: 'An earlier question.', status: 'answered' },
      { id: '3', role: 'assistant', content: 'An earlier reply.', status: 'answered' }
    ]) : [],
    history: [],
    failStart: scenario === 'fail-start' || scenario === 'existing-fail',
    closeAfterStart: scenario === 'closed-after-start',
    guest: legacy ? { id: 'guest-chat', ...example } : null,
    startCount: 0,
    lastStart: null
  };
}
reset('new');
function current() {
  if (state.signedIn) return state.conversation
    ? { active: true, customer: state.account, conversation: state.conversation, messages: state.messages }
    : { active: false, customer: state.account };
  return state.guest ? { active: false, customer: null, guestConversation: state.guest } : { active: false, customer: null };
}
function linkGuest(email) {
  if (!state.guest) return true;
  if (state.guest.email !== email) return false;
  state.conversation = state.guest;
  state.messages = welcome.slice();
  state.guest = null;
  return true;
}
app.get('/__preview/scenario/:name', (req, res) => { reset(req.params.name); res.json({ ok: true }); });
app.get('/__preview/state', (req, res) => res.json(state));
app.get('/api/public/config', (req, res) => res.json({ chatWelcome: welcome[0].content }));
app.get('/api/catalogue', (req, res) => res.json({ companies: [] }));
app.get('/api/customer/conversations', (req, res) => {
  const conversations = state.history.map((entry) => ({ ...entry, active: false }));
  if (state.conversation) conversations.unshift({ conversation: state.conversation, messages: state.messages, active: true });
  res.json({ conversations: conversations.map((entry) => ({
    id: entry.conversation.id, active: entry.active, createdAt: new Date().toISOString(),
    lastMessage: entry.messages.at(-1)?.content, lastRole: entry.messages.at(-1)?.role, messagesExpired: false
  })) });
});
app.get('/api/customer/conversations/:id', (req, res) => {
  const entry = state.history.find((item) => item.conversation.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ conversation: entry.conversation, messages: entry.messages, createdAt: new Date().toISOString(), messagesExpired: false });
});
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
  const currentId = state.conversation ? state.conversation.id : null;
  if (req.body.previousConversationId !== currentId) return res.status(409).json({ error: 'Your current chat has changed. Return to Messages and try again.', code: 'CHAT_CHANGED' });
  if (!state.account.name || !state.account.phone || !state.account.company) return res.status(409).json({ error: 'Complete your account details before starting a chat.', code: 'PROFILE_INCOMPLETE' });
  if (state.failStart) return res.status(503).json({ error: 'The first message could not be saved.' });
  if (typeof req.body.message !== 'string' || !req.body.message.trim() || !req.body.requestId) return res.status(400).json({ error: 'Enter a message.' });
  state.lastStart = req.body;
  state.startCount += 1;
  if (state.closeAfterStart) {
    state.messages = welcome.concat([{ id: '2', role: 'user', content: req.body.message.trim(), status: 'failed' }]);
    return res.status(410).json({ error: 'Your message was saved, but this conversation has expired or ended.', saved: true });
  }
  if (state.conversation) state.history.unshift({ conversation: state.conversation, messages: state.messages });
  state.conversation = { id: req.body.requestId, ...state.account };
  state.messages = welcome.concat([
    { id: '2', role: 'user', content: req.body.message.trim(), status: 'answered' },
    { id: '3', role: 'assistant', content: 'Thanks for your message.', status: 'answered' }
  ]);
  res.json({ ok: true, status: 'answered' });
});
app.post('/api/chat/messages', (req, res) => {
  if (!state.signedIn || !state.conversation) return res.status(401).json({ error: 'Start a conversation first.' });
  if (req.body.conversationId && req.body.conversationId !== state.conversation.id) return res.status(410).json({ error: 'Your chat has changed.' });
  state.messages.push({ id: String(state.messages.length + 1), role: 'user', content: req.body.message, status: 'answered' });
  state.messages.push({ id: String(state.messages.length + 1), role: 'assistant', content: 'Thanks for your message.', status: 'answered' });
  res.json({ ok: true, status: 'answered' });
});
app.post('/api/chat/close', (req, res) => { if (state.signedIn) state.conversation = null; else state.guest = null; res.json({ ok: true }); });
app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(3199, () => console.log('Isolated account chat preview on port 3199'));
