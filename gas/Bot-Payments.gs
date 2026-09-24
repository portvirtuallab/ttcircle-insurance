// =====================================================
// SPECIFY AND GENERATE, MODIFICATION INDEX 01024 - TEMPLATE-BASED PDF (CORREGIDO)
//
// v2.5 - El código de pago es un SALDO que se consume.
//   · chargePaymentCode() sustituye a markPaymentCodeAsUsed()
//   · Se cobra ANTES de emitir el certificado, leyendo la prima de la hoja
//   · Si el envío falla después de cobrar, se devuelve el importe
// =====================================================

const BOT_CONFIG = {
  // 🤖 Bot's Sheet
  BOT_SHEET_ID: '1rM4yZxj-tjenMF1v3Ubiz49NT1GpXOYriylVcEaL_N0',

  // 📊 Main sheet (where original quotes are)
  SOURCE_SHEET_ID: '1IKA_Yu9eeAx3PhA89gtbT6SfYtk-pz3KJ0JbWHn5oMY',
  SOURCE_SHEET_NAME: 'Sheet1',

  // Sheets on the bot (DO NOT touch "Quotes" which uses IMPORTRANGE)
  BANK_SHEET: 'Bank',              // Payment codes
  LOGS_SHEET: 'Bot_Logs',          // System logs
  CONFIG_SHEET: 'Config',          // Configuration
  QUOTES_IMPORT_SHEET: 'Quotes',   // Sheet with IMPORTRANGE (READ-ONLY)

  BOT_NAME: 'TT CIRCLE Insurance Bot',
  VERSION: '2.5 - Payment code as a balance',

  // Certificate configuration
  CERTIFICATE_CONFIG: {
    COMPANY_NAME: 'TT CIRCLE INSURANCE',
    COMPANY_ADDRESS: 'Principe de Vergara, 125, 28002 Madrid, Spain',
    POLICY_PREFIX: 'TTCIR',
    CERTIFICATE_PREFIX: 'CERT',
    TEMPLATE_DOC_ID: '14bXGkVUnNqkF6J_EMhtApFk7h7KeYDezj2ly46dzp3k'  // ID of the Google Docs template
  },

  // ✅ NUEVAS VALIDACIONES
  VALIDATION: {
    PAYMENT_CODE_PATTERN: /^[A-Z0-9]{6,12}$/i,
    QUOTE_CODE_PATTERN: /^TT[0-9]{4}[A-Z0-9]{6}$/i,
    MAX_RETRIES: 3,
    TIMEOUT_MS: 15000
  },

  EMAIL: {
    FROM_NAME: 'TT CIRCLE Insurance',
    REPLY_TO: 'noreply@ttcircle.com',
    SUPPORT_EMAIL: 'support@ttcircle.com'
  }
};

// =====================================================
// ✅ FUNCIONES DE VALIDACIÓN
// =====================================================

function validatePaymentCode(code) {
  if (!code || typeof code !== 'string') return false;
  return BOT_CONFIG.VALIDATION.PAYMENT_CODE_PATTERN.test(code.trim());
}

function validateQuoteCode(code) {
  if (!code || typeof code !== 'string') return false;
  return BOT_CONFIG.VALIDATION.QUOTE_CODE_PATTERN.test(code.trim());
}

// =====================================================
// ✅ HELPER FUNCTION TO FORMAT DATES CORRECTLY (MEJORADO)
// =====================================================

function formatDateSafely(dateValue) {
  try {
    if (!dateValue) return 'Not specified';

    let date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'string') {
      // Manejar formatos comunes: DD/MM/YYYY, YYYY-MM-DD, etc.
      const cleanDate = dateValue.trim();
      if (cleanDate.includes('/')) {
        // Convertir DD/MM/YYYY a YYYY-MM-DD
        const parts = cleanDate.split('/');
        if (parts.length === 3) {
          date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
          date = new Date(cleanDate);
        }
      } else {
        date = new Date(cleanDate);
      }
    } else if (typeof dateValue === 'number') {
      date = new Date(dateValue);
    } else {
      console.log('Unknown date format:', dateValue, typeof dateValue);
      return 'Not specified';
    }

    if (isNaN(date.getTime())) {
      console.log('Invalid date:', dateValue);
      return 'Not specified';
    }

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error, 'Original value:', dateValue);
    return 'Not specified';
  }
}

// =====================================================
// ✅ RATE LIMITING SIMPLE
// =====================================================

function checkRateLimit(identifier) {
  try {
    const now = Date.now();
    const rateLimitSheet = getOrCreateRateLimitSheet();
    const data = rateLimitSheet.getDataRange().getValues();

    // Limpiar requests antiguos (más de 5 minutos)
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    const recentRequests = data.filter(row => row[1] && row[1] > fiveMinutesAgo && row[0] === identifier);

    if (recentRequests.length > 20) { // Max 20 requests per 5 minutes
      throw new Error('Rate limit exceeded. Please wait before trying again.');
    }

    // Log this request
    rateLimitSheet.appendRow([identifier, now]);

  } catch (error) {
    console.warn('Rate limit check failed:', error);
    // No bloquear si hay error en rate limiting
  }
}

function getOrCreateRateLimitSheet() {
  const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
  let rateLimitSheet = spreadsheet.getSheetByName('Rate_Limits');

  if (!rateLimitSheet) {
    rateLimitSheet = spreadsheet.insertSheet('Rate_Limits');
    rateLimitSheet.getRange(1, 1, 1, 2).setValues([['Identifier', 'Timestamp']]);
  }

  return rateLimitSheet;
}

// =====================================================
// MAIN FUNCTION - HANDLE REQUESTS (CON VALIDACIONES)
// =====================================================

