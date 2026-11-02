'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    authenticated: false,
    generation: 0,
    view: 'enquiries',
    conversations: [],
    conversationsLoaded: false,
    conversationsRequest: 0,
    conversationsPage: 1,
    conversationsTotal: 0,
    conversationsPageSize: 50,
    conversationsSearchTimer: null,
    conversationId: null,
    conversationRequest: 0,
    conversationSaving: false,
    knowledge: [],
    knowledgeLoaded: false,
    knowledgeRequest: 0,
    knowledgeDetailRequest: 0,
    knowledgeTotal: 0,
    knowledgeTruncated: false,
    knowledgeId: null,
    editing: false,
    knowledgeSaving: false,
    dirty: false
  };
  const statusNames = {
    new: 'New', in_progress: 'In progress', closed: 'Closed',
    draft: 'Draft', published: 'Published', retired: 'Retired'
  };
  const kindNames = { company: 'Company information', product: 'Product', document: 'PDF document' };

  function setNotice(element, message, isError = false) {
    element.textContent = message || '';
    element.classList.toggle('notice--error', isError);
    element.hidden = !message;
    if (message && isError) element.setAttribute('role', 'alert');
    else element.setAttribute('role', 'status');
  }

  function niceDate(value) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function text(value, fallback = 'Not provided') {
    return value == null || String(value).trim() === '' ? fallback : String(value);
  }

  function el(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function displayStatus(element, value) {
    element.className = 'status';
    if (Object.prototype.hasOwnProperty.call(statusNames, value)) element.classList.add(`status--${value}`);
    element.textContent = statusNames[value] || text(value, 'Unknown');
  }

  function clearDetail() {
    state.conversationId = null;
    state.conversationRequest += 1;
    $('conversation-placeholder').hidden = false;
    $('conversation-detail-content').hidden = true;
    $('conversation-detail-state').hidden = true;
    $('message-list').replaceChildren();
    $('conversation-status').value = 'new';
    $('detail-status').textContent = '';
    $('message-count').textContent = '';
    ['detail-name', 'detail-dates', 'detail-email', 'detail-phone', 'detail-company'].forEach((id) => { $(id).textContent = ''; });
    setNotice($('conversation-status-notice'), '');
  }

  function clearEditor() {
    state.knowledgeDetailRequest += 1;
    state.knowledgeId = null;
    state.editing = false;
    state.dirty = false;
    $('knowledge-form').reset();
    $('knowledge-kind').disabled = false;
    $('knowledge-editor').hidden = true;
    $('knowledge-detail-state').hidden = true;
    $('knowledge-placeholder').hidden = false;
    $('document-content').textContent = '';
    setNotice($('knowledge-form-notice'), '');
  }

  function showLogin(message = '') {
    state.generation += 1;
    state.authenticated = false;
    state.conversations = [];
    state.conversationsLoaded = false;
    state.conversationsPage = 1;
    state.conversationsTotal = 0;
    clearTimeout(state.conversationsSearchTimer);
    state.conversationsSearchTimer = null;
    $('conversation-pagination').hidden = true;
    state.knowledge = [];
    state.knowledgeLoaded = false;
    state.knowledgeTotal = 0;
    state.knowledgeTruncated = false;
    $('knowledge-truncated').hidden = true;
    clearDetail();
    clearEditor();
    $('conversation-list').replaceChildren();
    $('knowledge-list').replaceChildren();
    $('conversation-search').value = '';
    $('conversation-filter').value = 'all';
    $('knowledge-search').value = '';
    $('knowledge-filter').value = 'all';
    $('account-email').textContent = '';
    $('account').hidden = true;
    $('workspace').hidden = true;
    $('session-loading').hidden = true;
    $('session-error').hidden = true;
    $('login-view').hidden = false;
    $('login-password').value = '';
    setNotice($('global-notice'), '');
    setNotice($('login-error'), message, Boolean(message));
  }

  async function request(path, options = {}) {
    const { method = 'GET', body, login = false } = options;
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      const csrf = await request('/api/csrf', { login });
      if (!csrf || typeof csrf.csrfToken !== 'string' || !csrf.csrfToken) throw new Error('Unable to get a security token. Please try again.');
      headers['X-CSRF-Token'] = csrf.csrfToken;
      if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
      });
    } catch {
      throw new Error('Unable to connect. Check your connection and try again.');
    }
    if (response.status === 401) {
      if (!login) showLogin('Your session has ended. Sign in to continue.');
      const error = new Error(login ? 'Sign-in failed. Check your email and password.' : 'Your session has ended.');
      error.unauthorized = true;
      throw error;
    }
    let data = null;
    const responseText = await response.text();
    if (responseText) {
      try { data = JSON.parse(responseText); } catch { /* An error response may not be JSON. */ }
    }
    if (!response.ok) {
      const serverMessage = data && typeof data.error === 'string' ? data.error : data && typeof data.message === 'string' ? data.message : '';
      throw new Error(serverMessage ? serverMessage.slice(0, 400) : `Request failed (${response.status}). Please try again.`);
    }
    return data;
  }

  function isCurrent(generation) { return state.authenticated && state.generation === generation; }

  async function checkSession() {
    $('session-loading').hidden = false;
    $('session-error').hidden = true;
    $('login-view').hidden = true;
    try {
      const session = await request('/api/admin/session', { login: true });
      if (!session || typeof session.authenticated !== 'boolean') throw new Error('The server returned an invalid session response. Please try again.');
      if (!session.authenticated) { showLogin(); return; }
      state.generation += 1;
      state.authenticated = true;
      $('session-loading').hidden = true;
      $('login-view').hidden = true;
      $('account-email').textContent = text(session.user && session.user.email, '');
      $('account').hidden = false;
      $('workspace').hidden = false;
      selectView('enquiries', true);
      loadConversations();
    } catch (error) {
      if (error.unauthorized) { showLogin(); return; }
      $('session-loading').hidden = true;
      $('session-error-message').textContent = error.message;
      $('session-error').hidden = false;
    }
  }

  function busy(button, working, label, original) {
    button.disabled = working;
    button.textContent = working ? label : original;
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('login-submit');
    busy(button, true, 'Signing in…', 'Sign in');
    setNotice($('login-error'), '');
    try {
      await request('/api/admin/login', { method: 'POST', login: true, body: { email: $('login-email').value.trim(), password: $('login-password').value } });
      $('login-password').value = '';
      await checkSession();
    } catch (error) {
      setNotice($('login-error'), error.message, true);
    } finally { busy(button, false, 'Signing in…', 'Sign in'); }
  });
  $('session-retry').addEventListener('click', checkSession);

  $('logout-button').addEventListener('click', async () => {
    if (!canLeaveEditor()) return;
    if (state.conversationSaving) {
      setNotice($('conversation-status-notice'), 'Wait for the status to finish saving.', true);
      return;
    }
    const button = $('logout-button');
    busy(button, true, 'Signing out…', 'Sign out');
    setNotice($('global-notice'), '');
    try {
      await request('/api/admin/logout', { method: 'POST', body: {} });
      showLogin();
    } catch (error) {
      if (!error.unauthorized && state.authenticated) setNotice($('global-notice'), error.message, true);
    } finally { busy(button, false, 'Signing out…', 'Sign out'); }
  });

  function canLeaveEditor() {
    if (state.knowledgeSaving) {
      setNotice($('knowledge-form-notice'), 'Wait for the current save to finish.', true);
      return false;
    }
    return !state.dirty || window.confirm('Discard your unsaved content changes?');
  }

  function selectView(view, force = false) {
    if (!force && state.view !== view && state.view === 'knowledge' && !canLeaveEditor()) return;
    if (!force && state.view !== view && state.view === 'enquiries' && state.conversationSaving) {
      setNotice($('conversation-status-notice'), 'Wait for the status to finish saving.', true);
      return;
    }
    if (state.view !== view && state.dirty) clearEditor();
    state.view = view;
    $('enquiries-view').hidden = view !== 'enquiries';
    $('knowledge-view').hidden = view !== 'knowledge';
    for (const button of document.querySelectorAll('[data-view]')) {
      const selected = button.dataset.view === view;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    setNotice($('global-notice'), '');
    if (view === 'knowledge' && !state.knowledgeLoaded) loadKnowledge();
    if (view === 'enquiries' && !state.conversationsLoaded && !force) loadConversations();
  }
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));

  function showListState(target, message, retry) {
    target.hidden = false;
    target.replaceChildren(document.createTextNode(message));
    if (retry) {
      const button = el('button', 'text-button', 'Try again');
      button.type = 'button';
      button.addEventListener('click', retry);
      target.append(button);
    }
  }

  async function loadConversations() {
    clearTimeout(state.conversationsSearchTimer);
    state.conversationsSearchTimer = null;
    const generation = state.generation;
    const sequence = ++state.conversationsRequest;
    const params = new URLSearchParams({
      search: $('conversation-search').value.trim(),
      status: $('conversation-filter').value,
      page: String(state.conversationsPage)
    });
    state.conversationsLoaded = false;
    $('conversation-count').textContent = 'Loading enquiries…';
    $('conversation-previous').disabled = true;
    $('conversation-next').disabled = true;
    showListState($('conversation-list-state'), 'Loading enquiries…');
    $('conversation-list').replaceChildren();
    try {
      const data = await request(`/api/admin/conversations?${params}`);
      if (!isCurrent(generation) || sequence !== state.conversationsRequest) return;
      if (!data || !Array.isArray(data.conversations) || !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.page) || data.page < 1 || !Number.isInteger(data.pageSize) || data.pageSize < 1) throw new Error('The server returned an invalid enquiry list.');
      state.conversations = data.conversations;
      state.conversationsTotal = data.total;
      state.conversationsPage = data.page;
      state.conversationsPageSize = data.pageSize;
      const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (data.page > lastPage) {
        state.conversationsPage = lastPage;
        await loadConversations();
        return;
      }
      state.conversationsLoaded = true;
      renderConversations();
    } catch (error) {
      if (!isCurrent(generation) || sequence !== state.conversationsRequest || error.unauthorized) return;
      $('conversation-count').textContent = 'Enquiries unavailable';
      $('conversation-pagination').hidden = true;
      showListState($('conversation-list-state'), error.message, loadConversations);
    }
  }

  function renderConversations() {
    if (!state.conversationsLoaded) return;
    const total = state.conversationsTotal;
    const page = state.conversationsPage;
    const pageSize = state.conversationsPageSize;
    const first = total && state.conversations.length ? (page - 1) * pageSize + 1 : 0;
    const last = Math.min(total, first ? first + state.conversations.length - 1 : 0);
    $('conversation-count').textContent = total ? `${first}–${last} of ${total} ${total === 1 ? 'enquiry' : 'enquiries'}` : '0 enquiries';
    const pages = Math.max(1, Math.ceil(total / pageSize));
    $('conversation-page').textContent = `Page ${page} of ${pages}`;
    $('conversation-previous').disabled = page <= 1;
    $('conversation-next').disabled = page >= pages;
    $('conversation-pagination').hidden = total <= pageSize;
    const container = $('conversation-list');
    container.replaceChildren();
    if (!state.conversations.length) {
      const filtered = $('conversation-search').value.trim() || $('conversation-filter').value !== 'all';
      showListState($('conversation-list-state'), filtered ? 'No enquiries match your filters.' : 'No enquiries yet. New conversations will appear here.');
      return;
    }
    $('conversation-list-state').hidden = true;
    state.conversations.forEach((item) => {
      const button = el('button', 'list-item');
      button.type = 'button';
      const selected = String(item.id) === String(state.conversationId);
      button.classList.toggle('is-selected', selected);
      if (selected) button.setAttribute('aria-current', 'true');
      const title = el('span', 'item-title', text(item.name, 'Unnamed contact'));
      const statusBadge = el('span');
      displayStatus(statusBadge, item.status);
      const meta = el('span', 'item-meta', [text(item.email, ''), text(item.company, '')].filter(Boolean).join(' • ') || 'No contact details');
      const date = el('span', 'item-date', niceDate(item.updatedAt || item.createdAt));
      button.append(title, statusBadge, meta, date);
      button.addEventListener('click', () => openConversation(item.id));
      container.append(button);
    });
  }

  async function openConversation(id, focus = true) {
    if (state.conversationSaving) {
      setNotice($('conversation-status-notice'), 'Wait for the status to finish saving.', true);
      return;
    }
    const generation = state.generation;
    const sequence = ++state.conversationRequest;
    state.conversationId = id;
    renderConversations();
    $('conversation-placeholder').hidden = true;
    $('conversation-detail-content').hidden = true;
    showListState($('conversation-detail-state'), 'Loading conversation…');
    if (focus) $('conversation-detail').focus();
    try {
      const data = await request(`/api/admin/conversations/${encodeURIComponent(id)}`);
      if (!isCurrent(generation) || sequence !== state.conversationRequest) return;
      if (!data || !data.conversation || !Array.isArray(data.messages)) throw new Error('The server returned an invalid conversation.');
      const conversation = data.conversation;
      $('detail-name').textContent = text(conversation.name, 'Unnamed contact');
      $('detail-dates').textContent = `Received ${niceDate(conversation.createdAt)} • Updated ${niceDate(conversation.updatedAt)}`;
      $('detail-email').textContent = text(conversation.email);
      $('detail-phone').textContent = text(conversation.phone);
      $('detail-company').textContent = text(conversation.company);
      displayStatus($('detail-status'), conversation.status);
      $('conversation-status').value = conversation.status;
      $('conversation-status-save').disabled = false;
      setNotice($('conversation-status-notice'), '');
      const messages = $('message-list');
      messages.replaceChildren();
      data.messages.forEach((message) => {
        const article = el('article', 'message');
        if (message.role === 'assistant') article.classList.add('message--assistant');
        const header = el('div', 'message-header');
        const role = message.role === 'user' ? 'Visitor' : message.role === 'assistant' ? 'Assistant' : text(message.role, 'Message');
        header.append(el('span', 'message-role', role), el('span', 'message-meta', [text(message.status, ''), niceDate(message.createdAt)].filter(Boolean).join(' • ')));
        article.append(header, el('p', 'message-content', text(message.content, '')));
        messages.append(article);
      });
      $('message-count').textContent = `${data.messages.length} ${data.messages.length === 1 ? 'message' : 'messages'}`;
      $('message-empty').textContent = conversation.messagesExpired ? 'Messages expire 30 days after the conversation starts.' : 'No messages in this conversation.';
      $('message-empty').hidden = data.messages.length !== 0;
      $('conversation-detail-state').hidden = true;
      $('conversation-detail-content').hidden = false;
    } catch (error) {
      if (!isCurrent(generation) || sequence !== state.conversationRequest || error.unauthorized) return;
      showListState($('conversation-detail-state'), error.message, () => openConversation(id, false));
    }
  }

  $('conversation-status-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const generation = state.generation;
    const id = state.conversationId;
    const status = $('conversation-status').value;
    const button = $('conversation-status-save');
    if (state.conversationSaving) return;
    state.conversationSaving = true;
    busy(button, true, 'Saving…', 'Save status');
    setNotice($('conversation-status-notice'), '');
    try {
      await request(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
      if (!isCurrent(generation)) return;
      if (String(state.conversationId) === String(id)) {
        displayStatus($('detail-status'), status);
        setNotice($('conversation-status-notice'), 'Status saved.');
      }
      loadConversations();
    } catch (error) {
      if (isCurrent(generation) && !error.unauthorized && String(state.conversationId) === String(id)) setNotice($('conversation-status-notice'), error.message, true);
    } finally {
      state.conversationSaving = false;
      busy(button, false, 'Saving…', 'Save status');
    }
  });
  $('refresh-conversations').addEventListener('click', () => {
    if (state.conversationSaving) {
      setNotice($('conversation-status-notice'), 'Wait for the status to finish saving.', true);
      return;
    }
    loadConversations();
  });
  function resetConversationSearch(debounce) {
    clearTimeout(state.conversationsSearchTimer);
    state.conversationsPage = 1;
    state.conversationsRequest += 1;
    state.conversationsLoaded = false;
    $('conversation-list').replaceChildren();
    $('conversation-pagination').hidden = true;
    $('conversation-count').textContent = 'Loading enquiries…';
    showListState($('conversation-list-state'), 'Loading enquiries…');
    if (debounce) state.conversationsSearchTimer = setTimeout(loadConversations, 300);
    else loadConversations();
  }
  $('conversation-search').addEventListener('input', () => resetConversationSearch(true));
  $('conversation-filter').addEventListener('change', () => resetConversationSearch(false));
  $('conversation-previous').addEventListener('click', () => {
    if (state.conversationsLoaded && state.conversationsPage > 1) {
      state.conversationsPage -= 1;
      loadConversations();
    }
  });
  $('conversation-next').addEventListener('click', () => {
    if (state.conversationsLoaded && state.conversationsPage * state.conversationsPageSize < state.conversationsTotal) {
      state.conversationsPage += 1;
      loadConversations();
    }
  });

  async function loadKnowledge() {
    const generation = state.generation;
    const sequence = ++state.knowledgeRequest;
    state.knowledgeLoaded = false;
    $('knowledge-truncated').hidden = true;
    showListState($('knowledge-list-state'), 'Loading content…');
    $('knowledge-list').replaceChildren();
    try {
      const data = await request('/api/admin/knowledge');
      if (!isCurrent(generation) || sequence !== state.knowledgeRequest) return false;
      if (!data || !Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0 || typeof data.truncated !== 'boolean') throw new Error('The server returned an invalid content list.');
      state.knowledge = data.items;
      state.knowledgeTotal = data.total;
      state.knowledgeTruncated = data.truncated;
      if (data.truncated) $('knowledge-truncated').textContent = `Showing the first ${data.items.length} of ${data.total} items. Search and filters apply only to these items.`;
      $('knowledge-truncated').hidden = !data.truncated;
      state.knowledgeLoaded = true;
      renderKnowledge();
      return true;
    } catch (error) {
      if (isCurrent(generation) && sequence === state.knowledgeRequest && !error.unauthorized) showListState($('knowledge-list-state'), error.message, loadKnowledge);
      return false;
    }
  }

  function renderKnowledge() {
    const query = $('knowledge-search').value.trim().toLocaleLowerCase();
    const status = $('knowledge-filter').value;
    const filtered = state.knowledge.filter((item) => {
      const searchable = [item.title, item.sourceName, kindNames[item.kind]].map((value) => text(value, '')).join(' ').toLocaleLowerCase();
      return (!query || searchable.includes(query)) && (status === 'all' || item.status === status);
    });
    $('knowledge-count').textContent = state.knowledgeTruncated ? `${state.knowledge.length} of ${state.knowledgeTotal} items` : `${state.knowledgeTotal} ${state.knowledgeTotal === 1 ? 'item' : 'items'}`;
    const container = $('knowledge-list');
    container.replaceChildren();
    if (!filtered.length) {
      showListState($('knowledge-list-state'), state.knowledge.length ? 'No content matches your filters.' : 'No content yet. Add an item to get started.');
      return;
    }
    $('knowledge-list-state').hidden = true;
    filtered.forEach((item) => {
      const button = el('button', 'list-item');
      button.type = 'button';
      const selected = state.editing && String(item.id) === String(state.knowledgeId);
      button.classList.toggle('is-selected', selected);
      if (selected) button.setAttribute('aria-current', 'true');
      const badge = el('span');
      displayStatus(badge, item.status);
      button.append(el('span', 'item-title', text(item.title, 'Untitled')), badge,
        el('span', 'item-meta', [kindNames[item.kind] || text(item.kind, 'Content'), text(item.sourceName, '')].filter(Boolean).join(' • ')),
        el('span', 'item-date', niceDate(item.updatedAt || item.createdAt)));
      button.addEventListener('click', () => openKnowledge(item.id));
      container.append(button);
    });
  }

  function updateEditorFields() {
    const kind = $('knowledge-kind').value;
    const documentKind = kind === 'document';
    $('knowledge-content-field').hidden = documentKind;
    $('knowledge-content').required = !documentKind;
    $('knowledge-file-field').hidden = !documentKind || state.editing;
    $('knowledge-file').required = documentKind && !state.editing;
    $('document-content-field').hidden = !documentKind || !state.editing;
    $('kind-note').hidden = !documentKind || !state.editing;
  }

  function newKnowledge() {
    if (!canLeaveEditor()) return;
    clearEditor();
    $('knowledge-placeholder').hidden = true;
    $('knowledge-editor').hidden = false;
    $('editor-heading').textContent = 'Add content';
    $('editor-subtitle').textContent = 'Add information for review and publication.';
    $('editor-status').hidden = true;
    $('knowledge-save').textContent = 'Save content';
    updateEditorFields();
    renderKnowledge();
    $('knowledge-detail').focus();
  }

  async function openKnowledge(id, focus = true, saved = false) {
    if (!saved && !canLeaveEditor()) return;
    clearEditor();
    const generation = state.generation;
    const sequence = state.knowledgeDetailRequest;
    state.knowledgeId = id;
    state.editing = true;
    $('knowledge-placeholder').hidden = true;
    showListState($('knowledge-detail-state'), 'Loading content…');
    renderKnowledge();
    if (focus) $('knowledge-detail').focus();
    try {
      const data = await request(`/api/admin/knowledge/${encodeURIComponent(id)}`);
      if (!isCurrent(generation) || sequence !== state.knowledgeDetailRequest) return;
      if (!data || !data.item || String(data.item.id) !== String(id) || typeof data.item.content !== 'string') throw new Error('The server returned an invalid content item.');
      editKnowledge(data.item);
      if (saved) setNotice($('knowledge-form-notice'), 'Content saved.');
    } catch (error) {
      if (!isCurrent(generation) || sequence !== state.knowledgeDetailRequest || error.unauthorized) return;
      showListState($('knowledge-detail-state'), error.message, () => openKnowledge(id, false, saved));
    }
  }

  function editKnowledge(item) {
    clearEditor();
    state.editing = true;
    state.knowledgeId = item.id;
    $('knowledge-placeholder').hidden = true;
    $('knowledge-editor').hidden = false;
    $('editor-heading').textContent = 'Edit content';
    $('editor-subtitle').textContent = `Updated ${niceDate(item.updatedAt || item.createdAt)}`;
    displayStatus($('editor-status'), item.status);
    $('editor-status').hidden = false;
    $('knowledge-kind').value = item.kind;
    $('knowledge-kind').disabled = true;
    $('knowledge-title-input').value = text(item.title, '');
    $('knowledge-source').value = text(item.sourceName, '');
    $('knowledge-content').value = text(item.content, '');
    $('document-content').textContent = text(item.content, 'No extracted content available.');
    $('knowledge-status').value = item.status;
    updateEditorFields();
    renderKnowledge();
  }

  $('new-knowledge').addEventListener('click', newKnowledge);
  $('empty-add-knowledge').addEventListener('click', newKnowledge);
  $('knowledge-cancel').addEventListener('click', () => {
    if (!canLeaveEditor()) return;
    clearEditor();
    renderKnowledge();
  });
  $('knowledge-kind').addEventListener('change', updateEditorFields);
  $('knowledge-form').addEventListener('input', () => { state.dirty = true; });
  $('knowledge-form').addEventListener('change', () => { state.dirty = true; });
  $('knowledge-search').addEventListener('input', () => { if (state.knowledgeLoaded) renderKnowledge(); });
  $('knowledge-filter').addEventListener('change', () => { if (state.knowledgeLoaded) renderKnowledge(); });
  $('refresh-knowledge').addEventListener('click', async () => {
    if (!canLeaveEditor()) return;
    clearEditor();
    await loadKnowledge();
  });

  $('knowledge-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.knowledgeSaving) return;
    const generation = state.generation;
    const editing = state.editing;
    const id = state.knowledgeId;
    const kind = $('knowledge-kind').value;
    const title = $('knowledge-title-input').value.trim();
    const sourceName = $('knowledge-source').value.trim();
    const status = $('knowledge-status').value;
    if (!title) { setNotice($('knowledge-form-notice'), 'Enter a title.', true); $('knowledge-title-input').focus(); return; }
    if (kind !== 'document' && !$('knowledge-content').value.trim()) { setNotice($('knowledge-form-notice'), 'Enter content.', true); $('knowledge-content').focus(); return; }
    let path = '/api/admin/knowledge';
    let method = 'POST';
    let body;
    if (editing) {
      path += `/${encodeURIComponent(id)}`;
      method = 'PATCH';
      body = { title, sourceName, status };
      if (kind !== 'document') body.content = $('knowledge-content').value;
    } else if (kind === 'document') {
      const file = $('knowledge-file').files[0];
      if (!file || !/\.pdf$/i.test(file.name)) { setNotice($('knowledge-form-notice'), 'Choose a PDF file to upload.', true); $('knowledge-file').focus(); return; }
      path = '/api/admin/documents';
      body = new FormData();
      body.append('file', file);
      body.append('title', title);
      body.append('sourceName', sourceName);
      body.append('status', status);
    } else {
      body = { title, kind, content: $('knowledge-content').value, sourceName, status };
    }
    const button = $('knowledge-save');
    state.knowledgeSaving = true;
    for (const control of $('knowledge-form').elements) control.disabled = true;
    busy(button, true, 'Saving…', 'Save content');
    setNotice($('knowledge-form-notice'), '');
    try {
      await request(path, { method, body });
      if (!isCurrent(generation)) return;
      state.dirty = false;
      const loaded = await loadKnowledge();
      if (!isCurrent(generation)) return;
      if (editing) {
        await openKnowledge(id, false, true);
        if (isCurrent(generation) && !loaded) setNotice($('global-notice'), 'Content saved, but the library could not be refreshed. Try refreshing it.', true);
        return;
      }
      clearEditor();
      setNotice($('global-notice'), loaded ? 'Content saved.' : 'Content saved, but the library could not be refreshed. Try refreshing it.', !loaded);
    } catch (error) {
      if (isCurrent(generation) && !error.unauthorized) setNotice($('knowledge-form-notice'), error.message, true);
    } finally {
      state.knowledgeSaving = false;
      for (const control of $('knowledge-form').elements) control.disabled = false;
      $('knowledge-kind').disabled = state.editing;
      busy(button, false, 'Saving…', 'Save content');
    }
  });

  checkSession();
})();
