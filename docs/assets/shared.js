/* Shared chrome and helpers for the TTCircle insurance simulator.
   Every stage page calls TTC.renderChrome() so the header, the stage strip
   and the footer stay identical across the five modules. */

(function (global) {
  'use strict';

  var STAGES = [
    { id: 'risk', href: 'risk-assessment.html', label: '1 · Risk assessment' },
    { id: 'quotation', href: 'quotation.html', label: '2 · Request your quotation' },
    { id: 'payment', href: 'payment.html', label: '3 · Report your payment' },
    { id: 'cargo', href: 'cargo-report.html', label: '4 · Cargo manage report' },
    { id: 'claims', href: 'claims.html', label: '5 · Insurance claims' }
  ];

  var CASE_KEY = 'ttc.caseFile.v1';

  function el(id) { return document.getElementById(id); }

  function renderChrome(current) {
    var header = el('site-header');
    if (header) {
      header.className = 'site-header';
      header.innerHTML =
        '<a class="brand" href="index.html" aria-label="TTCircle insurance simulator home">' +
          '<img class="brand-logo" src="assets/pvl-logo.svg" alt="PVL.ONE - Port Virtual Lab">' +
          '<span class="brand-divider" aria-hidden="true"></span>' +
          '<img class="school-logo" src="assets/school-logo.png" alt="Escola Europea - Intermodal Transport">' +
        '</a>' +
        '<nav class="top-nav" aria-label="Primary navigation">' +
          '<a href="index.html">Overview</a>' +
          '<a href="glossary.html">Field guide</a>' +
          '<a class="nav-pill" href="https://www.pvl.one" target="_blank" rel="noreferrer">Open PVL.ONE</a>' +
        '</nav>';
    }

    var strip = el('stage-strip');
    if (strip) {
      strip.className = 'stage-strip';
      strip.setAttribute('aria-label', 'Stages of the coverage');
      strip.innerHTML = STAGES.map(function (s) {
        var current_ = s.id === current ? ' aria-current="page"' : '';
        return '<a href="' + s.href + '"' + current_ + '>' + s.label + '</a>';
      }).join('');
    }

    var footer = el('site-footer');
    if (footer) {
      footer.innerHTML =
        '<div class="footer-logos">' +
          '<img src="assets/pvl-logo.svg" alt="PVL.ONE">' +
          '<img src="assets/school-logo.png" alt="Escola Europea - Intermodal Transport">' +
        '</div>' +
        '<span>Training simulator. Figures are illustrative and do not constitute an insurance offer.</span>';
    }
  }

  /* ---------- the case file: what one stage hands to the next ---------- */

  function readCase() {
    try {
      return JSON.parse(global.localStorage.getItem(CASE_KEY) || '{}');
    } catch (err) {
      return {};
    }
  }

  function writeCase(patch) {
    var next = readCase();
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    try {
      global.localStorage.setItem(CASE_KEY, JSON.stringify(next));
    } catch (err) {
      /* private browsing or blocked storage — the page still works, it just forgets. */
    }
    return next;
  }

  function clearCase() {
    try { global.localStorage.removeItem(CASE_KEY); } catch (err) { /* ignore */ }
  }

  /* ---------- small helpers ---------- */

  function money(value, currency) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 2
    });
  }

  function today() {
    return new Date().toISOString().split('T')[0];
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + url + ' (' + r.status + ')');
      return r.json();
    });
  }

  /* Collapsible sections used by the info panels. */
  function bindAccordions(root) {
    (root || document).querySelectorAll('.accordion-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var open = head.getAttribute('aria-expanded') === 'true';
        var body = head.nextElementSibling;
        head.setAttribute('aria-expanded', String(!open));
        body.style.maxHeight = open ? '0px' : body.scrollHeight + 'px';
      });
      /* Open the ones marked as expanded in the markup. */
      if (head.getAttribute('aria-expanded') === 'true') {
        var body = head.nextElementSibling;
        body.style.maxHeight = body.scrollHeight + 'px';
      }
    });
  }

  global.TTC = {
    STAGES: STAGES,
    renderChrome: renderChrome,
    readCase: readCase,
    writeCase: writeCase,
    clearCase: clearCase,
    money: money,
    today: today,
    getJSON: getJSON,
    bindAccordions: bindAccordions
  };
})(window);
