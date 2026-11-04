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
const jfdHtml = fs.readFileSync(path.join(publicDir, 'jfd.html'), 'utf8');

function clickProduct(chat, selector = '#shadow .product-detail-actions a') {
  const event = new chat.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  assert.equal(chat.find(selector).dispatchEvent(event), false);
}

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

function createChat(url = 'https://example.test/contact.html?company=jfd&product=shadow', options = {}) {
  const dom = new JSDOM(options.html || '<!doctype html><html><head></head><body data-page="contact"><input id="outside-chat"></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const state = options.state || { conversation: { id: previousId }, messages: [welcome], failNextCurrent: false };
  state.requests ||= [];
  for (const [key, value] of Object.entries(options.storage || {})) window.sessionStorage.setItem(key, value);
  if (options.focusOutside) window.document.querySelector('#outside-chat').focus();
  if (options.scrollHeight) {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return options.scrollHeight; } });
  }
  if (options.storageBlocked) {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  }
  window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
  window.fetch = async (url, requestOptions = {}) => {
    state.requests.push({ url, method: requestOptions.method || 'GET' });
    if (options.intercept) {
      const intercepted = options.intercept(url, requestOptions);
      if (intercepted !== undefined) return intercepted;
    }
    if (url === '/api/public/config') return response({});
    if (url === '/api/csrf') return response({ csrfToken: 'test-token' });
    if (url === '/api/customer/conversations') {
      const activeConversation = state.conversation ? [{
        id: state.conversation.id, active: true, createdAt: new Date().toISOString(),
        lastMessage: state.messages.at(-1)?.content || null, lastRole: 'assistant'
      }] : [];
      return response({ conversations: [...activeConversation, ...(state.archived || [])] });
    }
    if (url.startsWith('/api/customer/conversations/')) {
      const id = decodeURIComponent(url.slice('/api/customer/conversations/'.length));
      const archived = (state.archived || []).find((item) => item.id === id);
      return archived ? response(archived) : response({ error: 'Not found' }, 404);
    }
    if (url === '/api/chat/current') {
      if (state.failNextCurrent) {
        state.failNextCurrent = false;
        return response({ error: 'Unavailable' }, 503);
      }
      if (state.signedIn === false) return response({ active: false, customer: null });
      return state.conversation
        ? response({ active: true, customer, conversation: state.conversation, messages: state.messages })
        : response({ active: false, customer });
    }
    if (url === '/api/chat/start') {
      const payload = JSON.parse(requestOptions.body);
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

function savedStorage(chat) {
  return Object.fromEntries(Object.keys(chat.window.sessionStorage).map((key) => [key, chat.window.sessionStorage.getItem(key)]));
}

async function openChat(chat) {
  chat.find('.chat-launcher').click();
  await waitFor(() => !chat.find('.chat-archive-ask').disabled && chat.find('.chat-archive-list button'));
}

test('a product enquiry opens the existing chat on the same page without sending', async (t) => {
  const chat = createChat('https://example.test/jfd.html', { html: jfdHtml });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  await waitFor(() => chat.find('#sssb-chat-message').value === 'I would like to enquire about JFD Shadow.');
  assert.equal(chat.window.location.pathname, '/jfd.html');
  assert.equal(chat.find('.chat-panel').hidden, false);
  assert.equal(chat.find('.chat-conversation').hidden, false);
  assert.match(chat.find('.chat-messages').textContent, /Welcome/);
  assert.equal(chat.state.conversation.id, previousId);
  assert.equal(chat.state.requests.some((request) => request.method === 'POST'), false);
});

test('product enquiries preserve existing active and new-chat drafts', async (t) => {
  const chat = createChat('https://example.test/jfd.html', { html: jfdHtml });
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.find('.chat-archive-list button').click();
  const input = chat.find('#sssb-chat-message');
  input.value = 'My existing question';
  clickProduct(chat);
  assert.equal(input.value, 'My existing question\n\nI would like to enquire about JFD Shadow.');
  clickProduct(chat);
  assert.equal(input.value, 'My existing question\n\nI would like to enquire about JFD Shadow.');

  chat.find('.chat-conversation-back').click();
  await waitFor(() => chat.find('.chat-archive-list button'));
  chat.find('.chat-archive-ask').click();
  input.value = 'My new-chat draft';
  clickProduct(chat, '#enforcer .product-detail-actions a');
  assert.equal(input.value, 'My new-chat draft\n\nI would like to enquire about JFD Enforcer.');
  assert.equal(chat.state.requests.some((request) => request.method === 'POST'), false);
});

test('an unsigned visitor sees a prefilled welcome without creating a chat', async (t) => {
  const state = { conversation: null, messages: [], signedIn: false };
  const chat = createChat('https://example.test/jfd.html', { html: jfdHtml, state });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  await waitFor(() => chat.find('#sssb-chat-message').value.includes('JFD Shadow'));
  assert.equal(chat.find('.chat-conversation').hidden, false);
  assert.match(chat.find('.chat-messages').textContent, /Hello! I’m Haji/);
  assert.equal(state.requests.some((request) => request.method === 'POST'), false);
});

test('dynamically published products open their own prefilled enquiry', async (t) => {
  const catalogue = {
    companies: [{ key: 'jfd', name: 'JFD', url: 'jfd.html', productCount: 1, products: [{
      key: 'new-product', name: 'New Product', type: 'Equipment', summary: 'Published product', specs: [], features: [],
      enquiryUrl: '/contact.html?company=jfd&product=new-product#enquiry'
    }] }],
    categories: [], totals: { categories: 0, companies: 1, products: 1 }
  };
  const chat = createChat('https://example.test/jfd.html', {
    html: jfdHtml, intercept: (url) => url === '/api/catalogue' ? response(catalogue) : undefined
  });
  t.after(() => chat.dom.window.close());
  chat.window.eval(catalogueScript);
  await waitFor(() => chat.find('#new-product .product-detail-actions a'));
  clickProduct(chat, '#new-product .product-detail-actions a');
  await waitFor(() => chat.find('#sssb-chat-message').value === 'I would like to enquire about JFD New Product.');
  assert.equal(chat.window.location.pathname, '/jfd.html');
  assert.equal(chat.state.requests.some((request) => request.method === 'POST'), false);
});

test('a product enquiry waits for the current chat and uses the latest selection', async (t) => {
  let finishCurrent;
  const current = new Promise((resolve) => { finishCurrent = resolve; });
  const chat = createChat('https://example.test/jfd.html', {
    html: jfdHtml, intercept: (url) => url === '/api/chat/current' ? current : undefined
  });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  clickProduct(chat, '#enforcer .product-detail-actions a');
  finishCurrent(response({ active: true, customer, conversation: { id: previousId }, messages: [welcome] }));
  await waitFor(() => chat.find('#sssb-chat-message').value.includes('JFD Enforcer'));
  assert.equal(chat.find('#sssb-chat-message').value, 'I would like to enquire about JFD Enforcer.');
  assert.equal(chat.state.requests.some((request) => request.method === 'POST'), false);
});

test('closing a product enquiry while the chat loads cancels opening it later', async (t) => {
  let finishCurrent;
  const current = new Promise((resolve) => { finishCurrent = resolve; });
  const chat = createChat('https://example.test/jfd.html', {
    html: jfdHtml, intercept: (url) => url === '/api/chat/current' ? current : undefined
  });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  chat.find('.chat-archive-close').click();
  finishCurrent(response({ active: true, customer, conversation: { id: previousId }, messages: [welcome] }));
  await waitFor(() => !chat.find('.chat-archive-ask').disabled);
  assert.equal(chat.find('.chat-panel').hidden, true);
  assert.equal(chat.find('#sssb-chat-message').value, '');
});

test('a product enquiry is restored after retrying a failed chat load', async (t) => {
  const state = { conversation: { id: previousId }, messages: [welcome], failNextCurrent: true };
  const chat = createChat('https://example.test/jfd.html', { html: jfdHtml, state });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  await waitFor(() => !chat.find('.chat-refresh').hidden && !chat.find('.chat-refresh').disabled);
  chat.find('.chat-refresh').click();
  await waitFor(() => chat.find('#sssb-chat-message').value.includes('JFD Shadow'));
  assert.equal(chat.find('.chat-conversation').hidden, false);
});

test('quotation requests retain the product selected by an enquiry', async (t) => {
  const catalogue = { companies: [{ key: 'jfd', name: 'JFD', products: [{ key: 'shadow', name: 'Shadow' }] }] };
  const chat = createChat('https://example.test/jfd.html', {
    html: jfdHtml, intercept: (url) => url === '/api/catalogue' ? response(catalogue) : undefined
  });
  t.after(() => chat.dom.window.close());
  clickProduct(chat);
  await waitFor(() => chat.find('#sssb-chat-message').value.includes('JFD Shadow'));
  chat.find('.chat-quotation-open').click();
  await waitFor(() => chat.find('#sssb-quotation-product').value === 'jfd/shadow');
  assert.equal(chat.state.requests.some((request) => request.method === 'POST'), false);
});

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

test('open chat restores the latest active message after reload and page navigation', async (t) => {
  const first = createChat();
  t.after(() => first.dom.window.close());
  first.state.messages.push({ id: '2', role: 'assistant', content: 'The latest answer', status: 'answered' });
  await openChat(first);
  assert.deepEqual(savedStorage(first), { 'sssb-chat-open': '1' });

  for (const url of ['https://example.test/contact.html', 'https://example.test/about.html']) {
    const chat = createChat(url, { state: first.state, storage: savedStorage(first), focusOutside: true, scrollHeight: 900 });
    t.after(() => chat.dom.window.close());
    await waitFor(() => !chat.find('.chat-conversation').hidden && chat.find('.chat-messages').textContent.includes('The latest answer'));
    assert.equal(chat.find('.chat-panel').hidden, false);
    assert.equal(chat.find('.chat-history').scrollTop, 900);
    assert.equal(chat.window.document.activeElement.id, 'outside-chat');
  }
  assert.equal(first.state.requests.some((request) => request.method === 'POST'), false);

  first.find('.chat-archive-close').click();
  const closed = createChat('https://example.test/about.html', { state: first.state, storage: savedStorage(first) });
  t.after(() => closed.dom.window.close());
  assert.equal(closed.find('.chat-panel').hidden, true);
  assert.deepEqual(savedStorage(closed), { 'sssb-chat-open': '0' });
});

test('restores the latest available archived transcript when there is no active chat', async (t) => {
  const state = {
    conversation: null,
    messages: [],
    archived: [
      { id: 'expired', createdAt: '2026-01-01T00:00:00Z', lastMessage: 'Expired', messagesExpired: true, messages: [] },
      { id: 'available', createdAt: '2026-01-01T00:00:00Z', lastMessage: 'Last archived answer', messagesExpired: false,
        messages: [welcome, { id: '2', role: 'assistant', content: 'Last archived answer' }] }
    ]
  };
  const chat = createChat('https://example.test/about.html', {
    state, storage: { 'sssb-chat-open': '1' }, focusOutside: true, scrollHeight: 800
  });
  t.after(() => chat.dom.window.close());
  await waitFor(() => chat.find('.chat-archive-messages').textContent.includes('Last archived answer'));
  assert.equal(chat.find('.chat-archive-transcript').hidden, false);
  assert.equal(chat.find('.chat-archive-transcript').scrollTop, 800);
  assert.equal(chat.window.document.activeElement.id, 'outside-chat');
  assert.equal(state.requests.some((request) => request.url.endsWith('/expired')), false);
  assert.equal(state.requests.some((request) => request.method === 'POST'), false);
});

test('restoring without a saved conversation shows Messages without creating a chat', async (t) => {
  for (const signedIn of [true, false]) {
    const state = { conversation: null, messages: [], signedIn };
    const chat = createChat('https://example.test/about.html', { state, storage: { 'sssb-chat-open': '1' } });
    t.after(() => chat.dom.window.close());
    await waitFor(() => !chat.find('.chat-archive-empty').hidden);
    assert.equal(chat.find('.chat-conversation').hidden, true);
    assert.match(chat.find('.chat-archive-empty-detail').textContent, signedIn ? /appear here/i : /sign in/i);
    assert.equal(state.requests.some((request) => request.method === 'POST'), false);
    if (!signedIn) assert.equal(state.requests.some((request) => request.url === '/api/customer/conversations'), false);
  }
});

test('a failed restore can be retried without creating a conversation', async (t) => {
  const state = { conversation: { id: previousId }, messages: [welcome], failNextCurrent: true };
  const chat = createChat('https://example.test/about.html', { state, storage: { 'sssb-chat-open': '1' } });
  t.after(() => chat.dom.window.close());
  await waitFor(() => !chat.find('.chat-refresh').hidden && !chat.find('.chat-refresh').disabled);
  assert.match(chat.find('.chat-status').textContent, /could not load/i);
  chat.find('.chat-refresh').click();
  await waitFor(() => !chat.find('.chat-conversation').hidden);
  assert.match(chat.find('.chat-messages').textContent, /Welcome/);
  assert.equal(state.requests.some((request) => request.method === 'POST'), false);
});

test('closing during restore prevents an in-flight response from reopening the panel', async (t) => {
  let finishCurrent;
  const current = new Promise((resolve) => { finishCurrent = resolve; });
  const chat = createChat('https://example.test/about.html', {
    storage: { 'sssb-chat-open': '1' },
    intercept: (url) => url === '/api/chat/current' ? current : undefined
  });
  t.after(() => chat.dom.window.close());
  chat.find('.chat-archive-close').click();
  finishCurrent(response({ active: true, customer, conversation: { id: previousId }, messages: [welcome] }));
  await waitFor(() => !chat.find('.chat-archive-ask').disabled);
  assert.equal(chat.find('.chat-panel').hidden, true);
  assert.equal(savedStorage(chat)['sssb-chat-open'], '0');
});

test('a navigation choice during archived-history loading is respected', async (t) => {
  let finishHistory;
  const history = new Promise((resolve) => { finishHistory = resolve; });
  const state = { conversation: null, messages: [] };
  const chat = createChat('https://example.test/about.html', {
    state, storage: { 'sssb-chat-open': '1' },
    intercept: (url) => url === '/api/customer/conversations' ? history : undefined
  });
  t.after(() => chat.dom.window.close());
  await waitFor(() => state.requests.some((request) => request.url === '/api/customer/conversations'));
  chat.find('[data-chat-tab="help"]').click();
  finishHistory(response({ conversations: [{ id: 'older', lastMessage: 'Old message' }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(chat.find('.chat-help').hidden, false);
  assert.equal(state.requests.some((request) => request.url === '/api/customer/conversations/older'), false);
});

test('browser history restores an open chat and honors a later close without stealing focus', async (t) => {
  const chat = createChat('https://example.test/about.html', { focusOutside: true, scrollHeight: 600 });
  t.after(() => chat.dom.window.close());
  chat.window.sessionStorage.setItem('sssb-chat-open', '1');
  chat.window.dispatchEvent(new chat.window.PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => !chat.find('.chat-conversation').hidden);
  assert.equal(chat.find('.chat-history').scrollTop, 600);
  assert.equal(chat.window.document.activeElement.id, 'outside-chat');

  chat.window.sessionStorage.setItem('sssb-chat-open', '0');
  chat.window.dispatchEvent(new chat.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.equal(chat.find('.chat-panel').hidden, true);
  assert.equal(chat.window.document.activeElement.id, 'outside-chat');
});

test('browser history retains an unsent draft while showing the current conversation', async (t) => {
  const chat = createChat();
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.find('.chat-archive-ask').click();
  chat.find('#sssb-chat-message').value = 'An unsent draft';
  chat.window.dispatchEvent(new chat.window.PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => !chat.find('.chat-conversation').hidden && chat.find('.chat-messages').textContent.includes('Welcome'));
  chat.find('.chat-conversation-back').click();
  await waitFor(() => chat.find('.chat-archive-list button'));
  chat.find('.chat-archive-ask').click();
  assert.equal(chat.find('#sssb-chat-message').value, 'An unsent draft');
});

test('restoring over a draft keeps checking for a pending reply', async (t) => {
  const chat = createChat();
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.find('.chat-archive-ask').click();
  chat.find('#sssb-chat-message').value = 'An unsent draft';
  let pendingPolls = 0;
  const setTimeout = chat.window.setTimeout.bind(chat.window);
  chat.window.setTimeout = (callback, delay, ...args) => {
    if (delay === 4000) pendingPolls += 1;
    return setTimeout(callback, delay, ...args);
  };
  chat.state.messages.push({ id: '2', role: 'user', content: 'Waiting for a response', status: 'pending' });
  chat.window.dispatchEvent(new chat.window.PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => chat.find('.chat-messages').textContent.includes('Waiting for a response'));
  assert.equal(chat.find('#sssb-chat-message').disabled, true);
  assert.equal(pendingPolls, 1);
  assert.match(chat.find('.chat-status').textContent, /waiting for an AI response/i);
});

test('contact enquiry links still open the chat on a fresh page', async (t) => {
  const chat = createChat('https://example.test/contact.html#enquiry');
  t.after(() => chat.dom.window.close());
  await waitFor(() => chat.find('.chat-archive-list button'));
  assert.equal(chat.find('.chat-panel').hidden, false);
  assert.equal(chat.find('.chat-archive-list-view').hidden, false);
});

test('chat remains usable if session storage is unavailable', async (t) => {
  const chat = createChat('https://example.test/about.html', { storageBlocked: true });
  t.after(() => chat.dom.window.close());
  await openChat(chat);
  chat.window.dispatchEvent(new chat.window.PageTransitionEvent('pageshow', { persisted: true }));
  await waitFor(() => !chat.find('.chat-archive-ask').disabled);
  assert.equal(chat.find('.chat-panel').hidden, false);
  chat.find('.chat-archive-close').click();
  assert.equal(chat.find('.chat-panel').hidden, true);
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
