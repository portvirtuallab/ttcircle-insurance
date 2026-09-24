/* The TTCircle claims adjustment engine.
   A pure function: same policy, same declaration, same settlement, always.

   Three questions decide a cargo claim, in this order:
     1. Is the cause within the cover that was purchased?
     2. What proportion of the consignment was lost?
     3. Does what is left exceed the deductible?

   Everything it reads — the coverage matrix, the deductibles, the exclusion
   wording — lives in docs/data/config.json, so a trainer can change the rules
   without touching this file. */

(function (global) {
  'use strict';

  var round2 = function (n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  };

  /* The quotation writes "ICC(A)"; the config keys are "ICC_A". One spelling
     in, one spelling out — the mapping stays here rather than in every caller. */
  function normaliseLevel(level) {
    if (!level) return '';
    var clean = String(level).toUpperCase().replace(/[()\s-]/g, '_').replace(/_+/g, '_');
    var match = clean.match(/ICC_?([ABC])/);
    return match ? 'ICC_' + match[1] : '';
  }

  function levelLabel(level) {
    var key = normaliseLevel(level);
    return key ? 'ICC (' + key.slice(-1) + ')' : String(level || '—');
  }

  function parseExtensions(extensions) {
    if (Array.isArray(extensions)) return extensions.filter(Boolean);
    if (typeof extensions === 'string') {
      if (!extensions || extensions === 'None') return [];
      return extensions.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return [];
  }

  function deductibleFor(cfg, level) {
    var entry = cfg.deductibles && cfg.deductibles[level];
    return entry || { pct: 0, min: 0 };
  }

  function isCovered(cfg, cause, level) {
    var row = cfg.coverageMatrix && cfg.coverageMatrix[cause];
    return Boolean(row && row[level]);
  }

  /* Which extension, if any, brings an otherwise excluded peril back in. */
  function extensionOpening(cfg, cause, extensions) {
    var map = cfg.extensionCoverage || {};
    for (var i = 0; i < extensions.length; i += 1) {
      var perils = map[extensions[i]] || [];
      if (perils.indexOf(cause) !== -1) return extensions[i];
    }
    return null;
  }

  /* Would a wider cover have answered? This is the sentence that teaches most,
     so it is computed even when the claim fails. */
  function widerLevelThatWouldPay(cfg, cause, level, insuredValue, proportion) {
    var order = ['ICC_C', 'ICC_B', 'ICC_A'];
    var from = order.indexOf(level);
    if (from === -1) return null;

    for (var i = from + 1; i < order.length; i += 1) {
      if (!isCovered(cfg, cause, order[i])) continue;
      var ded = deductibleFor(cfg, order[i]);
      var gross = insuredValue * proportion;
      var settlement = Math.max(gross - Math.max(insuredValue * ded.pct, ded.min), 0);
      if (settlement > 0) {
        return { level: order[i], label: levelLabel(order[i]), settlement: round2(settlement) };
      }
    }
    return null;
  }

  /**
   * policy: { insuredValue, iccLevel, extensions }
   * input:  { causeOfLoss, totalPieces, damagedPieces }
   */
  function adjustClaim(policy, input, cfg) {
    var level = normaliseLevel(policy.iccLevel);
    var cause = input.causeOfLoss;
    var extensions = parseExtensions(policy.extensions);

    var insuredValue = Number(policy.insuredValue) || 0;
    var total = Number(input.totalPieces) || 0;
    var damaged = Number(input.damagedPieces) || 0;
    var proportion = total > 0 ? damaged / total : 0;
    var gross = insuredValue * proportion;

    var covered = isCovered(cfg, cause, level);
    var openedByExtension = null;

    if (!covered) {
      openedByExtension = extensionOpening(cfg, cause, extensions);
      if (openedByExtension) covered = true;
    }

    var base = {
      cause: cause,
      causeLabel: (cfg.causes && cfg.causes[cause] && cfg.causes[cause].label) || cause,
      level: level,
      levelLabel: levelLabel(level),
      extensions: extensions,
      insuredValue: round2(insuredValue),
      totalPieces: total,
      damagedPieces: damaged,
      proportion: proportion,
      gross: round2(gross)
    };

    if (!covered) {
      var texts = cfg.exclusionText || {};
      /* An absolute exclusion is a different lesson from "you bought too little
         cover", so the two never share wording. */
      var absolute = texts[cause];
      var reason = absolute
        || (extensionOpening(cfg, cause, ['ISRCC', 'IWC', 'Extraordinary Risks'])
              ? texts.needs_extension
              : texts.not_covered_at_level);

      return Object.assign(base, {
        covered: false,
        openedByExtension: null,
        deductible: 0,
        settlement: 0,
        reason: reason,
        wouldPayUnder: absolute ? null : widerLevelThatWouldPay(cfg, cause, level, insuredValue, proportion)
      });
    }

    var ded = deductibleFor(cfg, level);
    var deductible = Math.max(insuredValue * ded.pct, ded.min);
    var settlement = Math.max(gross - deductible, 0);

    return Object.assign(base, {
      covered: true,
      openedByExtension: openedByExtension,
      deductiblePct: ded.pct,
      deductibleMin: ded.min,
      deductible: round2(deductible),
      settlement: round2(settlement),
      reason: settlement === 0 ? (cfg.exclusionText || {}).below_deductible : null,
      wouldPayUnder: null
    });
  }

  global.TTCAdjust = {
    adjustClaim: adjustClaim,
    normaliseLevel: normaliseLevel,
    levelLabel: levelLabel,
    parseExtensions: parseExtensions,
    round2: round2
  };
})(window);
