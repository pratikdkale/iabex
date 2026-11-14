/* IABEX — page behaviour (no framework, no build step).
 * Sections: mobile menu · active nav · reveal on scroll · marquee · product filter
 *           · enquiry/application modal · forms (api/send.php, or FormSubmit — see below)
 *           The chat assistant lives in chat.js and uses window.IABEX.openModal.
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
  // html.js hides .reveal; html.reveal-on tells the <head> failsafe that we're in charge.
  var reveals = $$('.reveal');
  document.documentElement.classList.add('reveal-on');
  function showReveal(el) { el.classList.add('is-in'); }
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { showReveal(en.target); ro.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveals.forEach(function (el) { ro.observe(el); });
    // Backstop for webviews where the observer never fires, and for jumps via anchor links:
    // anything whose top has scrolled into (or past) the viewport is shown.
    var pending = false;
    var sweep = function () {
      pending = false;
      reveals = reveals.filter(function (el) {
        if (el.classList.contains('is-in')) return false;
        if (el.getBoundingClientRect().top < window.innerHeight) { showReveal(el); ro.unobserve(el); return false; }
        return true;
      });
      if (!reveals.length) window.removeEventListener('scroll', onScroll);
    };
    var onScroll = function () { if (!pending) { pending = true; setTimeout(sweep, 250); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('load', sweep);
  } else {
    reveals.forEach(showReveal);
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
    project: {
      type: 'enquiry',
      kicker: function () { return 'PROJECT ENQUIRY'; },
      note: 'Tell us what you’re building — an idea, a specification or an existing product to improve. Our engineering team will get back to you.',
      cta: 'Send project details',
      done: 'Our engineering team will review your requirement and get back to you.'
    },
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
    b.addEventListener('click', function (e) {
      e.preventDefault(); // links keep href="#contact" as the no-JS fallback
      lastTrigger = b; openModal(b.dataset.openModal, { title: b.dataset.title || '' });
    });
  });
  window.IABEX = { openModal: function (kind, data) { lastTrigger = document.activeElement; openModal(kind, data || {}); }, filterProducts: filterProducts };

  /* ---------- Forms → api/send.php, or FormSubmit on static hosting ---------- */
  // <meta name="form-endpoint"> in index.html switches every form (and the chat) to FormSubmit,
  // because static hosts like GitHub Pages can't run PHP. Remove the meta to go back to
  // api/send.php on cPanel. On localhost / file:// forms always go to api/send.php (dev_server.py).
  function showError(form, msg) { var e = $('[data-form-error]', form); if (e) { e.textContent = msg; e.classList.add('is-visible'); } }
  function hideError(form) { var e = $('[data-form-error]', form); if (e) { e.textContent = ''; e.classList.remove('is-visible'); } }
  var FAIL_MSG = 'We couldn’t send that just now. Please email info@iabex.net or call +91 76666 90113.';
  var endpointMeta = $('meta[name="form-endpoint"]');
  var isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var FORMSUBMIT = endpointMeta && endpointMeta.content && !isLocal ? endpointMeta.content.replace(/\/$/, '') : '';

  // Same subject lines as api/send.php
  function subjectFor(fd) {
    var name = fd.get('name') || '';
    if (fd.get('type') === 'application') return 'Job application: ' + (fd.get('role') || 'General application') + ' — ' + name;
    return fd.get('product') ? 'Quote request: ' + fd.get('product') + ' — ' + name
      : 'Website enquiry: ' + (fd.get('interest') || 'General') + ' — ' + name;
  }
  // FormSubmit control fields: _subject, _replyto, _honey (honeypot), _template, _captcha
  function formSubmitControls(fd) {
    return { _subject: subjectFor(fd), _replyto: fd.get('email') || '', _honey: fd.get('website') || '', _template: 'table', _captcha: 'false' };
  }
  // Sends FormData without files; resolves to { ok, message } like api/send.php.
  function submitData(fd) {
    if (!FORMSUBMIT) {
      return fetch('api/send.php', { method: 'POST', body: fd })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok, message: '' }; }); });
    }
    // URL-encoded body keeps it a "simple" CORS request (no preflight)
    var body = new URLSearchParams(), controls = formSubmitControls(fd);
    Object.keys(controls).forEach(function (k) { body.append(k, controls[k]); });
    fd.forEach(function (v, k) { if (k !== 'website' && typeof v === 'string') body.append(k, v); });
    return fetch(FORMSUBMIT.replace('formsubmit.co/', 'formsubmit.co/ajax/'), { method: 'POST', headers: { Accept: 'application/json' }, body: body })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) { return { ok: String(res.success) === 'true', message: '' }; });
  }
  // FormSubmit's AJAX endpoint doesn't take files, so applications (with a resume) are posted
  // as a normal form and FormSubmit redirects back to ?sent=application.
  function submitNative(form) {
    var controls = formSubmitControls(new FormData(form));
    controls._next = location.href.split(/[?#]/)[0] + '?sent=application#careers';
    Object.keys(controls).forEach(function (k) {
      if (k === '_honey') return;
      var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = controls[k]; form.appendChild(i);
    });
    var hp = $('input[name="website"]', form); if (hp) hp.name = '_honey';
    form.setAttribute('action', FORMSUBMIT);
    form.setAttribute('enctype', 'multipart/form-data');
    HTMLFormElement.prototype.submit.call(form);
  }
  window.IABEX.submit = submitData;

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

      var fd = new FormData(form);
      if (FORMSUBMIT && fd.get('type') === 'application') { submitNative(form); return; }

      submitData(fd)
        .then(function (res) {
          if (!res.ok) throw new Error(res.message || 'Something went wrong. Please try again.');
          wrap.classList.add('is-sent');
          form.reset();
        })
        .catch(function (err) {
          var msg = err && err.message && err.message !== 'Failed to fetch' && !FORMSUBMIT ? err.message : FAIL_MSG;
          showError(form, msg);
        })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    });
  });

  // Back from FormSubmit after a job application
  if (/[?&]sent=application\b/.test(location.search) && modal) {
    history.replaceState(null, '', location.pathname + location.hash);
    openModal('apply', { title: 'Application sent' });
    $('[data-form-wrap]', modal).classList.add('is-sent');
  }
  $$('[data-form-reset]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('[data-form-wrap]').classList.remove('is-sent'); });
  });
})();
