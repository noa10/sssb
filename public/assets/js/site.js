(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setInert(element, value) {
    if (!element) return;
    if (value) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    } else {
      element.removeAttribute("inert");
      element.removeAttribute("aria-hidden");
    }
  }

  function initYear() {
    var nodes = document.querySelectorAll("[data-year]");
    var year = String(new Date().getFullYear());
    nodes.forEach(function (node) {
      node.textContent = year;
    });
  }

  function initCurrentPage() {
    var page = document.body.dataset.page || "";
    var company = document.body.dataset.company || "";
    var productPages = ["products", "diving", "parachute", "boats"];
    var isProduct = productPages.indexOf(page) !== -1;

    document.querySelectorAll("[data-nav]").forEach(function (link) {
      var nav = link.getAttribute("data-nav");
      if (nav === page && link.tagName === "A") {
        link.setAttribute("aria-current", company ? "location" : "page");
      }
      if (nav === "products" && isProduct) {
        link.classList.add("is-section");
      }
    });

    if (company) {
      document.querySelectorAll("a[data-company]").forEach(function (link) {
        if (link.dataset.company === company) {
          link.setAttribute("aria-current", "page");
        }
      });
    }

    if (isProduct) {
      var mobileProducts = document.querySelector(".mobile-products");
      if (mobileProducts) mobileProducts.open = true;
    }
  }

  function initDropdown() {
    var root = document.querySelector("[data-dropdown]");
    if (!root) return;

    var trigger = root.querySelector("[data-dropdown-trigger]");
    var panel = root.querySelector("[data-dropdown-panel]");
    if (!trigger || !panel) return;

    var items = Array.prototype.slice.call(
      panel.querySelectorAll("a[href], button:not([disabled])")
    );

    setInert(panel, true);

    function openDropdown(focusFirst) {
      panel.dataset.open = "true";
      trigger.setAttribute("aria-expanded", "true");
      setInert(panel, false);
      if (focusFirst && items.length) {
        window.setTimeout(function () {
          items[0].focus();
        }, 30);
      }
    }

    function closeDropdown(returnFocus) {
      panel.dataset.open = "false";
      trigger.setAttribute("aria-expanded", "false");
      setInert(panel, true);
      if (returnFocus) trigger.focus();
    }

    trigger.addEventListener("click", function () {
      if (panel.dataset.open === "true") {
        closeDropdown(false);
      } else {
        openDropdown(false);
      }
    });

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openDropdown(true);
      }
      if (event.key === "Escape" && panel.dataset.open === "true") {
        event.preventDefault();
        closeDropdown(true);
      }
    });

    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown(true);
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      var index = items.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      var next =
        event.key === "ArrowDown"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      items[next].focus();
    });

    panel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        closeDropdown(false);
      });
    });

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) closeDropdown(false);
    });

    document.addEventListener("focusin", function (event) {
      if (!root.contains(event.target)) closeDropdown(false);
    });
  }

  function initMobileMenu() {
    var toggle = document.querySelector("[data-menu-toggle]");
    var panel = document.querySelector("[data-mobile-menu]");
    var close = document.querySelector("[data-menu-close]");
    var scrim = document.querySelector("[data-menu-scrim]");
    if (!toggle || !panel) return;

    var lastFocused = null;
    var isOpen = false;
    var focusableSelector =
      'a[href], button:not([disabled]), summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';

    setInert(panel, true);

    function openMenu() {
      if (isOpen) return;
      isOpen = true;
      lastFocused = document.activeElement;
      document.body.classList.add("menu-open");
      toggle.setAttribute("aria-expanded", "true");
      panel.dataset.open = "true";
      setInert(panel, false);
      if (scrim) setInert(scrim, false);
      window.setTimeout(function () {
        if (close) close.focus();
      }, 50);
    }

    function closeMenu(returnFocus) {
      if (!isOpen) return;
      isOpen = false;
      document.body.classList.remove("menu-open");
      toggle.setAttribute("aria-expanded", "false");
      panel.dataset.open = "false";
      if (scrim) setInert(scrim, true);
      window.setTimeout(function () {
        if (!isOpen) setInert(panel, true);
      }, 340);
      if (returnFocus !== false) {
        window.setTimeout(function () {
          if (lastFocused && typeof lastFocused.focus === "function") {
            lastFocused.focus();
          } else {
            toggle.focus();
          }
        }, 0);
      }
    }

    toggle.addEventListener("click", function () {
      if (isOpen) closeMenu(true);
      else openMenu();
    });

    if (close) {
      close.addEventListener("click", function () {
        closeMenu(true);
      });
    }

    if (scrim) {
      scrim.addEventListener("click", function () {
        closeMenu(true);
      });
    }

    panel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        closeMenu(false);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (!isOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }

      if (event.key !== "Tab") return;
      var focusable = Array.prototype.slice.call(
        panel.querySelectorAll(focusableSelector)
      ).filter(function (node) {
        return node.offsetParent !== null;
      });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 1024 && isOpen) closeMenu(false);
    });
  }

  function initReveal() {
    var elements = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

    document.querySelectorAll("[data-stagger]").forEach(function (group) {
      Array.prototype.slice.call(group.children).forEach(function (child, index) {
        child.classList.add("reveal");
        child.style.setProperty("--reveal-delay", Math.min(index, 5) * 45 + "ms");
        elements.push(child);
      });
    });

    if (!elements.length) return;

    var unique = elements.filter(function (element, index) {
      return elements.indexOf(element) === index;
    });

    if (reduceMotion || !("IntersectionObserver" in window)) {
      unique.forEach(function (element) {
        element.classList.add("is-visible");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -32px 0px" }
    );

    unique.forEach(function (element) {
      observer.observe(element);
    });
  }

  function initQuoteCarousel() {
    var carousel = document.querySelector("[data-quote-carousel]");
    if (!carousel) return;

    var slides = Array.prototype.slice.call(
      carousel.querySelectorAll("[data-quote-slide]")
    );
    var previous = carousel.querySelector("[data-quote-prev]");
    var next = carousel.querySelector("[data-quote-next]");
    var counter = carousel.querySelector("[data-quote-current]");
    if (!slides.length) return;

    var index = 0;

    function show(newIndex) {
      index = (newIndex + slides.length) % slides.length;
      slides.forEach(function (slide, slideIndex) {
        slide.hidden = slideIndex !== index;
      });
      if (counter) counter.textContent = String(index + 1).padStart(2, "0");
    }

    if (previous) {
      previous.addEventListener("click", function () {
        show(index - 1);
      });
    }

    if (next) {
      next.addEventListener("click", function () {
        show(index + 1);
      });
    }

    carousel.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        show(index + 1);
      }
    });

    show(0);
  }

  function initChat() {
    var widget = document.createElement("div");
    widget.className = "site-chat";
    widget.innerHTML = [
      '<button class="chat-launcher" type="button" aria-expanded="false" aria-controls="sssb-chat-panel">',
      '  <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      '  <span>Ask our AI assistant</span>',
      '</button>',
      '<section class="chat-panel" id="sssb-chat-panel" role="region" aria-labelledby="sssb-chat-title" hidden>',
      '  <div class="chat-resize" role="group" tabindex="0" aria-label="Resize chat panel" aria-controls="sssb-chat-panel" aria-describedby="sssb-chat-resize-help" title="Drag or use arrow keys to resize">',
      '    <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 14V5h9M5 5l8 8M5 10l5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '    <span class="chat-visually-hidden" id="sssb-chat-resize-help">Drag the top left corner, or use the arrow keys. Left and up make the panel larger; right and down make it smaller. Hold Shift for larger steps.</span>',
      '    <span class="chat-visually-hidden chat-resize-feedback" aria-live="polite" aria-atomic="true"></span>',
      '  </div>',
      '  <header class="chat-header">',
      '    <div><p class="chat-header-label">Semenanjung Selatan</p><h2 id="sssb-chat-title">AI product assistant</h2></div>',
      '    <div class="chat-header-actions">',
      '      <button class="chat-fullscreen" type="button" aria-label="Fullscreen chat" aria-pressed="false" aria-controls="sssb-chat-panel" title="Expand chat to fullscreen">',
      '        <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path class="chat-expand-icon" d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path class="chat-restore-icon" d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '      </button>',
      '      <button class="chat-close" type="button" aria-label="Close chat panel">',
      '        <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7"/></svg>',
      '      </button>',
      '    </div>',
      '  </header>',
      '  <div class="chat-body">',
      '    <p class="chat-intro">Ask about our products. For quotations and availability, please contact our team directly.</p>',
      '    <p class="chat-privacy">Please do not share sensitive, confidential or classified information. Chat messages expire 30 days after the chat starts.</p>',
      '    <div class="chat-account">',
      '      <div class="chat-account-guest"><p>Sign in to continue your chat on another device.</p><div class="chat-account-actions"><button class="chat-account-login" type="button">Sign in</button><button class="chat-account-register" type="button">Create account</button></div></div>',
      '      <div class="chat-account-signed-in" hidden><p>Signed in as <strong class="chat-account-email"></strong></p><button class="chat-account-logout" type="button">Sign out</button></div>',
      '      <form class="chat-account-form" hidden>',
      '        <p class="chat-form-heading chat-account-heading">Sign in</p>',
      '        <div class="chat-fields chat-account-fields">',
      '          <label for="sssb-account-email">Email address<input id="sssb-account-email" name="email" type="email" autocomplete="email" maxlength="254" required></label>',
      '          <label for="sssb-account-password">Password<input id="sssb-account-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required></label>',
      '          <label class="chat-account-confirm-label" for="sssb-account-confirm" hidden>Confirm password<input id="sssb-account-confirm" name="confirm" type="password" autocomplete="new-password" maxlength="1024"></label>',
      '        </div>',
      '        <p class="chat-account-help" hidden>Use at least 14 characters. Password recovery by email is not available.</p>',
      '        <button class="btn btn--primary chat-submit chat-account-submit" type="submit">Sign in</button>',
      '        <button class="chat-account-cancel" type="button">Cancel</button>',
      '      </form>',
      '    </div>',
      '    <p class="chat-status" role="status" aria-live="polite" hidden></p>',
      '    <button class="chat-refresh" type="button" hidden>Reload conversation</button>',
      '    <form class="chat-start" hidden>',
      '      <p class="chat-form-heading">Your details</p>',
      '      <div class="chat-fields">',
      '        <label for="sssb-chat-name">Full name (required)<input id="sssb-chat-name" name="name" autocomplete="name" required></label>',
      '        <label for="sssb-chat-email">Email address (required)<input id="sssb-chat-email" name="email" type="email" autocomplete="email" required></label>',
      '        <label for="sssb-chat-phone">Phone number (required)<input id="sssb-chat-phone" name="phone" type="tel" autocomplete="tel" required></label>',
      '        <label for="sssb-chat-company">Company (required)<input id="sssb-chat-company" name="company" autocomplete="organization" required></label>',
      '      </div>',
      '      <label class="chat-consent"><input name="consent" type="checkbox" required><span>I understand that my contact details and chat messages are saved for staff review, and my messages are processed by an AI provider. Messages are deleted 30 days after the chat starts; contact details are retained. <strong>(required)</strong></span></label>',
      '      <button class="btn btn--primary chat-submit" type="submit">Start chat</button>',
      '    </form>',
      '    <div class="chat-conversation" hidden>',
      '      <div class="chat-history" tabindex="0" aria-label="Conversation history">',
      '        <ol class="chat-messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text"></ol>',
      '        <p class="chat-empty">Your conversation will appear here.</p>',
      '      </div>',
      '      <form class="chat-message-form">',
      '        <label for="sssb-chat-message">Your message</label>',
      '        <textarea id="sssb-chat-message" name="message" rows="3" required></textarea>',
      '        <button class="btn btn--primary chat-submit" type="submit">Send message</button>',
      '      </form>',
      '      <button class="chat-end" type="button">End chat</button>',
      '    </div>',
      '    <div class="chat-contact">',
      '      <p>Contact our team</p>',
      '      <a class="chat-email" href="mailto:info@semenanjungselatan.com">info@semenanjungselatan.com</a>',
      '      <a class="chat-phone" href="tel:+6072352330">+60 7-235 2330</a>',
      '      <a class="chat-whatsapp" target="_blank" rel="noopener noreferrer" hidden>Open WhatsApp <span class="chat-external">(opens a new tab)</span></a>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join("");
    document.body.appendChild(widget);

    var launcher = widget.querySelector(".chat-launcher");
    var panel = widget.querySelector(".chat-panel");
    var resizeHandle = widget.querySelector(".chat-resize");
    var resizeFeedback = widget.querySelector(".chat-resize-feedback");
    var fullscreenButton = widget.querySelector(".chat-fullscreen");
    var closePanelButton = widget.querySelector(".chat-close");
    var status = widget.querySelector(".chat-status");
    var refresh = widget.querySelector(".chat-refresh");
    var accountGuest = widget.querySelector(".chat-account-guest");
    var accountSignedIn = widget.querySelector(".chat-account-signed-in");
    var accountEmail = widget.querySelector(".chat-account-email");
    var accountLogin = widget.querySelector(".chat-account-login");
    var accountRegister = widget.querySelector(".chat-account-register");
    var accountLogout = widget.querySelector(".chat-account-logout");
    var accountForm = widget.querySelector(".chat-account-form");
    var accountHeading = widget.querySelector(".chat-account-heading");
    var accountEmailInput = widget.querySelector("#sssb-account-email");
    var accountPassword = widget.querySelector("#sssb-account-password");
    var accountConfirm = widget.querySelector("#sssb-account-confirm");
    var accountConfirmLabel = widget.querySelector(".chat-account-confirm-label");
    var accountHelp = widget.querySelector(".chat-account-help");
    var accountSubmit = widget.querySelector(".chat-account-submit");
    var accountCancel = widget.querySelector(".chat-account-cancel");
    var startForm = widget.querySelector(".chat-start");
    var startButton = startForm.querySelector('button[type="submit"]');
    var conversation = widget.querySelector(".chat-conversation");
    var history = widget.querySelector(".chat-history");
    var messages = widget.querySelector(".chat-messages");
    var empty = widget.querySelector(".chat-empty");
    var messageForm = widget.querySelector(".chat-message-form");
    var messageInput = widget.querySelector("#sssb-chat-message");
    var sendButton = messageForm.querySelector('button[type="submit"]');
    var endButton = widget.querySelector(".chat-end");
    var emailLink = widget.querySelector(".chat-email");
    var whatsappLink = widget.querySelector(".chat-whatsapp");
    var isOpen = false;
    var isFullscreen = false;
    var preferredWidth = 420;
    var preferredHeight = 680;
    var resizeDrag = null;
    var fullscreenInert = [];
    var lastFocused = null;
    var active = null;
    var customer = null;
    var accountMode = null;
    var conversationEmail = "";
    var currentMessages = [];
    var conversationId = null;
    var messageSignature = "";
    var rendererReady = false;
    var loading = false;
    var busy = false;
    var stale = false;
    var pollTimer = null;
    var loadSequence = 0;
    var configSequence = 0;
    var pendingDraft = null;
    var contextApplied = false;
    var restoreAfterPendingLoad = false;

    var catalogue = {
      "jfd": "JFD products",
      "jfd/shadow": "JFD Shadow",
      "jfd/enforcer": "JFD Enforcer",
      "jfd/stealth-multi-role": "JFD Stealth Multi-Role",
      "jfd/stealth-sc": "JFD Stealth SC",
      "seacraft": "Seacraft products",
      "seacraft/future-1000": "Seacraft FUTURE 1000",
      "seacraft/ghost-2000": "Seacraft GHOST 2000",
      "seacraft/go": "Seacraft GO!",
      "seacraft/enc3-pro": "Seacraft ENC3-PRO",
      "fxc": "FXC products",
      "fxc/mc4": "FXC MC-4",
      "fxc/t10d": "FXC T-10D (Modified)",
      "fxc/model-12000": "FXC Model 12000",
      "fxc/model-2101": "FXC Model 2101",
      "zodiac-nautic": "Zodiac Nautic products",
      "zodiac-nautic/open-55": "Zodiac Nautic OPEN 5.5",
      "zodiac-nautic/open-65": "Zodiac Nautic OPEN 6.5",
      "zodiac-nautic/pro-55": "Zodiac Nautic PRO 5.5",
      "zodiac-nautic/medline-68": "Zodiac Nautic MEDLINE 6.8",
      "safe-at-sea": "Safe at Sea products",
      "safe-at-sea/rescuerunner": "Safe at Sea RescueRunner",
      "safe-at-sea/guardrunner": "Safe at Sea GuardRunner",
      "safe-at-sea/saferunner": "Safe at Sea SafeRunner",
      "safe-at-sea/elecorunner": "Safe at Sea ElEcoRunner"
    };

    function catalogueEnquiry() {
      if (document.body.dataset.page !== "contact") return "";
      var params = new URLSearchParams(window.location.search);
      var company = params.get("company") || "";
      var product = params.get("product") || "";
      var key = company + (product ? "/" + product : "");
      return Object.prototype.hasOwnProperty.call(catalogue, key)
        ? "I would like to enquire about " + catalogue[key] + "."
        : "";
    }

    function setStatus(text, isError) {
      var nextText = text || "";
      if (status.textContent !== nextText) status.textContent = nextText;
      status.hidden = !text;
      status.classList.toggle("is-error", !!isError);
    }

    function stopPolling() {
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = null;
    }

    function hasPendingMessage() {
      return currentMessages.some(function (message) {
        return message.status === "pending";
      });
    }

    function updateControls() {
      var accountBusy = busy || loading || stale || hasPendingMessage();
      panel.classList.toggle("has-conversation", active === true && !accountMode);
      accountGuest.hidden = !!customer || !!accountMode;
      accountSignedIn.hidden = !customer;
      accountForm.hidden = !!customer || !accountMode;
      accountEmail.textContent = customer ? customer.email : "";
      accountLogin.disabled = accountBusy;
      accountRegister.disabled = accountBusy;
      accountLogout.disabled = accountBusy;
      accountForm.querySelectorAll("input,button").forEach(function (control) { control.disabled = accountBusy; });
      startForm.hidden = active !== false || !!accountMode;
      conversation.hidden = active !== true || !!accountMode;
      startButton.disabled = busy || loading || stale;
      sendButton.disabled = busy || loading || stale || hasPendingMessage();
      messageInput.disabled = busy || loading || stale || hasPendingMessage();
      endButton.disabled = busy || loading || stale;
      refresh.hidden = !stale && active !== true;
      refresh.disabled = busy || loading;
      startButton.textContent = busy && active === false ? "Starting…" : "Start chat";
    }

    function applyCatalogueContext() {
      if (contextApplied) return;
      contextApplied = true;
      var enquiry = catalogueEnquiry();
      if (enquiry && !messageInput.value) messageInput.value = enquiry;
    }

    function renderMessages() {
      var signature = JSON.stringify([rendererReady, currentMessages]);
      if (signature === messageSignature) return;
      messageSignature = signature;
      var wasNearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 100;
      var visibleMessages = currentMessages.filter(function (message) {
        return message && (message.role === "user" || message.role === "assistant");
      });
      var additions = document.createDocumentFragment();
      visibleMessages.forEach(function (message, index) {
        var item = messages.children[index];
        var itemSignature = JSON.stringify([rendererReady, message.id, message.role, message.content, message.status, message.products, message.approvedLinks]);
        if (item && item.dataset.signature === itemSignature) return;
        if (!item) {
          item = document.createElement("li");
          item.appendChild(document.createElement("strong"));
          var body = document.createElement("div");
          body.className = "chat-message-body";
          item.appendChild(body);
          additions.appendChild(item);
        }
        item.dataset.signature = itemSignature;
        item.className = "chat-message chat-message--" + message.role;
        var label = item.querySelector("strong");
        var content = item.querySelector(".chat-message-body");
        var labelText = message.role === "user" ? "You" : "AI assistant";
        var contentText = typeof message.content === "string" ? message.content : "";
        if (label.textContent !== labelText) label.textContent = labelText;
        if (rendererReady) {
          window.SSSBChatContent.render(content, message, window.location.href);
        } else {
          var plain = document.createElement("p");
          plain.textContent = contentText;
          content.replaceChildren(plain);
        }
        var messageStatus = item.querySelector(".chat-message-status");
        if (message.status === "pending" || message.status === "failed") {
          if (!messageStatus) {
            messageStatus = document.createElement("span");
            messageStatus.className = "chat-message-status";
            item.appendChild(messageStatus);
          }
          messageStatus.textContent = message.status === "pending"
            ? "Waiting for an AI response…"
            : "Your message was saved, but the AI response is unavailable. Please contact our team directly.";
        } else if (messageStatus) {
          messageStatus.remove();
        }
      });
      messages.appendChild(additions);
      while (messages.children.length > visibleMessages.length) messages.lastElementChild.remove();
      empty.hidden = visibleMessages.length > 0;
      if (wasNearBottom && isOpen) history.scrollTop = history.scrollHeight;
    }

    var rendererScript = document.createElement("script");
    rendererScript.src = "/assets/js/chat-content.js";
    rendererScript.addEventListener("load", function () {
      rendererReady = !!window.SSSBChatContent && typeof window.SSSBChatContent.render === "function";
      if (rendererReady) renderMessages();
    });
    document.head.appendChild(rendererScript);

    async function requestJSON(url, options) {
      var timeout = null;
      var controller = url === "/api/chat/current" ? new AbortController() : null;
      if (controller) {
        timeout = window.setTimeout(function () { controller.abort(); }, 15000);
      }
      try {
        var settings = Object.assign({
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Accept": "application/json" }
        }, options || {});
        if (controller) settings.signal = controller.signal;
        var response = await fetch(url, settings);
        var text = await response.text();
        var data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch (error) {
          if (response.ok) throw error;
          data = {};
        }
        if (!response.ok) {
          var requestError = new Error("Request failed");
          requestError.status = response.status;
          requestError.data = data;
          throw requestError;
        }
        return data;
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
      }
    }

    async function postJSON(url, data) {
      var csrf = await requestJSON("/api/csrf");
      if (!csrf || typeof csrf.csrfToken !== "string" || !csrf.csrfToken) {
        throw new Error("CSRF token unavailable");
      }
      return requestJSON(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf.csrfToken
        },
        body: JSON.stringify(data)
      });
    }

    function updateContactConfig() {
      var sequence = ++configSequence;
      whatsappLink.hidden = true;
      whatsappLink.removeAttribute("href");
      requestJSON("/api/public/config").then(function (config) {
        if (sequence !== configSequence) return;
        if (config && typeof config.contactEmail === "string" &&
            /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.contactEmail)) {
          emailLink.href = "mailto:" + config.contactEmail;
          emailLink.textContent = config.contactEmail;
        }
        whatsappLink.hidden = true;
        whatsappLink.removeAttribute("href");
        if (!config || typeof config.whatsappUrl !== "string") return;
        try {
          var url = new URL(config.whatsappUrl);
          if (url.protocol === "https:" && url.hostname.toLowerCase() === "wa.me" &&
              /^\/\d+$/.test(url.pathname) && !url.search && !url.hash &&
              !url.username && !url.password && !url.port) {
            whatsappLink.href = url.href;
            whatsappLink.hidden = false;
          }
        } catch (error) {
          // Ignore invalid optional contact links.
        }
      }).catch(function () {
        if (sequence !== configSequence) return;
        // The known email and phone remain available if configuration cannot load.
        whatsappLink.hidden = true;
        whatsappLink.removeAttribute("href");
      });
    }

    async function loadCurrent() {
      stopPolling();
      var sequence = ++loadSequence;
      loading = true;
      updateControls();
      try {
        var data = await requestJSON("/api/chat/current");
        if (!data || typeof data.active !== "boolean" ||
            (data.active && (!data.conversation || !Array.isArray(data.messages)))) {
          throw new Error("Unexpected chat response");
        }
        if (sequence !== loadSequence) return false;
        if (data.customer != null && (!data.customer || typeof data.customer.email !== "string")) throw new Error("Unexpected customer response");
        var previousCustomer = customer;
        customer = data.customer || null;
        if (customer) {
          accountMode = null;
          accountForm.reset();
        }
        conversationEmail = data.active && typeof data.conversation.email === "string" ? data.conversation.email : "";
        var startEmail = startForm.querySelector('[name="email"]');
        if (customer) {
          startEmail.value = customer.email;
          startEmail.readOnly = true;
        } else {
          startEmail.readOnly = false;
          if (previousCustomer && startEmail.value === previousCustomer.email) startEmail.value = "";
        }
        var nextConversationId = data.active ? String(data.conversation.id) : null;
        if (nextConversationId !== conversationId) {
          messageSignature = "";
          messages.textContent = "";
          empty.hidden = false;
          if (conversationId !== null) {
            pendingDraft = null;
            messageInput.value = "";
            contextApplied = false;
          }
          conversationId = nextConversationId;
        }
        active = data.active;
        currentMessages = active ? data.messages : [];
        if (!active && pendingDraft) {
          pendingDraft = null;
          messageInput.value = "";
          contextApplied = false;
        }
        stale = false;
        updateControls();
        if (active) {
          applyCatalogueContext();
          renderMessages();
        } else {
          messageSignature = "";
        }
        if (pendingDraft && active) {
          var draft = pendingDraft;
          var saved = currentMessages.some(function (message) {
            return message.role === "user" && message.content === draft.value &&
              draft.ids.indexOf(String(message.id)) === -1;
          });
          if (saved && messageInput.value === draft.value) messageInput.value = "";
          pendingDraft = null;
        }
        return true;
      } catch (error) {
        if (sequence !== loadSequence) return false;
        stale = true;
        setStatus(hasPendingMessage()
          ? "We could not load your conversation. We'll keep checking; you can also contact our team below."
          : "We could not load your conversation. Reload it or contact our team below.", true);
        return false;
      } finally {
        if (sequence === loadSequence) {
          loading = false;
          updateControls();
          if (restoreAfterPendingLoad && isOpen && !busy) {
            restoreAfterPendingLoad = false;
            refreshCurrent();
          } else if (isOpen && !busy && active && hasPendingMessage()) {
            schedulePendingRefresh();
          }
        }
      }
    }

    function schedulePendingRefresh() {
      if (!isOpen || busy || !active || !hasPendingMessage() || pollTimer !== null) return;
      pollTimer = window.setTimeout(function () {
        pollTimer = null;
        refreshCurrent(true);
      }, stale ? 10000 : 4000);
    }

    function refreshCurrent(automatic) {
      if (busy || loading) return;
      if (!automatic) setStatus("Loading conversation…", false);
      var previousPending = currentMessages.filter(function (message) {
        return message && message.status === "pending";
      }).map(function (message) { return String(message.id); });
      return loadCurrent().then(function (loaded) {
        if (!loaded) return;
        var failedPending = currentMessages.some(function (message) {
          return message && message.status === "failed" && previousPending.indexOf(String(message.id)) !== -1;
        });
        if (failedPending) {
          setStatus("Your message was saved, but the AI response is unavailable. Please contact our team directly.", true);
        } else if (hasPendingMessage()) {
          setStatus("Waiting for an AI response…", false);
        } else {
          setStatus("", false);
        }
      });
    }

    function layoutPanel() {
      if (!isOpen) return null;
      var visualViewport = window.visualViewport;
      var viewportLeft = visualViewport ? visualViewport.offsetLeft : 0;
      var viewportTop = visualViewport ? visualViewport.offsetTop : 0;
      var viewportWidth = visualViewport ? visualViewport.width : document.documentElement.clientWidth;
      var viewportHeight = visualViewport ? visualViewport.height : window.innerHeight;
      var left = viewportLeft;
      var top = viewportTop;
      var width = viewportWidth;
      var height = viewportHeight;

      if (!isFullscreen) {
        var inset = viewportWidth <= 480 ? 12 : 20;
        var style = window.getComputedStyle(widget);
        var leftInset = Math.min(Math.max(inset, parseFloat(style.getPropertyValue("--chat-safe-left")) || 0), viewportWidth / 2);
        var rightInset = Math.min(Math.max(inset, parseFloat(style.getPropertyValue("--chat-safe-right")) || 0), viewportWidth / 2);
        var topInset = Math.min(Math.max(inset, parseFloat(style.getPropertyValue("--chat-safe-top")) || 0), viewportHeight / 2);
        var bottomInset = Math.min(Math.max(inset, parseFloat(style.getPropertyValue("--chat-safe-bottom")) || 0), viewportHeight / 2);
        var maxWidth = Math.max(1, viewportWidth - leftInset - rightInset);
        var bottom = viewportTop + viewportHeight - bottomInset;
        var launcherTop = launcher.getBoundingClientRect().top - 12;
        var minimumHeight = Math.min(320, Math.max(1, viewportHeight - topInset - bottomInset));
        if (launcherTop >= viewportTop + topInset + minimumHeight) {
          bottom = Math.min(bottom, launcherTop);
        }
        var maxHeight = Math.max(1, bottom - viewportTop - topInset);
        width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), preferredWidth));
        height = Math.min(maxHeight, Math.max(Math.min(320, maxHeight), preferredHeight));
        left = viewportLeft + viewportWidth - rightInset - width;
        top = bottom - height;
      }

      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.width = width + "px";
      panel.style.height = height + "px";
      return { width: width, height: height };
    }

    function announcePanelSize() {
      var rect = panel.getBoundingClientRect();
      resizeFeedback.textContent = "Chat panel width " + Math.round(rect.width) + " pixels, height " + Math.round(rect.height) + " pixels.";
    }

    function stopResize() {
      if (!resizeDrag) return;
      var pointerId = resizeDrag.pointerId;
      resizeDrag = null;
      panel.classList.remove("is-resizing");
      if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      announcePanelSize();
    }

    function setFullscreen(enabled) {
      if (enabled === isFullscreen) return;
      stopResize();
      isFullscreen = enabled;
      panel.classList.toggle("is-fullscreen", enabled);
      panel.setAttribute("role", enabled ? "dialog" : "region");
      if (enabled) panel.setAttribute("aria-modal", "true");
      else panel.removeAttribute("aria-modal");
      fullscreenButton.setAttribute("aria-pressed", String(enabled));
      fullscreenButton.title = enabled ? "Restore chat size" : "Expand chat to fullscreen";
      resizeHandle.hidden = enabled;

      if (enabled) {
        Array.prototype.forEach.call(document.body.children, function (element) {
          if (element !== widget && !element.hasAttribute("inert")) {
            element.setAttribute("inert", "");
            fullscreenInert.push(element);
          }
        });
        if (!launcher.hasAttribute("inert")) {
          launcher.setAttribute("inert", "");
          fullscreenInert.push(launcher);
        }
      } else {
        fullscreenInert.forEach(function (element) { element.removeAttribute("inert"); });
        fullscreenInert = [];
      }
      layoutPanel();
      if (enabled && !panel.contains(document.activeElement)) fullscreenButton.focus();
    }

    function openPanel(trigger) {
      if (isOpen) return;
      var mobilePanel = document.querySelector("[data-mobile-menu]");
      if (mobilePanel && mobilePanel.dataset.open === "true") return;
      isOpen = true;
      stopPolling();
      lastFocused = trigger || document.activeElement;
      panel.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      layoutPanel();
      closePanelButton.focus();
      updateContactConfig();
      if (busy || loading) {
        restoreAfterPendingLoad = true;
      } else {
        refreshCurrent();
      }
    }

    function finishOperation() {
      busy = false;
      updateControls();
      if (restoreAfterPendingLoad && isOpen && !loading) {
        restoreAfterPendingLoad = false;
        refreshCurrent();
      } else {
        schedulePendingRefresh();
      }
    }

    function closePanel() {
      if (!isOpen) return;
      stopResize();
      if (isFullscreen) setFullscreen(false);
      isOpen = false;
      restoreAfterPendingLoad = false;
      stopPolling();
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      if (lastFocused && typeof lastFocused.focus === "function" && lastFocused.offsetParent !== null) {
        lastFocused.focus();
      } else {
        launcher.focus();
      }
    }

    launcher.addEventListener("click", function () {
      if (isOpen) closePanel();
      else openPanel(launcher);
    });
    closePanelButton.addEventListener("click", closePanel);
    fullscreenButton.addEventListener("click", function () { setFullscreen(!isFullscreen); });
    resizeHandle.addEventListener("pointerdown", function (event) {
      if (isFullscreen || event.isPrimary === false || event.button !== 0) return;
      event.preventDefault();
      var rect = panel.getBoundingClientRect();
      resizeDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      resizeHandle.focus({ preventScroll: true });
      resizeHandle.setPointerCapture(event.pointerId);
      panel.classList.add("is-resizing");
    });
    resizeHandle.addEventListener("pointermove", function (event) {
      if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
      preferredWidth = resizeDrag.width + resizeDrag.x - event.clientX;
      preferredHeight = resizeDrag.height + resizeDrag.y - event.clientY;
      var size = layoutPanel();
      preferredWidth = size.width;
      preferredHeight = size.height;
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) {
      resizeHandle.addEventListener(name, function (event) {
        if (resizeDrag && event.pointerId === resizeDrag.pointerId) stopResize();
      });
    });
    resizeHandle.addEventListener("keydown", function (event) {
      if (isFullscreen || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(event.key) === -1) return;
      event.preventDefault();
      var step = event.shiftKey ? 80 : 20;
      var rect = panel.getBoundingClientRect();
      if (event.key === "ArrowLeft") preferredWidth = rect.width + step;
      if (event.key === "ArrowRight") preferredWidth = rect.width - step;
      if (event.key === "ArrowUp") preferredHeight = rect.height + step;
      if (event.key === "ArrowDown") preferredHeight = rect.height - step;
      var size = layoutPanel();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") preferredWidth = size.width;
      else preferredHeight = size.height;
      announcePanelSize();
    });
    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (isFullscreen) setFullscreen(false);
        else closePanel();
        return;
      }
      if (!isFullscreen || event.key !== "Tab") return;
      var focusable = Array.prototype.slice.call(panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) { return element.offsetParent !== null; });
      if (!focusable.length) {
        event.preventDefault();
        fullscreenButton.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener("resize", layoutPanel);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", layoutPanel);
      window.visualViewport.addEventListener("scroll", layoutPanel);
    }
    refresh.addEventListener("click", function () { refreshCurrent(false); });
    document.querySelectorAll("[data-open-chat]").forEach(function (button) {
      button.hidden = false;
      button.addEventListener("click", function () { openPanel(button); });
    });

    if (document.body.dataset.page === "contact") {
      document.querySelectorAll('a[href*="#enquiry"]').forEach(function (link) {
        var destination = new URL(link.href, window.location.href);
        if (destination.pathname === window.location.pathname && destination.hash === "#enquiry") {
          link.addEventListener("click", function () {
            if (link.closest("[data-mobile-menu]")) {
              window.setTimeout(function () { openPanel(launcher); }, 60);
            } else {
              openPanel(link);
            }
          });
        }
      });
      window.addEventListener("hashchange", function () {
        if (window.location.hash === "#enquiry") {
          window.setTimeout(function () { openPanel(launcher); }, 60);
        }
      });
      if (window.location.hash === "#enquiry") openPanel(launcher);
    }

    function clearChatView() {
      active = null;
      conversationId = null;
      conversationEmail = "";
      currentMessages = [];
      messages.textContent = "";
      empty.hidden = false;
      messageSignature = "";
      messageInput.value = "";
      pendingDraft = null;
      contextApplied = false;
    }

    function setAccountMode(mode) {
      if (busy || loading || stale || hasPendingMessage()) return;
      accountMode = mode;
      accountForm.reset();
      accountEmailInput.value = conversationEmail || startForm.querySelector('[name="email"]').value || "";
      accountHeading.textContent = mode === "register" ? "Create account" : "Sign in";
      accountSubmit.textContent = mode === "register" ? "Create account" : "Sign in";
      accountPassword.autocomplete = mode === "register" ? "new-password" : "current-password";
      accountPassword.minLength = mode === "register" ? 14 : 1;
      accountConfirmLabel.hidden = mode !== "register";
      accountConfirm.required = mode === "register";
      accountHelp.hidden = mode !== "register";
      setStatus("", false);
      updateControls();
      if (mode) accountEmailInput.focus();
    }

    accountLogin.addEventListener("click", function () { setAccountMode("login"); });
    accountRegister.addEventListener("click", function () { setAccountMode("register"); });
    accountCancel.addEventListener("click", function () { setAccountMode(null); });
    accountForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!accountMode || busy || loading || stale || hasPendingMessage() || !accountForm.reportValidity()) return;
      if (accountMode === "register" && accountPassword.value !== accountConfirm.value) {
        setStatus("The passwords do not match.", true);
        accountConfirm.focus();
        return;
      }
      var mode = accountMode;
      var failure = "";
      busy = true;
      stopPolling();
      updateControls();
      setStatus(mode === "register" ? "Creating account…" : "Signing in…", false);
      try {
        await postJSON(mode === "register" ? "/api/customer/register" : "/api/customer/login", {
          email: accountEmailInput.value.trim(), password: accountPassword.value
        });
      } catch (error) {
        failure = error.data && typeof error.data.error === "string" ? error.data.error : "We could not sign you in. Please try again.";
      }
      accountPassword.value = "";
      accountConfirm.value = "";
      clearChatView();
      var loaded = await loadCurrent();
      if (loaded && customer) {
        accountMode = null;
        accountForm.reset();
        setStatus(active ? "Signed in. Your chat is ready." : "Signed in. You can start a chat.", false);
      } else if (loaded) {
        accountPassword.value = "";
        accountConfirm.value = "";
        setStatus(failure || "We could not sign you in. Please try again.", true);
      }
      finishOperation();
    });
    accountLogout.addEventListener("click", async function () {
      if (busy || loading || stale || hasPendingMessage()) return;
      busy = true;
      stopPolling();
      clearChatView();
      updateControls();
      setStatus("Signing out…", false);
      try { await postJSON("/api/customer/logout", {}); } catch (error) { /* Refresh to confirm the session state. */ }
      var loaded = await loadCurrent();
      if (loaded) setStatus(customer ? "We could not sign you out. Please try again." : "Signed out. Sign in again to continue your chat.", !!customer);
      finishOperation();
    });

    startForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || loading || stale || active !== false || !startForm.reportValidity()) return;
      var fields = ["name", "email", "phone", "company"];
      for (var i = 0; i < fields.length; i += 1) {
        var field = startForm.querySelector('[name="' + fields[i] + '"]');
        if (!field.value.trim()) {
          field.focus();
          setStatus("Enter your name, email, phone number and company before starting chat.", true);
          return;
        }
      }
      busy = true;
      stopPolling();
      updateControls();
      setStatus("Starting chat…", false);
      var started = false;
      try {
        var result = await postJSON("/api/chat/start", {
          name: startForm.querySelector('[name="name"]').value.trim(),
          email: startForm.querySelector('[name="email"]').value.trim(),
          phone: startForm.querySelector('[name="phone"]').value.trim(),
          company: startForm.querySelector('[name="company"]').value.trim(),
          consent: startForm.querySelector('[name="consent"]').checked
        });
        if (!result || result.active !== true || !result.conversation || !Array.isArray(result.messages)) {
          throw new Error("Unexpected chat response");
        }
        active = true;
        conversationId = String(result.conversation.id);
        conversationEmail = result.conversation.email;
        messages.textContent = "";
        empty.hidden = false;
        messageSignature = "";
        currentMessages = result.messages;
        stale = false;
        renderMessages();
        applyCatalogueContext();
        started = true;
        setStatus("Chat started. You can now send a message.", false);
      } catch (error) {
        var loaded = await loadCurrent();
        if (loaded) {
          setStatus(active ? "Your existing chat is ready." : "We could not start the chat. Please try again or contact our team.", !active);
        }
      } finally {
        finishOperation();
        if (started && isOpen && !messageInput.disabled) messageInput.focus();
      }
    });

    messageForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || loading || stale || active !== true || hasPendingMessage() || !messageForm.reportValidity()) return;
      var value = messageInput.value.trim();
      if (!value) {
        messageInput.focus();
        setStatus("Enter a message before sending.", true);
        return;
      }
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        setStatus("Chat is unavailable in this browser. Please contact our team below.", true);
        return;
      }
      pendingDraft = {
        value: value,
        ids: currentMessages.map(function (message) { return String(message.id); })
      };
      messageInput.value = value;
      busy = true;
      stopPolling();
      updateControls();
      setStatus("Sending message and waiting for an AI response…", false);
      var result = null;
      var savedFailure = false;
      try {
        result = await postJSON("/api/chat/messages", { message: value, requestId: window.crypto.randomUUID() });
        if (!result || result.ok !== true || (result.status !== "answered" && result.status !== "failed")) {
          throw new Error("Unexpected message response");
        }
      } catch (error) {
        savedFailure = error.status === 503 && error.data && error.data.saved === true;
        result = null;
      }
      var loaded = await loadCurrent();
      finishOperation();
      if (loaded) {
        if (savedFailure) {
          setStatus("Your message was saved, but the AI response is unavailable. Please contact our team directly.", true);
        } else if (!result) {
          setStatus("The message could not be confirmed. Check the conversation before sending again, or contact our team.", true);
        } else if (!active) {
          setStatus("The chat is no longer active. Contact our team or start a new conversation.", true);
        } else if (result.status === "failed") {
          setStatus("The AI response is unavailable. Please contact our team directly.", true);
        } else {
          setStatus(hasPendingMessage() ? "Waiting for an AI response…" : "Response received.", false);
        }
        if (isOpen && !messageInput.disabled) messageInput.focus();
        schedulePendingRefresh();
      } else if (savedFailure) {
        setStatus("Your message was saved, but the AI response is unavailable and the conversation could not be loaded. Reload it or contact our team.", true);
      }
    });

    endButton.addEventListener("click", async function () {
      if (busy || loading || stale || active !== true) return;
      busy = true;
      stopPolling();
      updateControls();
      setStatus("Ending chat…", false);
      var ended = false;
      try {
        await postJSON("/api/chat/close", {});
        ended = true;
      } catch (error) {
        ended = false;
      }
      var loaded = await loadCurrent();
      finishOperation();
      if (loaded) {
        if (!active) {
          startForm.reset();
          if (customer) startForm.querySelector('[name="email"]').value = customer.email;
          messageInput.value = "";
          pendingDraft = null;
          contextApplied = false;
          setStatus("Chat ended. You can start a new conversation whenever you need to.", false);
        } else {
          setStatus(ended ? "The chat is still active. Reload the conversation or contact our team." : "We could not end the chat. Please try again.", true);
        }
      }
    });
  }

  initYear();
  initCurrentPage();
  initDropdown();
  initMobileMenu();
  initReveal();
  initQuoteCarousel();
  initChat();

  window.addEventListener("load", function () {
    document.documentElement.classList.add("is-loaded");
  });
})();
