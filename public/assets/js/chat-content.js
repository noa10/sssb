(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SSSBChatContent = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function safeUrl(value, base) {
    if (typeof value !== "string" || /[\s\\\x00-\x1f\x7f]/.test(value) ||
        !/^(?:https?:\/\/|\/(?!\/))/i.test(value)) return null;
    try {
      var url = new URL(value, base);
      var origin = new URL(base).origin;
      if (url.username || url.password || (url.protocol !== "https:" && url.origin !== origin)) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function appendLink(parent, label, destination, doc, base, approvedLinks) {
    var url = safeUrl(destination, base);
    var origin = new URL(base).origin;
    if (!url || (url.origin !== origin && (!approvedLinks || approvedLinks.indexOf(url.href) === -1))) {
      parent.appendChild(doc.createTextNode(label));
      return;
    }
    var link = doc.createElement("a");
    link.href = url.href;
    link.textContent = label;
    if (url.origin !== new URL(base).origin) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = "Opens " + url.hostname + " in a new tab";
      var hint = doc.createElement("span");
      hint.className = "chat-visually-hidden";
      hint.textContent = " (opens " + url.hostname + " in a new tab)";
      link.appendChild(hint);
    }
    parent.appendChild(link);
  }

  function appendInline(parent, text, doc, base, approvedLinks) {
    var tokens = /\[([^\]\n]{1,200})\]\(([^\s)]+)\)|(https?:\/\/[^\s<>()]+)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g;
    var index = 0;
    var match;
    while ((match = tokens.exec(text))) {
      parent.appendChild(doc.createTextNode(text.slice(index, match.index)));
      if (match[1] !== undefined) {
        appendLink(parent, match[1], match[2], doc, base, approvedLinks);
      } else if (match[3] !== undefined) {
        var address = match[3].replace(/[.,!?;:]+$/, "");
        appendLink(parent, address, address, doc, base, approvedLinks);
        parent.appendChild(doc.createTextNode(match[3].slice(address.length)));
      } else {
        var tag = match[4] !== undefined || match[5] !== undefined ? "strong" :
          (match[8] !== undefined ? "code" : "em");
        var inline = doc.createElement(tag);
        inline.textContent = match[4] || match[5] || match[6] || match[7] || match[8];
        parent.appendChild(inline);
      }
      index = tokens.lastIndex;
    }
    parent.appendChild(doc.createTextNode(text.slice(index)));
  }

  function appendFormattedText(container, text, doc, base, approvedLinks) {
    var lines = text.replace(/\r\n?/g, "\n").split("\n");
    var paragraph = null;
    var list = null;
    lines.forEach(function (line) {
      if (!line.trim()) {
        paragraph = null;
        list = null;
        return;
      }
      var item = line.match(/^\s*(?:([-*+])\s+|(\d+)[.)]\s+)(.*)$/);
      if (item) {
        var listType = item[2] ? "ol" : "ul";
        if (!list || list.tagName.toLowerCase() !== listType) {
          list = doc.createElement(listType);
          container.appendChild(list);
        }
        paragraph = null;
        var listItem = doc.createElement("li");
        appendInline(listItem, item[3], doc, base, approvedLinks);
        list.appendChild(listItem);
        return;
      }
      list = null;
      var heading = line.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        paragraph = null;
        var title = doc.createElement("p");
        title.className = "chat-rich-heading";
        appendInline(title, heading[1], doc, base, approvedLinks);
        container.appendChild(title);
        return;
      }
      if (!paragraph) {
        paragraph = doc.createElement("p");
        container.appendChild(paragraph);
      } else {
        paragraph.appendChild(doc.createElement("br"));
      }
      appendInline(paragraph, line, doc, base, approvedLinks);
    });
  }

  function appendProduct(container, product, doc, base) {
    if (!product || typeof product.name !== "string" || typeof product.url !== "string" ||
        !/^\/[a-z0-9-]+\.html#[a-z0-9-]+$/.test(product.url)) return;
    var url = safeUrl(product.url, base);
    if (!url || url.origin !== new URL(base).origin) return;
    var card = doc.createElement("article");
    card.className = "chat-product";
    var link = doc.createElement("a");
    link.className = "chat-product-main";
    link.href = url.href;
    if (typeof product.image === "string" && /^(?:\/assets\/img\/products\/[a-z0-9][a-z0-9._-]*|\/media\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?:jpe?g|png|webp)$/i.test(product.image)) {
      var image = doc.createElement("img");
      image.setAttribute("src", product.image);
      image.alt = "";
      image.loading = "lazy";
      image.width = 160;
      image.height = 120;
      link.appendChild(image);
    }
    var details = doc.createElement("span");
    details.className = "chat-product-details";
    var name = doc.createElement("strong");
    name.textContent = product.name;
    details.appendChild(name);
    if (typeof product.type === "string" && product.type) {
      var type = doc.createElement("span");
      type.textContent = product.type;
      details.appendChild(type);
    }
    var label = doc.createElement("span");
    label.className = "chat-product-action";
    label.textContent = "View product";
    details.appendChild(label);
    link.appendChild(details);
    card.appendChild(link);
    if (typeof product.manufacturerUrl === "string") {
      var source = safeUrl(product.manufacturerUrl, base);
      if (source && source.protocol === "https:" && source.origin !== new URL(base).origin) {
        var sourceWrap = doc.createElement("span");
        sourceWrap.className = "chat-product-source";
        appendLink(sourceWrap, "Manufacturer website", source.href, doc, base, [source.href]);
        card.appendChild(sourceWrap);
      }
    }
    container.appendChild(card);
  }

  function render(container, message, base) {
    var doc = container.ownerDocument;
    var text = typeof message.content === "string" ? message.content : "";
    container.replaceChildren();
    if (message.role === "assistant") {
      appendFormattedText(container, text, doc, base, Array.isArray(message.approvedLinks) ? message.approvedLinks : []);
      if (Array.isArray(message.products)) {
        message.products.forEach(function (product) {
          appendProduct(container, product, doc, base);
        });
      }
    } else {
      var plain = doc.createElement("p");
      plain.textContent = text;
      container.appendChild(plain);
    }
  }

  return { render: render, safeUrl: safeUrl };
});
