/* The TTCircle premium engine.
   A faithful port of calculateInsurancePremium() from the Apps Script backend,
   so the quotation page can show a live estimate while the student fills the form.
   The backend stays the source of truth — this is the shop window. */

(function (global) {
  'use strict';

  function regionFactor(t, origin, destination) {
    if (t.highRiskCountries.indexOf(origin) !== -1 || t.highRiskCountries.indexOf(destination) !== -1) {
      return t.regionRiskFactors.high;
    }
    if (t.mediumRiskCountries.indexOf(origin) !== -1 || t.mediumRiskCountries.indexOf(destination) !== -1) {
      return t.regionRiskFactors.medium;
    }
    return t.regionRiskFactors.low;
  }

  function calculate(tariffs, data) {
    var exw = parseFloat(data.exwPrice) || 0;
    var freight = parseFloat(data.freightPrice) || 0;
    var totalValue = exw + freight;

    var icc = data.iccCoverage || 'ICC(C)';
    var rates = tariffs.iccBaseRates[icc];
    var baseRate = (rates && rates[data.transportType]) || tariffs.defaultBaseRate;

    var region = regionFactor(tariffs, data.origin, data.destination);
    var cargo = tariffs.cargoRiskFactors[data.cargoType] || 1.0;
    var incoterm = tariffs.incotermFactors[data.incoterm] || 1.0;

    var firstPacking = data.packagingTypes ? String(data.packagingTypes).split(', ')[0] : 'Wooden Crate';
    var packing = tariffs.packagingRiskFactors[firstPacking] || 1.0;
    var condition = tariffs.conditionRiskFactors[data.cargoCondition] || 1.0;

    var premium = totalValue * (baseRate / 100) * region * cargo * packing * condition * incoterm;

    var extras = data.additionalCoverage ? String(data.additionalCoverage).split(', ').filter(Boolean) : [];
    extras.forEach(function (name) {
      var factor = tariffs.additionalCoverageFactors[name];
      if (factor) premium *= factor;
    });

    var minimum = tariffs.minimumPremium[data.currency] != null
      ? tariffs.minimumPremium[data.currency]
      : tariffs.minimumPremium.EUR;

    var minimumApplied = premium < minimum;
    premium = Math.max(premium, minimum);

    return {
      amount: Number(premium.toFixed(2)),
      rate: totalValue > 0 ? Number(((premium / totalValue) * 100).toFixed(3)) : 0,
      totalValue: totalValue,
      baseRate: baseRate,
      iccCoverage: icc,
      incoterm: data.incoterm,
      incotermFactor: incoterm,
      regionRiskFactor: region,
      cargoRiskFactor: cargo,
      packagingRiskFactor: packing,
      conditionRiskFactor: condition,
      extras: extras,
      minimumApplied: minimumApplied,
      currency: data.currency || 'EUR'
    };
  }

  /* The advice TTCircle offers alongside the number. */
  function advise(tariffs, data, result) {
    var notes = [];

    if (data.iccCoverage === 'ICC(C)') {
      notes.push('ICC(C) leaves theft, handling damage and water ingress uncovered. Consider ICC(B) or ICC(A).');
    } else if (data.iccCoverage === 'ICC(B)') {
      notes.push('ICC(B) is solid cover. Move to ICC(A) if the cargo is high value, fragile or attractive to thieves.');
    }

    if (['EXW', 'FCA'].indexOf(data.incoterm) !== -1) {
      notes.push(data.incoterm + ' places the maximum risk on the buyer. Negotiating a C- or D-term shifts part of it back to the seller.');
    } else if (['DDP', 'DPU', 'DAP'].indexOf(data.incoterm) !== -1) {
      notes.push(data.incoterm + ' leaves most of the transport risk with the seller, which reduces what you need to insure.');
    }

    if (result.packagingRiskFactor > 1.2) {
      notes.push('Your packing choice adds ' + Math.round((result.packagingRiskFactor - 1) * 100) + '% to the premium. Wooden crates or metal drums would cost less.');
    }
    if (result.conditionRiskFactor > 1.1) {
      notes.push('Used goods carry a higher risk factor. Document the condition before departure — it matters at claim time.');
    }
    if (result.regionRiskFactor >= tariffs.regionRiskFactors.high) {
      notes.push('This route crosses a high-risk region. ISRCC and IWC extensions are worth their cost here.');
    }
    if (result.minimumApplied) {
      notes.push('The minimum premium applies: the calculated figure came out below it.');
    }

    return notes;
  }

  global.TTCPremium = { calculate: calculate, advise: advise };
})(window);
