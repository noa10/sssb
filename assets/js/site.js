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

  function initContactForm() {
    var form = document.querySelector("[data-contact-form]");
    if (!form) return;

    var success = document.querySelector("[data-form-success]");
    var successTitle = success ? success.querySelector("h3") : null;
    var reset = document.querySelector("[data-form-reset]");
    var status = form.querySelector("[data-form-status]");
    var summary = form.querySelector("[data-form-errors]");
    var submit = form.querySelector('button[type="submit"]');
    var submitLabel = submit ? submit.innerHTML : "";
    var attempted = false;

    var productChoice = form.querySelector("[data-product-choice]");
    var enquiryType = form.querySelector('[name="enquiry"]');
    var enquiryMessage = form.querySelector('[name="message"]');
    var generatedMessage = "";

    function updateProductEnquiry() {
      if (!productChoice || !enquiryMessage) return;
      var option = productChoice.options[productChoice.selectedIndex];
      if (!option || !option.value || !option.dataset.enquiryLabel) {
        if (enquiryMessage.value === generatedMessage) enquiryMessage.value = "";
        generatedMessage = "";
        return;
      }
      if (enquiryType && !enquiryType.value) enquiryType.value = "product";
      var message = "I would like to enquire about " + option.dataset.enquiryLabel + ".";
      if (!enquiryMessage.value || enquiryMessage.value === generatedMessage) {
        enquiryMessage.value = message;
        generatedMessage = message;
      }
    }

    if (productChoice) {
      var enquiryParams = new URLSearchParams(window.location.search);
      var selectedCompany = enquiryParams.get("company") || "";
      var selectedProduct = enquiryParams.get("product") || "";
      var choiceValue = selectedCompany + (selectedProduct ? "/" + selectedProduct : "");
      var requestedOption = Array.prototype.find.call(productChoice.options, function (option) {
        return option.value && option.value === choiceValue;
      });
      if (requestedOption) productChoice.value = requestedOption.value;
      productChoice.addEventListener("change", updateProductEnquiry);
      updateProductEnquiry();
    }

    var validators = {
      name: function (value) {
        if (!value.trim()) return "Enter your full name.";
        if (value.trim().length < 2) return "Use at least two characters.";
        return "";
      },
      email: function (value) {
        if (!value.trim()) return "Enter your email address.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
          return "Enter a valid email, such as name@company.com.";
        }
        return "";
      },
      phone: function (value) {
        if (!value.trim()) return "";
        if (value.replace(/[^\d+]/g, "").length < 7) {
          return "Enter a valid phone number, including country code.";
        }
        return "";
      },
      enquiry: function (value) {
        if (!value) return "Choose the type of enquiry.";
        return "";
      },
      message: function (value) {
        if (!value.trim()) return "Tell us how we can help.";
        if (value.trim().length < 10) return "Add a little more detail (at least 10 characters).";
        return "";
      }
    };

    function fieldRow(field) {
      return field.closest(".form-row");
    }

    function errorNode(field) {
      return fieldRow(field) ? fieldRow(field).querySelector(".field-error") : null;
    }

    function clearSummary() {
      if (!summary) return;
      summary.hidden = true;
      summary.innerHTML = "";
    }

    function showSummary(invalidFields) {
      if (!summary) return;
      summary.innerHTML = "";
      var message = document.createElement("p");
      message.textContent =
        invalidFields.length === 1
          ? "One field needs attention before this enquiry can be prepared."
          : "A few fields need attention before this enquiry can be prepared.";
      var list = document.createElement("ul");

      invalidFields.forEach(function (field) {
        var label = form.querySelector('label[for="' + field.id + '"]');
        var item = document.createElement("li");
        var link = document.createElement("a");
        link.href = "#" + field.id;
        link.textContent = label
          ? label.textContent.replace("*", "").trim()
          : field.name;
        link.addEventListener("click", function (event) {
          event.preventDefault();
          field.focus();
        });
        item.appendChild(link);
        list.appendChild(item);
      });

      summary.appendChild(message);
      summary.appendChild(list);
      summary.hidden = false;
      summary.focus();
    }

    function validateField(field, show) {
      var validator = validators[field.name];
      if (!validator) return true;
      var message = validator(field.value);
      var row = fieldRow(field);
      var error = errorNode(field);

      if (message) {
        if (show) {
          if (row) row.classList.add("has-error");
          if (error) {
            error.textContent = message;
            error.hidden = false;
          }
          field.setAttribute("aria-invalid", "true");
        }
        return false;
      }

      if (row) row.classList.remove("has-error");
      if (error) {
        error.textContent = "";
        error.hidden = true;
      }
      field.removeAttribute("aria-invalid");
      if (!form.querySelector(".has-error")) clearSummary();
      return true;
    }

    var fields = Array.prototype.slice.call(
      form.querySelectorAll("input[name], select[name], textarea[name]")
    );

    fields.forEach(function (field) {
      field.addEventListener("blur", function () {
        if (attempted || field.value) validateField(field, true);
      });
      field.addEventListener("input", function () {
        if (fieldRow(field) && fieldRow(field).classList.contains("has-error")) {
          validateField(field, true);
        }
      });
      field.addEventListener("change", function () {
        if (fieldRow(field) && fieldRow(field).classList.contains("has-error")) {
          validateField(field, true);
        }
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (submit && submit.disabled) return;
      attempted = true;
      var invalidFields = [];
      var firstInvalid = null;

      fields.forEach(function (field) {
        var valid = validateField(field, true);
        if (!valid) {
          invalidFields.push(field);
          if (!firstInvalid) firstInvalid = field;
        }
      });

      if (invalidFields.length) {
        if (status) {
          status.textContent = "";
          status.hidden = true;
        }
        showSummary(invalidFields);
        if (!summary && firstInvalid) firstInvalid.focus();
        return;
      }

      clearSummary();
      if (status) {
        status.textContent = "";
        status.hidden = true;
      }

      fields.forEach(function (field) {
        field.disabled = true;
      });
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Preparing…";
      }

      window.setTimeout(function () {
        form.hidden = true;
        if (success) {
          success.hidden = false;
          if (successTitle) {
            successTitle.setAttribute("tabindex", "-1");
            successTitle.focus();
          }
        }
        fields.forEach(function (field) {
          field.disabled = false;
        });
        if (submit) {
          submit.disabled = false;
          submit.innerHTML = submitLabel;
        }
        form.reset();
        attempted = false;
        fields.forEach(function (field) {
          var row = fieldRow(field);
          if (row) row.classList.remove("has-error");
          var error = errorNode(field);
          if (error) {
            error.textContent = "";
            error.hidden = true;
          }
          field.removeAttribute("aria-invalid");
        });
      }, 650);
    });

    if (reset) {
      reset.addEventListener("click", function () {
        if (success) success.hidden = true;
        clearSummary();
        form.hidden = false;
        var first = form.querySelector("input[name='name']");
        if (first) first.focus();
      });
    }
  }

  initYear();
  initCurrentPage();
  initDropdown();
  initMobileMenu();
  initReveal();
  initQuoteCarousel();
  initContactForm();

  window.addEventListener("load", function () {
    document.documentElement.classList.add("is-loaded");
  });
})();
