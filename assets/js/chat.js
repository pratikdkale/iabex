/* IABEX — chat assistant. Rule-based and fully in the browser: no AI service, no API key.
 *
 * Knowledge is read from the page itself (product cards, roles, industries, FAQ, clients,
 * testimonials, section text), so it stays in sync when index.html changes.
 * What it can do:
 *   · understand typos and loose phrasing (fuzzy keyword scoring per intent)
 *   · find products by name, code (P-07) or need ("measure water quality")
 *   · remember context: the visitor's name/company, last product, last topic, yes/no offers
 *   · electronics maths: Ohm's law, LED series resistor, resistor colour codes (both ways),
 *     plain arithmetic — via a small parser, never eval()
 *   · office open/closed right now in IST, and when we next open
 *   · search the page text when no rule matches, and point to the section
 *   · take an enquiry inside the chat and send it like the site's forms (IABEX.submit, type=enquiry)
 *   · drive the page: open the enquiry modal, filter products, scroll to sections
 * Conversation is kept in sessionStorage for the tab's lifetime.
 * Uses window.IABEX from main.js (openModal, filterProducts, submit).
 * Contact details below must match the rest of the site (see CLAUDE.md).
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-chat]');
  if (!root) return;

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STORE = 'iabex-chat-v1';

  var CONTACT = {
    email: 'info@iabex.net',
    phone: '+91 76666 90113',
    tel: '+917666690113',
    wa: 'https://wa.me/917666690113', // TODO(client): confirm WhatsApp number
    address: 'S.No. 131/2A 24, behind Church, Rajyog Society, Warje, Pune 411058',
    hours: 'Mon–Sat, 9:30 AM – 6:30 PM IST',
    map: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Rajyog Society, Warje, Pune 411058')
  };

  /* ==========================================================================
     Knowledge, read from the page
     ========================================================================== */
  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function cleanText(el) { // text without .placeholder bits
    if (!el) return '';
    var c = el.cloneNode(true);
    $$('.placeholder', c).forEach(function (p) { p.remove(); });
    return text(c);
  }

  var FAMILY = {};
  $$('[data-filter]').forEach(function (t) { if (t.dataset.filter !== 'all') FAMILY[t.dataset.filter] = text(t).replace(/\s*\d+$/, ''); });
  var PRODUCTS = $$('.product').map(function (p) {
    var img = $('img', p);
    return { code: p.dataset.code, name: p.dataset.product, family: p.dataset.family, img: img ? img.getAttribute('src') : '' };
  });
  var ROLES = $$('.role').map(function (r) {
    return { title: text($('.role__title', r)), tags: $$('.chip', r).map(text), open: text($('.role__open', r)) };
  });
  var INDUSTRIES = $$('.industry').map(text).filter(function (t) { return t && t.indexOf('[') < 0; });
  var CLIENTS = [];
  $$('[data-marquee] img').forEach(function (i) { var a = i.getAttribute('alt'); if (a && CLIENTS.indexOf(a) < 0) CLIENTS.push(a); });
  var QUOTES = $$('#testimonials figure').map(function (f) {
    return { text: text($('blockquote', f) || $('p', f)), who: text($('.quote__name', f)), role: text($('.quote__role', f)) };
  }).filter(function (q) { return q.text; });
  var FAQ = $$('#faq details').map(function (d) {
    var s = $('summary', d), a = $('p', d);
    return { q: text(s), a: cleanText(a) };
  }).filter(function (f) { return f.a && f.a.indexOf('[') < 0; });
  // Passages for free-text search: paragraphs and cards that aren't placeholders
  var PASSAGES = $$('main p, main .step, main .cap-card, main .quality, main summary').map(function (el) {
    var t = cleanText(el), sec = el.closest('section[id]');
    return { text: t, id: sec ? sec.id : '', el: el };
  }).filter(function (p) { return p.text.length > 40 && p.text.indexOf('[') < 0 && p.id && p.id !== 'contact'; });

  /* ==========================================================================
     Text utilities
     ========================================================================== */
  function norm(s) {
    return String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  }
  function tokens(n) { return n.replace(/[^a-z0-9µω.'\- ]/g, ' ').split(/[\s\-]+/).map(function (t) { return t.replace(/^[.']+|[.']+$/g, ''); }).filter(Boolean); }
  var STOP = 'a an the and or of to for in on at by with from is are was be been am i you we me my our your it its this that these those do does did can could would should will shall have has had any some there what which who how when where why please hi hey hello want need looking like just about tell show give get know also more much very really'.split(' ');
  function stem(t) { return t.length > 5 ? t.replace(/(ing|ed|es)$/, '') : t.length > 3 ? t.replace(/s$/, '') : t; }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i]; var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // How well does a single-word keyword match the token list? 2 exact, 1.4 fuzzy, 0 none.
  function wordHit(kw, toks) {
    var best = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t === kw || stem(t) === stem(kw)) return 2;
      if (kw.length >= 4 && t.length >= 4) {
        var d = lev(t, kw, kw.length >= 7 ? 2 : 1);
        if (d <= (kw.length >= 7 ? 2 : 1)) best = Math.max(best, 1.4);
      }
    }
    return best;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Bot copy mini-markup: **bold**, [label](href), newlines. Input is escaped first.
  function fmt(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(((?:https?:|mailto:|tel:|#)[^)\s]+)\)/g, function (m, label, href) {
        var ext = /^https?:/.test(href);
        return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + label + '</a>';
      })
      .replace(/\n/g, '<br>');
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function listOf(arr) { return arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
  function hi() { return ctx.name ? ', ' + ctx.name : ''; }

  /* ==========================================================================
     Engineering numbers
     ========================================================================== */
  var PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, '': 1, k: 1e3, meg: 1e6 };
  function fmtSI(x, unit) {
    if (!isFinite(x)) return '—';
    var ax = Math.abs(x), steps = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
    for (var i = 0; i < steps.length; i++) {
      if (ax >= steps[i][0] * 0.9995 || i === steps.length - 1) {
        var v = x / steps[i][0];
        return parseFloat(v.toPrecision(3)) + ' ' + steps[i][1] + unit;
      }
    }
  }
  // Pull quantities like 12V, 20mA, 4.7kΩ, 4k7, 0.5W out of text.
  function quantities(n) {
    var q = { V: [], A: [], R: [], W: [] }, m;
    var s = n.replace(/ohms?|Ω/g, 'ω');
    var re = /(\d+(?:\.\d+)?)\s*(meg|k|m|u|µ|n|p)?\s*(v|volts?|a|amps?|amperes?|ω|r|w|watts?)(?![a-z])/g;
    while ((m = re.exec(s))) {
      var unit = m[3].charAt(0), val = parseFloat(m[1]) * PREFIX[m[2] || ''];
      if (unit === 'v') q.V.push(val); else if (unit === 'a') q.A.push(val);
      else if (unit === 'w') q.W.push(val); else q.R.push(val);
    }
    var rkm = /\b(\d+)([kmr])(\d+)\b/g; // 4k7, 2r2, 1m5 (resistor notation)
    while ((m = rkm.exec(s))) q.R.push(parseFloat(m[1] + '.' + m[3]) * ({ r: 1, k: 1e3, m: 1e6 })[m[2]]);
    var bare = /\b(\d+(?:\.\d+)?)\s*(k|meg)(?![a-z0-9])/g; // "2.2k" with no unit = resistance
    while ((m = bare.exec(s))) q.R.push(parseFloat(m[1]) * PREFIX[m[2]]);
    return q;
  }

  var COLOURS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
  var COLOUR_ALIAS = { purple: 'violet', gray: 'grey' };
  var TOL = { brown: '±1%', red: '±2%', green: '±0.5%', blue: '±0.25%', violet: '±0.1%', grey: '±0.05%', gold: '±5%', silver: '±10%' };
  var E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  function nextE12(r) {
    var dec = Math.pow(10, Math.floor(Math.log10(r)));
    for (var k = 0; k < 2; k++) {
      for (var i = 0; i < E12.length; i++) { var v = E12[i] * dec; if (v >= r * 0.999) return parseFloat(v.toPrecision(3)); }
      dec *= 10;
    }
    return r;
  }

  function calcColourCode(toks, n) {
    var cols = toks.map(function (t) { return COLOUR_ALIAS[t] || t; })
      .filter(function (t) { return COLOURS.indexOf(t) >= 0 || t === 'gold' || t === 'silver'; });
    if (cols.length < 3 || (cols.length < 4 && !/resistor|band|colou?r|code/.test(n))) return null;
    var digits, mult, tol;
    if (cols.length === 3) { digits = cols.slice(0, 2); mult = cols[2]; tol = null; }
    else if (cols.length === 4) { digits = cols.slice(0, 2); mult = cols[2]; tol = cols[3]; }
    else { digits = cols.slice(0, 3); mult = cols[3]; tol = cols[4]; }
    if (digits.some(function (d) { return COLOURS.indexOf(d) < 0; })) return null;
    var base = parseInt(digits.map(function (d) { return COLOURS.indexOf(d); }).join(''), 10);
    var m = mult === 'gold' ? 0.1 : mult === 'silver' ? 0.01 : Math.pow(10, COLOURS.indexOf(mult));
    var t = tol ? (TOL[tol] || '?') : '±20%';
    return bot('**' + cols.map(cap).join(' – ') + '** → **' + fmtSI(base * m, 'Ω') + '** ' + t +
      '\n' + (cols.length >= 5 ? 'Read as a 5-band resistor: three digits, multiplier, tolerance.' : 'Two digits (' + base + '), ×' + fmtSI(m, '') .trim() + ' multiplier' + (tol ? ', ' + tol + ' tolerance band.' : ', no tolerance band.')),
      { suggest: ['Colour code for 4.7k', 'LED resistor for 12V', 'Ohm’s law help'] });
  }

  function calcColourFor(n) {
    if (!/colou?r|band/.test(n)) return null;
    var q = quantities(n); if (!q.R.length) return null;
    var r = q.R[0];
    if (r < 0.1) return null;
    var e = Math.floor(Math.log10(r)) - 1, d = Math.round(r / Math.pow(10, e));
    if (d >= 100) { d = 10; e++; }
    var multName = e === -1 ? 'gold' : e === -2 ? 'silver' : COLOURS[e];
    if (!multName) return null;
    var bands = [COLOURS[Math.floor(d / 10)], COLOURS[d % 10], multName, 'gold'].map(cap);
    return bot('For **' + fmtSI(d * Math.pow(10, e), 'Ω') + '** (4-band, ±5%):\n**' + bands.join(' – ') + '**', { suggest: ['Red red brown gold', 'LED resistor for 5V'] });
  }

  var LED_VF = { red: 2.0, orange: 2.0, yellow: 2.1, green: 2.2, blue: 3.1, white: 3.1, uv: 3.3, ir: 1.3, infrared: 1.3, amber: 2.0 };
  function calcLED(toks, n) {
    if (toks.indexOf('led') < 0 && toks.indexOf('leds') < 0) return null;
    var q = quantities(n);
    if (!/resistor|resistance|series|limit|ohm|ω/.test(n) && !(q.V.length && q.A.length)) return null;
    if (!q.V.length) return bot('Happy to size it. Tell me the **supply voltage**, LED colour (or forward voltage) and current — e.g. “LED resistor 12V white 20mA”.', { suggest: ['LED resistor 12V white 20mA', 'LED resistor 5V red'] });
    var colour = null; Object.keys(LED_VF).some(function (c) { if (toks.indexOf(c) >= 0) { colour = c; return true; } return false; });
    var vs = Math.max.apply(null, q.V), vf, note = '';
    if (q.V.length >= 2) vf = Math.min.apply(null, q.V);
    else { vf = colour ? LED_VF[colour] : 2.0; note = colour ? ' (typical for ' + colour + ')' : ' (assumed — tell me the colour for a better figure)'; }
    var count = 1, sm = n.match(/(\d+)\s*leds?\s*(?:in\s*)?series/); if (sm) count = Math.max(1, parseInt(sm[1], 10));
    var i = q.A.length ? q.A[0] : 0.02, inote = q.A.length ? '' : ' (assumed)';
    var drop = vs - vf * count;
    if (drop <= 0) return bot('With a ' + fmtSI(vs, 'V') + ' supply and ' + count + ' × ' + fmtSI(vf, 'V') + ' LED' + (count > 1 ? 's' : '') + ' there’s no headroom for a resistor. Use a higher supply, fewer LEDs in series — or a constant-current driver, which we design too.');
    var r = drop / i, rs = nextE12(r), p = i * i * rs;
    var rating = [0.125, 0.25, 0.5, 1, 2, 5].filter(function (w) { return w >= p * 2; })[0] || 5;
    return bot('**LED series resistor**\nSupply ' + fmtSI(vs, 'V') + ' · LED Vf ' + fmtSI(vf, 'V') + note + (count > 1 ? ' × ' + count + ' in series' : '') + ' · current ' + fmtSI(i, 'A') + inote +
      '\nR = (' + fmtSI(vs, 'V') + ' − ' + fmtSI(vf * count, 'V') + ') ÷ ' + fmtSI(i, 'A') + ' = **' + fmtSI(r, 'Ω') + '**' +
      '\nNearest standard (E12, rounded up): **' + fmtSI(rs, 'Ω') + '**, dissipating ' + fmtSI(p, 'W') + ' → use a **' + (rating < 1 ? '1/' + Math.round(1 / rating) : rating) + ' W** resistor.' +
      (vs >= 24 || p > 0.5 ? '\nAt this power a switching LED driver would waste far less — that’s something we build.' : ''),
      { suggest: ['Colour code for ' + fmtSI(rs, 'Ω').replace(/\s/g, ''), 'Solar products', 'Discuss a project'] });
  }

  function calcOhm(n, toks) {
    var q = quantities(n), have = {};
    ['V', 'A', 'R', 'W'].forEach(function (k) { if (q[k].length) have[k] = q[k][0]; });
    var keys = Object.keys(have);
    var asked = /ohm|current|voltage|resistance|dissipat|calculate|calc|across|through/.test(n);
    if (keys.length < 2) {
      if (/ohm'?s? law|ohms law/.test(n)) return bot('Give me any two of **voltage, current, resistance or power** and I’ll work out the rest — e.g. “12V across 470Ω” or “5V 20mA”.', { suggest: ['12V across 470 ohm', '5V 20mA', '2W at 12V'] });
      return null;
    }
    if (!asked && toks.length > 4) return null; // "need a 12V 2A supply" is a request, not a sum
    var V = have.V, I = have.A, R = have.R, P = have.W;
    if (V != null && I != null) { R = V / I; P = V * I; }
    else if (V != null && R != null) { I = V / R; P = V * V / R; }
    else if (I != null && R != null) { V = I * R; P = I * I * R; }
    else if (P != null && V != null) { I = P / V; R = V * V / P; }
    else if (P != null && I != null) { V = P / I; R = P / (I * I); }
    else if (P != null && R != null) { V = Math.sqrt(P * R); I = Math.sqrt(P / R); }
    return bot('**Ohm’s law**\nVoltage **' + fmtSI(V, 'V') + '** · Current **' + fmtSI(I, 'A') + '** · Resistance **' + fmtSI(R, 'Ω') + '** · Power **' + fmtSI(P, 'W') + '**' +
      (R > 0 ? '\nNearest standard resistor (E12): ' + fmtSI(nextE12(R), 'Ω') + '.' : ''),
      { suggest: ['LED resistor for 12V', 'Brown black red gold'] });
  }

  // Arithmetic: + − × ÷ ^ %, parentheses. Recursive descent, no eval().
  function calcMath(n) {
    var s = n.replace(/^(what is|what's|whats|calculate|calc|compute|solve|evaluate)\s+/, '').replace(/[?=]+$/, '').replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
    if (!/^[\d.+\-*/^%()]+$/.test(s) || !/\d[+\-*/^%]/.test(s)) return null;
    var pos = 0;
    function peek() { return s[pos]; }
    function num() {
      if (peek() === '(') { pos++; var v = expr(); if (peek() !== ')') throw 0; pos++; return v; }
      if (peek() === '-') { pos++; return -num(); }
      var m = /^\d*\.?\d+/.exec(s.slice(pos)); if (!m) throw 0; pos += m[0].length;
      var v2 = parseFloat(m[0]); if (peek() === '%') { pos++; v2 /= 100; } return v2;
    }
    function power() { var b = num(); if (peek() === '^') { pos++; return Math.pow(b, power()); } return b; }
    function term() { var v = power(); while (peek() === '*' || peek() === '/') { var o = s[pos++], r = power(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var o = s[pos++], r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { var out = expr(); if (pos !== s.length || !isFinite(out)) return null;
      return bot(pick(['That’s ', 'Comes to ', '']) + '**' + parseFloat(out.toPrecision(10)).toLocaleString('en-IN', { maximumFractionDigits: 8 }) + '**.');
    } catch (e) { return null; }
  }

  /* ==========================================================================
     Office hours (IST)
     ========================================================================== */
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function ist() {
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) { var d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000); return { day: d.getDay(), mins: d.getHours() * 60 + d.getMinutes() }; }
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), mins: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10) };
  }
  var OPEN = 570, CLOSE = 1110; // 9:30–18:30
  function officeStatus() {
    var t = ist(), open = t.day !== 0 && t.mins >= OPEN && t.mins < CLOSE;
    if (open) {
      var left = CLOSE - t.mins, h = Math.floor(left / 60), m = left % 60;
      return { open: true, line: 'We’re **open right now** — the office closes in ' + (h ? h + ' h ' : '') + m + ' min (6:30 PM IST).' };
    }
    var nd = t.day, when;
    if (t.day !== 0 && t.mins < OPEN) when = 'today at 9:30 AM IST';
    else { nd = (t.day + 1) % 7; if (nd === 0) nd = 1; when = (nd === (t.day + 1) % 7 ? 'tomorrow (' + DAYS[nd] + ')' : DAYS[nd]) + ' at 9:30 AM IST'; }
    return { open: false, line: 'The office is **closed right now** — we open ' + when + '. Messages sent now are picked up first thing.' };
  }

  /* ==========================================================================
     Products
     ========================================================================== */
  var NEED = { // need words → product name fragments
    water: ['pH', 'TDS', 'ORP'], quality: ['pH', 'TDS', 'ORP'], acid: ['pH'], acidity: ['pH'], alkaline: ['pH'], conductivity: ['TDS'], salinity: ['TDS'], dissolved: ['TDS'], ro: ['TDS'], purifier: ['TDS'], oxidation: ['ORP'], chlorine: ['ORP'],
    flow: ['Flow Totalizer'], totaliser: ['Flow Totalizer'], totalizer: ['Flow Totalizer'], litres: ['Flow Totalizer'], liters: ['Flow Totalizer'],
    clock: ['Real Time Clock'], time: ['Real Time Clock', 'Timer'], display: ['Dot Matrix', 'Flow Totalizer'], timer: ['Timer'], counter: ['Timer'], count: ['Timer'],
    touch: ['SmartTouch'], button: ['SmartTouch'], switch: ['SmartTouch'], lift: ['Lift'], elevator: ['Lift'],
    serial: ['USB to Serial', 'CAN to RS232'], uart: ['USB to Serial'], rs232: ['CAN to RS232', 'USB to Serial'], can: ['CAN to RS232'], gpio: ['USB to GPIO'], usb: ['USB to'], converter: ['USB to Serial', 'CAN to RS232'], interface: ['USB to', 'CAN to RS232'],
    street: ['Street Light'], streetlight: ['Street Light'], lantern: ['Lantern'], lamp: ['Lantern', 'Street Light'], light: ['Street Light', 'Lantern', 'Home Lighting'], lighting: ['Home Lighting', 'Street Light'], home: ['Home Lighting'], house: ['Home Lighting'],
    battery: ['Charge Controller', 'MPPT', 'SLCC'], charge: ['Charge Controller', 'MPPT', 'SLCC'], charging: ['Charge Controller', 'MPPT', 'SLCC'], mppt: ['MPPT'], panel: ['MPPT', 'Charge Controller'], driver: ['LED Driver'],
    leak: ['Leak'], leakage: ['Leak'], pressure: ['Leak'], airtight: ['Leak'], temperature: ['Temperature'], thermal: ['Temperature'], oven: ['Temperature'], furnace: ['Temperature'], heat: ['Temperature'],
    log: ['Data Logger'], logger: ['Data Logger'], logging: ['Data Logger'], record: ['Data Logger'], recording: ['Data Logger'], monitor: ['Data Logger'], monitoring: ['Data Logger'], energy: ['AC Data Logger', 'DC Data Logger'], mains: ['AC Data Logger'], ac: ['AC Data Logger'], dc: ['DC Data Logger']
  };
  var FAMILY_WORDS = {
    industrial: ['industrial', 'interface', 'interfaces', 'converter', 'converters'],
    process: ['process', 'instrument', 'instruments', 'meter', 'meters', 'instrumentation'],
    solar: ['solar', 'lighting', 'renewable'],
    spm: ['spm', 'logger', 'loggers', 'logging']
  };
  function byFragment(frag) { var f = frag.toLowerCase(); return PRODUCTS.filter(function (p) { return p.name.toLowerCase().indexOf(f) >= 0; }); }
  function byCode(code) { return PRODUCTS.filter(function (p) { return p.code === code; })[0]; }

  // Name/need search. Words are weighted by rarity across product names (idf-style).
  var DF = {};
  PRODUCTS.forEach(function (p) {
    var seen = {};
    tokens(norm(p.name)).forEach(function (t) { if (!seen[t]) { seen[t] = 1; DF[t] = (DF[t] || 0) + 1; } });
  });
  function findProducts(toks) {
    var score = {};
    var add = function (p, s) { score[p.code] = (score[p.code] || 0) + s; };
    var useful = toks.filter(function (t) { return STOP.indexOf(t) < 0 && t.length > 1; });
    PRODUCTS.forEach(function (p) {
      tokens(norm(p.name)).forEach(function (nt) {
        if (nt.length < 2 || nt === 'to' || nt === 'cum') return;
        var h = wordHit(nt, useful);
        if (h) add(p, h / 2 * Math.log(1 + PRODUCTS.length / DF[nt]));
      });
    });
    useful.forEach(function (t) {
      var frags = NEED[t] || NEED[stem(t)];
      if (frags) frags.forEach(function (f, i) { byFragment(f).forEach(function (p) { add(p, 1.6 - i * 0.2); }); });
    });
    var ranked = Object.keys(score).sort(function (a, b) { return score[b] - score[a]; });
    if (!ranked.length) return { list: [], top: 0 };
    var top = score[ranked[0]];
    return { list: ranked.filter(function (c) { return score[c] >= top * 0.6; }).slice(0, 6).map(byCode), top: top };
  }
  function familyIn(toks) {
    var hit = null;
    Object.keys(FAMILY_WORDS).some(function (f) { if (FAMILY_WORDS[f].some(function (w) { return toks.indexOf(w) >= 0; })) { hit = f; return true; } return false; });
    return hit;
  }
  function productsReply(list, intro) {
    ctx.lastProducts = list.map(function (p) { return p.code; });
    ctx.topic = 'product';
    var names = list.map(function (p) { return p.name; });
    return bot(intro || (list.length === 1
      ? 'That’s our **' + list[0].name + '** (' + list[0].code + ', ' + FAMILY[list[0].family] + '). Tap it to request the datasheet, pricing and lead time.'
      : 'Here’s what matches: ' + listOf(names.map(function (n) { return '**' + n + '**'; })) + '. Tap any of them for details.'),
      { products: ctx.lastProducts, suggest: ['How does pricing work?', 'Can it be customised?', 'Show all products'] });
  }
  function familyReply(f) {
    var list = PRODUCTS.filter(function (p) { return p.family === f; });
    ctx.lastFamily = f;
    return productsReply(list, '**' + FAMILY[f] + '** — ' + list.length + ' products in the catalogue:');
  }

  /* ==========================================================================
     Intents
     kw: strong keywords/phrases (2 pts, phrases 3) · weak: supporting words (1 pt)
     ask: how a "did you mean" chip phrases it · run(ctx, n, toks) → message(s)
     ========================================================================== */
  function act(label, type, arg, extra) { var a = { label: label, type: type, arg: arg }; if (extra) for (var k in extra) a[k] = extra[k]; return a; }
  var A = {
    project: function (label) { return act(label || 'Open project form', 'modal', 'project', { title: 'Discuss a project' }); },
    lead: function (label) { return act(label || 'Tell the team here', 'lead', ''); },
    wa: function () { return act('WhatsApp us', 'link', CONTACT.wa); },
    call: function () { return act('Call ' + CONTACT.phone, 'link', 'tel:' + CONTACT.tel); },
    mail: function () { return act('Email us', 'link', 'mailto:' + CONTACT.email); },
    go: function (id, label) { return act(label || 'Take me there', 'scroll', id); },
    catalogue: function () { return act('Email me the catalogue', 'modal', 'catalogue', { title: 'Full product catalogue' }); }
  };

  var INTENTS = [
    { id: 'greet', kw: ['hi', 'hello', 'hey', 'hii', 'hiya', 'namaste', 'namaskar', 'good morning', 'good afternoon', 'good evening', 'greetings', 'yo'],
      run: function () {
        return bot(pick(['Hey' + hi() + '! ', 'Hello' + hi() + '! ', 'Hi' + hi() + ' — good to see you. ']) + pick(['What are you working on?', 'What can I help you find?', 'Are you after a catalogue product or something custom?']),
          { suggest: ['What do you build?', 'Find a product', 'Discuss a project'] });
      } },
    { id: 'howareyou', kw: ['how are you', 'how r u', 'how are u', 'how is it going', 'hows it going', "what's up", 'whats up', 'wassup', 'how do you do'],
      run: function () { return bot(pick(['Running at a steady 3.3 V, thanks for asking. ', 'All green on the status LEDs here. ', 'Doing well — no magic smoke today. ']) + 'How can I help' + hi() + '?'); } },
    { id: 'identity', kw: ['are you a bot', 'are you human', 'are you ai', 'are you real', 'who are you', 'what are you', 'your name', 'chatgpt', 'robot', 'bot', 'chatbot', 'real person'],
      run: function () {
        return bot('I’m the **IABEX assistant** — an automated helper that runs right here in your browser. I know our products, services and office details, I can do quick electronics calculations, and I can pass your requirement straight to our engineers. For anything else, a real person is one tap away.',
          { actions: [A.wa(), A.call()], suggest: ['What can you do?', 'Talk to a person'] });
      } },
    { id: 'help', kw: ['help', 'what can you do', 'what do you know', 'commands', 'options', 'menu', 'how does this work', 'what can i ask'],
      run: function () {
        return bot('Here’s what I’m good at:\n· **Find products** by name, code (P-07) or need — “something to measure water quality”\n· **Explain what we do** — PCB, firmware, IoT, solar, automation, ODM\n· **Office hours, address and directions**, live in IST\n· **Electronics maths** — Ohm’s law, LED resistors, resistor colour codes\n· **Open roles** and how to apply\n· **Take your project requirement** and send it to our engineers',
          { suggest: ['Measure water quality', 'LED resistor for 12V', 'Is the office open?', 'Discuss a project'] });
      } },
    { id: 'about', kw: ['about iabex', 'about you', 'about your company', 'who is iabex', 'company', 'background', 'history', 'founded', 'how old', 'experience', 'years', 'iabex technologies'], weak: ['iabex', 'about', 'tell'],
      run: function () {
        ctx.topic = 'about';
        return bot('**IABEX Technologies** is a Pune-based embedded-electronics company with **15+ years** of product development. We design and manufacture under one roof — PCB design, firmware, prototypes, enclosures and production — for industrial, solar and process customers. Our motto says it: “It’s all about ElectroniX.”',
          { actions: [A.go('about', 'Read more')], suggest: ['What do you build?', 'Who are your clients?', 'Tell me about the award'] });
      },
      more: function () { return bot('We started by building our own embedded products and grew into a full design-and-build partner. The same team that draws the schematic writes the firmware, builds the prototype and runs production — so nothing gets lost between vendors.', { actions: [A.go('process', 'See how we work')] }); } },
    { id: 'services', kw: ['services', 'what do you do', 'what do you build', 'what do you make', 'what you do', 'offerings', 'solutions', 'capabilities', 'expertise', 'specialise', 'specialize', 'practice areas', 'service'], weak: ['offer', 'provide', 'do'],
      run: function () {
        ctx.topic = 'services';
        return bot('Four practice areas, one engineering team:\n· **IoT & connected devices** — remote monitoring, smart metering, sensor networks\n· **Solar & renewable** — street lighting, pump and off-grid electronics\n· **Industrial automation** — controls, instruments and special purpose machines\n· **ODM & white labelling** — your brand on our proven designs\nBehind all of it: PCB design, embedded firmware, prototyping, assembly and testing.',
          { actions: [A.go('capabilities', 'See capabilities')], suggest: ['IoT', 'Solar', 'Automation / SPM', 'White labelling'] });
      } },
    { id: 'iot', kw: ['iot', 'connected', 'internet of things', 'remote monitoring', 'wireless', 'gsm', 'wifi', 'wi-fi', 'bluetooth', 'lora', 'telemetry', 'smart metering', 'sensor network', 'cloud', '4g'],
      run: function () {
        ctx.topic = 'iot';
        return bot('**IoT & connected devices** — we build remote monitoring, smart metering and sensor-network hardware that keeps critical systems connected: the board, the firmware and the enclosure, designed for the environment it’ll live in.', { actions: [A.project('Discuss an IoT project')], suggest: ['Data loggers', 'Firmware stack?', 'How do you work?'] });
      } },
    { id: 'solar', kw: ['solar', 'renewable', 'photovoltaic', 'off-grid', 'off grid', 'green energy', 'pv'],
      run: function () {
        ctx.topic = 'solar';
        return bot('**Solar & renewable** is one of our core areas — street lighting, pump controllers and off-grid power electronics. Our solar work also powered **MillionSoUL**, the IIT Bombay study-lamp initiative recognised with the Prime Minister’s Award.', { actions: [act('Show solar products', 'filter', 'solar')], suggest: ['MPPT charge controller', 'Tell me about the award', 'Discuss a project'] });
      } },
    { id: 'automation', kw: ['automation', 'spm', 'special purpose machine', 'special purpose machines', 'plc', 'scada', 'industrial control', 'test station', 'test rig', 'jig', 'fixture', 'machine'],
      run: function () {
        ctx.topic = 'automation';
        return bot('**Industrial automation & SPM** — process controls, scientific instruments and special purpose machines: leak testers, temperature profile managers, data loggers and custom test stations that improve line efficiency.', { actions: [act('Show SPM products', 'filter', 'spm'), A.project('Discuss a machine')], suggest: ['Leak tester', 'Industries you serve'] });
      } },
    { id: 'odm', kw: ['odm', 'white label', 'white-label', 'whitelabel', 'white labelling', 'white labeling', 'private label', 'rebrand', 'oem', 'own brand', 'my brand', 'customise', 'customize', 'customised', 'customized', 'customisation'],
      run: function () {
        return bot('Yes — through our **ODM & white-labelling** service we customise branding, enclosure and firmware features on our proven designs, then manufacture them under your brand.' + (ctx.lastProducts && ctx.lastProducts.length ? ' That includes the ' + byCode(ctx.lastProducts[0]).name + ' you were looking at.' : ''),
          { actions: [A.project('Discuss white labelling')], suggest: ['Show all products', 'Minimum order?'] });
      } },
    { id: 'pcb', kw: ['pcb', 'layout', 'schematic', 'multilayer', 'board design', 'gerber', 'altium', 'kicad', 'layers', 'circuit design', 'hardware design'],
      run: function () { return bot('**PCB design** is done in-house — schematic capture and multilayer layout, designed alongside the firmware and enclosure so the board is right the first time.', { actions: [A.project()], suggest: ['Firmware?', 'Prototyping?', 'Assembly?'] }); } },
    { id: 'firmware', kw: ['firmware', 'embedded c', 'stm32', 'arm', 'microcontroller', 'mcu', 'programming', 'bootloader', 'rtos', 'arduino', 'esp32', 'pic', 'avr', 'embedded software', 'embedded'],
      run: function () { return bot('Our firmware is written in **Embedded C**, with deep experience on **STM32 and ARM** platforms, and industrial links like **RS485, Modbus and CAN**. The same team designs the hardware, so drivers and boards are tuned to each other.', { actions: [A.project()], suggest: ['PCB design', 'Are you hiring?'] }); } },
    { id: 'protocols', kw: ['modbus', 'rs485', 'rs-485', 'can bus', 'canbus', 'uart', 'i2c', 'spi', 'protocol', 'protocols', 'communication'],
      run: function () { return bot('We work with **RS485, Modbus, CAN**, serial/UART and the usual on-board buses. We also make interface hardware — USB to Serial, CAN to RS232 and USB to GPIO converters.', { products: ['P-04', 'P-05', 'P-06'], suggest: ['Firmware stack?', 'Discuss a project'] }); } },
    { id: 'assembly', kw: ['assembly', 'manufacturing', 'manufacture', 'production', 'smd', 'smt', 'tht', 'through-hole', 'through hole', 'soldering', 'mass production', 'contract manufacturing', 'ems', 'volume'],
      run: function () { return bot('We handle **THT and SMD assembly**, testing and enclosure integration at our Warje, Pune facility — from the first prototype batch through to volume production, backed by long-term repair support.', { actions: [A.go('facility', 'See the facility')], suggest: ['Facility photos', 'Quality checks?'] }); } },
    { id: 'prototype', kw: ['prototype', 'prototyping', 'poc', 'proof of concept', 'mvp', 'sample', 'samples'],
      run: function () { return bot('We build **working prototypes** and test them on the bench and in the field until they meet spec — before any money goes into tooling.', { actions: [A.project('Discuss a prototype')], suggest: ['How do you work?'] }); } },
    { id: 'quality', kw: ['testing', 'quality', 'qc', 'qa', 'inspection', 'burn-in', 'certification', 'certified', 'iso', 'rohs', 'compliance', 'standards', 'tested'],
      run: function () { return bot('**Every unit is functionally tested** at our facility before it ships. For certification and compliance documents for a specific product, our team will share them with your enquiry.', { actions: [A.go('quality', 'Quality section'), A.lead('Ask the team')] }); } },
    { id: 'support', kw: ['warranty', 'guarantee', 'repair', 'after sales', 'after-sales', 'maintenance', 'return', 'rma', 'broken', 'faulty', 'not working', 'defective', 'service centre', 'support'],
      run: function () { return bot('We provide **return and repair services** across the product’s life. For warranty terms on a specific product — or if a unit needs attention — the fastest route is our team directly.', { actions: [A.wa(), A.call(), A.lead('Describe the issue')] }); } },
    { id: 'nda', kw: ['nda', 'confidential', 'confidentiality', 'non disclosure', 'non-disclosure', 'intellectual property', 'ip ownership', 'secret', 'ownership'],
      run: function () { return bot('Confidentiality is a fair thing to settle first. Our team will confirm NDA and IP terms with you before any sensitive details are shared — just mention it in your first message.', { actions: [A.project('Start a confidential enquiry'), A.mail()] }); } },
    { id: 'pricing', kw: ['price', 'pricing', 'prices', 'cost', 'costs', 'quote', 'quotation', 'rate', 'rates', 'budget', 'how much', 'expensive', 'cheap', 'charges', 'fees', 'datasheet', 'spec', 'specs', 'specification', 'specifications', 'lead time', 'delivery time', 'moq', 'minimum order', 'stock', 'availability', 'in stock', 'discount'],
      run: function () {
        var p = ctx.lastProducts && ctx.lastProducts.length ? byCode(ctx.lastProducts[0]) : null;
        if (p) return bot('Pricing, the datasheet and lead time for the **' + p.name + '** depend on quantity and how you’ll use it, so a sales engineer sends them after a quick enquiry — usually with a recommendation for your application.', { actions: [act('Request ' + p.code + ' details', 'product', p.code)], suggest: ['Can it be customised?', 'Show similar products'] });
        return bot('We share **specifications, pricing and lead time after an enquiry** — they depend on quantity, configuration and your application, and we’d rather quote what actually fits. Tell me which product (or what you need) and I’ll set it up.', { actions: [A.catalogue()], suggest: ['Find a product', 'Discuss a project'] });
      } },
    { id: 'catalogue', kw: ['send catalogue', 'brochure', 'pdf', 'download catalogue', 'catalogue pdf', 'email catalogue', 'full catalogue', 'catalog pdf'],
      run: function () { return bot('I can have the **full product catalogue** emailed to you.', { actions: [A.catalogue()] }); } },
    { id: 'products', kw: ['products', 'product', 'catalogue', 'catalog', 'range', 'items', 'what do you sell', 'sell', 'buy', 'purchase', 'shop', 'order', 'find a product', 'show all products', 'all products'],
      run: function () {
        var counts = Object.keys(FAMILY).map(function (f) { return FAMILY[f] + ' (' + PRODUCTS.filter(function (p) { return p.family === f; }).length + ')'; });
        ctx.topic = 'products';
        return bot('We have **' + PRODUCTS.length + ' catalogue products** across ' + listOf(counts) + '. Tell me what it needs to do — “measure flow”, “solar street light”, or a code like P-08 — and I’ll find it.',
          { actions: [act('Browse the catalogue', 'filter', 'all'), A.catalogue()], suggest: Object.keys(FAMILY).map(function (f) { return FAMILY[f]; }) });
      } },
    { id: 'project', kw: ['custom', 'project', 'build', 'develop', 'development', 'design', 'idea', 'new product', 'requirement', 'bespoke', 'tailor made', 'from scratch', 'startup', 'power supply', 'smps', 'discuss a project', 'custom build', 'hire you', 'outsource'], weak: ['make', 'want', 'need'],
      run: function () {
        ctx.offer = 'lead'; ctx.offerText = '';
        return bot('Most of our work starts exactly like this — from a customer’s idea or specification. Two ways to start:\n· Use the **project form**, or\n· Tell me here in a sentence or two and I’ll pass it straight to our engineering team.\nShall I take it down here?',
          { actions: [A.project(), A.lead('Tell you here')], suggest: ['Yes, here', 'How do you work?', 'Do you sign NDAs?'] });
      } },
    { id: 'process', kw: ['process', 'how do you work', 'steps', 'workflow', 'approach', 'methodology', 'how it works', 'stages', 'timeline', 'how long'],
      run: function () {
        ctx.topic = 'process';
        return bot('Four steps, one accountable team:\n**1 · Requirement & concept** — we study the application, environment and cost target\n**2 · Design** — schematic, PCB, firmware, enclosure, all in-house\n**3 · Prototype & validate** — bench and field testing until it meets spec\n**4 · Produce & support** — assembly, testing, delivery and long-term repair',
          { actions: [A.go('process', 'See the process')], suggest: ['Discuss a project', 'Do you sign NDAs?'] });
      } },
    { id: 'industries', kw: ['industries', 'industry', 'sectors', 'sector', 'verticals', 'domains', 'markets', 'who do you serve', 'applications'],
      run: function () { return bot('We build for ' + listOf(INDUSTRIES.map(function (i) { return '**' + i.toLowerCase() + '**'; })) + ' — hardware that holds up on the plant floor, the street and in the field.', { actions: [A.go('industries', 'See industries')], suggest: ['Who are your clients?'] }); } },
    { id: 'clients', kw: ['clients', 'client', 'customers', 'who have you worked with', 'worked with', 'references', 'brands', 'companies', 'portfolio', 'trusted by', 'honeywell', 'intel', 'microchip', 'forbes marshall'],
      run: function () {
        ctx.topic = 'clients';
        var named = CLIENTS.slice(0, 8).map(function (c) { return '**' + c + '**'; });
        return bot('Engineering teams at ' + (CLIENTS.length > 8 ? named.join(', ') + ' and others' : listOf(named)) + ' have worked with us.', { suggest: ['What do they say?', 'Tell me about the award', 'Discuss a project'] });
      } },
    { id: 'testimonials', kw: ['testimonial', 'testimonials', 'review', 'reviews', 'feedback', 'what do they say', 'what people say', 'rating', 'recommendation'],
      run: function () {
        var q = QUOTES[ctx.quoteIdx = ((ctx.quoteIdx || 0) + 1) % (QUOTES.length || 1)];
        if (!q) return null;
        return bot('“' + q.text.replace(/^[“"]|[”"]$/g, '') + '”\n— **' + q.who + '**, ' + q.role, { actions: [A.go('testimonials', 'All testimonials')], suggest: QUOTES.length > 1 ? ['Another one'] : [] });
      } },
    { id: 'award', kw: ['award', 'prime minister', 'modi', 'millionsoul', 'million soul', 'iit bombay', 'recognition', 'recognised', 'achievement', 'study lamp', 'solar lamp', 'pm award'],
      run: function () { return bot('IABEX designed the concept electronics for **MillionSoUL** — an IIT Bombay initiative building low-cost solar study lamps for rural school children. The initiative was recognised with the **Prime Minister’s Award for Innovation**.', { actions: [A.go('recognition', 'See the photo')], suggest: ['Solar products', 'What do you build?'] }); } },
    { id: 'facility', kw: ['facility', 'factory', 'lab', 'laboratory', 'plant', 'workshop', 'infrastructure', 'equipment', 'campus', 'visit', 'tour', 'setup'],
      run: function () { return bot('Design, assembly and testing all happen at our **Warje, Pune** facility — electronics lab, assembly and stores bay, and office on one campus. You’re welcome to visit; just let us know ahead.', { actions: [A.go('facility', 'See photos'), act('Get directions', 'link', CONTACT.map)], suggest: ['Is the office open?'] }); } },
    { id: 'careers', kw: ['job', 'jobs', 'career', 'careers', 'hiring', 'vacancy', 'vacancies', 'openings', 'job openings', 'work with you', 'work for you', 'join', 'join you', 'apply', 'resume', 'cv', 'position', 'positions', 'recruitment', 'fresher', 'roles', 'employment'],
      run: function () {
        if (!ROLES.length) return bot('We’re not listing roles right now, but we always read general applications.', { actions: [act('Send a general application', 'modal', 'apply', { title: 'General application' })] });
        return bot('We’re hiring at **Warje, Pune** (full-time):\n' + ROLES.map(function (r) { return '· **' + r.title + '** — ' + r.open; }).join('\n') + '\nThe process: application → technical conversation → practical round.',
          { actions: ROLES.map(function (r) { return act('Apply: ' + r.title, 'modal', 'apply', { title: r.title }); }).concat([act('General application', 'modal', 'apply', { title: 'General application' })]) });
      } },
    { id: 'internship', kw: ['internship', 'internships', 'intern', 'trainee', 'training', 'final year', 'student project', 'apprentice'],
      run: function () { return bot('We don’t have a listed internship right now, but send a **general application** with what you’d like to work on — our team reads every one.', { actions: [act('General application', 'modal', 'apply', { title: 'General application' })] }); } },
    { id: 'hours', kw: ['hours', 'timing', 'timings', 'open', 'opening hours', 'closed', 'working hours', 'office hours', 'are you open', 'open now', 'open today', 'weekend', 'sunday', 'saturday', 'holiday', 'when can i call'],
      run: function () { var s = officeStatus(); return bot(s.line + '\nRegular hours: **' + CONTACT.hours + '**.', { actions: s.open ? [A.call(), A.wa()] : [A.lead('Leave a message'), A.wa()] }); } },
    { id: 'address', kw: ['address', 'location', 'located', 'where are you', 'where is', 'directions', 'map', 'how to reach', 'how to get', 'pune', 'warje', 'come to', 'office location'],
      run: function () { return bot('We’re at **' + CONTACT.address + '**.\n' + officeStatus().line, { actions: [act('Open in Google Maps', 'link', CONTACT.map), A.call()] }); } },
    { id: 'whatsapp', kw: ['whatsapp', 'whats app', 'wa'],
      run: function () { return bot('Sure — WhatsApp works well for quick questions and photos of a board or requirement.', { actions: [A.wa()] }); } },
    { id: 'contact', kw: ['contact', 'reach', 'email', 'mail', 'phone', 'call', 'number', 'talk to', 'speak', 'human', 'person', 'someone', 'representative', 'sales', 'agent', 'talk to a person', 'mobile'],
      run: function () {
        return bot('You can reach the team at:\n· Email **[' + CONTACT.email + '](mailto:' + CONTACT.email + ')**\n· Phone **[' + CONTACT.phone + '](tel:' + CONTACT.tel + ')**\n· ' + CONTACT.hours + '\n' + officeStatus().line,
          { actions: [A.wa(), A.call(), A.lead('Leave a message here')] });
      } },
    { id: 'leader', kw: ['ceo', 'founder', 'md', 'owner', 'director', 'prashant', 'leadership', 'who runs', 'management', 'team size', 'team'],
      run: function () { return bot('IABEX is led by **Prashant**, our MD & CEO — an electronics engineer known, in his former professor’s words, for keeping his commitments. The engineering team designs and builds everything in-house in Pune.', { suggest: ['Client reviews', 'Open roles'] }); } },
    { id: 'export', kw: ['export', 'international', 'shipping', 'ship', 'deliver', 'delivery', 'outside india', 'abroad', 'usa', 'europe', 'overseas', 'courier'],
      run: function () { return bot('Tell us your location and quantity with the enquiry and our team will confirm delivery options and lead time.', { actions: [A.lead('Ask about delivery')] }); } },
    { id: 'thanks', kw: ['thanks', 'thank you', 'thx', 'ty', 'thank', 'appreciate', 'great', 'awesome', 'cool', 'nice', 'perfect', 'helpful', 'super', 'brilliant'],
      run: function () { return bot(pick(['Any time' + hi() + '!', 'Glad that helped' + hi() + '.', 'Happy to help' + hi() + '.']) + ' Anything else?', { suggest: ['Discuss a project', 'Find a product', 'That’s all'] }); } },
    { id: 'bye', kw: ['bye', 'goodbye', 'good bye', 'see you', 'cya', "that's all", 'thats all', 'that is all', 'nothing else', 'no thanks', 'good night'],
      run: function () { return bot(pick(['Thanks for stopping by' + hi() + '. ', 'Take care' + hi() + '. ']) + 'If anything comes up, I’m right here — or reach us on ' + CONTACT.phone + '.'); } },
    { id: 'joke', kw: ['joke', 'jokes', 'funny', 'laugh', 'bored', 'make me laugh'],
      run: function () {
        return bot(pick([
          'Why did the capacitor break up with the resistor? It needed some space to charge.',
          'I told my PCB a joke. No reaction — it was a bit too grounded.',
          'Ohm’s law walks into a bar. The bartender says, “That’ll be V over R.” It pays the current price.',
          'An engineer’s favourite exercise? Running the extra mil — of trace clearance.',
          'There are 10 kinds of engineers: those who read binary and those who don’t.'
        ]), { suggest: ['Another one', 'What can you do?'] });
      } },
    { id: 'negative', kw: ['useless', 'stupid', 'dumb', 'worst', 'not helpful', 'rubbish', 'idiot', 'hate', 'terrible', 'waste', 'bad bot', 'you suck'],
      run: function () { return bot('Sorry — I’ve clearly missed what you need. Let me get you to a person who can help properly.', { actions: [A.wa(), A.call(), A.lead('Send your question to the team')] }); } }
  ];

  function scoreIntents(n, toks) {
    return INTENTS.map(function (it) {
      var s = 0;
      it.kw.forEach(function (k) {
        if (k.indexOf(' ') >= 0) { if ((' ' + n + ' ').indexOf(' ' + k + ' ') >= 0 || n.indexOf(k) >= 0 && k.length > 6) s += 3; }
        else if (k.length <= 3) { if (toks.indexOf(k) >= 0 || toks.indexOf(k + 's') >= 0) s += 2; }
        else s += wordHit(k, toks);
      });
      (it.weak || []).forEach(function (k) { if (toks.indexOf(k) >= 0) s += 0.8; });
      return { it: it, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
  }

  // Free-text search over the page's own copy
  var PDF = {}, PTOK = PASSAGES.map(function (p) {
    var set = {};
    tokens(norm(p.text)).forEach(function (t) { if (STOP.indexOf(t) < 0 && t.length > 2) set[stem(t)] = 1; });
    Object.keys(set).forEach(function (t) { PDF[t] = (PDF[t] || 0) + 1; });
    return set;
  });
  function searchPage(toks) {
    var q = toks.filter(function (t) { return STOP.indexOf(t) < 0 && t.length > 2; }).map(stem);
    if (!q.length) return null;
    var best = null, bestS = 0, bestHits = 0;
    PTOK.forEach(function (set, i) {
      var s = 0, hits = 0;
      q.forEach(function (t) { if (set[t]) { s += Math.log(1 + PASSAGES.length / PDF[t]); hits++; } });
      if (s > bestS) { bestS = s; best = i; bestHits = hits; }
    });
    if (best == null || bestHits < Math.min(2, q.length) || bestS < 2.2) return null;
    var p = PASSAGES[best], t = p.text.length > 260 ? p.text.slice(0, 250).replace(/\s\S*$/, '') + '…' : p.text;
    return bot('Here’s what our site says:\n“' + t + '”', { actions: [A.go(p.id, 'Show me on the page'), act('Ask the team instead', 'lead', toks.join(' '))] });
  }

  /* ==========================================================================
     In-chat enquiry
     ========================================================================== */
  function interestFor(s) {
    var n = norm(s);
    if (/solar|renewable|street ?light|lantern|mppt|battery/.test(n)) return 'Solar & renewable electronics';
    if (/iot|wireless|gsm|wifi|bluetooth|remote|cloud|lora|monitor/.test(n)) return 'IoT & connected devices';
    if (/automation|spm|machine|plc|test station|jig|leak/.test(n)) return 'Industrial automation / SPM';
    if (/odm|white ?label|brand|oem/.test(n)) return 'ODM & white labelling';
    if (/\bp-\d{2}\b|catalogue|catalog/.test(n)) return 'A catalogue product';
    return 'Custom product development';
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function startLead(prefill) {
    ctx.offer = null;
    ctx.flow = { step: 'need', data: { message: prefill || '' }, from: msgs.length };
    if (prefill) return leadNext(bot('Got it — I’ll pass that on.'));
    return bot('Tell me about it in a sentence or two — what should it do, where will it run, and roughly how many units?', { suggest: ['Cancel'] });
  }
  function leadNext(prefix) {
    var f = ctx.flow, d = f.data, out = prefix ? [prefix] : [];
    if (!d.message) { f.step = 'need'; out.push(bot('What’s the requirement?')); }
    else if (!d.name) { if (ctx.name) { d.name = ctx.name; return leadNext(prefix); } f.step = 'name'; out.push(bot('And your name?', { suggest: ['Cancel'] })); }
    else if (!d.email) { f.step = 'email'; out.push(bot('Thanks, ' + d.name.split(' ')[0] + '. Which **email** should our team reply to?', { suggest: ['Cancel'] })); }
    else if (d.phone == null) { f.step = 'phone'; out.push(bot('A **phone number** for a quick call? (optional)', { suggest: ['Skip', 'Cancel'] })); }
    else {
      f.step = 'confirm';
      out.push(bot('Here’s what I’ll send to the engineering team:\n**Name:** ' + d.name + (ctx.company ? '\n**Company:** ' + ctx.company : '') + '\n**Email:** ' + d.email + (d.phone ? '\n**Phone:** ' + d.phone : '') + '\n**Requirement:** ' + d.message + '\nShall I send it?', { suggest: ['Yes, send it', 'Change something', 'Cancel'] }));
    }
    return out;
  }
  function leadStep(raw, n) {
    var f = ctx.flow, d = f.data;
    if (/^(cancel|stop|quit|exit|never ?mind|forget it|abort)\b/.test(n)) { ctx.flow = null; return bot('No problem — cancelled. Anything else I can help with?', { suggest: ['Find a product', 'Contact details'] }); }
    if (f.step === 'need') { if (n.length < 4) return bot('Could you add a little more detail?'); d.message = raw.trim(); return leadNext(); }
    if (f.step === 'name') {
      var nm = raw.replace(/^(my name is|i am|i'm|im|this is|it's|its)\s+/i, '').replace(/[^\p{L}\s.'-]/gu, '').trim().slice(0, 60);
      if (nm.length < 2) return bot('Sorry, I didn’t catch your name.');
      d.name = nm.split(/\s+/).map(cap).join(' '); if (!ctx.name) ctx.name = d.name.split(' ')[0];
      return leadNext();
    }
    if (f.step === 'email') {
      var em = (raw.match(/[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}/) || [''])[0];
      if (!EMAIL_RE.test(em)) return bot('That doesn’t look like an email address — mind checking it?');
      d.email = em; return leadNext();
    }
    if (f.step === 'phone') {
      if (/^(skip|no|none|nope|na|n\/a|later|-)\b/.test(n)) { d.phone = ''; return leadNext(); }
      var digits = raw.replace(/[^\d+]/g, '');
      if (digits.replace(/\D/g, '').length < 7) return bot('That number looks short — try again, or say **skip**.', { suggest: ['Skip'] });
      d.phone = digits; return leadNext();
    }
    if (f.step === 'confirm') {
      if (/^(yes|y|yeah|yep|yup|sure|ok|okay|send|go|correct|confirm|do it|please)/.test(n)) return sendLead();
      if (/change|edit|wrong|fix|update/.test(n)) {
        if (/email|mail/.test(n)) { d.email = ''; } else if (/phone|number/.test(n)) { d.phone = null; } else if (/name/.test(n)) { d.name = ''; } else if (/requirement|message|details|project/.test(n)) { d.message = ''; }
        else return bot('What should I change — **name, email, phone** or **requirement**?', { suggest: ['Change email', 'Change requirement', 'Cancel'] });
        return leadNext(bot('Sure, let’s fix that.'));
      }
      return bot('Shall I send it? Say **yes** to send, **change email / phone / name / requirement** to edit, or **cancel**.', { suggest: ['Yes, send it', 'Cancel'] });
    }
  }
  function sendLead() {
    var d = ctx.flow.data, before = msgs.slice(0, ctx.flow.from);
    ctx.flow = null;
    var fd = new FormData();
    fd.append('type', 'enquiry'); fd.append('website', '');
    fd.append('name', d.name); fd.append('email', d.email); fd.append('phone', d.phone || '');
    fd.append('company', ctx.company || ''); fd.append('interest', interestFor(d.message));
    // Context for the sales team: what the visitor asked before starting the enquiry
    var history = before.filter(function (m) { return m.from === 'user'; }).slice(-10).map(function (m) { return '> ' + m.text; }).join('\n');
    fd.append('message', d.message + '\n\n-- Sent from the website chat assistant.' + (history ? '\nEarlier in the chat the visitor asked:\n' + history : ''));
    var submit = window.IABEX && window.IABEX.submit;
    return (submit ? submit(fd) : Promise.reject(new Error('')))
      .then(function (res) {
        if (!res.ok) throw new Error(res.message || '');
        return bot('**Sent.** Our engineering team has your requirement and will reply to ' + d.email + '. ' + officeStatus().line.replace('Messages sent now are picked up first thing.', 'We’ll pick it up first thing.'), { suggest: ['How do you work?', 'Thanks!'] });
      })
      .catch(function () {
        return bot('I couldn’t send that just now. Please email **[' + CONTACT.email + '](mailto:' + CONTACT.email + ')** or call **' + CONTACT.phone + '** — or try WhatsApp.', { actions: [A.wa(), A.mail()] });
      });
  }

  /* ==========================================================================
     Brain
     ========================================================================== */
  var NOT_NAMES = 'looking interested from a an the working trying not here fine good ok okay in searching just very so also new student engineer going doing having back sorry confused curious after with for at on wondering planning based building developing a manufacturer buyer'.split(' ');
  function bot(t, extra) { var m = { from: 'bot', text: t }; if (extra) for (var k in extra) m[k] = extra[k]; return m; }

  // Wraps the core so an introduction ("I'm Priya from Acme, do you make…") is acknowledged
  // in front of the actual answer.
  function think(raw) {
    ctx.intro = null;
    var out = thinkCore(raw);
    if (ctx.intro && out && !out.then) {
      var list = [].concat(out);
      if (list[0] && list[0].from === 'bot') list[0] = bot(ctx.intro + list[0].text, list[0]);
      out = list;
    }
    ctx.intro = null;
    return out;
  }
  function thinkCore(raw) {
    var n = norm(raw), toks = tokens(n), m;
    ctx.turns = (ctx.turns || 0) + 1;

    if (ctx.flow) return leadStep(raw, n);

    // Yes/no to a pending offer
    var offer = ctx.offer, offerText = ctx.offerText || '';
    ctx.offer = null; ctx.offerText = '';
    if (offer && /^(yes|y|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|here)\b/.test(n)) return startLead(offerText);
    if (offer && /^(no|nope|nah|not now|later)\b/.test(n)) return bot('No worries. What else can I help with?');

    // Name / company introductions
    m = raw.match(/\b(?:my name is|i am|i'm|im|this is|call me)\s+([A-Za-z][A-Za-z'.-]{1,20})(?:\s+([A-Za-z][A-Za-z'.-]{1,20}))?/i);
    var intro = null;
    if (m && NOT_NAMES.indexOf(m[1].toLowerCase()) < 0 && (/my name is|call me|this is/i.test(raw) || toks.length <= 4 || /^(hi|hello|hey)?[\s,!.]*(i am|i'm|im)\s/i.test(raw))) {
      ctx.name = cap(m[1].toLowerCase());
      intro = 'Nice to meet you, ' + ctx.name + '. ';
    }
    var cm = raw.replace(/’/g, "'").match(/\b(?:i'm from|i am from|we are from|we're from|from|i work at|i work for|calling from|representing)\s+([A-Z0-9][\w&.\-]*(?:\s+[A-Z0-9][\w&.\-]*){0,3})/);
    if (cm && intro !== null || cm && /i'm from|i am from|we are from|we're from|work at|work for|calling from|representing/i.test(raw)) {
      if (!/^(pune|mumbai|delhi|india|bangalore|bengaluru|chennai|hyderabad|nashik|nagpur)$/i.test(cm[1])) { ctx.company = cm[1]; intro = (intro || '') + 'Great to have someone from ' + ctx.company + ' here. '; }
    }
    if (intro && toks.length <= 7 && !/\?|product|price|have|make|need/.test(n)) return bot(intro + 'What are you working on?', { suggest: ['Discuss a project', 'Find a product', 'What do you build?'] });
    ctx.intro = intro;

    // Follow-ups using memory
    if (/^(tell me more|more|go on|and\??|elaborate|explain more|more details|details)$/.test(n)) {
      var last = INTENTS.filter(function (i) { return i.id === ctx.topic && i.more; })[0];
      if (last) return last.more(); if (ctx.lastProducts && ctx.lastProducts.length) return think('price');
    }
    if (/^(another( one)?|one more|again)$/.test(n) && ctx.lastIntent && /joke|testimonials/.test(ctx.lastIntent)) return run(ctx.lastIntent, n, toks);
    if (/show similar|similar products/.test(n) && ctx.lastProducts && ctx.lastProducts.length) return familyReply(byCode(ctx.lastProducts[0]).family);

    // Calculators
    var calc = calcColourFor(n) || calcColourCode(toks, n) || calcLED(toks, n) || calcOhm(n, toks) || calcMath(n);
    if (calc) { ctx.topic = 'calc'; return calc; }

    // Product code: P-07, p07, P 7
    m = n.match(/\bp\s?-?\s?(\d{1,2})\b/);
    if (m) { var p = byCode('P-' + ('0' + m[1]).slice(-2)); if (p) return productsReply([p]); return bot('There’s no product P-' + m[1] + ' — the catalogue runs P-01 to ' + PRODUCTS[PRODUCTS.length - 1].code + '.'); }

    var scores = scoreIntents(n, toks), top = scores[0];
    var fam = familyIn(toks), found = findProducts(toks);
    var productish = /\b(product|products|have|sell|make|buy|need|looking|want|show|find|any|offer|stock|recommend|suggest|something)\b/.test(n);

    // A family tab name typed or tapped as-is ("Solar LED lighting")
    var famExact = Object.keys(FAMILY).filter(function (f) { return norm(FAMILY[f]) === n; })[0];
    if (famExact) return familyReply(famExact);
    // A product plus a question about it: "price of the pH meter", "can the lantern be white-labelled"
    if (found.list.length && found.top >= 1.2 && top.s >= 2 && /^(pricing|odm|support|catalogue)$/.test(top.it.id)) {
      ctx.lastProducts = found.list.map(function (p) { return p.code; });
      return run(top.it.id, n, toks);
    }
    // A specific product beats its family: "do you have a pH meter?"
    if (found.list.length && found.top >= 2.5 && found.list.length <= 3 && !(top.s >= 3 && top.s > found.top + 1)) return productsReply(found.list);
    // "solar products", "process instruments"
    if (fam && (productish || /product|catalog|range/.test(n)) && !(top.it.id === 'pricing' && top.s >= 2)) return familyReply(fam);
    // A product by name/need, unless a clear intent outranks it
    if (found.list.length && (found.top >= 2.2 || (productish && found.top >= 1.2)) && !(top.s >= 3 && top.s > found.top + 1)) return productsReply(found.list);
    if (top.s >= 1.8) return run(top.it.id, n, toks);
    if (found.list.length && found.top >= 1) return productsReply(found.list);

    var hit = searchPage(toks);
    if (hit) return hit;

    // Didn't understand: offer close matches and a human
    ctx.offer = 'lead'; ctx.offerText = raw.trim();
    var near = scores.filter(function (s) { return s.s > 0; }).slice(0, 3).map(function (s) { return s.it; });
    return bot(pick(['I’m not certain I followed that one' + hi() + '.', 'Hmm, that one’s outside what I know' + hi() + '.']) + ' Want me to pass your question to our engineers? They’ll reply by email.',
      { actions: [act('Yes, ask the team', 'lead', raw.trim())], suggest: near.length ? near.map(function (i) { return SUGGEST_LABEL[i.id] || cap(i.kw[0]); }) : ['What can you do?', 'Contact details'] });
  }
  var SUGGEST_LABEL = { pricing: 'How does pricing work?', products: 'Find a product', services: 'What do you build?', careers: 'Open roles', hours: 'Is the office open?', contact: 'Contact details', project: 'Discuss a project', process: 'How do you work?', about: 'About IABEX' };

  function run(id, n, toks) {
    var it = INTENTS.filter(function (i) { return i.id === id; })[0];
    ctx.lastIntent = id;
    var out = it.run(ctx, n, toks);
    return out || bot('Let me get someone from the team on that.', { actions: [A.wa(), A.lead()] });
  }

  /* ==========================================================================
     UI
     ========================================================================== */
  var panel = $('[data-chat-panel]', root), log = $('[data-chat-log]', root), form = $('[data-chat-form]', root);
  var input = $('input', form), chipsEl = $('[data-chat-chips]', root), fab = $('[data-chat-toggle]', root), nudge = $('[data-chat-nudge]', root);
  var msgs = [], ctx = {}, queue = Promise.resolve();

  function save() { try { sessionStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-60), ctx: ctx })); } catch (e) {} }
  function load() { try { var s = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (s) { msgs = s.msgs || []; ctx = s.ctx || {}; } } catch (e) {} }
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function isPhone() { return window.matchMedia('(max-width: 640px)').matches; }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function renderExtras(m, wrap) {
    if (m.products && m.products.length) {
      var row = el('div', 'chat__products');
      m.products.map(byCode).filter(Boolean).forEach(function (p) {
        var b = el('button', 'chat__product');
        b.type = 'button';
        b.innerHTML = '<span class="chat__product-img"><img src="' + esc(p.img) + '" alt="" loading="lazy"></span><span class="chat__product-code">' + esc(p.code) + '</span><span class="chat__product-name">' + esc(p.name) + '</span>';
        b.addEventListener('click', function () { doAction(act('', 'product', p.code)); });
        $('img', b).addEventListener('load', scrollDown);
        row.appendChild(b);
      });
      wrap.appendChild(row);
    }
    if (m.actions && m.actions.length) {
      var acts = el('div', 'chat__actions');
      m.actions.forEach(function (a) {
        var b;
        if (a.type === 'link') {
          b = el('a', 'chat__act', esc(a.label)); b.href = a.arg;
          if (/^https?:/.test(a.arg)) { b.target = '_blank'; b.rel = 'noopener'; }
        } else {
          b = el('button', 'chat__act', esc(a.label)); b.type = 'button';
          b.addEventListener('click', function () { doAction(a); });
        }
        acts.appendChild(b);
      });
      wrap.appendChild(acts);
    }
  }
  function renderMsg(m) {
    var row = el('div', 'chat__row chat__row--' + m.from);
    var bubble = el('div', 'chat__msg chat__msg--' + m.from, m.from === 'bot' ? fmt(m.text) : esc(m.text));
    row.appendChild(bubble);
    if (m.from === 'bot') renderExtras(m, row);
    log.appendChild(row);
    return { row: row, bubble: bubble };
  }
  function setChips(list) {
    chipsEl.innerHTML = '';
    (list || []).slice(0, 4).forEach(function (s) {
      var b = el('button', 'chat__chip', esc(s)); b.type = 'button';
      b.addEventListener('click', function () { send(s); });
      chipsEl.appendChild(b);
    });
    chipsEl.hidden = !chipsEl.children.length;
    scrollDown(); // chips change the log's height
  }
  function typeOut(bubble) { // reveal the already-built bubble text progressively
    var nodes = [], walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT), t;
    while ((t = walker.nextNode())) { nodes.push({ node: t, full: t.nodeValue }); t.nodeValue = ''; }
    var total = nodes.reduce(function (a, b) { return a + b.full.length; }, 0), step = Math.max(2, Math.ceil(total / 45)), i = 0, shown = 0;
    return new Promise(function (resolve) {
      (function tick() {
        var budget = step;
        while (budget > 0 && i < nodes.length) {
          var nd = nodes[i], have = nd.node.nodeValue.length, take = Math.min(budget, nd.full.length - have);
          nd.node.nodeValue = nd.full.slice(0, have + take); budget -= take; shown += take;
          if (nd.node.nodeValue.length >= nd.full.length) i++;
        }
        scrollDown();
        if (i < nodes.length) setTimeout(tick, 16); else resolve();
      })();
    });
  }
  function botSay(m) {
    return new Promise(function (resolve) {
      var typing = el('div', 'chat__row chat__row--bot', '<div class="chat__msg chat__msg--bot chat__typing" aria-label="Assistant is typing"><i></i><i></i><i></i></div>');
      log.appendChild(typing); scrollDown();
      var delay = reduceMotion ? 0 : Math.min(350 + m.text.length * 6, 1300);
      setTimeout(function () {
        typing.remove();
        msgs.push(m); save();
        var r = renderMsg(m);
        var extras = $$('.chat__products, .chat__actions', r.row);
        if (reduceMotion) { scrollDown(); resolve(); return; }
        extras.forEach(function (x) { x.style.visibility = 'hidden'; });
        typeOut(r.bubble).then(function () { extras.forEach(function (x) { x.style.visibility = ''; }); scrollDown(); resolve(); });
      }, delay);
    });
  }
  function respond(out) {
    return Promise.resolve(out).then(function (res) {
      var list = [].concat(res || []).filter(Boolean);
      var chain = Promise.resolve();
      list.forEach(function (m) { chain = chain.then(function () { return botSay(m); }); });
      return chain.then(function () { var last = list[list.length - 1]; setChips(last && last.suggest); });
    });
  }
  function send(textIn) {
    var t = String(textIn || '').trim();
    if (!t) return;
    var m = { from: 'user', text: t.slice(0, 1000) };
    msgs.push(m); save(); renderMsg(m); scrollDown(); setChips([]);
    queue = queue.then(function () {
      var out;
      try { out = think(m.text); } catch (e) { out = bot('Something tripped a fuse on my side. Try rephrasing — or reach the team directly.', { actions: [A.wa(), A.call()] }); }
      return respond(out);
    }).then(save);
  }
  function doAction(a) {
    var IABEX = window.IABEX || {};
    if (a.type === 'lead') { respond(startLead(a.arg)); return; }
    if (a.type === 'say') { send(a.arg); return; }
    if (a.type === 'product') { var p = byCode(a.arg); if (p && IABEX.openModal) { if (isPhone()) setOpen(false); IABEX.openModal('product', { title: p.name, code: p.code }); } return; }
    if (a.type === 'modal' && IABEX.openModal) { if (isPhone()) setOpen(false); IABEX.openModal(a.arg, { title: a.title || '' }); return; }
    if (a.type === 'filter') {
      if (IABEX.filterProducts) IABEX.filterProducts(a.arg);
      a = { type: 'scroll', arg: 'products' };
    }
    if (a.type === 'scroll') {
      var target = document.getElementById(a.arg);
      if (target) { if (isPhone()) setOpen(false); target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
    }
  }

  function greeting() {
    var h = new Date().getHours(), part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var where = {
      products: 'I see you’re in the catalogue — tell me what the product needs to do and I’ll find it, or ask for a code like P-08.',
      capabilities: 'You’re looking at what we build — ask me about any practice area, or describe your project.',
      careers: 'Thinking about joining us? I can walk you through the open roles.',
      facility: 'Want to visit? I can give you directions and tell you if we’re open right now.',
      contact: 'I can take your requirement right here and send it to our engineers.',
      process: 'Curious how a project runs with us? Ask away.'
    }[ctx.section] || 'I can find products, explain what we build, check if the office is open, do quick electronics maths, or pass your requirement to our engineers.';
    return [bot(part + '! I’m the **IABEX assistant**. ' + where, { suggest: ['What do you build?', 'Find a product', 'Discuss a project', 'Is the office open?'] })];
  }

  function setOpen(open) {
    panel.hidden = !open;
    root.classList.toggle('is-open', open);
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? 'Close chat' : 'Chat with IABEX');
    $('use', fab).setAttribute('href', open ? '#i-close' : '#i-chat');
    document.body.classList.toggle('chat-open', open && isPhone());
    if (open) {
      hideNudge(); try { sessionStorage.setItem(STORE + '-seen', '1'); } catch (e) {}
      if (!log.children.length) {
        if (msgs.length) { msgs.forEach(renderMsg); var last = msgs[msgs.length - 1]; setChips(last.from === 'bot' ? last.suggest : []); }
        else respond(greeting());
      }
      setTimeout(function () { scrollDown(); if (!isPhone() || !msgs.length) input.focus(); }, 30);
    } else if (document.activeElement && root.contains(document.activeElement)) fab.focus();
  }

  fab.addEventListener('click', function () { setOpen(panel.hidden); });
  $$('[data-chat-close]', root).forEach(function (b) { b.addEventListener('click', function () { setOpen(false); }); });
  $$('[data-chat-reset]', root).forEach(function (b) {
    b.addEventListener('click', function () {
      msgs = []; ctx = { section: ctx.section }; log.innerHTML = ''; save();
      respond(greeting()); input.focus();
    });
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); var v = input.value; input.value = ''; send(v); });
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
  $$('[data-open-chat]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); setOpen(true); }); });

  // Which section is the visitor reading? Used for a context-aware greeting and nudge.
  if ('IntersectionObserver' in window) {
    var secObs = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) ctx.section = x.target.id; }); }, { rootMargin: '-40% 0px -55% 0px' });
    $$('main section[id]').forEach(function (s) { secObs.observe(s); });
  }

  // One gentle nudge per session, after the visitor has spent a little time on the page
  function hideNudge() { if (nudge) nudge.hidden = true; root.classList.remove('has-nudge'); }
  function showNudge() {
    if (!nudge || !panel.hidden || document.querySelector('dialog[open]')) return;
    var line = {
      products: 'Looking for a specific product? I can find it by what it needs to do.',
      careers: 'Want a quick rundown of the open roles?',
      capabilities: 'Have a project in mind? I can pass it to our engineers.',
      facility: 'Planning a visit? I can tell you if we’re open right now.',
      contact: 'Prefer to chat? I can take your requirement here.'
    }[ctx.section] || 'Questions about a product or project? Ask me.';
    $('[data-chat-nudge-text]', nudge).textContent = line;
    nudge.hidden = false; root.classList.add('has-nudge');
  }
  if (nudge) {
    $('[data-chat-nudge-open]', nudge).addEventListener('click', function () { setOpen(true); });
    $('[data-chat-nudge-close]', nudge).addEventListener('click', function () { hideNudge(); try { sessionStorage.setItem(STORE + '-seen', '1'); } catch (e) {} });
    var seen = false; try { seen = !!sessionStorage.getItem(STORE + '-seen'); } catch (e) {}
    if (!seen) setTimeout(showNudge, 20000);
  }

  load();
})();
