(function () {
  'use strict';

  function count(value) {
    var number = Number(value) || 0;
    return number < 10 ? '0' + number : String(number);
  }

  function plural(value, singular, many) {
    return count(value) + ' ' + (Number(value) === 1 ? singular : many);
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function companyByPage(companies, href) {
    return companies.find(function (company) { return company.url === href; }) || null;
  }

  function categoryByPage(categories, href) {
    return categories.find(function (category) { return category.url === href; }) || null;
  }

  function updateHeaderCounts(catalogue) {
    catalogue.categories.forEach(function (category) {
      var label = plural(category.companyCount, 'company', 'companies') + ' · ' + plural(category.productCount, 'product', 'products');
      document.querySelectorAll('.dropdown-link[data-nav="' + category.id + '"] small').forEach(function (element) {
        element.textContent = label;
      });
    });
  }

  function updateStats(catalogue) {
    document.querySelectorAll('[data-catalogue-stat]').forEach(function (element) {
      var key = element.getAttribute('data-catalogue-stat');
      if (key === 'categories') element.textContent = count(catalogue.totals.categories);
      if (key === 'companies') element.textContent = count(catalogue.totals.companies);
      if (key === 'products') element.textContent = count(catalogue.totals.products);
    });
    var word = document.querySelector('[data-catalogue-product-word]');
    if (word) word.textContent = String(catalogue.totals.products);
  }

  function updateCompanyCards(catalogue) {
    document.querySelectorAll('a.company-card[href]').forEach(function (card) {
      var company = companyByPage(catalogue.companies, card.getAttribute('href'));
      if (!company) return;
      var label = card.querySelector('.catalogue-model-count');
      if (label) label.textContent = plural(company.productCount, 'individual product', 'individual products') + ' · View details';
    });
  }

  function updateCategorySummaries(catalogue) {
    var page = document.body.getAttribute('data-page');
    if (page === 'products' || page === 'home' || !page) return;
    var category = catalogue.categories.find(function (item) { return item.id === page; });
    if (!category) return;
    document.querySelectorAll('.directory-heading .kicker').forEach(function (element) {
      element.textContent = plural(category.companyCount, 'company', 'companies') + ' · ' + plural(category.productCount, 'individual product', 'individual products');
    });
  }

  function updateGroupHeadings(catalogue) {
    document.querySelectorAll('.catalogue-group-heading').forEach(function (heading) {
      var link = heading.querySelector('a[href]');
      var category = link ? categoryByPage(catalogue.categories, link.getAttribute('href')) : null;
      if (!category) return;
      var eyebrow = heading.querySelector('.eyebrow');
      if (!eyebrow) return;
      var index = catalogue.categories.indexOf(category);
      eyebrow.textContent = count(index + 1) + ' / ' + plural(category.companyCount, 'company', 'companies') + ' / ' + plural(category.productCount, 'product', 'products');
    });
  }

  function updateHomeCards(catalogue) {
    document.querySelectorAll('.cap-card[href]').forEach(function (card) {
      var category = categoryByPage(catalogue.categories, card.getAttribute('href'));
      if (!category) return;
      var topline = card.querySelector('.cap-topline .num');
      if (!topline) return;
      var index = catalogue.categories.indexOf(category);
      topline.textContent = count(index + 1) + ' / ' + plural(category.companyCount, 'company', 'companies');
    });
  }

  function productArticle(product, company, index) {
    var article = node('article', 'product-detail-card');
    article.id = product.key;
    article.setAttribute('aria-labelledby', product.key + '-title');

    var media = node('div', 'product-detail-media' + (product.photo ? ' product-detail-media--photo' : ''));
    if (product.imageUrl) {
      var image = document.createElement('img');
      image.src = product.imageUrl;
      image.width = 720;
      image.height = 452;
      image.alt = company.name + ' ' + product.name;
      image.loading = 'lazy';
      media.append(image);
    } else {
      media.classList.add('product-detail-media--placeholder');
      media.append(node('span', '', company.name));
    }

    var body = node('div', 'product-detail-body');
    body.append(node('span', 'product-detail-type', count(index + 1) + ' / ' + product.type));
    var title = node('h3', '', product.name);
    title.id = product.key + '-title';
    body.append(title);
    body.append(node('p', 'product-detail-summary', product.summary));

    if (product.descriptionHtml) {
      var rich = node('div', 'product-rich-text');
      // The server sanitizes this HTML before it is stored and again before it is served.
      rich.innerHTML = product.descriptionHtml;
      body.append(rich);
    }

    if (product.specs.length) {
      var specs = node('dl', 'product-specs');
      product.specs.forEach(function (spec) {
        var row = document.createElement('div');
        row.append(node('dt', '', spec.label), node('dd', '', spec.value));
        specs.append(row);
      });
      body.append(specs);
    }
    if (product.specNote) body.append(node('p', 'product-spec-note', product.specNote));

    if (product.features.length) {
      body.append(node('p', 'product-features-title', 'Key features'));
      var features = node('ul', 'product-features');
      product.features.forEach(function (feature) { features.append(node('li', '', feature)); });
      body.append(features);
    }

    var actions = node('div', 'product-detail-actions');
    var enquiry = node('a', 'btn btn--outline', 'Product enquiry');
    enquiry.href = product.enquiryUrl;
    enquiry.setAttribute('aria-label', 'Enquire about ' + company.name + ' ' + product.name);
    actions.append(enquiry);
    if (product.sourceUrl) {
      var source = node('a', 'text-link', 'Manufacturer reference');
      source.href = product.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      actions.append(source);
    }
    body.append(actions);
    article.append(media, body);
    return article;
  }

  function hydrateCompany(catalogue) {
    var companyKey = document.body.getAttribute('data-company');
    if (!companyKey) return;
    var company = catalogue.companies.find(function (item) { return item.key === companyKey; });
    if (!company) return;

    var section = document.getElementById('products');
    if (!section) return;
    var heading = section.querySelector('.company-section-heading .eyebrow');
    if (heading) heading.textContent = 'Individual products / ' + count(company.productCount) + ' ' + (company.productCount === 1 ? 'model' : 'models');

    var index = section.querySelector('.company-product-index');
    if (index) {
      index.replaceChildren();
      company.products.forEach(function (product) {
        var link = node('a', '', product.name);
        link.href = '#' + product.key;
        index.append(link);
      });
      index.hidden = !company.products.length;
    }

    var grid = section.querySelector('.company-products-grid');
    if (!grid) return;
    grid.replaceChildren();
    if (!company.products.length) {
      grid.append(node('p', 'catalogue-empty', 'No published products are listed for this company yet.'));
    } else {
      company.products.forEach(function (product, position) {
        grid.append(productArticle(product, company, position));
      });
    }

    if (window.location.hash) {
      try {
        var target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
        if (target) target.scrollIntoView();
      } catch (error) { /* Ignore malformed fragments. */ }
    }
  }

  function hydrate(catalogue) {
    if (!catalogue || !Array.isArray(catalogue.companies) || !Array.isArray(catalogue.categories) || !catalogue.totals) return;
    if (!catalogue.totals.products) return;
    updateHeaderCounts(catalogue);
    updateStats(catalogue);
    updateCompanyCards(catalogue);
    updateCategorySummaries(catalogue);
    updateGroupHeadings(catalogue);
    updateHomeCards(catalogue);
    hydrateCompany(catalogue);
    document.dispatchEvent(new CustomEvent('sssb:catalogue', { detail: catalogue }));
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 5000);
  fetch('/api/catalogue', { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal })
    .then(function (response) {
      if (!response.ok) throw new Error('Catalogue unavailable');
      return response.json();
    })
    .then(hydrate)
    .catch(function () { /* Keep the static catalogue as the fallback. */ })
    .finally(function () { clearTimeout(timer); });
})();
