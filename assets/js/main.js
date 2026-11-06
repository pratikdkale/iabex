/* IABEX — page behaviour (no framework, no build step).
 * Sections: mobile menu · active nav · reveal on scroll · marquee · product filter
 *           · enquiry/application modal · AJAX forms (api/send.php)
 * The 3D hero lives in hero3d.js.
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Year ---------- */
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Mobile menu ---------- */
  var header = $('.site-header');
  var toggle = $('[data-menu-toggle]');
  function setMenu(open) {
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
  }
  if (toggle) {
    toggle.addEventListener('click', function () { setMenu(!header.classList.contains('is-open')); });
    $$('#mobile-nav a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    window.addEventListener('resize', function () { if (window.innerWidth > 960) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && header.classList.contains('is-open')) setMenu(false); });
  }

  /* ---------- Active nav link ---------- */
  var navLinks = $$('.nav a');
  if ('IntersectionObserver' in window && navLinks.length) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && byId[en.target.id]) {
          navLinks.forEach(function (a) { a.classList.remove('is-active'); });
          byId[en.target.id].classList.add('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- Reveal on scroll ---------- */
  var reveals = $$('.reveal');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); ro.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach(function (el) { ro.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Marquee: duplicate logos for a seamless loop ---------- */
  var track = $('[data-marquee]');
  if (track) {
    $$('img', track).forEach(function (img) {
      var c = img.cloneNode(true); c.alt = ''; c.setAttribute('aria-hidden', 'true'); track.appendChild(c);
    });
  }

  /* ---------- Product filter ---------- */
  var tabs = $$('[data-filter]');
  var products = $$('.product');
  var counts = { all: products.length };
  products.forEach(function (p) { var f = p.dataset.family; counts[f] = (counts[f] || 0) + 1; });
  $$('[data-count]').forEach(function (el) { el.textContent = counts[el.dataset.count] || 0; });

  function filterProducts(family) {
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.filter === family)); });
    products.forEach(function (p) { p.hidden = !(family === 'all' || p.dataset.family === family); });
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { filterProducts(t.dataset.filter); }); });
  $$('[data-filter-link]').forEach(function (a) { a.addEventListener('click', function () { filterProducts(a.dataset.filterLink); }); });

  /* ---------- Modal (product enquiry · catalogue · job application) ---------- */
  var modal = $('[data-modal]');
  var COPY = {
    product: {
      type: 'enquiry',
      kicker: function (d) { return (d.code ? d.code + ' · ' : '') + 'PRODUCT ENQUIRY'; },
      note: 'Specifications, pricing and lead time are shared by our sales engineers after we understand your application.',
      cta: 'Request details',
      done: 'A sales engineer will reply with the datasheet, pricing and lead time.'
    },
    catalogue: {
      type: 'enquiry',
      kicker: function () { return 'CATALOGUE REQUEST'; },
      note: 'We’ll email the full product catalogue and follow up to understand your requirements.',
      cta: 'Email me the catalogue',
      done: 'The catalogue is on its way to your inbox.'
    },
    apply: {
      type: 'application',
      kicker: function () { return 'JOB APPLICATION · WARJE, PUNE'; },
      note: 'All roles are full-time at our Warje, Pune facility. Process: application → technical conversation → practical round.',
      cta: 'Submit application',
      done: 'Our team will review your application and contact you about next steps.'
    }
  };
  var lastTrigger = null;

  function openModal(kind, data) {
    if (!modal) return;
    var c = COPY[kind];
    var wrap = $('[data-form-wrap]', modal);
    var form = $('form', modal);
    wrap.classList.remove('is-sent');
    form.reset();
    hideError(form);
    modal.dataset.kind = kind;

    $('[data-modal-kicker]', modal).textContent = c.kicker(data);
    $('[data-modal-title]', modal).textContent = data.title;
    $('[data-modal-note]', modal).textContent = c.note;
    $('[data-modal-cta]', modal).textContent = c.cta;
    $('[data-modal-done]', modal).textContent = c.done;
    $('[data-modal-type]', modal).value = c.type;

    // Enable only the fields that belong to this kind (disabled = not validated, not sent)
    $$('[data-only]', modal).forEach(function (el) {
      var on = el.dataset.only.split(' ').indexOf(kind) !== -1;
      var fields = el.matches('input, select, textarea') ? [el] : $$('input, select, textarea', el);
      fields.forEach(function (f) { f.disabled = !on; });
    });
    $$('[data-required-for]', modal).forEach(function (f) { f.required = f.dataset.requiredFor === kind; });
    var product = $('input[name="product"]', modal); if (product) product.value = kind === 'product' ? data.title : 'Full product catalogue';
    var role = $('input[name="role"]', modal); if (role) role.value = data.title;

    if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '');
    document.body.classList.add('modal-open');
    var first = $('input:not([type=hidden]):not([disabled])', form); if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal() {
    if (!modal) return;
    if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('open');
  }
  if (modal) {
    modal.addEventListener('close', function () {
      document.body.classList.remove('modal-open');
      if (lastTrigger) lastTrigger.focus();
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); }); // backdrop click
    $$('[data-modal-close]', modal).forEach(function (b) { b.addEventListener('click', closeModal); });
  }
  products.forEach(function (p) {
    p.addEventListener('click', function () { lastTrigger = p; openModal('product', { title: p.dataset.product, code: p.dataset.code }); });
  });
  $$('[data-open-modal]').forEach(function (b) {
    b.addEventListener('click', function () { lastTrigger = b; openModal(b.dataset.openModal, { title: b.dataset.title || '' }); });
  });

  /* ---------- AJAX forms → api/send.php ---------- */
  function showError(form, msg) { var e = $('[data-form-error]', form); if (e) { e.textContent = msg; e.classList.add('is-visible'); } }
  function hideError(form) { var e = $('[data-form-error]', form); if (e) { e.textContent = ''; e.classList.remove('is-visible'); } }

  $$('[data-ajax-form]').forEach(function (form) {
    var wrap = form.closest('[data-form-wrap]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      hideError(form);
      if (!form.checkValidity()) {
        var bad = $(':invalid:not(fieldset)', form);
        showError(form, 'Please fill in the required fields' + (bad && bad.type === 'email' ? ' and a valid email.' : '.'));
        if (bad) bad.focus();
        return;
      }
      var resume = $('input[name="resume"]:not([disabled])', form);
      if (resume && resume.files[0] && resume.files[0].size > 5 * 1024 * 1024) { showError(form, 'Resume is too large. Maximum size is 5 MB.'); return; }

      var btn = $('button[type="submit"]', form);
      var label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Sending…';

      fetch(form.getAttribute('action') || 'api/send.php', { method: 'POST', body: new FormData(form) })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok, message: '' }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.message || 'Something went wrong. Please try again.');
          wrap.classList.add('is-sent');
          form.reset();
        })
        .catch(function (err) {
          var msg = err && err.message && err.message !== 'Failed to fetch'
            ? err.message
            : 'We couldn’t send that just now. Please email info@iabex.net or call +91 76666 90113.';
          showError(form, msg);
        })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    });
  });
  $$('[data-form-reset]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('[data-form-wrap]').classList.remove('is-sent'); });
  });
})();
