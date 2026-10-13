/* The TTCircle premium engine.
   A faithful port of calculateInsurancePremium() from the Apps Script backend,
   so the quotation page can show a live estimate while the student fills the form.
   The backend stays the source of truth — this is the shop window. */

(function (global) {
  'use strict';

  /* El riesgo pais vive en data/countries.json, que leen las dos etapas. Antes
     habia tres listas -- aqui, en tariffs.json y en el backend -- y no decian lo
     mismo: Marruecos era alto riesgo para la prima y banda B para la puntuacion.

     Se toma el PEOR de los dos extremos, no la media. La etapa uno promedia,
     porque pregunta que clase de envio es; aqui se tarifa, y una tarifa se pone
     sobre la exposicion mayor. */
  function regionFactor(t, origin, destination) {
    var table = t.countryRisk;
    if (!table || !table.countries || !table.bands) return 1.0;

    function factorFor(name) {
      var band = table.countries[name];
      var entry = band ? table.bands[band] : null;
      return entry && entry.factor != null ? entry.factor : 1.0;
    }

    return Math.max(factorFor(origin), factorFor(destination));
  }

  function calculate(tariffs, data) {
    var exw = parseFloat(data.exwPrice) || 0;
    var freight = parseFloat(data.freightPrice) || 0;
    var cifValue = exw + freight;

    /* Trade practice: the cover is written on CIF + 10%, and the premium is
       rated on that insured value — not on the invoice value. */
    var upliftPct = tariffs.insuredValueUpliftPct != null ? tariffs.insuredValueUpliftPct : 0;
    var uplift = cifValue * (upliftPct / 100);
    var totalValue = cifValue + uplift;

    var icc = data.iccCoverage || 'ICC(C)';
    var rates = tariffs.iccBaseRates[icc];
    var baseRate = (rates && rates[data.transportType]) || tariffs.defaultBaseRate;

    var region = regionFactor(tariffs, data.origin, data.destination);
    var cargo = tariffs.cargoRiskFactors[data.cargoType] || 1.0;
    var incoterm = tariffs.incotermFactors[data.incoterm] || 1.0;

    var firstPacking = data.packagingTypes ? String(data.packagingTypes).split(', ')[0] : 'Wooden Crate';
    var packing = tariffs.packagingRiskFactors[firstPacking] || 1.0;
    var condition = tariffs.conditionRiskFactors[data.cargoCondition] || 1.0;

    /* La tasa efectiva: todo lo que multiplica, en tanto por uno sobre el valor
       asegurado. Se arma antes de aplicarla porque hace falta entera para
       despejar el valor asegurado mas abajo. */
    var rate = (baseRate / 100) * region * cargo * packing * condition * incoterm;

    var extras = data.additionalCoverage ? String(data.additionalCoverage).split(', ').filter(Boolean) : [];
    extras.forEach(function (name) {
      var factor = tariffs.additionalCoverageFactors[name];
      if (factor) rate *= factor;
    });

    /* Incoterms 2020, CIF A5 y CIP A5: la cobertura minima es el precio del
       contrato mas un 10%, y ese 100% es coste + SEGURO + flete. O sea que la
       prima esta dentro de la suma que asegura, y el calculo es circular:

           asegurado = (C+F + prima) x 1,10        prima = tasa x asegurado

       Despejando:  asegurado = 1,10 x (C+F) / (1 - 1,10 x tasa)

       Sin este paso la prima sale un 0,4% corta y la mercancia queda
       infrasegurada por el importe de su propia prima. Senalado por Agueda
       Capafons en octubre de 2026. */
    var u = 1 + upliftPct / 100;
    var grossUp = 1 - u * rate;
    if (grossUp <= 0) grossUp = 1;             /* tasa absurda: no dividir por cero */

    totalValue = (u * cifValue) / grossUp;
    uplift = totalValue - cifValue;

    var premium = rate * totalValue;

    var minimum = tariffs.minimumPremium[data.currency] != null
      ? tariffs.minimumPremium[data.currency]
      : tariffs.minimumPremium.EUR;

    var minimumApplied = premium < minimum;
    premium = Math.max(premium, minimum);

    return {
      amount: Number(premium.toFixed(2)),
      rate: totalValue > 0 ? Number(((premium / totalValue) * 100).toFixed(3)) : 0,
      cifValue: cifValue,
      uplift: Number((totalValue - cifValue - premium).toFixed(2)),
      upliftPct: upliftPct,
      totalValue: totalValue,
      /* Incoterms 2020 llama 100% al precio del contrato, que es coste +
         SEGURO + flete. Devolverlo entero deja que la pantalla ensene la suma
         tal y como la define la norma, sin que las filas se solapen. */
      contractPrice: Number((cifValue + premium).toFixed(2)),
      simpleInsuredValue: Number((u * cifValue).toFixed(2)),
      effectiveRate: Number((rate * 100).toFixed(4)),
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
    /* El umbral sale de la propia tabla de bandas: la banda mas alta que
       exista. Antes se leia de regionRiskFactors, que ya no existe. */
    var worstBand = tariffs.countryRisk && tariffs.countryRisk.bands ? tariffs.countryRisk.bands.D : null;
    if (worstBand && result.regionRiskFactor >= worstBand.factor) {
      notes.push('This route crosses a high-risk region. ISRCC and IWC extensions are worth their cost here.');
    }
    if (result.minimumApplied) {
      notes.push('The minimum premium applies: the calculated figure came out below it.');
    }

    return notes;
  }

  global.TTCPremium = { calculate: calculate, advise: advise };
})(window);