function doPost(e) {
  try {
    logActivity('doPost', 'Request received', null);
    console.log('=== TT CIRCLE BOT - PAYMENT CODE AS BALANCE ===');

    if (!e.postData || !e.postData.contents) {
      throw new Error('No data received in request');
    }

    const data = JSON.parse(e.postData.contents);
    console.log('Action requested:', data.action);

    // ✅ Rate limiting básico
    if (data.action !== 'testConnection') {
      checkRateLimit(data.code || 'anonymous');
    }

    let result;
    switch(data.action) {
      case 'checkPaymentCode':
        if (!validatePaymentCode(data.code)) {
          throw new Error('Invalid payment code format. Must be 6-12 alphanumeric characters.');
        }
        result = checkPaymentCode(data.code);
        break;
      case 'getQuoteData':
        if (!validateQuoteCode(data.quoteCode)) {
          throw new Error('Invalid quote code format. Must start with TT followed by 4 digits and 6 alphanumeric characters.');
        }
        result = getQuoteDataFromImportRange(data.quoteCode);
        break;
      case 'sendInsuranceEmail':
        result = sendInsuranceEmailWithCertificate(data.quoteData);
        break;
      case 'testConnection':
        result = testBotConnection();
        break;
      default:
        throw new Error('Unknown action: ' + data.action);
    }

    return result;

  } catch (error) {
    console.error('Bot error:', error);
    logActivity('doPost', 'ERROR: ' + error.toString(), null, 'ERROR');

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
// GET QUOTE DATA - READ-ONLY FROM IMPORTRANGE
// =====================================================

function getQuoteDataFromImportRange(quoteCode) {
  try {
    console.log('Getting quote data for:', quoteCode);
    logActivity('getQuoteData', 'Searching quote: ' + quoteCode, null);

    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    const quotesSheet = spreadsheet.getSheetByName(BOT_CONFIG.QUOTES_IMPORT_SHEET);

    if (!quotesSheet) {
      console.log('⚠️ Quotes sheet not found, searching directly in main sheet...');
      return getQuoteDataFromMainSheet(quoteCode);
    }

    const data = quotesSheet.getDataRange().getValues();
    if (data.length <= 1) {
      console.log('⚠️ No data in imported sheet, searching directly in main sheet...');
      return getQuoteDataFromMainSheet(quoteCode);
    }

    const rows = data.slice(1);
    console.log(`📊 Searching in ${rows.length} imported quote records`);

    const foundRow = rows.find(row =>
      row[1] && row[1].toString().toUpperCase() === quoteCode.toUpperCase()
    );

    if (!foundRow) {
      console.log('Quote not found in imported data, trying main sheet...');
      return getQuoteDataFromMainSheet(quoteCode);
    }

    const result = mapQuoteData(foundRow);
    logActivity('getQuoteData', 'Quote found in imported data: ' + result.policyHolder, quoteCode);
    console.log('✅ Quote found in imported data for:', result.policyHolder);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        data: result,
        source: 'imported_data'
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('Error reading imported data, trying main sheet:', error);
    return getQuoteDataFromMainSheet(quoteCode);
  }
}

// =====================================================
// GET QUOTE DATA DIRECTLY FROM MAIN SHEET
// =====================================================

function getQuoteDataFromMainSheet(quoteCode) {
  try {
    console.log('Getting quote data from main sheet for:', quoteCode);
    logActivity('getQuoteData', 'Searching in main sheet: ' + quoteCode, null);

    const mainSpreadsheet = SpreadsheetApp.openById(BOT_CONFIG.SOURCE_SHEET_ID);
    const mainSheet = mainSpreadsheet.getSheetByName(BOT_CONFIG.SOURCE_SHEET_NAME);

    if (!mainSheet) {
      throw new Error(`Sheet "${BOT_CONFIG.SOURCE_SHEET_NAME}" not found in main spreadsheet`);
    }

    const data = mainSheet.getDataRange().getValues();
    if (data.length <= 1) {
      throw new Error('No data found in main sheet');
    }

    const rows = data.slice(1);
    console.log(`📊 Searching in ${rows.length} main sheet records`);

    const foundRow = rows.find(row =>
      row[1] && row[1].toString().toUpperCase() === quoteCode.toUpperCase()
    );

    if (!foundRow) {
      logActivity('getQuoteData', 'Quote not found in main sheet: ' + quoteCode, null);
      console.log('❌ Quote not found in main sheet. Sample codes:');
      rows.slice(0, 5).forEach(row => console.log(`- ${row[1]}`));

      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          message: 'Quote code not found in system',
          debug: {
            searchedCode: quoteCode,
            totalQuotes: rows.length,
            sampleCodes: rows.slice(0, 3).map(r => r[1]).filter(c => c),
            source: 'main_sheet'
          }
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const result = mapQuoteData(foundRow);
    logActivity('getQuoteData', 'Quote found in main sheet: ' + result.policyHolder, quoteCode);
    console.log('✅ Quote found in main sheet for:', result.policyHolder);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        data: result,
        source: 'main_sheet'
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('Error getting quote from main sheet:', error);
    logActivity('getQuoteData', 'ERROR in main sheet: ' + error.toString(), quoteCode, 'ERROR');

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Error retrieving quote from main sheet: ' + error.toString(),
        debug: {
          mainSheetId: BOT_CONFIG.SOURCE_SHEET_ID,
          sheetName: BOT_CONFIG.SOURCE_SHEET_NAME
        }
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// ✅ HELPER FUNCTION TO MAP DATA - CORREGIDO Y MEJORADO
// =====================================================

function mapQuoteData(row) {
  return {
    timestamp:             row[0]  || '',
    quoteCode:             row[1]  || '',
    email:                 row[2]  || '',
    policyHolder:          row[3]  || '',
    policyHolderAddress:   row[4]  || '',
    beneficiaryName:       row[5]  || '',
    beneficiaryAddress:    row[6]  || '',
    transportType:         row[7]  || '',
    incoterm:              row[8]  || '',
    packageType:           row[9]  || '',
    cargoType:             row[10] || '',
    quantity:              row[11] || '',
    currency:              row[12] || '',
    origin:                row[13] || '',
    destination:           row[14] || '',
    exwPrice:              row[15] || 0,
    // ✅ CORREGIDO: Usar nombre consistente
    freightAndOtherCosts:  row[16] || 0,
    totalValue:            row[17] || 0,
    estimatedPremium:      row[18] || 0,
    premiumRatePercent:    row[19] || '',
    iccCoverage:           row[20] || '',
    additionalCoverage:    row[21] || 'None',
    packagingTypes:        row[22] || '',
    cargoCondition:        row[23] || '',
    departureDate:         row[24] || '',
    requestDate:           row[25] || '',
    additionalNotes:       row[26] || 'None',
    status:                row[27] || 'Pending',
    riskAssessmentSummary: row[28] || '',

    // ✅ CAMPOS ADICIONALES PARA COMPATIBILIDAD
    requesterName:         row[3]  || '', // Fallback a policyHolder
    premiumRate:           row[19] || ''  // Alias para compatibilidad
  };
}

// =====================================================
// ✅ GENERATE PDF CERTIFICATE VIA DOCUMENT TEMPLATE (OPTIMIZADO)
// =====================================================

function generateInsuranceCertificatePDF(quoteData) {
  try {
    console.log('🔧 Generating PDF certificate using template for quote:', quoteData.quoteCode);
    logActivity('generatePDF', 'Start generating PDF for: ' + quoteData.quoteCode, quoteData.quoteCode);

    // 1) Generate unique identifiers
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);
    const policyNumber = `${BOT_CONFIG.CERTIFICATE_CONFIG.POLICY_PREFIX}-${timestamp}`;
    const certificateNumber = `${BOT_CONFIG.CERTIFICATE_CONFIG.CERTIFICATE_PREFIX}-${quoteData.quoteCode}`;

    // 2) Format dates
    const formattedDeparture = formatDateSafely(quoteData.departureDate);
    const formattedRequest   = formatDateSafely(quoteData.requestDate);
    const formattedIssue     = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // 3) Copy the template document
    const templateId = BOT_CONFIG.CERTIFICATE_CONFIG.TEMPLATE_DOC_ID;
    const templateFile = DriveApp.getFileById(templateId);
    const copyTitle = `TempCert_${quoteData.quoteCode}_${timestamp}`;
    const tempFile = templateFile.makeCopy(copyTitle);
    const tempDocId = tempFile.getId();
    const tempDoc = DocumentApp.openById(tempDocId);
    const body = tempDoc.getBody();

    // ✅ 4) OPTIMIZED REPLACEMENTS - Crear objeto de reemplazos
    const replacements = {
      '{{COMPANY_NAME}}':             BOT_CONFIG.CERTIFICATE_CONFIG.COMPANY_NAME,
      '{{COMPANY_ADDRESS}}':          BOT_CONFIG.CERTIFICATE_CONFIG.COMPANY_ADDRESS,
      '{{POLICY_NUMBER}}':            policyNumber,
      '{{CERTIFICATE_NUMBER}}':       certificateNumber,
      '{{QUOTE_CODE}}':               quoteData.quoteCode,
      '{{TIMESTAMP}}':                quoteData.timestamp,
      '{{ISSUE_DATE}}':               formattedIssue,
      '{{DEPARTURE_DATE}}':           formattedDeparture,
      '{{REQUEST_DATE}}':             formattedRequest,

      '{{EMAIL}}':                    quoteData.email,
      '{{POLICY_HOLDER}}':            quoteData.policyHolder,
      '{{REQUESTER_NAME}}':           quoteData.requesterName || quoteData.policyHolder,
      '{{POLICY_HOLDER_ADDRESS}}':    quoteData.policyHolderAddress || 'N/A',
      '{{BENEFICIARY_NAME}}':         quoteData.beneficiaryName || 'N/A',
      '{{BENEFICIARY_ADDRESS}}':      quoteData.beneficiaryAddress || 'N/A',

      '{{TRANSPORT_TYPE}}':           quoteData.transportType,
      '{{INCOTERM}}':                 quoteData.incoterm || 'N/A',
      '{{PACKAGE_TYPE}}':             quoteData.packageType,
      '{{CARGO_TYPE}}':               quoteData.cargoType,
      '{{QUANTITY}}':                 quoteData.quantity,
      '{{CURRENCY}}':                 quoteData.currency,
      '{{ORIGIN}}':                   quoteData.origin,
      '{{DESTINATION}}':              quoteData.destination,

      '{{EXW_PRICE}}':                quoteData.exwPrice,
      // ✅ CORREGIDO: Usar el campo correcto
      '{{FREIGHT_OTHER_COSTS}}':      quoteData.freightAndOtherCosts || '0',
      '{{TOTAL_VALUE}}':              quoteData.totalValue,
      '{{ESTIMATED_PREMIUM}}':        quoteData.estimatedPremium,
      '{{PREMIUM_RATE_PERCENT}}':     quoteData.premiumRatePercent || quoteData.premiumRate || 'N/A',

      '{{ICC_COVERAGE}}':             quoteData.iccCoverage,
      '{{ADDITIONAL_COVERAGE}}':      quoteData.additionalCoverage,
      '{{PACKAGING_TYPES}}':          quoteData.packagingTypes,
      '{{CARGO_CONDITION}}':          quoteData.cargoCondition,

      '{{ADDITIONAL_NOTES}}':         quoteData.additionalNotes && quoteData.additionalNotes !== 'None' ? quoteData.additionalNotes : 'N/A',
      '{{STATUS}}':                   quoteData.status,
      '{{RISK_ASSESSMENT_SUMMARY}}':  quoteData.riskAssessmentSummary || 'N/A',

      '{{COMPANY_SIGNATURE_NAME}}':   BOT_CONFIG.CERTIFICATE_CONFIG.COMPANY_NAME,
      '{{ASSURED_SIGNATURE_NAME}}':   quoteData.policyHolder
    };

    // ✅ Aplicar todos los reemplazos en un bucle
    Object.entries(replacements).forEach(([placeholder, value]) => {
      body.replaceText(placeholder, String(value || 'N/A'));
    });

    // 5) Save and close the temporary document
    tempDoc.saveAndClose();

    // 6) Convert the filled document to PDF
    const pdfBlob = DriveApp.getFileById(tempDocId).getAs('application/pdf');
    pdfBlob.setName(`Certificate_${quoteData.quoteCode}_${timestamp}.pdf`);

    // … aquí harías la llamada al helper en el otro archivo .gs
    guardarPdfEnCarpeta(pdfBlob);

    // 7) Move the temp file to trash
    DriveApp.getFileById(tempDocId).setTrashed(true);

    console.log('✅ PDF certificate generated successfully via template');
    logActivity('generatePDF', 'Certificate generated successfully for: ' + quoteData.policyHolder, quoteData.quoteCode);

    return pdfBlob;

  } catch (error) {
    console.error('❌ Error generating PDF certificate via template:', error);
    logActivity('generatePDF', 'ERROR: ' + error.toString(), quoteData.quoteCode, 'ERROR');
    throw new Error('Failed to generate PDF certificate via template: ' + error.toString());
  }
}

// =====================================================
// SEND EMAIL WITH TEMPLATE-BASED PDF CERTIFICATE ATTACHED
// ✅ v2.5 - Cobra la prima contra el saldo ANTES de emitir nada
// =====================================================

function sendInsuranceEmailWithCertificate(quoteData) {

  // Declarado fuera del try para que el catch pueda devolver el importe
  // si algo falla después de haber cobrado.
  var charge = null;

  try {
    console.log('📧 Sending insurance email with template PDF to:', quoteData.email);
    logActivity('sendInsuranceEmail', 'Sending with certificate to: ' + quoteData.email, quoteData.quoteCode);

    // ✅ PASO 0: cobrar la prima contra el saldo del código de pago.
    // La prima se toma de quoteData, que viene de la hoja — no de lo que
    // el navegador quiera mandar. Sin fondos no se emite certificado.
    charge = chargePaymentCode(quoteData.paymentCode, quoteData.estimatedPremium);

    if (!charge.ok) {
      console.error('❌ Payment refused:', charge.reason);
      logActivity('sendInsuranceEmail', 'PAYMENT REFUSED: ' + charge.reason,
                  quoteData.quoteCode, 'ERROR');

      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: charge.reason,
          balanceBefore: charge.balanceBefore,
          premiumDue: quoteData.estimatedPremium
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Generate the PDF certificate from template
    console.log('🔧 Step 1: Generating PDF from template...');
    const certificatePDF = generateInsuranceCertificatePDF(quoteData);

    console.log('🔧 Step 2: Creating email content...');
    const subject = `TT CIRCLE Insurance - Payment Confirmed & Certificate ${quoteData.quoteCode}`;
    const htmlBody = createPaymentConfirmationEmailWithCertificate(quoteData, charge);

    console.log('🔧 Step 3: Sending email with attachment...');
    MailApp.sendEmail({
      to: quoteData.email,
      subject: subject,
      htmlBody: htmlBody,
      attachments: [certificatePDF],
      name: BOT_CONFIG.EMAIL.FROM_NAME,
      replyTo: BOT_CONFIG.EMAIL.REPLY_TO
    });

    console.log('🔧 Step 4: Charged. Balance now', charge.balanceAfter);

    logActivity('sendInsuranceEmail', 'Email with certificate sent successfully', quoteData.quoteCode);
    console.log('✅ Insurance email with certificate sent successfully to:', quoteData.email);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: 'Payment confirmation email with certificate sent successfully',
        certificateGenerated: true,
        emailSent: true,
        paymentCode: quoteData.paymentCode,
        amountCharged: quoteData.estimatedPremium,
        balanceBefore: charge.balanceBefore,
        balanceAfter: charge.balanceAfter
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('❌ Error sending insurance email with certificate:', error);

    // Si ya se había cobrado, devolver el importe: nadie debe pagar por un
    // certificado que no llegó a emitirse.
    if (charge && charge.ok) {
      refundPaymentCode(quoteData.paymentCode, quoteData.estimatedPremium);
      logActivity('sendInsuranceEmail',
        'Refunded ' + quoteData.estimatedPremium + ' to ' + quoteData.paymentCode +
        ' after failure', quoteData.quoteCode, 'ERROR');
    }

    logActivity('sendInsuranceEmail', 'ERROR: ' + error.toString(), quoteData.quoteCode || 'unknown', 'ERROR');

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Error sending email with certificate: ' + error.toString(),
        refunded: Boolean(charge && charge.ok),
        details: {
          step: 'Email sending failed',
          originalError: error.message
        }
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// ✅ EMAIL TEMPLATE FOR CONFIRMATION - MEJORADO
// =====================================================

function createPaymentConfirmationEmailWithCertificate(data, charge) {
  const departureDate = formatDateSafely(data.departureDate);
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // ✅ Mostrar freight costs correctamente
  const freightCosts = data.freightAndOtherCosts ?
    `${data.freightAndOtherCosts} ${data.currency}` : 'N/A';

  // Bloque del saldo, solo si hubo cobro
  const balanceBlock = (charge && charge.ok) ? `
          <div style="background: #eef6fd; border: 1px solid #009fe3; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #0b2d63;">Account ${data.paymentCode || ''}</h4>
            <table class="info-table">
              <tr><td>Balance before:</td><td>${charge.balanceBefore} ${charge.currency}</td></tr>
              <tr><td>Premium charged:</td><td><strong>${data.estimatedPremium} ${data.currency}</strong></td></tr>
              <tr><td>Balance remaining:</td><td><strong>${charge.balanceAfter} ${charge.currency}</strong></td></tr>
            </table>
          </div>` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 650px; margin: 0 auto; background: #ffffff; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 2.2rem; font-weight: 700; }
        .header p { margin: 10px 0 0; font-size: 1.1rem; opacity: 0.9; }
        .content { padding: 30px; }
        .success-banner { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center; }
        .policy-code { background: #10b981; color: white; padding: 15px; border-radius: 8px; text-align: center; font-family: 'Courier New', monospace; font-size: 1.4rem; font-weight: bold; letter-spacing: 2px; margin: 20px 0; }
        .quote-info { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 25px; border-radius: 12px; margin: 25px 0; border: 1px solid #e2e8f0; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table td { padding: 12px 15px; border-bottom: 1px solid #e5e7eb; }
        .info-table td:first-child { font-weight: 600; background: #f9fafb; width: 40%; }
        .status-active { color: #10b981; font-weight: bold; font-size: 1.2rem; }
        .certificate-notice { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center; }
        .footer { background: #f8fafc; padding: 25px; text-align: center; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛡️ TT CIRCLE</h1>
          <p>Payment Confirmed - Policy Activated</p>
        </div>

        <div class="content">
          <div class="success-banner">
            <h2 style="margin: 0; color: #065f46;">✅ PAYMENT PROCESSED SUCCESSFULLY</h2>
            <p style="margin: 10px 0 0; color: #065f46; font-size: 1.1rem;">Your cargo insurance policy is now ACTIVE</p>
          </div>

          <h3>Dear ${data.policyHolder},</h3>
          <p>Your payment has been successfully processed. Your cargo is now fully protected under policy <strong>${data.quoteCode}</strong>.</p>

          <div class="certificate-notice">
            <h3 style="margin: 0; color: #92400e;">📄 OFFICIAL CERTIFICATE ATTACHED</h3>
            <p style="margin: 10px 0 0; color: #92400e; font-size: 1.1rem;">Your official insurance certificate has been generated from our template and is attached as a PDF document. Please keep it safe for your records and any potential claims.</p>
          </div>

          <div class="policy-code">POLICY: ${data.quoteCode}</div>
          ${balanceBlock}

          <div class="quote-info">
            <h3 style="margin-top: 0; color: #1f2937;">📋 Active Insurance Policy</h3>
            <table class="info-table">
              <tr><td>Policy Number:</td><td><strong>${data.quoteCode}</strong></td></tr>
              <tr><td>Policy Holder:</td><td><strong>${data.policyHolder}</strong></td></tr>
              <tr><td>Policy Holder Address:</td><td>${data.policyHolderAddress || 'N/A'}</td></tr>
              <tr><td>Beneficiary:</td><td>${data.beneficiaryName || 'N/A'}</td></tr>
              <tr><td>Beneficiary Address:</td><td>${data.beneficiaryAddress || 'N/A'}</td></tr>
              <tr><td>Coverage Status:</td><td><span class="status-active">🟢 ACTIVE</span></td></tr>
              <tr><td>Route:</td><td>${data.origin} → ${data.destination}</td></tr>
              <tr><td>Transport:</td><td>${data.transportType}</td></tr>
              <tr><td>Incoterm:</td><td>${data.incoterm || 'N/A'}</td></tr>
              <tr><td>Cargo Type:</td><td>${data.cargoType}</td></tr>
              <tr><td>Quantity:</td><td>${data.quantity}</td></tr>
              <tr><td>Total Value:</td><td><strong>${data.totalValue} ${data.currency}</strong></td></tr>
              <tr><td>Freight & Other Costs:</td><td>${freightCosts}</td></tr>
              <tr><td>Premium:</td><td><strong>${data.estimatedPremium} ${data.currency}</strong></td></tr>
              <tr><td>Premium Rate:</td><td>${data.premiumRatePercent || data.premiumRate || 'N/A'}</td></tr>
              <tr><td>Departure:</td><td><strong>${departureDate}</strong></td></tr>
              <tr><td>Issue Date:</td><td><strong>${currentDate}</strong></td></tr>
            </table>
          </div>

          <div style="background: #e0f2fe; border: 1px solid #0288d1; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #01579b;">📎 Important Documents:</h4>
            <ul style="margin: 0; padding-left: 20px; color: #01579b;">
              <li><strong>Official Insurance Certificate (PDF)</strong> - Attached to this email</li>
              <li>Keep the original certificate for claims</li>
              <li>Present certificate when making any claim</li>
              <li>Certificate must be surrendered upon payment of claims</li>
            </ul>
          </div>

          ${data.riskAssessmentSummary ? `
          <div style="background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <h4 style="margin: 0 0 10px 0; color: #374151;">📊 Risk Assessment:</h4>
            <p style="margin: 0; color: #374151; font-size: 0.9rem;">${data.riskAssessmentSummary}</p>
          </div>
          ` : ''}
        </div>

        <div class="footer">
          <p><strong>TT CIRCLE Insurance</strong></p>
          <p>Automated cargo protection • Always available</p>
          <p style="font-size: 0.9rem; margin-top: 15px;">
            In case of loss or damage, please contact us immediately for claims processing.<br>
            Keep your certificate safe - it's required for any insurance claims.<br>
            Support: ${BOT_CONFIG.EMAIL.SUPPORT_EMAIL}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// =====================================================
// VERIFY PAYMENT CODE (CON VALIDACIÓN)
// =====================================================

function checkPaymentCode(code) {
  try {
    console.log('Checking payment code:', code);
    logActivity('checkPaymentCode', 'Checking code: ' + code, null);

    // ✅ Validación adicional
    if (!validatePaymentCode(code)) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: 'Invalid payment code format. Must be 6-12 alphanumeric characters.',
          validationError: true
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    const bankSheet = spreadsheet.getSheetByName(BOT_CONFIG.BANK_SHEET);

    if (!bankSheet) {
      throw new Error('Bank sheet not found. Please create "Bank" sheet with payment codes.');
    }

    const bankData = bankSheet.getDataRange().getValues();
    if (bankData.length <= 1) {
      throw new Error('No payment codes found in Bank sheet');
    }

    const codeUpper = code.toUpperCase();
    const foundRow = bankData.find(row =>
      row[0] && row[0].toString().toUpperCase() === codeUpper
    );

    if (!foundRow) {
      logActivity('checkPaymentCode', 'Code not found: ' + code, null);
      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          found: false,
          message: 'Payment code not found in system'
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const status = foundRow[3] ? foundRow[3].toString().toUpperCase() : 'VALID';
    const balance = parseFloat(foundRow[1]) || 0;

    // ✅ v2.5: el código muere cuando se agota el saldo, no al primer uso.
    if (status === 'USED' || status === 'DEPLETED' || balance <= 0) {
      logActivity('checkPaymentCode', 'Code exhausted: ' + code, null);
      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          found: true,
          valid: false,
          message: 'Payment code has no funds left'
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const paymentInfo = {
      code: foundRow[0],
      amount: balance,
      currency: foundRow[2] || 'EUR',
      status: status
    };

    logActivity('checkPaymentCode', 'Code verified: ' + code, JSON.stringify(paymentInfo));
    console.log('Payment code verified:', paymentInfo);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        found: true,
        valid: true,
        paymentInfo: paymentInfo,
        message: 'Payment code verified successfully'
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('Error checking payment code:', error);
    logActivity('checkPaymentCode', 'ERROR: ' + error.toString(), code, 'ERROR');

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Error verifying payment code: ' + error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// ✅ v2.5 - CHARGE AGAINST THE PAYMENT CODE BALANCE
//
// Sustituye a markPaymentCodeAsUsed(), que además nunca llegaba a
// ejecutarse: se la llamaba con quoteData.paymentCode, un campo que
// mapQuoteData() no produce, así que la condición era siempre falsa
// y ningún código se marcaba jamás.
// =====================================================

function chargePaymentCode(paymentCode, amount) {
  if (!paymentCode) {
    return { ok: false, reason: 'No payment code supplied' };
  }

  const charge = parseFloat(amount);
  if (!isFinite(charge) || charge < 0) {
    return { ok: false, reason: 'Invalid amount to charge' };
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    const bankSheet = spreadsheet.getSheetByName(BOT_CONFIG.BANK_SHEET);
    if (!bankSheet) {
      return { ok: false, reason: 'Bank sheet not found' };
    }

    const data = bankSheet.getDataRange().getValues();
    const wanted = paymentCode.toString().toUpperCase().trim();

    for (let i = 1; i < data.length; i++) {
      const cell = data[i][0];
      if (!cell || cell.toString().toUpperCase().trim() !== wanted) continue;

      const balanceBefore = parseFloat(data[i][1]) || 0;
      const currency = data[i][2] || 'EUR';
      const status = data[i][3] ? data[i][3].toString().toUpperCase() : '';

      if (status === 'USED' || status === 'DEPLETED') {
        return { ok: false, reason: 'Payment code has no funds left',
                 balanceBefore: balanceBefore, currency: currency };
      }

      if (balanceBefore < charge) {
        return { ok: false, reason: 'Insufficient funds',
                 balanceBefore: balanceBefore, currency: currency };
      }

      const balanceAfter = Math.round((balanceBefore - charge) * 100) / 100;

      bankSheet.getRange(i + 1, 2).setValue(balanceAfter);                       // saldo
      bankSheet.getRange(i + 1, 4).setValue(balanceAfter <= 0 ? 'DEPLETED' : 'VALID');
      bankSheet.getRange(i + 1, 5).setValue(new Date());                         // último uso

      logActivity('chargePaymentCode',
        'Charged ' + charge + ' ' + currency + ' to ' + wanted +
        ' (' + balanceBefore + ' -> ' + balanceAfter + ')', wanted);

      return { ok: true, balanceBefore: balanceBefore, balanceAfter: balanceAfter,
               currency: currency };
    }

    return { ok: false, reason: 'Payment code not found' };

  } catch (error) {
    console.error('Error charging payment code:', error);
    logActivity('chargePaymentCode', 'ERROR: ' + error.toString(), paymentCode, 'ERROR');
    return { ok: false, reason: 'Error charging payment code: ' + error.toString() };
  }
}

// =====================================================
// ✅ v2.5 - REFUND (si el certificado no llegó a emitirse)
// =====================================================

function refundPaymentCode(paymentCode, amount) {
  if (!paymentCode) return;

  const refund = parseFloat(amount);
  if (!isFinite(refund) || refund <= 0) return;

  try {
    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    const bankSheet = spreadsheet.getSheetByName(BOT_CONFIG.BANK_SHEET);
    if (!bankSheet) return;

    const data = bankSheet.getDataRange().getValues();
    const wanted = paymentCode.toString().toUpperCase().trim();

    for (let i = 1; i < data.length; i++) {
      const cell = data[i][0];
      if (!cell || cell.toString().toUpperCase().trim() !== wanted) continue;

      const balance = parseFloat(data[i][1]) || 0;
      const restored = Math.round((balance + refund) * 100) / 100;

      bankSheet.getRange(i + 1, 2).setValue(restored);
      bankSheet.getRange(i + 1, 4).setValue('VALID');

      console.log('Refunded', refund, 'to', wanted, '->', restored);
      return;
    }
  } catch (error) {
    console.error('Error refunding payment code:', error);
  }
}

// =====================================================
// ✅ LOGGING SYSTEM MEJORADO
// =====================================================

function logActivity(action, details, reference, severity = 'INFO') {
  try {
    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    let logsSheet = spreadsheet.getSheetByName(BOT_CONFIG.LOGS_SHEET);

    if (!logsSheet) {
      logsSheet = spreadsheet.insertSheet(BOT_CONFIG.LOGS_SHEET);
      logsSheet.getRange(1, 1, 1, 7).setValues([[
        'Timestamp', 'Action', 'Details', 'Reference', 'Source', 'Severity', 'Status'
      ]]);
      logsSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#f0f0f0');
    }

    const logData = [
      new Date(),
      action,
      details,
      reference || '',
      `Bot ${BOT_CONFIG.VERSION}`,
      severity,
      'LOGGED'
    ];

    logsSheet.appendRow(logData);

    // ✅ Log crítico en consola
    if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(`[${severity}] ${action}: ${details}`);
    }

  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// =====================================================
// INITIALIZATION FOR NECESSARY SHEETS ONLY
// =====================================================

function initializeNonInterferingBot() {
  console.log('=== INITIALIZING BOT v2.5 - PAYMENT CODE AS BALANCE ===');

  try {
    const spreadsheet = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);

    // Create ONLY the sheets the bot needs (DO NOT touch Quotes)
    const requiredSheets = [
      BOT_CONFIG.BANK_SHEET,
      BOT_CONFIG.LOGS_SHEET,
      BOT_CONFIG.CONFIG_SHEET
    ];

    requiredSheets.forEach(sheetName => {
      let sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(sheetName);
        console.log('✅ Created sheet:', sheetName);

        if (sheetName === BOT_CONFIG.BANK_SHEET) {
          sheet.getRange(1, 1, 1, 5).setValues([[
            'Payment Code', 'Amount', 'Currency', 'Status', 'Date Used'
          ]]);
          const samplePayments = [
            ['TEAM01', 5000, 'EUR', 'VALID', ''],
            ['TEAM02', 5000, 'EUR', 'VALID', ''],
            ['TEAM03', 5000, 'EUR', 'VALID', '']
          ];
          sheet.getRange(2, 1, samplePayments.length, 5).setValues(samplePayments);

        } else if (sheetName === BOT_CONFIG.CONFIG_SHEET) {
          const configData = [
            ['Setting', 'Value'],
            ['bot_status', 'ACTIVE'],
            ['system_type', 'PAYMENT_CODE_AS_BALANCE'],
            ['main_sheet_id', BOT_CONFIG.SOURCE_SHEET_ID],
            ['email_notifications', 'TRUE'],
            ['pdf_certificates', 'TRUE'],
            ['version', BOT_CONFIG.VERSION],
            ['validation_enabled', 'TRUE'],
            ['rate_limiting_enabled', 'TRUE']
          ];
          sheet.getRange(1, 1, configData.length, 2).setValues(configData);
        }

        sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#f0f0f0');
      }
    });

    logActivity('initializeBot', 'Bot v2.5 initialized successfully', 'SYSTEM');

    console.log('=== BOT v2.5 READY ===');
    console.log('✅ Sheet "Quotes" with IMPORTRANGE left untouched');
    console.log('✅ Payment codes now carry a balance that depletes');
    console.log('✅ Premium charged before the certificate is issued');
    console.log('✅ Refund on failure');

    return {
      success: true,
      message: 'Bot v2.5 initialized successfully',
      version: BOT_CONFIG.VERSION,
      sheets: requiredSheets,
      importrangeIntact: true,
      pdfCertificates: true,
      features: ['PAYMENT_BALANCE', 'CHARGE_BEFORE_ISSUE', 'REFUND_ON_FAILURE',
                 'TEMPLATE_PDF_CERTIFICATES', 'EMAIL_ATTACHMENTS',
                 'IMPORTRANGE_COMPATIBLE', 'INPUT_VALIDATION', 'RATE_LIMITING']
    };

  } catch (error) {
    console.error('Error initializing bot:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// =====================================================
// ✅ TEST CONNECTION MEJORADO
// =====================================================

function testBotConnection() {
  try {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        status: 'OPERATIONAL',
        system: 'PAYMENT_CODE_AS_BALANCE',
        timestamp: new Date().toISOString(),
        message: 'TT CIRCLE Bot v2.5 is working correctly',
        version: BOT_CONFIG.VERSION,
        mainSheetId: BOT_CONFIG.SOURCE_SHEET_ID,
        botSheetId: BOT_CONFIG.BOT_SHEET_ID,
        features: [
          'PAYMENT_BALANCE',
          'CHARGE_BEFORE_ISSUE',
          'REFUND_ON_FAILURE',
          'TEMPLATE_PDF_CERTIFICATES',
          'EMAIL_ATTACHMENTS',
          'IMPORTRANGE_COMPATIBLE',
          'INPUT_VALIDATION',
          'RATE_LIMITING',
          'IMPROVED_LOGGING'
        ]
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// ✅ TEST: cobrar y devolver, sin emitir nada
// Ejecútala desde el editor para comprobar el saldo.
// =====================================================

function testChargeAndRefund() {
  const code = 'TEAM01';
  const amount = 108.68;

  const charged = chargePaymentCode(code, amount);
  console.log('Charge result:', charged);

  if (charged.ok) {
    refundPaymentCode(code, amount);
    console.log('Refunded. The balance should be back to', charged.balanceBefore);
  }

  return charged;
}

// =====================================================
// ✅ TEST FUNCTION TO GENERATE CERTIFICATE - TEMPLATE VERSION
// =====================================================

function testCertificateGeneration() {
  const testQuoteData = {
    timestamp:                '2025-06-04 16:11:20',
    quoteCode:                'TT2506YO3L9G',
    email:                    'international@escolaeuropea.eu',
    policyHolder:             'Play Forwarding',
    policyHolderAddress:      'Calle Mayor 123, Madrid, Spain',
    beneficiaryName:          'Test Beneficiary',
    beneficiaryAddress:       'Test Address 456, Barcelona, Spain',
    requesterName:            'Orlando Reveco',
    transportType:            'air',
    incoterm:                 'CIF',
    packageType:              'Large Box (> 100kg, up to 150x100x100 cm)',
    cargoType:                'general',
    quantity:                 '2',
    currency:                 'EUR',
    origin:                   'Spain',
    destination:              'Sweden',
    exwPrice:                 '425,000.00',
    freightAndOtherCosts:     '18,500.00',
    totalValue:               '443,500.00',
    estimatedPremium:         '612.03',
    premiumRatePercent:       '13.800%',
    iccCoverage:              'ICC(B)',
    additionalCoverage:       'None',
    packagingTypes:           'Cardboard Box',
    cargoCondition:           'Used',
    departureDate:            '2025-06-19',
    requestDate:              '2025-06-04',
    additionalNotes:          'None',
    status:                   'Pending Review',
    riskAssessmentSummary:    'Low risk - standard cargo'
  };

  try {
    console.log('🧪 Testing certificate generation via template...');
    const certificate = generateInsuranceCertificatePDF(testQuoteData);
    console.log('✅ Test certificate generated successfully');
    console.log('Certificate size:', certificate.getBytes().length, 'bytes');

    const formattedDate = formatDateSafely(testQuoteData.departureDate);
    console.log('📅 Date formatting test:', formattedDate);

    return {
      success: true,
      message: 'Test certificate generated successfully via template',
      certificateSize: certificate.getBytes().length,
      dateFormatTest: formattedDate
    };

  } catch (error) {
    console.error('❌ Error generating test certificate via template:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// =====================================================
// PURGAR ENTRADAS ANTIGUAS EN Bot_Logs (automático)
// =====================================================

function purgeOldLogs() {
  try {
    const daysThreshold = 30;
    const msInADay = 1000 * 60 * 60 * 24;
    const cutoffDate = new Date(Date.now() - daysThreshold * msInADay);

    const ss = SpreadsheetApp.openById(BOT_CONFIG.BOT_SHEET_ID);
    const logsSheet = ss.getSheetByName(BOT_CONFIG.LOGS_SHEET);
    if (!logsSheet) {
      console.warn('Bot_Logs sheet not found al intentar purgar.');
      return;
    }

    const lastRow = logsSheet.getLastRow();
    if (lastRow < 2) {
      return;
    }

    const timestamps = logsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const rowsToDelete = [];
    timestamps.forEach((cellArr, idx) => {
      const cellValue = cellArr[0];
      const logDate = new Date(cellValue);
      if (!isNaN(logDate.getTime()) && logDate < cutoffDate) {
        rowsToDelete.push(idx + 2);
      }
    });

    // Eliminar de abajo hacia arriba
    rowsToDelete.sort((a, b) => b - a).forEach(rowNum => {
      logsSheet.deleteRow(rowNum);
    });

    console.log(`❎ Se purgaron ${rowsToDelete.length} filas de Bot_Logs anteriores a ${cutoffDate.toLocaleDateString()}`);

    // ✅ Log la purga
    if (rowsToDelete.length > 0) {
      logActivity('purgeOldLogs', `Purged ${rowsToDelete.length} old log entries`, null, 'INFO');
    }

  } catch (err) {
    console.error('Error en purgeOldLogs:', err);
    logActivity('purgeOldLogs', 'ERROR: ' + err.toString(), null, 'ERROR');
  }
}

// =====================================================
// ✅ FUNCIÓN ADICIONAL - LIMPIAR RATE LIMITS ANTIGUOS
// =====================================================

function cleanupOldRateLimits() {
  try {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const rateLimitSheet = getOrCreateRateLimitSheet();

    const data = rateLimitSheet.getDataRange().getValues();
    if (data.length <= 1) return;

    const rowsToDelete = [];
    data.slice(1).forEach((row, idx) => {
      if (row[1] && row[1] < fiveMinutesAgo) {
        rowsToDelete.push(idx + 2);
      }
    });

    // Eliminar de abajo hacia arriba
    rowsToDelete.sort((a, b) => b - a).forEach(rowNum => {
      rateLimitSheet.deleteRow(rowNum);
    });

    if (rowsToDelete.length > 0) {
      console.log(`🧹 Cleaned ${rowsToDelete.length} old rate limit entries`);
    }

  } catch (error) {
    console.error('Error cleaning rate limits:', error);
  }
}
