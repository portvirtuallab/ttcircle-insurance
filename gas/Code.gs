/**
 * TT CIRCLE Insurance — quotation backend.
 *
 * Deployed as a web app (Execute as: Me · Who has access: Anyone) and called
 * from docs/quotation.html with fetch. doGet() is a leftover from when Apps
 * Script served the form itself; the form now lives on GitHub Pages.
 *
 * If you change a factor in calculateInsurancePremium(), mirror it in
 * docs/data/tariffs.json or the on-screen estimate and the emailed quotation
 * will disagree.
 */

// CONFIGURACIÓN
const CONFIG = {
  SHEET_ID: '1IKA_Yu9eeAx3PhA89gtbT6SfYtk-pz3KJ0JbWHn5oMY',
  SHEET_NAME: 'Sheet1',
  DEG_INFO_URL: 'https://sites.google.com/playpcs.com/playttcircle/insurance-dashboard/services-quotation/quotation/sdr'
};

// =====================================================
// FUNCIONES PRINCIPALES
// =====================================================

// El formulario vive en GitHub Pages. Este script solo lo atiende por POST.
// Antes doGet servía una copia del formulario guardada aquí dentro; esa copia
// se quedó congelada con la regla vieja de CIF y sin Emiratos ni reefer, así
// que cualquiera que abriera esta URL aprendía lo contrario de lo correcto.
// Una sola copia del formulario, y está en Pages.
const QUOTATION_FORM_URL = 'https://portvirtuallab.github.io/ttcircle-insurance/quotation.html';

function doGet(e) {
  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<title>TT CIRCLE Insurance</title>' +
    '<style>body{font-family:Inter,"Segoe UI",sans-serif;margin:0;padding:48px 24px;' +
    'background:#f5f8fb;color:#10233d;text-align:center}' +
    'h1{color:#0b2d63;letter-spacing:-.02em}p{color:#65758a;max-width:34rem;margin:1rem auto}' +
    'a{display:inline-block;margin-top:24px;padding:14px 26px;border-radius:12px;' +
    'background:linear-gradient(135deg,#164194,#009fe3);color:#fff;font-weight:700;' +
    'text-decoration:none}</style>' +
    '<h1>TT CIRCLE Insurance</h1>' +
    '<p>This address is the quotation service, not the form. ' +
    'The quotation form is part of the PVL.ONE insurance module.</p>' +
    '<a href="' + QUOTATION_FORM_URL + '" target="_blank" rel="noreferrer">Open the quotation form</a>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('TT CIRCLE Insurance')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    console.log('=== PROCESSING FORM SUBMISSION ===');
    console.log('Received data:', e.postData);

    if (!e.postData || !e.postData.contents) {
      throw new Error('No data received in request');
    }

    const data = JSON.parse(e.postData.contents);
    console.log('Parsed form data:', Object.keys(data));

    // Validar datos
    validateFormData(data);
    console.log('Form validation passed');

    // Guardar en Google Sheet
    const result = saveToSheet(data);
    console.log('Sheet save result:', result.success);

    if (result.success) {
      // Enviar email de confirmación
      try {
        sendEmail(data, result.quoteCode);
        console.log('Email sent successfully');
      } catch (emailError) {
        console.error('Email error (non-blocking):', emailError);
      }

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          quoteCode: result.quoteCode,
          message: 'Quote submitted successfully',
          timestamp: new Date().toISOString()
        }))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    console.error('=== ERROR IN FORM PROCESSING ===');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString(),
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// VALIDACIÓN DE DATOS
// =====================================================

function validateFormData(data) {
  const required = [
    'email', 'policyHolder', 'policyHolderAddress', 'beneficiaryName', 'beneficiaryAddress',
    'transportType', 'packageType', 'quantity', 'origin', 'destination', 'exwPrice',
    'freightPrice', 'currency', 'cargoType', 'departureDate', 'packagingTypes',
    'cargoCondition', 'iccCoverage', 'incoterm'
  ];

  // Verificar campos requeridos
  const missing = required.filter(field => !data[field] || data[field].toString().trim() === '');
  if (missing.length > 0) {
    throw new Error('Missing required fields: ' + missing.join(', '));
  }

  // Validar números
  if (isNaN(data.quantity) || parseInt(data.quantity) <= 0) {
    throw new Error('Quantity must be a positive number');
  }

  if (isNaN(data.exwPrice) || parseFloat(data.exwPrice) < 0) {
    throw new Error('EXW Price must be a valid non-negative number');
  }

  if (isNaN(data.freightPrice) || parseFloat(data.freightPrice) < 0) {
    throw new Error('Freight Price must be a valid non-negative number');
  }

  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    throw new Error('Invalid email format');
  }

  // Validar fecha de salida
  const departureDate = new Date(data.departureDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (departureDate < today) {
    throw new Error('Departure date cannot be in the past');
  }

  // Validar selección de ICC
  const validIccOptions = ['ICC(A)', 'ICC(B)', 'ICC(C)'];
  if (!validIccOptions.includes(data.iccCoverage)) {
    throw new Error('Invalid ICC coverage selection');
  }

  // Validar restricciones de Incoterm con ICC (Incoterms 2020).
  // CIF A5 obliga al vendedor a cubrir ICC(C) COMO MÍNIMO, de modo que ICC(C)
  // es la opción válida por defecto — la versión anterior la bloqueaba, que es
  // justo lo contrario de lo que exige la norma. CIP A5 sí impone ICC(A).
  if (data.incoterm === 'CIP' && (data.iccCoverage === 'ICC(C)' || data.iccCoverage === 'ICC(B)')) {
    throw new Error('CIP incoterm requires ICC(A) all-risks coverage (Incoterms 2020, CIP A5)');
  }

  // Validar incoterms marítimos solo para transporte marítimo
  const maritimeIncoterms = ['FAS', 'FOB', 'CFR', 'CIF'];
  if (maritimeIncoterms.includes(data.incoterm) && data.transportType !== 'maritime') {
    throw new Error(`${data.incoterm} is only valid for maritime transport`);
  }
}

