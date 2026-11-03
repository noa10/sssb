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
    var fullscreenControl = [
      '<button class="chat-fullscreen" type="button" aria-label="Fullscreen chat" aria-pressed="false" aria-controls="sssb-chat-panel" title="Expand chat to fullscreen">',
      '  <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path class="chat-expand-icon" d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path class="chat-restore-icon" d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '</button>'
    ].join("");
    widget.innerHTML = [
      '<button class="chat-launcher" type="button" aria-expanded="false" aria-controls="sssb-chat-panel">',
      '  <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      '  <span>Ask Haji</span>',
      '</button>',
      '<section class="chat-panel" id="sssb-chat-panel" role="region" aria-labelledby="sssb-chat-title" hidden>',
      '  <div class="chat-resize" role="group" tabindex="0" aria-label="Resize chat panel" aria-controls="sssb-chat-panel" aria-describedby="sssb-chat-resize-help" title="Drag or use arrow keys to resize">',
      '    <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 14V5h9M5 5l8 8M5 10l5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '    <span class="chat-visually-hidden" id="sssb-chat-resize-help">Drag the top left corner, or use the arrow keys. Left and up make the panel larger; right and down make it smaller. Hold Shift for larger steps.</span>',
      '    <span class="chat-visually-hidden chat-resize-feedback" aria-live="polite" aria-atomic="true"></span>',
      '  </div>',
      '  <header class="chat-header">',
      '    <div class="chat-brand"><button class="chat-conversation-back" type="button" aria-label="Back to messages" aria-controls="sssb-chat-archive" title="Back to messages" hidden><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><img class="chat-brand-logo" src="/assets/img/haji-avatar2.png" alt="" aria-hidden="true" width="34" height="34"><div><h2 id="sssb-chat-title">Haji</h2><p class="chat-header-label">Company and product enquiries</p></div></div>',
      '    <div class="chat-header-actions">',
      fullscreenControl,
      '      <button class="chat-close" type="button" aria-label="Close chat panel">',
      '        <svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7"/></svg>',
      '      </button>',
      '    </div>',
      '  </header>',
      '  <div class="chat-body">',
      '    <div class="chat-account" hidden>',
      '      <div class="chat-account-guest"><p class="chat-form-heading">Your account</p><p>Sign in to start a conversation and pick it up again later.</p><div class="chat-account-actions"><button class="btn btn--primary chat-account-login" type="button">Sign in</button><button class="chat-account-register" type="button">Create an account</button></div><div class="chat-guest-existing" hidden><p>To continue your previous chat, sign in or create an account using the same email address.</p><button class="chat-guest-end" type="button">End previous guest chat</button></div></div>',
      '      <div class="chat-account-signed-in" hidden><p class="chat-form-heading">Your account</p><div class="chat-account-menu"><p>Signed in as <strong class="chat-account-email"></strong></p><button class="chat-account-profile" type="button">Edit account details</button><button class="chat-account-refresh" type="button" hidden>Reload conversation</button><button class="chat-account-logout" type="button">Sign out</button></div></div>',
      '      <form class="chat-account-form" hidden>',
      '        <p class="chat-form-heading chat-account-heading">Sign in</p>',
      '        <p class="chat-account-description">Continue your conversation with our assistant.</p>',
      '        <div class="chat-fields chat-account-fields">',
      '          <label class="chat-account-profile-label" for="sssb-account-name" hidden>Full name<input id="sssb-account-name" name="name" autocomplete="name" maxlength="120" data-account-profile></label>',
      '          <label class="chat-account-profile-label" for="sssb-account-phone" hidden>Phone number<input id="sssb-account-phone" name="phone" type="tel" autocomplete="tel" maxlength="50" data-account-profile></label>',
      '          <label class="chat-account-profile-label" for="sssb-account-company" hidden>Company<input id="sssb-account-company" name="company" autocomplete="organization" maxlength="160" data-account-profile></label>',
      '          <label for="sssb-account-email">Email address<input id="sssb-account-email" name="email" type="email" autocomplete="email" maxlength="254" required></label>',
      '          <label for="sssb-account-password">Password<input id="sssb-account-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required></label>',
      '          <label class="chat-account-confirm-label" for="sssb-account-confirm" hidden>Confirm password<input id="sssb-account-confirm" name="confirm" type="password" autocomplete="new-password" maxlength="1024"></label>',
      '        </div>',
      '        <p class="chat-account-help" hidden>Use at least 8 characters. Password recovery by email is not available.</p>',
      '        <button class="btn btn--primary chat-submit chat-account-submit" type="submit">Sign in</button>',
      '        <div class="chat-account-form-actions"><button class="chat-account-switch" type="button">Create an account</button><button class="chat-account-cancel" type="button">Back to chat</button></div>',
      '      </form>',
      '      <form class="chat-profile-form" hidden>',
      '        <p class="chat-form-heading">Account details</p>',
      '        <p class="chat-profile-help" hidden>Please complete your account details before starting a chat.</p>',
      '        <div class="chat-fields chat-account-fields">',
      '          <label for="sssb-profile-name">Full name<input id="sssb-profile-name" name="name" autocomplete="name" maxlength="120" required></label>',
      '          <label for="sssb-profile-phone">Phone number<input id="sssb-profile-phone" name="phone" type="tel" autocomplete="tel" maxlength="50" required></label>',
      '          <label for="sssb-profile-company">Company<input id="sssb-profile-company" name="company" autocomplete="organization" maxlength="160" required></label>',
      '        </div>',
      '        <button class="btn btn--primary chat-submit" type="submit">Save account details</button>',
      '        <button class="chat-profile-cancel" type="button">Back to chat</button>',
      '      </form>',
      '    </div>',
      '    <p class="chat-status" role="status" aria-live="polite" hidden></p>',
      '    <button class="chat-refresh" type="button" hidden>Reload conversation</button>',
      '    <div class="chat-conversation" hidden>',
      '      <div class="chat-history" tabindex="0" aria-label="Conversation history">',
      '        <ol class="chat-messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text"></ol>',
      '        <p class="chat-empty">Your conversation will appear here.</p>',
      '      </div>',
      '      <form class="chat-message-form">',
      '        <label class="chat-visually-hidden" for="sssb-chat-message">Your message</label>',
      '        <textarea id="sssb-chat-message" name="message" rows="1" maxlength="4000" placeholder="Ask a question…" title="Press Enter to send. Press Shift+Enter for a new line." required></textarea>',
      '        <button class="chat-send" type="submit" aria-label="Send message"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 16 8-16 8 2-8-2-8Zm2 8h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>',
      '      </form>',
      '      <div class="chat-conversation-actions"><button class="chat-quotation-open" type="button" aria-controls="sssb-chat-quotation" aria-describedby="sssb-quotation-start-hint" aria-expanded="false">Request a quotation</button><p class="chat-quotation-start-hint" id="sssb-quotation-start-hint" hidden>Send a message to start your chat before requesting a quotation.</p></div>',
      '      <p class="chat-legal chat-conversation-legal">By chatting with us, you agree to our <a href="privacy.html">Privacy Policy</a>.</p>',
      '    </div>',
      '    <section class="chat-archive chat-view" id="sssb-chat-archive" aria-labelledby="sssb-archive-title" hidden>',
      '      <div class="chat-view-heading"><span class="chat-view-spacer" aria-hidden="true"></span><h3 class="chat-view-title" id="sssb-archive-title" tabindex="-1">Messages</h3><div class="chat-view-actions">',
      fullscreenControl,
      '        <button class="chat-archive-close chat-view-close" type="button" aria-label="Close chat panel" title="Close chat panel"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7"/></svg></button></div></div>',
      '      <p class="chat-archive-status" role="status" aria-live="polite" hidden></p>',
      '      <div class="chat-archive-list-view">',
      '        <div class="chat-archive-empty" hidden><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><strong>No messages</strong><p class="chat-archive-empty-detail">Your conversations will appear here.</p></div>',
      '        <ul class="chat-archive-list"></ul>',
      '        <button class="chat-archive-ask" type="button">Ask a question</button>',
      '        <p class="chat-legal">By starting a chat, you agree to our <a href="privacy.html">Privacy Policy</a>. Messages are no longer available 30 days after the chat starts. Please do not share sensitive, confidential or classified information.</p>',
      '      </div>',
      '      <div class="chat-archive-transcript" hidden>',
      '        <button class="chat-archive-back" type="button">Back to messages</button>',
      '        <p class="chat-archive-meta"></p>',
      '        <ol class="chat-messages chat-archive-messages" aria-label="Past chat messages"></ol>',
      '        <p class="chat-archive-expired" hidden>Messages for this chat are no longer available.</p>',
      '      </div>',
      '    </section>',
      '    <section class="chat-help chat-view" id="sssb-chat-help" aria-labelledby="sssb-help-title" hidden>',
      '      <div class="chat-view-heading"><span class="chat-view-spacer" aria-hidden="true"></span><h3 class="chat-view-title" id="sssb-help-title" tabindex="-1">Help</h3><div class="chat-view-actions">',
      fullscreenControl,
      '        <button class="chat-help-close chat-view-close" type="button" aria-label="Close chat panel" title="Close chat panel"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7"/></svg></button></div></div>',
      '      <div class="chat-help-body">',
      '        <p class="chat-help-lede">For a quotation, open a chat and select Request a quotation. For other help, contact our team.</p>',
      '        <div class="chat-help-links">',
      '          <a class="chat-help-link chat-email" href="mailto:info@semenanjungselatan.com">info@semenanjungselatan.com</a>',
      '          <a class="chat-help-link chat-phone" href="tel:+6072352330">+60 7-235 2330</a>',
      '          <a class="chat-help-link chat-whatsapp" target="_blank" rel="noopener noreferrer" hidden>Open WhatsApp <span class="chat-external">(opens a new tab)</span></a>',
      '          <a class="chat-help-link" href="contact.html">Contact page</a>',
      '        </div>',
      '        <div class="chat-help-note"><strong>Privacy</strong><p>Chat messages are no longer available 30 days after a chat starts. Contact details and quotation requests are retained so our team can follow up.</p><a href="privacy.html">Read the privacy policy</a></div>',
      '      </div>',
      '    </section>',
      '    <section class="chat-quotation" id="sssb-chat-quotation" aria-labelledby="sssb-quotation-title" hidden>',
      '      <h3 class="chat-form-heading" id="sssb-quotation-title" tabindex="-1">Request a quotation</h3>',
      '      <p class="chat-quotation-intro">Tell us what you need. Our team will use your account details to follow up.</p>',
      '      <div class="chat-quotation-contact"><div><span>Contact</span><strong class="chat-quotation-name"></strong><span class="chat-quotation-email"></span><span class="chat-quotation-phone"></span><span class="chat-quotation-company"></span></div><button class="chat-quotation-edit" type="button">Edit account details</button></div>',
      '      <form class="chat-quotation-form">',
      '        <div class="chat-fields">',
      '          <label for="sssb-quotation-product">Product or manufacturer <strong>(required)</strong><select id="sssb-quotation-product" name="product" required></select></label>',
      '          <p class="chat-quotation-status chat-quotation-catalogue-status" role="status" aria-live="polite" hidden></p>',
      '          <button class="chat-quotation-back chat-quotation-catalogue-retry" type="button" hidden>Retry loading products</button>',
      '          <label class="chat-quotation-other" for="sssb-quotation-other" hidden>Product or service <strong>(required)</strong><input id="sssb-quotation-other" name="other" maxlength="200"></label>',
      '          <label class="chat-quotation-jfd" for="sssb-quotation-enquiry-type" hidden>Area of interest <strong>(required)</strong><select id="sssb-quotation-enquiry-type" name="enquiryType"><option value="">Select an area</option><option value="commercial-diving">Commercial diving and hyperbaric equipment</option><option value="defence-diving">Defence diving</option><option value="safety-systems">Safety critical systems &amp; communications</option><option value="service-maintenance">Service, inspection, maintenance and training</option><option value="submarine-rescue">Submarine escape and rescue</option><option value="submarine-platforms">Submarine platforms</option><option value="tactical-delivery">Tactical delivery vehicles</option></select></label>',
      '          <label for="sssb-quotation-message">Request details <span class="chat-quotation-message-required">(optional)</span><textarea id="sssb-quotation-message" name="message" maxlength="2000" rows="3" placeholder="Tell us what you need and how it will be used."></textarea></label>',
      '          <label for="sssb-quotation-quantity">Quantity <span>(optional)</span><input id="sssb-quotation-quantity" name="quantity" type="number" min="1" max="100000" step="1" inputmode="numeric"></label>',
      '          <label for="sssb-quotation-date">Required by <span>(optional)</span><input id="sssb-quotation-date" name="requiredBy" type="date"></label>',
      '          <label for="sssb-quotation-delivery">Delivery location <span>(optional)</span><input id="sssb-quotation-delivery" name="deliveryLocation" maxlength="200"></label>',
      '          <label for="sssb-quotation-route">Procurement route <span>(optional)</span><select id="sssb-quotation-route" name="procurementRoute"><option value="unsure">Not sure</option><option value="government">Government procurement</option><option value="direct">Direct purchase</option><option value="support">Support request</option></select></label>',
      '          <label class="chat-quotation-country" for="sssb-quotation-country" hidden>Country <strong>(required)</strong><input id="sssb-quotation-country" name="country" autocomplete="country-name" maxlength="100"></label>',
      '          <div class="chat-quotation-zodiac chat-fields" hidden>',
      '            <label for="sssb-quotation-city">City <strong>(required)</strong><input id="sssb-quotation-city" name="city" autocomplete="address-level2" maxlength="100"></label>',
      '            <label for="sssb-quotation-postal">Postal code <strong>(required)</strong><input id="sssb-quotation-postal" name="postalCode" autocomplete="postal-code" maxlength="30"></label>',
      '            <label for="sssb-quotation-navigation">Navigation area <strong>(required)</strong><input id="sssb-quotation-navigation" name="navigationArea" maxlength="100"></label>',
      '            <label for="sssb-quotation-region">State, region or department <span>(optional)</span><input id="sssb-quotation-region" name="region" autocomplete="address-level1" maxlength="100"><small>For the USA or France, please include your state or department.</small></label>',
      '          </div>',
      '        </div>',
      '        <p class="chat-quotation-retention">Your quotation request and contact details remain available to our team after chat messages expire.</p>',
      '        <p class="chat-quotation-status" role="status" aria-live="polite" hidden></p>',
      '        <div class="chat-quotation-actions"><button class="btn btn--primary chat-submit" type="submit">Send quotation request</button><button class="chat-quotation-back" type="button">Back to chat</button></div>',
      '      </form>',
      '    </section>',
      '  </div>',
      '  <nav class="chat-nav" aria-label="Chat sections">',
      '    <button class="chat-nav-item" type="button" data-chat-tab="messages" aria-current="page"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8M8 12.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Messages</span></button>',
      '    <button class="chat-nav-item" type="button" data-chat-tab="help"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M9.8 9.2a2.3 2.3 0 1 1 3.1 2.2c-.6.3-.9.8-.9 1.4v.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 16.6h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg><span>Help</span></button>',
      '    <button class="chat-nav-item" type="button" data-chat-tab="account"><svg class="od-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M5 20v-1a7 7 0 0 1 14 0v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Account</span></button>',
      '  </nav>',
      '</section>'
    ].join("");
    document.body.appendChild(widget);

    var launcher = widget.querySelector(".chat-launcher");
    var panel = widget.querySelector(".chat-panel");
    var resizeHandle = widget.querySelector(".chat-resize");
    var resizeFeedback = widget.querySelector(".chat-resize-feedback");
    var fullscreenButtons = widget.querySelectorAll(".chat-fullscreen");
    var closePanelButton = widget.querySelector(".chat-close");
    var status = widget.querySelector(".chat-status");
    var refresh = widget.querySelector(".chat-refresh");
    var accountArea = widget.querySelector(".chat-account");
    var accountGuest = widget.querySelector(".chat-account-guest");
    var guestExisting = widget.querySelector(".chat-guest-existing");
    var guestEnd = widget.querySelector(".chat-guest-end");
    var accountSignedIn = widget.querySelector(".chat-account-signed-in");
    var accountEmail = widget.querySelector(".chat-account-email");
    var accountLogin = widget.querySelector(".chat-account-login");
    var accountRegister = widget.querySelector(".chat-account-register");
    var accountProfile = widget.querySelector(".chat-account-profile");
    var accountRefresh = widget.querySelector(".chat-account-refresh");
    var accountLogout = widget.querySelector(".chat-account-logout");
    var helpView = widget.querySelector("#sssb-chat-help");
    var helpTitle = widget.querySelector("#sssb-help-title");
    var helpClose = widget.querySelector(".chat-help-close");
    var navMessages = widget.querySelector('[data-chat-tab="messages"]');
    var navHelp = widget.querySelector('[data-chat-tab="help"]');
    var navAccount = widget.querySelector('[data-chat-tab="account"]');
    var archiveView = widget.querySelector("#sssb-chat-archive");
    var archiveTitle = widget.querySelector("#sssb-archive-title");
    var archiveStatus = widget.querySelector(".chat-archive-status");
    var archiveListView = widget.querySelector(".chat-archive-list-view");
    var archiveList = widget.querySelector(".chat-archive-list");
    var archiveEmpty = widget.querySelector(".chat-archive-empty");
    var archiveEmptyDetail = widget.querySelector(".chat-archive-empty-detail");
    var archiveTranscript = widget.querySelector(".chat-archive-transcript");
    var archiveBack = widget.querySelector(".chat-archive-back");
    var archiveClose = widget.querySelector(".chat-archive-close");
    var archiveMeta = widget.querySelector(".chat-archive-meta");
    var archiveMessages = widget.querySelector(".chat-archive-messages");
    var archiveExpired = widget.querySelector(".chat-archive-expired");
    var archiveAsk = widget.querySelector(".chat-archive-ask");
    var accountForm = widget.querySelector(".chat-account-form");
    var accountHeading = widget.querySelector(".chat-account-heading");
    var accountDescription = widget.querySelector(".chat-account-description");
    var accountName = widget.querySelector("#sssb-account-name");
    var accountPhone = widget.querySelector("#sssb-account-phone");
    var accountCompany = widget.querySelector("#sssb-account-company");
    var accountProfileLabels = widget.querySelectorAll(".chat-account-profile-label");
    var accountEmailInput = widget.querySelector("#sssb-account-email");
    var accountPassword = widget.querySelector("#sssb-account-password");
    var accountConfirm = widget.querySelector("#sssb-account-confirm");
    var accountConfirmLabel = widget.querySelector(".chat-account-confirm-label");
    var accountHelp = widget.querySelector(".chat-account-help");
    var accountSubmit = widget.querySelector(".chat-account-submit");
    var accountSwitch = widget.querySelector(".chat-account-switch");
    var accountCancel = widget.querySelector(".chat-account-cancel");
    var profileForm = widget.querySelector(".chat-profile-form");
    var profileName = widget.querySelector("#sssb-profile-name");
    var profilePhone = widget.querySelector("#sssb-profile-phone");
    var profileCompany = widget.querySelector("#sssb-profile-company");
    var profileHelp = widget.querySelector(".chat-profile-help");
    var profileCancel = widget.querySelector(".chat-profile-cancel");
    var conversation = widget.querySelector(".chat-conversation");
    var history = widget.querySelector(".chat-history");
    var messages = widget.querySelector(".chat-messages");
    var empty = widget.querySelector(".chat-empty");
    var messageForm = widget.querySelector(".chat-message-form");
    var messageInput = widget.querySelector("#sssb-chat-message");
    var sendButton = messageForm.querySelector('button[type="submit"]');
    var conversationBack = widget.querySelector(".chat-conversation-back");
    var quotationButton = widget.querySelector(".chat-quotation-open");
    var quotationStartHint = widget.querySelector(".chat-quotation-start-hint");
    var quotationView = widget.querySelector(".chat-quotation");
    var quotationForm = widget.querySelector(".chat-quotation-form");
    var quotationTitle = widget.querySelector("#sssb-quotation-title");
    var quotationProduct = widget.querySelector("#sssb-quotation-product");
    var quotationCatalogueStatus = widget.querySelector(".chat-quotation-catalogue-status");
    var quotationCatalogueRetry = widget.querySelector(".chat-quotation-catalogue-retry");
    var quotationSubmit = quotationForm.querySelector('button[type="submit"]');
    var quotationOther = widget.querySelector("#sssb-quotation-other");
    var quotationEnquiryType = widget.querySelector("#sssb-quotation-enquiry-type");
    var quotationMessage = widget.querySelector("#sssb-quotation-message");
    var quotationCountry = widget.querySelector("#sssb-quotation-country");
    var quotationStatus = widget.querySelector(".chat-quotation-form > .chat-quotation-status");
    var quotationBack = widget.querySelector(".chat-quotation-actions .chat-quotation-back");
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
    var draftChat = false;
    var welcomeText = "Hello! I’m Haji, your Semenanjung Selatan assistant. I can help with questions about our company, products and services. You can also select Request a quotation in this chat to send a request to our team. What would you like to know?";
    var customer = null;
    var guestConversation = null;
    var profileMode = false;
    var accountMode = null;
    var accountOpen = false;
    var startRequested = false;
    var currentMessages = [];
    var activeMessages = [];
    var conversationId = null;
    var draftPreviousConversationId = null;
    var draftMessageValue = "";
    var activeMessageValue = "";
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
    var seenAssistantIds = Object.create(null);
    var animateIncoming = false;
    var activeReveal = null;
    var quotationOpen = false;
    var historyOpen = false;
    var helpOpen = false;
    var historySequence = 0;
    var returnToQuotation = false;
    var quotationRequestId = null;
    var quotationPayloadSignature = "";
    var quotationCatalogue = {};
    var quotationCatalogueLoading = false;
    var quotationCatalogueSequence = 0;

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

    document.addEventListener("sssb:catalogue", function (event) {
      var detail = event.detail;
      if (!detail || !Array.isArray(detail.companies)) return;
      var published = {};
      detail.companies.forEach(function (company) {
        if (!company || typeof company.key !== "string") return;
        published[company.key] = company.name + " products";
        (company.products || []).forEach(function (product) {
          if (product && typeof product.key === "string") {
            published[company.key + "/" + product.key] = company.name + " " + product.name;
          }
        });
      });
      catalogue = published;
      if (contextApplied && document.body.dataset.page === "contact" && messageInput && !messageInput.value) {
        var enquiry = catalogueEnquiry();
        if (enquiry) messageInput.value = enquiry;
      }
    });

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

    function setQuotationStatus(text, isError) {
      quotationStatus.textContent = text || "";
      quotationStatus.hidden = !text;
      quotationStatus.classList.toggle("is-error", !!isError);
    }

    function setQuotationCatalogueStatus(text, isError) {
      quotationCatalogueStatus.textContent = text || "";
      quotationCatalogueStatus.hidden = !text;
      quotationCatalogueStatus.classList.toggle("is-error", !!isError);
      quotationCatalogueRetry.hidden = !isError;
    }

    function refreshQuotationOptions() {
      var previous = quotationProduct.value;
      quotationProduct.replaceChildren(new Option("Select a product or manufacturer", ""));
      Object.keys(quotationCatalogue).filter(function (key) { return key.indexOf("/") === -1; }).forEach(function (company) {
        var group = document.createElement("optgroup");
        group.label = quotationCatalogue[company].replace(/ products$/, "");
        group.appendChild(new Option("General enquiry", company));
        Object.keys(quotationCatalogue).filter(function (key) { return key.indexOf(company + "/") === 0; }).forEach(function (key) {
          group.appendChild(new Option(quotationCatalogue[key], key));
        });
        quotationProduct.appendChild(group);
      });
      quotationProduct.appendChild(new Option("Other / not sure", "other"));
      quotationProduct.value = previous || "";
      if (quotationProduct.selectedIndex < 0) quotationProduct.value = "";
      syncQuotationFields();
    }

    async function loadQuotationCatalogue(shouldPrefill) {
      var sequence = ++quotationCatalogueSequence;
      var previous = quotationProduct.value;
      var previousName = quotationCatalogue[previous];
      quotationCatalogueLoading = true;
      setQuotationCatalogueStatus("Loading products…", false);
      updateControls();
      try {
        var data = await requestJSON("/api/catalogue");
        if (!data || !Array.isArray(data.companies)) throw new Error("Unexpected catalogue response");
        var published = Object.create(null);
        var productCount = 0;
        data.companies.forEach(function (company) {
          if (!company || typeof company.key !== "string" || typeof company.name !== "string" || !Array.isArray(company.products)) {
            throw new Error("Unexpected catalogue company");
          }
          published[company.key] = company.name + " products";
          company.products.forEach(function (product) {
            if (!product || typeof product.key !== "string" || typeof product.name !== "string") throw new Error("Unexpected catalogue product");
            published[company.key + "/" + product.key] = company.name + " " + product.name;
            productCount += 1;
          });
        });
        if (sequence !== quotationCatalogueSequence) return;
        quotationCatalogue = published;
        refreshQuotationOptions();
        if (previous && previous !== "other" && !quotationProduct.value) {
          setQuotationCatalogueStatus("Your previous selection is no longer available. Choose another product or Other / not sure.", false);
        } else if (previousName && previousName !== quotationCatalogue[previous]) {
          setQuotationCatalogueStatus("Your selected product has changed. Please review it before sending your request.", false);
        } else if (!productCount) {
          setQuotationCatalogueStatus("No products are currently published. Choose a manufacturer for a general enquiry or select Other / not sure.", false);
        } else {
          setQuotationCatalogueStatus("", false);
        }
        if (!previous && shouldPrefill) prefillQuotationProduct();
      } catch (error) {
        if (sequence !== quotationCatalogueSequence) return;
        quotationCatalogue = {};
        refreshQuotationOptions();
        setQuotationCatalogueStatus("The product list could not be loaded. Retry or choose Other / not sure.", true);
      } finally {
        if (sequence === quotationCatalogueSequence) {
          quotationCatalogueLoading = false;
          updateControls();
          if (quotationOpen && isOpen && document.activeElement === quotationTitle && !quotationProduct.disabled) quotationProduct.focus();
        }
      }
    }

    function quotationCompany() {
      return quotationProduct.value && quotationProduct.value !== "other" ? quotationProduct.value.split("/")[0] : "";
    }

    function syncQuotationFields() {
      var company = quotationCompany();
      var unavailable = busy || loading || stale || hasPendingMessage();
      quotationProduct.disabled = unavailable || quotationCatalogueLoading;
      quotationSubmit.disabled = unavailable || quotationCatalogueLoading;
      quotationCatalogueRetry.disabled = unavailable || quotationCatalogueLoading;
      var isOther = quotationProduct.value === "other";
      var isJfd = company === "jfd";
      var isZodiac = company === "zodiac-nautic";
      var needsCountry = isZodiac || company === "safe-at-sea";
      var needsMessage = isJfd || company === "fxc" || company === "safe-at-sea";
      widget.querySelector(".chat-quotation-other").hidden = !isOther;
      quotationOther.required = isOther;
      quotationOther.disabled = unavailable || !isOther;
      widget.querySelector(".chat-quotation-jfd").hidden = !isJfd;
      quotationEnquiryType.required = isJfd;
      quotationEnquiryType.disabled = unavailable || !isJfd;
      quotationMessage.required = needsMessage;
      widget.querySelector(".chat-quotation-message-required").textContent = needsMessage ? "(required)" : "(optional)";
      widget.querySelector(".chat-quotation-country").hidden = !needsCountry;
      quotationCountry.required = needsCountry;
      quotationCountry.disabled = unavailable || !needsCountry;
      var zodiacFields = widget.querySelector(".chat-quotation-zodiac");
      zodiacFields.hidden = !isZodiac;
      zodiacFields.querySelectorAll("input").forEach(function (input) {
        input.disabled = unavailable || !isZodiac;
        input.required = isZodiac && input.name !== "region";
      });
    }

    function fillQuotationContact() {
      ["name", "email", "phone", "company"].forEach(function (field) {
        widget.querySelector(".chat-quotation-" + field).textContent = customer && customer[field] || "Not provided";
      });
    }

    function prefillQuotationProduct() {
      if (quotationProduct.value) return;
      if (document.body.dataset.page === "contact") {
        var params = new URLSearchParams(window.location.search);
        var company = params.get("company") || "";
        var product = params.get("product") || "";
        var key = company + (product ? "/" + product : "");
        if (Object.prototype.hasOwnProperty.call(quotationCatalogue, key)) quotationProduct.value = key;
      }
      if (!quotationProduct.value) {
        for (var index = currentMessages.length - 1; index >= 0 && !quotationProduct.value; index -= 1) {
          var references = currentMessages[index].products;
          if (!Array.isArray(references)) continue;
          references.some(function (reference) {
            var match = Object.keys(quotationCatalogue).find(function (key) {
              return key.indexOf("/") !== -1 && reference && quotationCatalogue[key] === reference.name;
            });
            if (match) quotationProduct.value = match;
            return !!match;
          });
        }
      }
      syncQuotationFields();
    }

    function resetQuotation() {
      quotationOpen = false;
      returnToQuotation = false;
      quotationForm.reset();
      quotationRequestId = null;
      quotationPayloadSignature = "";
      quotationCatalogueSequence += 1;
      quotationCatalogueLoading = false;
      quotationCatalogue = {};
      setQuotationStatus("", false);
      setQuotationCatalogueStatus("", false);
      refreshQuotationOptions();
    }

    function setArchiveStatus(text, isError) {
      archiveStatus.textContent = text || "";
      archiveStatus.hidden = !text;
      archiveStatus.classList.toggle("is-error", !!isError);
    }

    function formatChatDate(value) {
      var date = new Date(value);
      if (!value || isNaN(date.getTime())) return "Date unavailable";
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
        ", " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    function relativeChatTime(value) {
      var date = new Date(value);
      if (!value || isNaN(date.getTime())) return "";
      var minutes = Math.floor(Math.max(0, Date.now() - date.getTime()) / 60000);
      if (minutes < 1) return "Just now";
      if (minutes < 60) return minutes + "m";
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h";
      var days = Math.floor(hours / 24);
      if (days < 7) return days + "d";
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    }

    function previewText(value) {
      return (typeof value === "string" ? value : "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<[^>]*>/g, " ")
        .replace(/[*_`#>]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function archiveSnippet(item) {
      if (item.messagesExpired) return "Messages are no longer available.";
      var text = previewText(item.lastMessage);
      if (!text) return "No messages yet.";
      if (item.lastRole === "user") text = "You: " + text;
      if (text.length > 96) text = text.slice(0, 95).replace(/\s+\S*$/, "").replace(/\s+$/, "") + "…";
      return text;
    }

    function showArchiveList() {
      archiveListView.hidden = false;
      archiveTranscript.hidden = true;
      archiveMessages.replaceChildren();
      archiveExpired.hidden = true;
      archiveMeta.textContent = "";
      setArchiveStatus("", false);
    }

    function renderArchiveList(conversations) {
      archiveList.replaceChildren();
      archiveList.hidden = conversations.length === 0;
      archiveEmpty.hidden = conversations.length > 0;
      archiveEmptyDetail.textContent = customer ? "Your conversations will appear here." : "Sign in to see your conversations.";
      var fragment = document.createDocumentFragment();
      conversations.forEach(function (item) {
        var row = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "chat-archive-item";
        var avatar = document.createElement("img");
        avatar.className = "chat-archive-avatar";
        avatar.src = "/assets/img/haji-avatar2.png";
        avatar.alt = "";
        avatar.setAttribute("aria-hidden", "true");
        avatar.width = 38;
        avatar.height = 38;
        avatar.loading = "lazy";
        var copy = document.createElement("span");
        copy.className = "chat-archive-copy";
        var top = document.createElement("span");
        top.className = "chat-archive-top";
        var name = document.createElement("strong");
        name.textContent = "Haji";
        var time = document.createElement("time");
        var date = new Date(item.createdAt);
        if (!isNaN(date.getTime())) time.setAttribute("datetime", date.toISOString());
        time.textContent = relativeChatTime(item.createdAt);
        var snippet = document.createElement("span");
        snippet.className = "chat-archive-snippet";
        snippet.textContent = archiveSnippet(item);
        top.appendChild(name);
        top.appendChild(time);
        copy.appendChild(top);
        copy.appendChild(snippet);
        button.appendChild(avatar);
        button.appendChild(copy);
        if (item.active) {
          var dot = document.createElement("span");
          dot.className = "chat-archive-dot";
          dot.setAttribute("aria-hidden", "true");
          button.appendChild(dot);
        }
        button.addEventListener("click", function () {
          if (item.active && active === true && String(item.id) === conversationId) showSavedConversation();
          else openArchivedChat(item.id);
        });
        row.appendChild(button);
        fragment.appendChild(row);
      });
      archiveList.appendChild(fragment);
    }

    async function loadHistory() {
      var sequence = ++historySequence;
      archiveList.replaceChildren();
      archiveList.hidden = false;
      archiveEmpty.hidden = true;
      setArchiveStatus("Loading your messages…", false);
      try {
        var data = await requestJSON("/api/customer/conversations");
        if (sequence !== historySequence || !historyOpen) return;
        if (!data || !Array.isArray(data.conversations)) throw new Error("Unexpected chats response");
        renderArchiveList(data.conversations);
        setArchiveStatus("", false);
      } catch (error) {
        if (sequence !== historySequence || !historyOpen) return;
        setArchiveStatus("We could not load your messages. Please try again.", true);
      }
    }

    function renderArchivedMessages(list) {
      var fragment = document.createDocumentFragment();
      list.filter(function (message) {
        return message && (message.role === "user" || message.role === "assistant");
      }).forEach(function (message) {
        var item = document.createElement("li");
        item.className = "chat-message chat-message--" + message.role;
        var label = document.createElement("strong");
        label.textContent = message.role === "user" ? "You" : "Haji";
        var body = document.createElement("div");
        body.className = "chat-message-body";
        item.appendChild(label);
        item.appendChild(body);
        if (rendererReady) window.SSSBChatContent.render(body, message, window.location.href);
        else {
          var paragraph = document.createElement("p");
          paragraph.textContent = typeof message.content === "string" ? message.content : "";
          body.appendChild(paragraph);
        }
        fragment.appendChild(item);
      });
      archiveMessages.replaceChildren(fragment);
    }

    async function openArchivedChat(id) {
      var sequence = ++historySequence;
      archiveListView.hidden = true;
      archiveTranscript.hidden = false;
      archiveMessages.replaceChildren();
      archiveExpired.hidden = true;
      archiveMeta.textContent = "";
      setArchiveStatus("Loading chat…", false);
      try {
        var data = await requestJSON("/api/customer/conversations/" + encodeURIComponent(id));
        if (sequence !== historySequence || !historyOpen) return;
        if (!data || !Array.isArray(data.messages)) throw new Error("Unexpected chat response");
        archiveMeta.textContent = formatChatDate(data.createdAt) +
          (data.active ? " · Current chat" : data.endedAt ? " · Ended" : "");
        renderArchivedMessages(data.messages);
        archiveExpired.hidden = !data.messagesExpired;
        setArchiveStatus("", false);
        archiveBack.focus();
      } catch (error) {
        if (sequence !== historySequence || !historyOpen) return;
        setArchiveStatus(error.status === 404 ? "This chat is no longer available." : "We could not load this chat. Please try again.", true);
      }
    }

    function openHistory() {
      if (busy || loading || hasPendingMessage()) return;
      historyOpen = true;
      helpOpen = false;
      accountOpen = false;
      accountMode = null;
      profileMode = false;
      startRequested = false;
      quotationOpen = false;
      returnToQuotation = false;
      historySequence += 1;
      accountForm.reset();
      showArchiveList();
      setStatus(stale ? "We could not load your conversation. Reload it or contact our team in Help." : "", stale);
      updateControls();
      archiveTitle.focus();
      if (customer && !stale) loadHistory();
      else renderArchiveList([]);
    }

    function openHelp() {
      if (busy || loading || hasPendingMessage()) return;
      historyOpen = false;
      helpOpen = true;
      accountOpen = false;
      accountMode = null;
      profileMode = false;
      startRequested = false;
      quotationOpen = false;
      returnToQuotation = false;
      historySequence += 1;
      accountForm.reset();
      setStatus("", false);
      updateControls();
      helpTitle.focus();
    }

    function openAccount() {
      if (busy || loading || hasPendingMessage()) return;
      historyOpen = false;
      helpOpen = false;
      accountOpen = true;
      accountMode = null;
      profileMode = false;
      startRequested = false;
      quotationOpen = false;
      returnToQuotation = false;
      historySequence += 1;
      accountForm.reset();
      setStatus("", false);
      updateControls();
      if (isOpen) (customer ? accountProfile : accountLogin).focus();
    }

    function showDraftWelcome() {
      currentMessages = [{ id: "draft-welcome", role: "assistant", content: welcomeText, status: "answered" }];
      messageSignature = "";
      renderMessages();
    }

    function showConversation() {
      historyOpen = false;
      helpOpen = false;
      accountOpen = false;
      accountMode = null;
      profileMode = false;
      startRequested = false;
      historySequence += 1;
      setStatus("", false);
      updateControls();
      if (isOpen && !messageInput.disabled) messageInput.focus();
    }

    function showSavedConversation() {
      if (draftChat) {
        draftMessageValue = messageInput.value;
        messageInput.value = activeMessageValue;
        draftChat = false;
        currentMessages = activeMessages;
        messageSignature = "";
        renderMessages();
      }
      showConversation();
    }

    function continueRequestedChat() {
      if (!startRequested || !isOpen || busy || loading || stale || hasPendingMessage()) return;
      if (!customer) {
        historyOpen = false;
        helpOpen = false;
        accountOpen = true;
        accountMode = null;
        updateControls();
        setStatus("Sign in or create an account to send your message.", false);
        accountLogin.focus();
      } else if (!hasSavedDetails() && (draftChat || active !== true)) {
        historyOpen = false;
        helpOpen = false;
        accountOpen = true;
        profileMode = true;
        fillProfileForm();
        updateControls();
        setStatus("Complete your account details to send your message.", false);
        profileName.focus();
      } else {
        showConversation();
        if (typeof messageForm.requestSubmit === "function") messageForm.requestSubmit();
        else messageForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }

    function askFromHistory() {
      if (busy || loading || stale || hasPendingMessage()) return;
      if (!draftChat) {
        activeMessageValue = active === true ? messageInput.value : "";
        messageInput.value = draftMessageValue;
      }
      draftPreviousConversationId = active === true ? conversationId : null;
      draftChat = true;
      showDraftWelcome();
      applyCatalogueContext();
      showConversation();
    }

    function openQuotation() {
      if (busy || loading || stale || hasPendingMessage() || !customer || active !== true || draftChat) return;
      fillQuotationContact();
      quotationOpen = true;
      setStatus("", false);
      updateControls();
      quotationTitle.focus();
      loadQuotationCatalogue(!quotationProduct.value);
    }

    function closeQuotation(restoreFocus) {
      if (busy || loading) return;
      quotationOpen = false;
      updateControls();
      if (restoreFocus && isOpen) quotationButton.focus();
    }

    function setStatus(text, isError, visuallyQuiet) {
      var nextText = text || "";
      if (status.textContent !== nextText) status.textContent = nextText;
      status.hidden = !text;
      status.classList.toggle("is-error", !!isError);
      status.classList.toggle("is-quiet", !!visuallyQuiet);
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

    function hasSavedDetails(account) {
      account = account || customer;
      return !!account && ["name", "email", "phone", "company"].every(function (field) {
        return typeof account[field] === "string" && account[field].trim();
      });
    }

    function fillProfileForm() {
      profileName.value = customer && customer.name || "";
      profilePhone.value = customer && customer.phone || "";
      profileCompany.value = customer && customer.company || "";
    }

    function updateControls() {
      var accountBusy = busy || loading || stale || hasPendingMessage();
      var completeProfile = hasSavedDetails();
      var showHistory = historyOpen;
      var showHelp = helpOpen;
      var showAccount = accountOpen;
      var showChat = !showHistory && !showHelp && !showAccount;
      var hasConversation = active === true || draftChat;
      var showProfile = !!customer && showAccount && profileMode;
      if (!customer || active !== true || draftChat || accountMode || showProfile || !showChat) quotationOpen = false;
      panel.classList.toggle("has-conversation", hasConversation && !quotationOpen && showChat);
      panel.classList.toggle("has-account-view", showAccount);
      panel.classList.toggle("has-quotation-view", quotationOpen);
      panel.classList.toggle("has-history-view", showHistory);
      panel.classList.toggle("has-help-view", showHelp);
      panel.classList.toggle("has-view", showHistory || showHelp);
      panel.setAttribute("aria-labelledby", showHistory ? "sssb-archive-title" : showHelp ? "sssb-help-title" : "sssb-chat-title");
      accountArea.hidden = !showAccount;
      accountGuest.hidden = !showAccount || !!customer || !!accountMode;
      guestExisting.hidden = !guestConversation || !!customer;
      guestEnd.disabled = accountBusy;
      accountLogin.hidden = !!customer || !!accountMode;
      accountSignedIn.hidden = !showAccount || !customer || showProfile;
      accountForm.hidden = !showAccount || !!customer || !accountMode;
      accountEmail.textContent = customer ? customer.email : "";
      accountLogin.disabled = accountBusy;
      accountRegister.disabled = accountBusy;
      accountProfile.disabled = accountBusy;
      accountRefresh.hidden = active !== true;
      accountRefresh.disabled = accountBusy;
      accountLogout.disabled = accountBusy;
      accountForm.querySelectorAll("input,button").forEach(function (control) {
        control.disabled = accountBusy || (control.hasAttribute("data-account-profile") && accountMode !== "register");
      });
      profileForm.hidden = !showProfile;
      profileHelp.hidden = completeProfile || (active === true && !draftChat);
      profileForm.querySelectorAll("input,button").forEach(function (control) { control.disabled = accountBusy; });
      conversation.hidden = !hasConversation || quotationOpen || !showChat;
      conversationBack.hidden = conversation.hidden;
      conversationBack.disabled = busy || loading || hasPendingMessage();
      quotationView.hidden = !quotationOpen;
      archiveView.hidden = !showHistory;
      helpView.hidden = !showHelp;
      archiveAsk.disabled = accountBusy;
      navMessages.disabled = busy || loading || hasPendingMessage();
      navHelp.disabled = busy || loading || hasPendingMessage();
      navAccount.disabled = busy || loading || hasPendingMessage();
      if (showHistory || showChat) navMessages.setAttribute("aria-current", "page");
      else navMessages.removeAttribute("aria-current");
      if (showHelp) navHelp.setAttribute("aria-current", "page");
      else navHelp.removeAttribute("aria-current");
      if (showAccount) navAccount.setAttribute("aria-current", "page");
      else navAccount.removeAttribute("aria-current");
      quotationButton.disabled = accountBusy || active !== true || draftChat;
      quotationStartHint.hidden = active === true && !draftChat;
      quotationButton.setAttribute("aria-expanded", String(quotationOpen));
      widget.querySelector(".chat-quotation-edit").disabled = accountBusy;
      quotationForm.querySelectorAll("input,select,textarea,button").forEach(function (control) { control.disabled = accountBusy; });
      syncQuotationFields();
      sendButton.disabled = busy || loading || stale || hasPendingMessage();
      messageInput.disabled = busy || loading || stale || hasPendingMessage();
      refresh.hidden = !stale && !(active === true && hasPendingMessage());
      refresh.disabled = busy || loading;
    }

    function applyCatalogueContext() {
      if (contextApplied) return;
      contextApplied = true;
      var enquiry = catalogueEnquiry();
      if (enquiry && !messageInput.value) messageInput.value = enquiry;
    }

    function prefersReducedMotion() {
      return typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function scrollMessageHistory() {
      if (isOpen) history.scrollTop = history.scrollHeight;
    }

    function finishReveal(reveal) {
      if (!reveal || activeReveal !== reveal) return;
      if (reveal.handle !== null) window.cancelAnimationFrame(reveal.handle);
      activeReveal = null;
      reveal.item.classList.remove("is-revealing");
      reveal.item.removeAttribute("aria-busy");
      if (rendererReady) window.SSSBChatContent.render(reveal.content, reveal.message, window.location.href);
      else reveal.paragraph.textContent = reveal.text;
      scrollMessageHistory();
    }

    function cancelReveal() {
      if (!activeReveal) return;
      var reveal = activeReveal;
      if (reveal.handle !== null) window.cancelAnimationFrame(reveal.handle);
      activeReveal = null;
      reveal.item.classList.remove("is-revealing");
      reveal.item.removeAttribute("aria-busy");
    }

    function revealMessage(item, content, message) {
      var text = typeof message.content === "string" ? message.content : "";
      if (!text || prefersReducedMotion()) return;
      if (activeReveal) finishReveal(activeReveal);
      var characters = Array.from(text);
      var paragraph = document.createElement("p");
      paragraph.className = "chat-message-reveal";
      content.replaceChildren(paragraph);
      item.classList.add("is-revealing");
      item.setAttribute("aria-busy", "true");
      var reveal = {
        item: item,
        content: content,
        message: message,
        text: text,
        paragraph: paragraph,
        handle: null
      };
      activeReveal = reveal;
      var started = 0;
      var duration = Math.min(1600, Math.max(320, characters.length * 7));
      function frame(now) {
        if (activeReveal !== reveal) return;
        if (!started) started = now;
        var progress = Math.min(1, (now - started) / duration);
        var count = Math.max(1, Math.round(progress * characters.length));
        paragraph.textContent = characters.slice(0, count).join("");
        scrollMessageHistory();
        if (progress < 1) reveal.handle = window.requestAnimationFrame(frame);
        else finishReveal(reveal);
      }
      reveal.handle = window.requestAnimationFrame(frame);
    }

    function appendOutgoingMessage(text) {
      var item = document.createElement("li");
      item.className = "chat-message chat-message--user chat-message--outgoing";
      var label = document.createElement("strong");
      label.textContent = "You";
      var body = document.createElement("div");
      body.className = "chat-message-body";
      var paragraph = document.createElement("p");
      paragraph.textContent = text;
      body.appendChild(paragraph);
      item.appendChild(label);
      item.appendChild(body);
      messages.appendChild(item);
      empty.hidden = true;
      scrollMessageHistory();
    }

    function removeThinking() {
      var item = messages.querySelector(".chat-message--thinking");
      if (item) item.remove();
    }

    function showThinking() {
      removeThinking();
      var item = document.createElement("li");
      item.className = "chat-message chat-message--assistant chat-message--thinking chat-message--outgoing";
      item.setAttribute("aria-label", "Haji is typing");
      var label = document.createElement("strong");
      label.textContent = "Haji";
      var body = document.createElement("div");
      body.className = "chat-message-body";
      var dots = document.createElement("span");
      dots.className = "chat-typing";
      dots.setAttribute("aria-hidden", "true");
      for (var index = 0; index < 3; index += 1) dots.appendChild(document.createElement("span"));
      body.appendChild(dots);
      item.appendChild(label);
      item.appendChild(body);
      item.dataset.thinking = "true";
      messages.appendChild(item);
      empty.hidden = true;
      scrollMessageHistory();
    }

    function renderMessages() {
      var signature = JSON.stringify([rendererReady, currentMessages]);
      if (signature === messageSignature) return;
      messageSignature = signature;
      var wasNearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 100;
      var visibleMessages = currentMessages.filter(function (message) {
        return message && (message.role === "user" || message.role === "assistant");
      });
      var lastAssistantIndex = -1;
      visibleMessages.forEach(function (message, index) {
        if (message.role === "assistant") lastAssistantIndex = index;
      });
      var additions = document.createDocumentFragment();
      visibleMessages.forEach(function (message, index) {
        var messageId = String(message.id);
        var isNewAssistant = message.role === "assistant" && !seenAssistantIds[messageId];
        seenAssistantIds[messageId] = true;
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
        if (activeReveal && activeReveal.item === item) cancelReveal();
        item.dataset.signature = itemSignature;
        if (item.dataset.thinking) {
          delete item.dataset.thinking;
          item.removeAttribute("aria-label");
        }
        item.className = "chat-message chat-message--" + message.role;
        var label = item.querySelector("strong");
        var content = item.querySelector(".chat-message-body");
        var labelText = message.role === "user" ? "You" : "Haji";
        var contentText = typeof message.content === "string" ? message.content : "";
        if (label.textContent !== labelText) label.textContent = labelText;
        if (rendererReady) {
          window.SSSBChatContent.render(content, message, window.location.href);
        } else {
          var plain = document.createElement("p");
          plain.textContent = contentText;
          content.replaceChildren(plain);
        }
        if (isNewAssistant && animateIncoming && index === lastAssistantIndex && message.status !== "pending") {
          animateIncoming = false;
          revealMessage(item, content, message);
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
    rendererScript.src = "/assets/js/chat-content.js?v=20261103-chat-products";
    rendererScript.addEventListener("load", function () {
      rendererReady = !!window.SSSBChatContent && typeof window.SSSBChatContent.render === "function";
      if (rendererReady) renderMessages();
    });
    document.head.appendChild(rendererScript);

    async function requestJSON(url, options) {
      var timeout = null;
      var catalogueRequest = url === "/api/catalogue";
      var controller = url === "/api/chat/current" || catalogueRequest ? new AbortController() : null;
      if (controller) {
        timeout = window.setTimeout(function () { controller.abort(); }, catalogueRequest ? 5000 : 15000);
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
        if (config && typeof config.chatWelcome === "string" && config.chatWelcome.trim()) {
          welcomeText = config.chatWelcome;
          if (draftChat && !busy) showDraftWelcome();
        }
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
        if ((data.active && !data.customer) ||
            (data.guestConversation != null && (data.customer || data.active || typeof data.guestConversation.email !== "string"))) {
          throw new Error("Unexpected chat ownership");
        }
        var previousCustomer = customer;
        customer = data.customer || null;
        if (previousCustomer && (!customer || previousCustomer.email !== customer.email)) resetQuotation();
        guestConversation = data.guestConversation || null;
        if (customer) {
          accountMode = null;
          accountForm.reset();
          if (!previousCustomer || previousCustomer.email !== customer.email) {
            profileMode = false;
            fillProfileForm();
          } else if (!profileMode && hasSavedDetails(previousCustomer) && !hasSavedDetails()) {
            fillProfileForm();
          }
        } else if (previousCustomer) {
          profileForm.reset();
          profileMode = false;
        }
        var nextConversationId = data.active ? String(data.conversation.id) : null;
        var savedFirstMessage = !!(draftChat && pendingDraft && pendingDraft.expectedConversationId === nextConversationId &&
          data.active && data.messages.some(function (message) {
            return message.role === "user" && message.content === pendingDraft.value;
          }));
        if (nextConversationId !== conversationId) {
          resetQuotation();
          messageSignature = "";
          cancelReveal();
          seenAssistantIds = Object.create(null);
          animateIncoming = false;
          messages.textContent = "";
          empty.hidden = false;
          activeMessageValue = "";
          if (conversationId !== null && !draftChat && !pendingDraft) {
            messageInput.value = "";
            contextApplied = false;
          }
          conversationId = nextConversationId;
        }
        active = data.active;
        activeMessages = active ? data.messages : [];
        if (savedFirstMessage) draftChat = false;
        if (!draftChat) currentMessages = activeMessages;
        stale = false;
        updateControls();
        if (draftChat) {
          showDraftWelcome();
        } else if (active) {
          applyCatalogueContext();
          renderMessages();
        } else {
          messageSignature = "";
        }
        if (pendingDraft) {
          var draft = pendingDraft;
          var saved = active && (!draft.expectedConversationId || draft.expectedConversationId === conversationId) && activeMessages.some(function (message) {
            return message.role === "user" && message.content === draft.value &&
              draft.ids.indexOf(String(message.id)) === -1;
          });
          if (saved && messageInput.value === draft.value) {
            messageInput.value = "";
            if (draft.newChat) {
              draftMessageValue = "";
              activeMessageValue = "";
            }
          }
          pendingDraft = null;
        }
        return true;
      } catch (error) {
        if (sequence !== loadSequence) return false;
        stale = true;
        setStatus(hasPendingMessage()
          ? "We could not load your conversation. We'll keep checking; you can also contact our team in the Help tab."
          : "We could not load your conversation. Reload it or contact our team in the Help tab.", true);
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
        if (!loaded) {
          if (historyOpen) setArchiveStatus("", false);
          return;
        }
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
        if (isOpen && historyOpen && !busy && !archiveListView.hidden) {
          if (customer) loadHistory();
          else {
            renderArchiveList([]);
            setArchiveStatus("", false);
          }
        }
        if (startRequested && previousPending.length && isOpen && !busy && !loading && !hasPendingMessage()) continueRequestedChat();
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

    function focusFullscreenButton() {
      var visible = Array.prototype.find.call(fullscreenButtons, function (button) {
        return button.offsetParent !== null;
      });
      if (visible) visible.focus();
    }

    function setFullscreen(enabled) {
      if (enabled === isFullscreen) return;
      stopResize();
      isFullscreen = enabled;
      panel.classList.toggle("is-fullscreen", enabled);
      panel.setAttribute("role", enabled ? "dialog" : "region");
      if (enabled) panel.setAttribute("aria-modal", "true");
      else panel.removeAttribute("aria-modal");
      fullscreenButtons.forEach(function (button) {
        button.setAttribute("aria-pressed", String(enabled));
        button.title = enabled ? "Restore chat size" : "Expand chat to fullscreen";
      });
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
      if (enabled && !panel.contains(document.activeElement)) focusFullscreenButton();
    }

    function openPanel(trigger) {
      if (isOpen) return;
      var mobilePanel = document.querySelector("[data-mobile-menu]");
      if (mobilePanel && mobilePanel.dataset.open === "true") return;
      isOpen = true;
      historyOpen = true;
      helpOpen = false;
      accountOpen = false;
      startRequested = false;
      showArchiveList();
      archiveEmpty.hidden = true;
      archiveList.hidden = false;
      setArchiveStatus("Loading your messages…", false);
      stopPolling();
      lastFocused = trigger || document.activeElement;
      panel.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      updateControls();
      layoutPanel();
      archiveTitle.focus();
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
      historyOpen = false;
      helpOpen = false;
      accountOpen = false;
      accountMode = null;
      profileMode = false;
      startRequested = false;
      quotationOpen = false;
      returnToQuotation = false;
      accountForm.reset();
      historySequence += 1;
      restoreAfterPendingLoad = false;
      stopPolling();
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      updateControls();
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
    fullscreenButtons.forEach(function (button) {
      button.addEventListener("click", function () { setFullscreen(!isFullscreen); });
    });
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
        if (quotationOpen) closeQuotation(true);
        else if (accountMode) {
          var returnToDraft = startRequested && draftChat;
          startRequested = false;
          if (returnToDraft) {
            accountMode = null;
            showConversation();
          } else setAccountMode(null);
        } else if (profileMode) {
          var returnToProfileDraft = startRequested && draftChat;
          startRequested = false;
          if (returnToProfileDraft) {
            profileMode = false;
            showConversation();
          } else leaveProfile();
        } else if (isFullscreen) setFullscreen(false);
        else closePanel();
        return;
      }
      if (!isFullscreen || event.key !== "Tab") return;
      var focusable = Array.prototype.slice.call(panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (element) { return element.offsetParent !== null; });
      if (!focusable.length) {
        event.preventDefault();
        focusFullscreenButton();
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
    accountRefresh.addEventListener("click", function () { refreshCurrent(false); });
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
      resetQuotation();
      active = null;
      draftChat = false;
      conversationId = null;
      draftPreviousConversationId = null;
      draftMessageValue = "";
      activeMessageValue = "";
      currentMessages = [];
      activeMessages = [];
      messages.textContent = "";
      empty.hidden = false;
      messageSignature = "";
      messageInput.value = "";
      pendingDraft = null;
      contextApplied = false;
    }

    function setAccountMode(mode) {
      if (busy || loading || stale || hasPendingMessage()) return;
      var previousEmail = accountMode ? accountEmailInput.value : "";
      accountMode = mode;
      accountForm.reset();
      var saved = guestConversation || {};
      accountEmailInput.value = previousEmail || saved.email || "";
      var registering = mode === "register";
      accountProfileLabels.forEach(function (label) { label.hidden = !registering; });
      accountName.required = registering;
      accountPhone.required = registering;
      accountCompany.required = registering;
      if (registering) {
        accountName.value = saved.name || "";
        accountPhone.value = saved.phone || "";
        accountCompany.value = saved.company || "";
      }
      accountHeading.textContent = registering ? "Create account" : "Sign in";
      accountDescription.textContent = registering
        ? "Create an account to start and return to your conversations."
        : "Continue your conversation with our assistant.";
      accountSubmit.textContent = registering ? "Create account" : "Sign in";
      accountSwitch.textContent = registering ? "Already have an account? Sign in" : "New here? Create an account";
      accountPassword.autocomplete = registering ? "new-password" : "current-password";
      accountPassword.minLength = mode === "register" ? 8 : 1;
      accountConfirmLabel.hidden = mode !== "register";
      accountConfirm.required = mode === "register";
      accountHelp.hidden = mode !== "register";
      setStatus("", false);
      updateControls();
      if (mode) (registering ? accountName : accountEmailInput).focus();
      else accountLogin.focus();
    }

    guestEnd.addEventListener("click", async function () {
      if (busy || loading || stale || customer || !guestConversation) return;
      busy = true;
      updateControls();
      setStatus("Ending your previous guest chat…", false);
      try { await postJSON("/api/chat/close", {}); } catch (error) { /* Refresh to confirm the chat state. */ }
      var loaded = await loadCurrent();
      finishOperation();
      if (loaded) setStatus(guestConversation ? "We could not end the previous chat. Please try again." : "Previous guest chat ended. Sign in or create an account to start a chat.", !!guestConversation);
    });

    accountLogin.addEventListener("click", function () { setAccountMode("login"); });
    accountRegister.addEventListener("click", function () { setAccountMode("register"); });
    accountSwitch.addEventListener("click", function () { setAccountMode(accountMode === "register" ? "login" : "register"); });
    accountCancel.addEventListener("click", function () {
      var returnToDraft = startRequested && draftChat;
      startRequested = false;
      if (returnToDraft) {
        accountMode = null;
        showConversation();
      } else {
        setAccountMode(null);
      }
    });
    navMessages.addEventListener("click", openHistory);
    conversationBack.addEventListener("click", openHistory);
    navHelp.addEventListener("click", openHelp);
    navAccount.addEventListener("click", openAccount);
    archiveBack.addEventListener("click", function () {
      historySequence += 1;
      showArchiveList();
      updateControls();
      archiveTitle.focus();
    });
    archiveClose.addEventListener("click", closePanel);
    helpClose.addEventListener("click", closePanel);
    archiveAsk.addEventListener("click", askFromHistory);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && isOpen && !busy && !loading && !historyOpen && !helpOpen && !quotationOpen && !accountMode) {
        refreshCurrent(true);
      }
    });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted && isOpen && !busy && !loading) refreshCurrent(true);
    });
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
      var profile = null;
      if (mode === "register") {
        profile = {
          name: accountName.value.trim(),
          phone: accountPhone.value.trim(),
          company: accountCompany.value.trim()
        };
        if (!profile.name || !profile.phone || !profile.company) {
          setStatus("Enter your name, phone number and company.", true);
          (!profile.name ? accountName : !profile.phone ? accountPhone : accountCompany).focus();
          return;
        }
      }
      busy = true;
      stopPolling();
      updateControls();
      setStatus(mode === "register" ? "Creating account…" : "Signing in…", false);
      try {
        var payload = { email: accountEmailInput.value.trim(), password: accountPassword.value };
        if (profile) {
          payload.name = profile.name;
          payload.phone = profile.phone;
          payload.company = profile.company;
        }
        await postJSON(mode === "register" ? "/api/customer/register" : "/api/customer/login", payload);
      } catch (error) {
        failure = error.data && typeof error.data.error === "string" ? error.data.error : "We could not sign you in. Please try again.";
      }
      accountPassword.value = "";
      accountConfirm.value = "";
      var unsentDraft = draftChat ? messageInput.value : null;
      clearChatView();
      if (unsentDraft !== null) {
        draftChat = true;
        messageInput.value = unsentDraft;
      }
      var loaded = await loadCurrent();
      if (loaded && customer) {
        accountMode = null;
        accountForm.reset();
        setStatus(active ? "Signed in. Your chat is ready." : hasSavedDetails()
          ? "Signed in. You can start a chat."
          : "Signed in. Complete your account details to start a chat.", false, active);
      } else if (loaded) {
        accountPassword.value = "";
        accountConfirm.value = "";
        setStatus(failure || "We could not sign you in. Please try again.", true);
      }
      finishOperation();
      if (loaded && customer && startRequested && isOpen) {
        if (draftChat) draftPreviousConversationId = active === true ? conversationId : null;
        continueRequestedChat();
      }
    });
    accountLogout.addEventListener("click", async function () {
      if (busy || loading || stale || hasPendingMessage()) return;
      busy = true;
      stopPolling();
      startRequested = false;
      clearChatView();
      profileMode = false;
      updateControls();
      setStatus("Signing out…", false);
      try { await postJSON("/api/customer/logout", {}); } catch (error) { /* Refresh to confirm the session state. */ }
      var loaded = await loadCurrent();
      if (loaded) setStatus(customer ? "We could not sign you out. Please try again." : "Signed out. Sign in again to continue your chat.", !!customer);
      finishOperation();
    });

    function leaveProfile() {
      profileMode = false;
      quotationOpen = returnToQuotation && !!customer && active === true;
      accountOpen = !quotationOpen;
      returnToQuotation = false;
      if (quotationOpen) fillQuotationContact();
      updateControls();
      if (isOpen) (quotationOpen ? quotationProduct : accountProfile).focus();
    }

    accountProfile.addEventListener("click", function () {
      if (busy || loading || stale || hasPendingMessage() || !customer) return;
      returnToQuotation = quotationOpen;
      quotationOpen = false;
      historyOpen = false;
      helpOpen = false;
      accountOpen = true;
      fillProfileForm();
      profileMode = true;
      setStatus("", false);
      updateControls();
      profileName.focus();
    });
    widget.querySelector(".chat-quotation-edit").addEventListener("click", function () { accountProfile.click(); });
    profileCancel.addEventListener("click", function () {
      if (busy || loading || stale) return;
      var returnToDraft = startRequested && draftChat;
      startRequested = false;
      setStatus("", false);
      if (returnToDraft) {
        profileMode = false;
        showConversation();
      } else {
        leaveProfile();
      }
    });
    profileForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || loading || stale || !customer || !profileForm.reportValidity()) return;
      var profile = { name: profileName.value.trim(), phone: profilePhone.value.trim(), company: profileCompany.value.trim() };
      if (!profile.name || !profile.phone || !profile.company) {
        setStatus("Enter your name, phone number and company.", true);
        (!profile.name ? profileName : !profile.phone ? profilePhone : profileCompany).focus();
        return;
      }
      busy = true;
      updateControls();
      setStatus("Saving account details…", false);
      var profileSaved = false;
      try {
        var result = await postJSON("/api/customer/profile", profile);
        if (!result || !result.authenticated || !result.customer || typeof result.customer.email !== "string") {
          throw new Error("Unexpected customer response");
        }
        customer = result.customer;
        profileMode = false;
        quotationOpen = returnToQuotation && active === true;
        accountOpen = !quotationOpen;
        returnToQuotation = false;
        fillProfileForm();
        if (quotationOpen) fillQuotationContact();
        profileSaved = true;
        setStatus("Account details saved.", false);
      } catch (error) {
        if (error.status === 401) await loadCurrent();
        setStatus(error.data && typeof error.data.error === "string" ? error.data.error : "We could not save your account details. Please try again.", true);
      } finally {
        finishOperation();
        if (profileSaved && startRequested && isOpen) continueRequestedChat();
        else if (profileSaved && isOpen) (quotationOpen ? quotationProduct : accountProfile).focus();
      }
    });

    quotationButton.addEventListener("click", openQuotation);
    quotationBack.addEventListener("click", function () { closeQuotation(true); });
    quotationCatalogueRetry.addEventListener("click", function () { loadQuotationCatalogue(!quotationProduct.value); });
    quotationProduct.addEventListener("change", function () {
      setQuotationStatus("", false);
      syncQuotationFields();
    });
    quotationForm.addEventListener("input", function () { setQuotationStatus("", false); });
    quotationForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || loading || stale || quotationCatalogueLoading || hasPendingMessage() || !quotationOpen || !customer || active !== true || !quotationForm.reportValidity()) return;
      var selection = quotationProduct.value;
      var company = quotationCompany();
      var fields = quotationForm.elements;
      var productName = selection === "other" ? quotationOther.value.trim() : quotationCatalogue[selection];
      var message = quotationMessage.value.trim();
      if (!productName || (quotationMessage.required && !message)) {
        setQuotationStatus(!productName ? "Enter a product or service." : "Enter the details of your request.", true);
        (!productName ? quotationOther : quotationMessage).focus();
        return;
      }
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        setQuotationStatus("Quotation requests are unavailable in this browser. Please contact our team.", true);
        return;
      }
      var payload = {
        conversationId: conversationId,
        companyId: company || null,
        productKey: selection.indexOf("/") !== -1 ? selection.split("/")[1] : null,
        productName: productName,
        quantity: fields.quantity.value ? Number(fields.quantity.value) : null,
        requiredBy: fields.requiredBy.value || null,
        deliveryLocation: fields.deliveryLocation.value.trim(),
        procurementRoute: fields.procurementRoute.value,
        message: message,
        enquiryType: company === "jfd" ? quotationEnquiryType.value : "",
        country: company === "zodiac-nautic" || company === "safe-at-sea" ? quotationCountry.value.trim() : "",
        city: company === "zodiac-nautic" ? fields.city.value.trim() : "",
        postalCode: company === "zodiac-nautic" ? fields.postalCode.value.trim() : "",
        navigationArea: company === "zodiac-nautic" ? fields.navigationArea.value.trim() : "",
        region: company === "zodiac-nautic" ? fields.region.value.trim() : ""
      };
      var signature = JSON.stringify(payload);
      if (!quotationRequestId || signature !== quotationPayloadSignature) {
        quotationRequestId = window.crypto.randomUUID();
        quotationPayloadSignature = signature;
      }
      payload.requestId = quotationRequestId;
      busy = true;
      stopPolling();
      updateControls();
      setQuotationStatus("Sending your request…", false);
      var sent = false;
      try {
        var result = await postJSON("/api/chat/quotation", payload);
        if (!result || result.ok !== true || !result.quotation) throw new Error("Unexpected quotation response");
        sent = true;
        resetQuotation();
        var loaded = await loadCurrent();
        setStatus(loaded
          ? "Quotation request sent. Our team will follow up using your account details."
          : "Your quotation request was sent, but the conversation could not be refreshed. Reload the conversation to see it.", !loaded);
      } catch (error) {
        var failure = error.data && typeof error.data.error === "string" ? error.data.error : "We could not confirm your request. Please try again or contact our team.";
        if (error.status === 401 || error.status === 410 || (error.data && error.data.code === "NO_ACTIVE_CONVERSATION")) {
          quotationOpen = false;
          await loadCurrent();
          setStatus(failure, true);
        } else if (error.data && error.data.code === "PROFILE_INCOMPLETE") {
          quotationOpen = false;
          returnToQuotation = true;
          accountOpen = true;
          profileMode = true;
          fillProfileForm();
          setStatus(failure, true);
        } else if (error.data && error.data.code === "PRODUCT_CHANGED") {
          await loadQuotationCatalogue(false);
          setQuotationStatus(failure, true);
        } else {
          setQuotationStatus(failure, true);
        }
      } finally {
        finishOperation();
        if (isOpen && sent && !messageInput.disabled) messageInput.focus();
        else if (isOpen && profileMode && !profileName.disabled) profileName.focus();
      }
    });

    messageInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (busy || loading || stale || (active !== true && !draftChat) || hasPendingMessage()) return;
      if (typeof messageForm.requestSubmit === "function") {
        messageForm.requestSubmit();
      } else {
        messageForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });

    messageForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy || loading || stale || (active !== true && !draftChat) || hasPendingMessage() || !messageForm.reportValidity()) return;
      var value = messageInput.value.trim();
      if (!value) {
        messageInput.focus();
        setStatus("Enter a message before sending.", true);
        return;
      }
      if (!customer || ((draftChat || active !== true) && !hasSavedDetails())) {
        startRequested = true;
        continueRequestedChat();
        return;
      }
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        setStatus("Chat is unavailable in this browser. Please contact our team in the Help tab.", true);
        return;
      }
      var firstMessage = draftChat || active !== true;
      var requestId = window.crypto.randomUUID();
      pendingDraft = {
        value: value,
        ids: currentMessages.map(function (message) { return String(message.id); }),
        expectedConversationId: firstMessage ? requestId : conversationId,
        newChat: firstMessage
      };
      messageInput.value = value;
      busy = true;
      stopPolling();
      updateControls();
      appendOutgoingMessage(value);
      showThinking();
      animateIncoming = true;
      setStatus("Sending message…", false, true);
      var result = null;
      var savedFailure = false;
      var failure = "";
      try {
        var payload = { message: value, requestId: requestId };
        if (firstMessage) {
          payload.consent = true;
          payload.previousConversationId = draftPreviousConversationId;
        } else {
          payload.conversationId = conversationId;
        }
        result = await postJSON(firstMessage ? "/api/chat/start" : "/api/chat/messages", payload);
        if (!result || result.ok !== true || ["answered", "pending", "failed"].indexOf(result.status) === -1) {
          throw new Error("Unexpected message response");
        }
        if (result.saved === true && result.active === false) {
          savedFailure = true;
          failure = "Your message was already saved in an earlier chat. Open Messages to view it.";
        }
      } catch (error) {
        savedFailure = !!(error.data && error.data.saved === true);
        failure = error.data && typeof error.data.error === "string" ? error.data.error : "";
        result = null;
      }
      var loaded = await loadCurrent();
      if (savedFailure && messageInput.value === value) {
        messageInput.value = "";
        pendingDraft = null;
        if (firstMessage) draftMessageValue = "";
      }
      if (!loaded) removeThinking();
      finishOperation();
      if (loaded) {
        if (savedFailure) {
          setStatus(failure || "Your message was saved, but the assistant response could not be confirmed.", true);
        } else if (!result) {
          setStatus(failure || "The message could not be confirmed. Check the conversation before sending again, or contact our team.", true);
        } else if (!active) {
          setStatus("The chat is no longer active. Contact our team or start a new conversation.", true);
        } else if (result.status === "failed") {
          setStatus("The AI response is unavailable. Please contact our team directly.", true);
        } else {
          setStatus(hasPendingMessage() ? "Waiting for an AI response…" : "Response received.", false, !hasPendingMessage());
        }
        if (isOpen && !messageInput.disabled) messageInput.focus();
        schedulePendingRefresh();
      } else if (savedFailure) {
        setStatus("Your message was saved, but the conversation could not be loaded. Reload it or contact our team.", true);
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
