const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', 'public');
const siteScript = fs.readFileSync(path.join(publicDir, 'assets/js/site.js'), 'utf8');
const catalogueScript = fs.readFileSync(path.join(publicDir, 'assets/js/catalogue.js'), 'utf8');
const customer = { name: 'Test Customer', email: 'test@example.test', phone: '0123456789', company: 'Example' };
const previousId = '11111111-1111-4111-8111-111111111111';
const welcome = { id: '1', role: 'assistant', content: 'Welcome', status: 'answered' };

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the chat UI');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createChat(url = 'https://example.test/contact.html?company=jfd&product=shadow') {
  const dom = new JSDOM('<!doctype html><html><head></head><body data-page="contact"></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const state = { conversation: { id: previousId }, messages: [welcome], failNextCurrent: false };
  window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
  window.fetch = async (url, options = {}) => {
    if (url === '/api/public/config') return response({});
    if (url === '/api/csrf') return response({ csrfToken: 'test-token' });
    if (url === '/api/customer/conversations') return response({ conversations: [{
      id: state.conversation.id, active: true, createdAt: new Date().toISOString(), lastMessage: 'Welcome', lastRole: 'assistant'
    }] });
    if (url === '/api/chat/current') {
      if (state.failNextCurrent) {
        state.failNextCurrent = false;
        return response({ error: 'Unavailable' }, 503);
      }
      return response({ active: true, customer, conversation: state.conversation, messages: state.messages });
    }
    if (url === '/api/chat/start') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.previousConversationId, previousId);
      state.conversation = { id: payload.requestId };
      state.messages = [welcome, { id: '2', role: 'user', content: payload.message, status: 'failed' }];
      state.failNextCurrent = true;
      return response({ saved: true, error: 'Your message was saved, but the assistant could not respond.' }, 503);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  window.eval(siteScript);
  return { dom, window, state, find: (selector) => window.document.querySelector(selector) };
}

async function openChat(chat) {
  chat.find('.chat-launcher').click();
  await waitFor(() => !chat.find('.chat-archive-ask').disabled && chat.find('.chat-archive-list button'));
}

test('a product enquiry remains available in a new chat while both drafts are preserved', async (t) => {
  const chat = createChat();
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  const input = chat.find('#sssb-chat-message');
  assert.equal(input.value, 'I would like to enquire about JFD Shadow.');

  chat.find('.chat-archive-ask').click();
  assert.equal(input.value, 'I would like to enquire about JFD Shadow.');
  input.value = 'Draft for the new chat';
  chat.find('.chat-conversation-back').click();
  await waitFor(() => chat.find('.chat-archive-list button'));
  chat.find('.chat-archive-list button').click();
  assert.equal(input.value, 'I would like to enquire about JFD Shadow.');
  input.value = 'Draft for the existing chat';
  chat.find('.chat-conversation-back').click();
  chat.find('.chat-archive-ask').click();
  assert.equal(input.value, 'Draft for the new chat');
  input.value = '';
  chat.find('.chat-conversation-back').click();
  chat.find('.chat-archive-ask').click();
  assert.equal(input.value, '');
});

test('a new-chat draft receives a product added by a later catalogue response', async (t) => {
  const chat = createChat('https://example.test/contact.html?company=example&product=new');
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.find('.chat-archive-ask').click();
  const input = chat.find('#sssb-chat-message');
  assert.equal(input.value, '');
  chat.window.document.dispatchEvent(new chat.window.CustomEvent('sssb:catalogue', { detail: {
    companies: [{ key: 'example', name: 'Example', products: [{ key: 'new', name: 'New Product' }] }]
  } }));
  assert.equal(input.value, 'I would like to enquire about Example New Product.');
  chat.find('.chat-conversation-back').click();
  chat.find('.chat-archive-ask').click();
  assert.equal(input.value, 'I would like to enquire about Example New Product.');
});

test('a saved first message is restored after the immediate reload fails', async (t) => {
  const chat = createChat();
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.find('.chat-archive-ask').click();
  const input = chat.find('#sssb-chat-message');
  input.value = 'A saved first question';
  chat.find('.chat-message-form').dispatchEvent(new chat.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !chat.find('.chat-refresh').hidden && !chat.find('.chat-refresh').disabled);
  assert.equal(input.value, 'A saved first question');
  assert.match(chat.find('.chat-status').textContent, /message was saved/i);

  chat.find('.chat-refresh').click();
  await waitFor(() => chat.find('.chat-messages .chat-message--user .chat-message-status'));
  const message = chat.find('.chat-messages .chat-message--user');
  assert.match(message.textContent, /A saved first question/);
  assert.match(message.textContent, /saved, but the AI response is unavailable/i);
  assert.equal(input.value, '');
  assert.equal(input.disabled, false);
});

test('the privacy page loads catalogue counts into its navigation', async (t) => {
  const html = fs.readFileSync(path.join(publicDir, 'privacy.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.test/privacy.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  assert.ok(dom.window.document.querySelector('script[src^="assets/js/catalogue.js"]'));
  dom.window.fetch = async () => response({
    companies: [], categories: [{ id: 'diving', companyCount: 2, productCount: 3 }], totals: {}
  });
  dom.window.eval(catalogueScript);
  const label = dom.window.document.querySelector('.dropdown-link[data-nav="diving"] small');
  await waitFor(() => label.textContent === '02 companies · 03 products');
});