// =====================================================
// GUARDAR EN GOOGLE SHEETS
// =====================================================

function saveToSheet(data) {
  try {
    console.log('Opening Google Sheet:', CONFIG.SHEET_ID);

    const spreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    if (!spreadsheet) {
      throw new Error('Could not open spreadsheet with ID: ' + CONFIG.SHEET_ID);
    }

    const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) {
      throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" not found');
    }

    // Generar código de cotización único
    const timestamp = new Date();
    const year = timestamp.getFullYear().toString().slice(-2);
    const month = (timestamp.getMonth() + 1).toString().padStart(2, '0');
    const randomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    const quoteCode = `TT${year}${month}${randomCode}`;

    console.log('Generated quote code:', quoteCode);

    // Calcular valores
    const exwPrice = parseFloat(data.exwPrice);
    const freightPrice = parseFloat(data.freightPrice);
    const totalValue = exwPrice + freightPrice;
    const estimatedPremium = calculateInsurancePremium(data);

    // Crear headers si la hoja está vacía
    if (sheet.getLastRow() === 0) {
      const headers = [
        'Timestamp', 'Quote Code', 'Email', 'Policy Holder', 'Policy Holder Address',
        'Beneficiary Name', 'Beneficiary Address', 'Transport Type', 'Incoterm',
        'Package Type', 'Cargo Type', 'Quantity', 'Currency', 'Origin',
        'Destination', 'EXW Price', 'Freight Price', 'Total Value',
        'Estimated Premium', 'Premium Rate %', 'ICC Coverage', 'Additional Coverage',
        'Packaging Types', 'Cargo Condition', 'Departure Date', 'Request Date',
        'Additional Notes', 'Status', 'Risk Assessment Summary'
      ];

      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f0f0f0');

      console.log('Headers created in sheet');
    }

    // Preparar resumen de evaluación de riesgo
    const riskSummary = `Transport: ${data.transportType} | Incoterm: ${data.incoterm} | ICC: ${data.iccCoverage} | ` +
                       `Cargo Risk: ${estimatedPremium.cargoRiskFactor}x | Region Risk: ${estimatedPremium.regionRiskFactor}x | ` +
                       `Packaging Risk: ${estimatedPremium.packagingRiskFactor}x`;

    // Preparar datos para insertar
    const rowData = [
      timestamp,
      quoteCode,
      data.email.trim(),
      data.policyHolder.trim(),
      data.policyHolderAddress.trim(),
      data.beneficiaryName.trim(),
      data.beneficiaryAddress.trim(),
      data.transportType,
      data.incoterm,
      data.packageType,
      data.cargoType,
      parseInt(data.quantity),
      data.currency,
      data.origin,
      data.destination,
      exwPrice,
      freightPrice,
      totalValue,
      parseFloat(estimatedPremium.amount),
      parseFloat(estimatedPremium.rate),
      data.iccCoverage,
      data.additionalCoverage || 'None',
      data.packagingTypes || 'Not specified',
      data.cargoCondition || 'Not specified',
      data.departureDate,
      data.requestDate,
      data.additionalNotes || 'None',
      'Pending Review',
      riskSummary
    ];

    // Insertar fila
    sheet.appendRow(rowData);

    // Formatear la nueva fila
    const lastRow = sheet.getLastRow();

    // Formato para fecha
    sheet.getRange(lastRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    sheet.getRange(lastRow, 25).setNumberFormat('yyyy-MM-dd');
    sheet.getRange(lastRow, 26).setNumberFormat('yyyy-MM-dd');

    // Formato para precios
    const priceColumns = [16, 17, 18, 19];
    priceColumns.forEach(col => {
      sheet.getRange(lastRow, col).setNumberFormat('#,##0.00');
    });

    // Formato para porcentaje
    sheet.getRange(lastRow, 20).setNumberFormat('0.000%');

    console.log('Data saved successfully to row:', lastRow);

    return {
      success: true,
      quoteCode: quoteCode,
      rowNumber: lastRow,
      estimatedPremium: estimatedPremium
    };

  } catch (error) {
    console.error('Error saving to Google Sheets:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// =====================================================
// CÁLCULO DE PRIMA DE SEGURO
// =====================================================

// Práctica de mercado: la cobertura se emite sobre CIF + 10%, y la prima se
// tarifica sobre ese valor asegurado, no sobre el valor de factura.
// Debe coincidir con insuredValueUpliftPct de docs/data/tariffs.json.
const INSURED_VALUE_UPLIFT_PCT = 10;

function calculateInsurancePremium(data) {
  const cifValue = parseFloat(data.exwPrice) + parseFloat(data.freightPrice);
  const uplift = cifValue * (INSURED_VALUE_UPLIFT_PCT / 100);
  const totalValue = cifValue + uplift;

  // Tarifas base por tipo de ICC
  const iccBaseRates = {
    'ICC(A)': { maritime: 0.20, air: 0.12, rail: 0.16, inland: 0.25, multimodal: 0.22 },
    'ICC(B)': { maritime: 0.15, air: 0.10, rail: 0.13, inland: 0.20, multimodal: 0.18 },
    'ICC(C)': { maritime: 0.10, air: 0.06, rail: 0.09, inland: 0.15, multimodal: 0.12 }
  };

  // Factores de ajuste por Incoterm
  const incotermFactors = {
    'EXW': 1.15, 'FCA': 1.10, 'FAS': 1.08, 'FOB': 1.05, 'CPT': 1.00,
    'CIP': 0.95, 'CFR': 1.03, 'CIF': 0.98, 'DAP': 0.92, 'DPU': 0.90, 'DDP': 0.88
  };

  // Factores de riesgo por tipo de mercancía
  const cargoRiskFactors = {
    'general': 1.0, 'perishable': 1.4, 'hazardous': 2.0, 'electronics': 1.3,
    'machinery': 1.2, 'textiles': 1.1, 'automotive': 1.5, 'pharmaceuticals': 1.6
  };

  // Factores de riesgo por tipo de embalaje
  const packagingRiskFactors = {
    'Cardboard Box': 1.2, 'Wooden Crate': 1.0, 'Metal Drum': 0.9, 'Gas Cylinder': 1.1,
    'Palletized': 0.95, 'Plastic Container': 1.05, 'Bags/Sacks': 1.3, 'Bulk (No Packaging)': 1.4
  };

  // Factores de riesgo por condición de la mercancía
  const conditionRiskFactors = { 'New': 1.0, 'Used': 1.15, 'Refurbished': 1.08 };

  // Factores de riesgo por región
  const regionRiskFactors = { 'high': 1.5, 'medium': 1.2, 'low': 1.0 };

  // Clasificación de países por riesgo
  const highRiskCountries = [
    'Egypt', 'Morocco', 'Tunisia', 'Lebanon', 'Jordan', 'Russia'
  ];

  const mediumRiskCountries = [
    'China', 'India', 'Turkey', 'Brazil', 'Argentina', 'Mexico',
    'Poland', 'Hungary', 'Czech Republic', 'South Korea'
  ];

  // Determinar factor de riesgo regional
  let regionRiskFactor = regionRiskFactors.low;
  if (highRiskCountries.includes(data.origin) || highRiskCountries.includes(data.destination)) {
    regionRiskFactor = regionRiskFactors.high;
  } else if (mediumRiskCountries.includes(data.origin) || mediumRiskCountries.includes(data.destination)) {
    regionRiskFactor = regionRiskFactors.medium;
  }

  // Obtener factores de riesgo
  const cargoRiskFactor = cargoRiskFactors[data.cargoType] || 1.0;
  const incotermFactor = incotermFactors[data.incoterm] || 1.0;
  const packagingType = data.packagingTypes ? data.packagingTypes.split(', ')[0] : 'Wooden Crate';
  const packagingRiskFactor = packagingRiskFactors[packagingType] || 1.0;
  const conditionRiskFactor = conditionRiskFactors[data.cargoCondition] || 1.0;

  // Obtener tarifa base según ICC y modo de transporte
  const iccCoverage = data.iccCoverage || 'ICC(C)';
  const baseRate = iccBaseRates[iccCoverage] ?
    (iccBaseRates[iccCoverage][data.transportType] || 0.15) : 0.15;

  // Calcular prima base
  let premium = totalValue * (baseRate / 100) * regionRiskFactor * cargoRiskFactor *
                packagingRiskFactor * conditionRiskFactor * incotermFactor;

  // Aplicar factores de coberturas adicionales.
  // Una tabla, no una cadena de if: añadir una extensión es una línea aquí y
  // otra en additionalCoverageFactors de tariffs.json. Deben coincidir.
  const extensionFactors = {
    'ISRCC': 1.25,
    'IWC': 1.35,
    'Extraordinary Risks': 1.15,
    'Reefer Breakdown': 1.30
  };

  if (data.additionalCoverage && data.additionalCoverage !== 'None') {
    const coverages = data.additionalCoverage.split(', ');

    coverages.forEach(function (name) {
      const factor = extensionFactors[name.trim()];
      if (factor) premium *= factor;
    });
  }

  // Establecer prima mínima según moneda
  const minimumPremium = data.currency === 'USD' ? 35 : 30;
  const minimumApplied = premium < minimumPremium;
  premium = Math.max(premium, minimumPremium);

  return {
    amount: premium.toFixed(2),
    rate: ((premium / totalValue) * 100).toFixed(3),
    cifValue: cifValue,
    uplift: uplift,
    upliftPct: INSURED_VALUE_UPLIFT_PCT,
    baseRate: baseRate,
    iccCoverage: iccCoverage,
    incoterm: data.incoterm,
    incotermFactor: incotermFactor,
    regionRiskFactor: regionRiskFactor,
    cargoRiskFactor: cargoRiskFactor,
    packagingRiskFactor: packagingRiskFactor,
    conditionRiskFactor: conditionRiskFactor,
    totalValue: totalValue,
    minimumApplied: minimumApplied
  };
}

// =====================================================
// ENVÍO DE EMAIL DE CONFIRMACIÓN
// =====================================================

function sendEmail(data, quoteCode) {
  try {
    const totalValue = (parseFloat(data.exwPrice) + parseFloat(data.freightPrice)).toFixed(2);
    const subject = `TT CIRCLE Insurance - Quote ${quoteCode}`;

    // Calcular prima estimada
    const estimatedPremium = calculateInsurancePremium(data);

    // Formatear fecha de salida
    const departureDate = new Date(data.departureDate);
    const formattedDepartureDate = departureDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Descripción de cobertura ICC
    const iccDescriptions = {
      'ICC(A)': 'All Risks Coverage - Comprehensive protection against physical loss or damage from external causes',
      'ICC(B)': 'Named Perils Coverage - Protection against specific listed risks including fire, explosion, collision, and natural disasters',
      'ICC(C)': 'Basic Coverage - Protection against major risks including fire, explosion, sinking, stranding, and collision'
    };

    // Descripción de Incoterms
    const incotermDescriptions = {
      'EXW': 'Ex Works - Buyer bears all risks from seller\'s premises',
      'FCA': 'Free Carrier - Risk transfers at agreed delivery point',
      'FAS': 'Free Alongside Ship - Risk transfers at port alongside vessel',
      'FOB': 'Free On Board - Risk transfers when goods cross ship\'s rail',
      'CPT': 'Carriage Paid To - Seller pays freight, buyer bears risk',
      'CIP': 'Carriage and Insurance Paid To - Seller provides insurance',
      'CFR': 'Cost and Freight - Seller pays freight, buyer bears risk',
      'CIF': 'Cost, Insurance and Freight - Seller provides marine insurance',
      'DAP': 'Delivered At Place - Seller bears risk until delivery',
      'DPU': 'Delivered at Place Unloaded - Risk transfers after unloading',
      'DDP': 'Delivered Duty Paid - Seller bears maximum responsibility'
    };

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Inter, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #10233d; margin: 0; padding: 0; }
          .container { max-width: 650px; margin: 0 auto; background: #ffffff; }
          .header {
            background: linear-gradient(135deg, #164194 0%, #009fe3 100%);
            color: white; padding: 30px 20px; text-align: center;
          }
          .header h1 { margin: 0; font-size: 2.2rem; font-weight: 700; letter-spacing: -0.02em; }
          .header p { margin: 10px 0 0; font-size: 1.1rem; opacity: 0.9; }
          .content { padding: 30px; background: #ffffff; }
          .quote-summary {
            background: #f5f8fb;
            padding: 25px; border-radius: 12px; margin: 25px 0;
            border: 1px solid #dfe7ef;
          }
          .quote-code {
            background: #0b2d63; color: white; padding: 15px;
            border-radius: 8px; text-align: center; font-family: 'Courier New', monospace;
            font-size: 1.4rem; font-weight: bold; letter-spacing: 2px; margin: 20px 0;
          }
          .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .info-table td { padding: 12px 15px; border-bottom: 1px solid #dfe7ef; }
          .info-table td:first-child { font-weight: 600; background: #f5f8fb; width: 40%; }
          .premium-highlight {
            background: #0b2d63;
            padding: 20px; border-radius: 10px; margin: 20px 0;
            text-align: center; color: #ffffff;
          }
          .premium-amount { font-size: 1.8rem; font-weight: bold; color: #ffffff; }
          .icc-coverage-box {
            background: #fdf8ee;
            padding: 20px; border-radius: 10px; margin: 20px 0;
            border-left: 4px solid #f9b233;
          }
          .incoterm-box {
            background: #eef6fd;
            padding: 20px; border-radius: 10px; margin: 20px 0;
            border-left: 4px solid #009fe3;
          }
          .next-steps { background: #fdf8ee; padding: 20px; border-radius: 10px; border-left: 4px solid #f9b233; }
          .deg-info {
            background: #f5f8fb;
            padding: 20px; border-radius: 10px; margin: 25px 0;
            border: 1px solid #dfe7ef;
          }
          .deg-link {
            display: inline-block; background: #164194; color: white;
            padding: 12px 24px; text-decoration: none; border-radius: 8px;
            font-weight: bold; margin-top: 15px;
          }
          .footer { background: #f5f8fb; padding: 25px; text-align: center; color: #65758a; }
          .contact-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #dfe7ef; }
          .address-box {
            background: #f5f8fb; padding: 15px; border-radius: 8px; margin: 10px 0;
            border-left: 3px solid #164194;
          }
          .minimum-notice {
            background: rgba(255,255,255,0.12); padding: 15px; border-radius: 8px;
            margin: 15px 0; font-size: 0.9rem; color: #ffffff;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>TT CIRCLE</h1>
            <p>Professional Cargo Insurance Solutions</p>
            <p style="font-size: 0.9rem; margin-top: 10px; opacity: 0.8;">Training Port Virtual Lab – Escola Europea</p>
          </div>

          <div class="content">
            <h2>Dear ${data.policyHolder},</h2>
            <p>Thank you for choosing TT CIRCLE Insurance for your cargo protection needs. We have successfully received your detailed quote request and our expert underwriting team is already reviewing your shipment details.</p>

            <div class="quote-code">${quoteCode}</div>

            <div class="address-box">
              <h4 style="margin-top: 0; color: #0b2d63;">Policy Holder Information</h4>
              <p style="margin: 5px 0;"><strong>${data.policyHolder}</strong></p>
              <p style="margin: 5px 0;">${data.policyHolderAddress}</p>
            </div>

            <div class="address-box">
              <h4 style="margin-top: 0; color: #0b2d63;">Insurance Beneficiary Information</h4>
              <p style="margin: 5px 0;"><strong>${data.beneficiaryName}</strong></p>
              <p style="margin: 5px 0;">${data.beneficiaryAddress}</p>
            </div>

            <div class="incoterm-box">
              <h3 style="margin-top: 0; color: #164194;">Selected Incoterm: ${data.incoterm}</h3>
              <p style="margin: 10px 0;"><strong>${incotermDescriptions[data.incoterm] || 'Standard international trade term'}</strong></p>
              <p style="font-size: 0.9rem; margin: 5px 0; color: #65758a;">Risk transfer factor: ${estimatedPremium.incotermFactor}x</p>
            </div>

            <div class="icc-coverage-box">
              <h3 style="margin-top: 0; color: #7a5406;">Selected Coverage: ${data.iccCoverage}</h3>
              <p style="margin: 10px 0;"><strong>${iccDescriptions[data.iccCoverage] || 'Standard ICC Coverage'}</strong></p>
            </div>

            <div class="quote-summary">
              <h3 style="margin-top: 0; color: #0b2d63;">Quote Summary</h3>
              <table class="info-table">
                <tr><td>Transport Mode</td><td>${data.transportType}</td></tr>
                <tr><td>Origin</td><td>${data.origin}</td></tr>
                <tr><td>Destination</td><td>${data.destination}</td></tr>
                <tr><td>Cargo Type</td><td>${data.cargoType}</td></tr>
                <tr><td>Container Type</td><td>${data.packageType}</td></tr>
                <tr><td>Quantity</td><td>${data.quantity}</td></tr>
                <tr><td>Packaging Types</td><td>${data.packagingTypes}</td></tr>
                <tr><td>Cargo Condition</td><td>${data.cargoCondition}</td></tr>
                <tr><td>Additional Coverage</td><td>${data.additionalCoverage || 'None'}</td></tr>
                <tr><td>CIF value (goods + freight)</td><td>${data.currency} ${totalValue}</td></tr>
                <tr><td>Uplift ${estimatedPremium.upliftPct}% (expected profit)</td><td>${data.currency} ${estimatedPremium.uplift.toFixed(2)}</td></tr>
                <tr><td><strong>Insured value</strong></td><td><strong>${data.currency} ${estimatedPremium.totalValue.toFixed(2)}</strong></td></tr>
                <tr><td>Expected Departure</td><td>${formattedDepartureDate}</td></tr>
                <tr><td>Additional Notes</td><td>${data.additionalNotes || 'None'}</td></tr>
              </table>
            </div>

            <div class="premium-highlight">
              <h3 style="margin-top: 0; color: #ffffff;">Estimated Premium</h3>
              <p class="premium-amount">${data.currency} ${estimatedPremium.amount}</p>
              <p style="font-size: 0.9rem; margin-top: 10px; opacity: 0.85;">Premium rate: ${estimatedPremium.rate}%</p>
              <div class="minimum-notice">
                A minimum premium of ${data.currency === 'USD' ? '$35' : '€30'} applies.
              </div>
            </div>

            <div class="next-steps">
              <h3 style="margin-top: 0; color: #7a5406;">Next Steps</h3>
              <p style="margin: 10px 0;">Our insurance advisor will contact you within <strong>2-4 business hours</strong> to provide personalized coverage options and finalize your policy.</p>
              <p style="margin: 10px 0;">Please keep your quote code <strong>${quoteCode}</strong> for reference — you will need it to report your payment.</p>
            </div>

            <div class="deg-info">
              <h3 style="margin-top: 0; color: #0b2d63;">Don't want to insure your cargo? Learn about DEG</h3>
              <p>Learn more about our comprehensive cargo protection plans and additional services.</p>
              <a href="${CONFIG.DEG_INFO_URL}" class="deg-link">Explore DEG Options</a>
            </div>

            <div class="contact-info">
              <p><strong>Contact Us</strong></p>
              <p>Email: support@ttcircle-insurance.com</p>
              <p>Business Hours: Monday-Friday, 9:00 - 18:00</p>
            </div>
          </div>

          <div class="footer">
            <p>TT CIRCLE Insurance – Your trusted partner in cargo protection</p>
            <p>Powered by Escola Europea – Port Virtual Lab Training</p>
            <p style="font-size: 0.8rem; margin-top: 10px;">Training simulator. Figures are illustrative and do not constitute an insurance offer.</p>
            <p style="font-size: 0.8rem;">© ${new Date().getFullYear()} TT CIRCLE.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Enviar email
    MailApp.sendEmail({
      to: data.email,
      subject: subject,
      htmlBody: htmlBody,
      name: 'TT CIRCLE INSURANCE'
    });

    console.log('Email sent to:', data.email);

  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

// =====================================================
// FUNCIONES DE UTILIDAD Y TESTING
// =====================================================

function testConnection() {
  return {
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'TT CIRCLE Insurance API is working correctly',
    config: {
      sheetId: CONFIG.SHEET_ID,
      sheetName: CONFIG.SHEET_NAME
    }
  };
}

function testCalculatePremium() {
  const testData = {
    exwPrice: 10000,
    freightPrice: 2000,
    transportType: 'maritime',
    cargoType: 'electronics',
    origin: 'Spain',
    destination: 'Germany',
    currency: 'EUR',
    additionalCoverage: 'ISRCC, IWC',
    packagingTypes: 'Wooden Crate',
    cargoCondition: 'New',
    iccCoverage: 'ICC(A)',
    incoterm: 'CIF',
    departureDate: '2026-07-15'
  };

  const result = calculateInsurancePremium(testData);
  console.log('Test premium calculation:', result);
  return result;
}

function testSaveToSheet() {
  const testData = {
    email: 'test@example.com',
    policyHolder: 'Test Company Ltd.',
    policyHolderAddress: '123 Test Street, Test City, Test Country',
    beneficiaryName: 'Beneficiary Company Inc.',
    beneficiaryAddress: '456 Benefit Ave, Benefit City, Benefit Country',
    transportType: 'maritime',
    packageType: '20ft Standard Container',
    cargoType: 'electronics',
    quantity: 2,
    currency: 'EUR',
    origin: 'Spain',
    destination: 'Germany',
    exwPrice: 10000,
    freightPrice: 2000,
    additionalCoverage: 'ISRCC',
    packagingTypes: 'Wooden Crate',
    cargoCondition: 'New',
    iccCoverage: 'ICC(A)',
    incoterm: 'CIF',
    departureDate: '2026-07-15',
    requestDate: '2026-06-05',
    additionalNotes: 'Handle with care - fragile electronics'
  };

  try {
    const result = saveToSheet(testData);
    console.log('Test save result:', result);
    return result;
  } catch (error) {
    console.error('Test save failed:', error);
    return { success: false, error: error.toString() };
  }
}

// =====================================================
// ESTADÍSTICAS Y ANÁLISIS
// =====================================================

function getQuoteStatistics() {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) return { totalQuotes: 0 };

    const quotes = data.slice(1);
    const totalQuotes = quotes.length;
    const totalValue = quotes.reduce((sum, row) => sum + (row[17] || 0), 0);
    const totalPremium = quotes.reduce((sum, row) => sum + (row[18] || 0), 0);

    const countBy = (index) => {
      const stats = {};
      quotes.forEach(row => {
        const key = row[index] || 'Unknown';
        stats[key] = (stats[key] || 0) + 1;
      });
      return stats;
    };

    return {
      totalQuotes: totalQuotes,
      totalValue: totalValue,
      totalPremium: totalPremium,
      averageValue: totalValue / totalQuotes,
      averagePremium: totalPremium / totalQuotes,
      incotermBreakdown: countBy(8),
      packagingBreakdown: countBy(22),
      conditionBreakdown: countBy(23),
      iccCoverageBreakdown: countBy(20)
    };
  } catch (error) {
    console.error('Error getting statistics:', error);
    return { error: error.toString() };
  }
}

function getDetailedRiskAnalysis(quoteCode) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const data = sheet.getDataRange().getValues();

    const quoteRow = data.find(row => row[1] === quoteCode);
    if (!quoteRow) {
      return { error: 'Quote not found' };
    }

    const reconstructedData = {
      transportType: quoteRow[7],
      cargoType: quoteRow[10],
      origin: quoteRow[13],
      destination: quoteRow[14],
      exwPrice: quoteRow[15],
      freightPrice: quoteRow[16],
      currency: quoteRow[12],
      iccCoverage: quoteRow[20],
      incoterm: quoteRow[8],
      additionalCoverage: quoteRow[21],
      packagingTypes: quoteRow[22],
      cargoCondition: quoteRow[23]
    };

    const analysis = calculateInsurancePremium(reconstructedData);

    return {
      quoteCode: quoteCode,
      riskAnalysis: analysis,
      recommendations: generateRiskRecommendations(reconstructedData, analysis)
    };

  } catch (error) {
    console.error('Error in detailed risk analysis:', error);
    return { error: error.toString() };
  }
}

function generateRiskRecommendations(data, analysis) {
  const recommendations = [];

  if (data.iccCoverage === 'ICC(C)') {
    recommendations.push('Consider upgrading to ICC(B) or ICC(A) for broader coverage against theft, damage, and handling risks.');
  } else if (data.iccCoverage === 'ICC(B)') {
    recommendations.push('ICC(B) provides good protection. Consider ICC(A) for full all-risks coverage if carrying high-value or sensitive cargo.');
  }

  if (['EXW', 'FCA'].includes(data.incoterm)) {
    recommendations.push(`${data.incoterm} places maximum risk on the buyer. Consider negotiating terms with more seller responsibility to reduce insurance costs.`);
  } else if (['DDP', 'DPU', 'DAP'].includes(data.incoterm)) {
    recommendations.push(`${data.incoterm} provides good risk distribution. The seller bears most transport risks, reducing your insurance needs.`);
  }

  if (analysis.packagingRiskFactor > 1.2) {
    recommendations.push('Consider upgrading to more protective packaging (wooden crates or metal containers) to reduce premium costs.');
  }

  if (analysis.conditionRiskFactor > 1.1) {
    recommendations.push('Used or refurbished items carry higher risk. Document the condition properly and consider additional protective measures.');
  }

  if (analysis.regionRiskFactor > 1.3) {
    recommendations.push('High-risk route detected. Consider additional coverage options like ISRCC or IWC.');
  }

  if (analysis.minimumApplied) {
    recommendations.push('Minimum premium applied. Consider bundling multiple small shipments to optimise insurance costs.');
  }

  return recommendations;
}

// =====================================================
// ANÁLISIS DE INCOTERMS Y COBERTURAS
// =====================================================

function compareICCCoverages(shipmentData) {
  const iccOptions = ['ICC(C)', 'ICC(B)', 'ICC(A)'];
  const comparisons = {};

  const blockedOptions = [];
  if (shipmentData.incoterm === 'CIF') {
    blockedOptions.push('ICC(C)');
  } else if (shipmentData.incoterm === 'CIP') {
    blockedOptions.push('ICC(C)', 'ICC(B)');
  }

  iccOptions.forEach(icc => {
    if (blockedOptions.includes(icc)) {
      comparisons[icc] = {
        premium: 'N/A',
        rate: 'N/A',
        baseRate: 'N/A',
        description: getICCDescription(icc),
        blocked: true,
        reason: `Not available with ${shipmentData.incoterm} terms`
      };
    } else {
      const testData = Object.assign({}, shipmentData, { iccCoverage: icc });
      const premium = calculateInsurancePremium(testData);

      comparisons[icc] = {
        premium: premium.amount,
        rate: premium.rate,
        baseRate: premium.baseRate,
        description: getICCDescription(icc),
        blocked: false
      };
    }
  });

  return {
    comparisons: comparisons,
    incoterm: shipmentData.incoterm,
    recommendation: getICCRecommendation(shipmentData, comparisons)
  };
}

function getICCDescription(icc) {
  const descriptions = {
    'ICC(A)': 'All Risks - Broadest coverage protecting against all physical loss or damage from external causes',
    'ICC(B)': 'Named Perils - Covers specific listed risks including natural disasters and transport accidents',
    'ICC(C)': 'Basic - Covers major risks like fire, explosion, sinking, collision, and general average'
  };

  return descriptions[icc] || 'Standard coverage';
}

function getICCRecommendation(data, comparisons) {
  const cargoValue = parseFloat(data.exwPrice) + parseFloat(data.freightPrice);
  const cargoType = data.cargoType;

  if (data.incoterm === 'CIP') {
    return 'CIP terms require ICC(A) all-risks coverage as per international standards';
  } else if (data.incoterm === 'CIF') {
    return 'CIF terms require minimum ICC(B) coverage. Consider ICC(A) for maximum protection';
  }

  if (['electronics', 'pharmaceuticals', 'machinery'].includes(cargoType) || cargoValue > 50000) {
    return 'ICC(A) recommended for high-value or sensitive cargo requiring comprehensive protection';
  } else if (['automotive', 'hazardous'].includes(cargoType) || cargoValue > 20000) {
    return 'ICC(B) recommended for a good balance between coverage and cost';
  } else {
    return 'ICC(C) suitable for basic protection of general cargo';
  }
}

function validateIncotermTransport(incoterm, transportType) {
  const maritimeOnlyIncoterms = ['FAS', 'FOB', 'CFR', 'CIF'];

  if (maritimeOnlyIncoterms.includes(incoterm) && transportType !== 'maritime') {
    return {
      valid: false,
      message: `${incoterm} can only be used with maritime transport`
    };
  }

  return {
    valid: true,
    message: 'Valid incoterm-transport combination'
  };
}

function getIncotermsSummary() {
  return {
    allTransport: {
      'EXW': {
        name: 'Ex Works',
        description: 'Minimum seller obligation. Buyer arranges all transport',
        riskTransfer: 'At seller premises',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Experienced buyers with logistics capabilities'
      },
      'FCA': {
        name: 'Free Carrier',
        description: 'Seller delivers to carrier nominated by buyer',
        riskTransfer: 'When goods handed to carrier',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Container shipments and multimodal transport'
      },
      'CPT': {
        name: 'Carriage Paid To',
        description: 'Seller pays freight to destination',
        riskTransfer: 'When goods handed to first carrier',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Any mode of transport'
      },
      'CIP': {
        name: 'Carriage and Insurance Paid To',
        description: 'Seller pays freight and provides insurance',
        riskTransfer: 'When goods handed to first carrier',
        insuranceResponsibility: 'Seller (ICC A required)',
        suitableFor: 'High-value goods requiring insurance'
      },
      'DAP': {
        name: 'Delivered At Place',
        description: 'Seller delivers ready for unloading',
        riskTransfer: 'At named destination',
        insuranceResponsibility: 'Seller until delivery',
        suitableFor: 'Door-to-door deliveries'
      },
      'DPU': {
        name: 'Delivered at Place Unloaded',
        description: 'Seller delivers and unloads at destination',
        riskTransfer: 'After unloading at destination',
        insuranceResponsibility: 'Seller until unloaded',
        suitableFor: 'When seller can ensure unloading'
      },
      'DDP': {
        name: 'Delivered Duty Paid',
        description: 'Maximum seller obligation including duties',
        riskTransfer: 'At final destination',
        insuranceResponsibility: 'Seller',
        suitableFor: 'Turnkey deliveries'
      }
    },
    maritimeOnly: {
      'FAS': {
        name: 'Free Alongside Ship',
        description: 'Seller delivers alongside vessel',
        riskTransfer: 'Alongside ship at port',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Bulk cargo and breakbulk'
      },
      'FOB': {
        name: 'Free On Board',
        description: 'Seller loads goods on vessel',
        riskTransfer: 'When goods cross ship rail',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Traditional maritime shipments'
      },
      'CFR': {
        name: 'Cost and Freight',
        description: 'Seller pays freight to destination port',
        riskTransfer: 'When goods cross ship rail',
        insuranceResponsibility: 'Buyer',
        suitableFor: 'Maritime transport without insurance'
      },
      'CIF': {
        name: 'Cost, Insurance and Freight',
        description: 'Seller pays freight and provides insurance',
        riskTransfer: 'When goods cross ship rail',
        insuranceResponsibility: 'Seller (min ICC B required)',
        suitableFor: 'Traditional maritime with insurance'
      }
    }
  };
}

function analyzeIncotermCosts(data) {
  const baseData = {
    exwPrice: parseFloat(data.exwPrice),
    freightPrice: parseFloat(data.freightPrice),
    cargoValue: parseFloat(data.exwPrice) + parseFloat(data.freightPrice)
  };

  const incotermCosts = {
    'EXW': {
      sellerCosts: 0,
      buyerCosts: baseData.freightPrice + (baseData.cargoValue * 0.03),
      insuranceBearer: 'Buyer',
      riskPeriod: 'Entire journey'
    },
    'FCA': {
      sellerCosts: baseData.cargoValue * 0.01,
      buyerCosts: baseData.freightPrice + (baseData.cargoValue * 0.02),
      insuranceBearer: 'Buyer',
      riskPeriod: 'From carrier receipt'
    },
    'CPT': {
      sellerCosts: baseData.freightPrice,
      buyerCosts: baseData.cargoValue * 0.01,
      insuranceBearer: 'Buyer',
      riskPeriod: 'From first carrier'
    },
    'CIP': {
      sellerCosts: baseData.freightPrice + (baseData.cargoValue * 0.002),
      buyerCosts: 0,
      insuranceBearer: 'Seller',
      riskPeriod: 'Covered by seller insurance'
    },
    'DAP': {
      sellerCosts: baseData.freightPrice + (baseData.cargoValue * 0.02),
      buyerCosts: baseData.cargoValue * 0.005,
      insuranceBearer: 'Seller',
      riskPeriod: 'Minimal for buyer'
    },
    'DPU': {
      sellerCosts: baseData.freightPrice + (baseData.cargoValue * 0.025),
      buyerCosts: 0,
      insuranceBearer: 'Seller',
      riskPeriod: 'None for buyer'
    },
    'DDP': {
      sellerCosts: baseData.freightPrice + (baseData.cargoValue * 0.05),
      buyerCosts: 0,
      insuranceBearer: 'Seller',
      riskPeriod: 'None for buyer'
    },
    'FAS': {
      sellerCosts: baseData.cargoValue * 0.01,
      buyerCosts: baseData.freightPrice + (baseData.cargoValue * 0.02),
      insuranceBearer: 'Buyer',
      riskPeriod: 'From alongside ship'
    },
    'FOB': {
      sellerCosts: baseData.cargoValue * 0.015,
      buyerCosts: baseData.freightPrice + (baseData.cargoValue * 0.015),
      insuranceBearer: 'Buyer',
      riskPeriod: 'From on board'
    },
    'CFR': {
      sellerCosts: baseData.freightPrice,
      buyerCosts: baseData.cargoValue * 0.01,
      insuranceBearer: 'Buyer',
      riskPeriod: 'From on board'
    },
    'CIF': {
      sellerCosts: baseData.freightPrice + (baseData.cargoValue * 0.0015),
      buyerCosts: 0,
      insuranceBearer: 'Seller',
      riskPeriod: 'Covered by seller insurance'
    }
  };

  const selectedIncoterm = incotermCosts[data.incoterm] || incotermCosts['EXW'];

  return {
    incoterm: data.incoterm,
    analysis: selectedIncoterm,
    recommendation: generateIncotermRecommendation(data, selectedIncoterm),
    totalCost: {
      seller: baseData.exwPrice + selectedIncoterm.sellerCosts,
      buyer: selectedIncoterm.buyerCosts
    }
  };
}

function generateIncotermRecommendation(data, incotermAnalysis) {
  const recommendations = [];

  if (incotermAnalysis.insuranceBearer === 'Buyer' && parseFloat(data.exwPrice) + parseFloat(data.freightPrice) > 50000) {
    recommendations.push('High-value cargo with buyer insurance responsibility. Consider negotiating CIP/CIF terms for seller-provided insurance.');
  }

  if (incotermAnalysis.riskPeriod === 'Entire journey' || incotermAnalysis.riskPeriod === 'From carrier receipt') {
    recommendations.push('Extended risk exposure period. Ensure comprehensive insurance coverage from origin to destination.');
  }

  if (data.transportType === 'multimodal' && ['FAS', 'FOB', 'CFR', 'CIF'].includes(data.incoterm)) {
    recommendations.push('Maritime-only Incoterm used with multimodal transport. Consider switching to FCA or CPT for clarity.');
  }

  return recommendations.join(' ');
}
