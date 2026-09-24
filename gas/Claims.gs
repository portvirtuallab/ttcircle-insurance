// ============================================================================
// Insurance Claims System - Google Apps Script (.gs)
//
// v2.0
//   · uploadFile ahora recibe el fichero en base64. Un doPost de Apps Script
//     NUNCA rellena e.files: la version anterior lanzaba excepcion en cada
//     subida y el navegador no miraba la respuesta, asi que las evidencias se
//     daban por archivadas sin estar en Drive.
//   · El correo sale como "TT CIRCLE Insurance", no con el nombre de la cuenta.
//   · Adjunta un acuse de recibo en PDF.
//   · Los enlaces apuntan a la pantalla de estado real, con el expediente.
//   · Importes en EUR. Antes ponia "$".
// ============================================================================

/** Constants **/
const SPREADSHEET_ID = '1g1JG90L3KwK57CmoWZb-f_4hPqxSsTIt_74PUxGeLDE';
const DRIVE_FOLDER_ID = '1SQKk4VB-UHPYLvcUugUAqcII83_3_TBY';

const BRAND = {
  NAME: 'TT CIRCLE Insurance',
  STATUS_URL: 'https://portvirtuallab.github.io/ttcircle-insurance/claim-status.html',
  FOOTER: 'TT CIRCLE · PVL.ONE training simulator, Escola Europea – Intermodal Transport'
};

/**
 * Entry point for HTTP POST requests.
 * Routes based on `action` parameter: verifyPolicy, uploadFile, submitClaim, logOperation.
 */
function doPost(e) {
  try {
    const action = e.parameter.action || 'submitClaim';

    switch (action) {
      case 'verifyPolicy':
        return verifyPolicyNumber(e.parameter.policyNumber);
      case 'uploadFile':
        return uploadFileToFolder(e);
      case 'submitClaim':
        return submitClaim(e);
      case 'logOperation':
        return logOperation(e);
      default:
        return submitClaim(e);
    }
  } catch (error) {
    console.error('Error in doPost:', error);
    return json({ success: false, error: error.toString() });
  }
}

/** Small helper so every branch answers the same shape. */
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Verify if a given policy number exists in Sheet2, column A.
 * Returns JSON: { valid: boolean, policyNumber: string }.
 */
function verifyPolicyNumber(policyNumber) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet2 = spreadsheet.getSheetByName('Sheet2');
    if (!sheet2) {
      throw new Error('Sheet2 not found');
    }

    const values = sheet2.getRange('A:A').getValues();
    const trimmedInput = policyNumber ? policyNumber.toString().trim() : '';
    const policyExists = values.some(row => {
      const cellValue = row[0];
      return cellValue && cellValue.toString().trim() === trimmedInput;
    });

    return json({ valid: policyExists, policyNumber: policyNumber });

  } catch (error) {
    console.error('Error verifying policy:', error);
    return json({ valid: false, error: error.toString() });
  }
}

/**
 * Upload one piece of evidence to the claims folder.
 *
 * The file arrives as base64 in e.parameter.fileData, with fileName and
 * mimeType beside it. It is NOT a multipart upload: an Apps Script doPost
 * has no e.files, so the old `e.files.file` threw on every single call.
 */
function uploadFileToFolder(e) {
  try {
    const incidentId = e.parameter.incidentId || 'unknown';
    const data       = e.parameter.fileData;
    const name       = e.parameter.fileName || 'evidence';
    const mime       = e.parameter.mimeType || 'application/octet-stream';

    if (!data) {
      throw new Error('No file data received (expected base64 in fileData)');
    }

    const bytes = Utilities.base64Decode(data);
    const blob  = Utilities.newBlob(bytes, mime, incidentId + '_' + name);

    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const createdFile = folder.createFile(blob);

    console.log('Stored evidence:', createdFile.getName(), createdFile.getId());

    return json({
      success: true,
      fileId: createdFile.getId(),
      fileName: createdFile.getName(),
      fileUrl: createdFile.getUrl()
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    return json({ success: false, error: error.toString() });
  }
}

/**
 * Submit a new insurance claim:
 * 1. Append claim data to "Claims" sheet.
 * 2. Email the claimant an acknowledgement with a PDF receipt attached.
 */
function submitClaim(e) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let claimsSheet = spreadsheet.getSheetByName('Claims');

    if (!claimsSheet) {
      claimsSheet = spreadsheet.insertSheet('Claims');
      claimsSheet.getRange(1, 1, 1, 11).setValues([[
        'Timestamp', 'Incident ID', 'Incident Date', 'Claimant Name',
        'Contact Email', 'Policy Number', 'Incident Description',
        'Damage Type', 'Estimated Loss', 'Additional Info', 'Files Count'
      ]]);
    }

    const timestamp      = new Date().toISOString();
    const incidentId     = e.parameter.incidentId || '';
    const incidentDate   = e.parameter.incidentDate || '';
    const claimantName   = e.parameter.claimantName || '';
    const contactEmail   = e.parameter.contactEmail || '';
    const policyNumber   = e.parameter.policyNumber || '';
    const incidentDesc   = e.parameter.incidentDescription || '';
    const damageType     = e.parameter.damageType || '';
    const estimatedLoss  = e.parameter.estimatedLoss || '0';
    const additionalInfo = e.parameter.additionalInfo || '';
    const filesCount     = e.parameter.filesCount || '0';

    const lastRow = claimsSheet.getLastRow();
    claimsSheet.getRange(lastRow + 1, 1, 1, 11).setValues([[
      timestamp, incidentId, incidentDate, claimantName, contactEmail,
      policyNumber, incidentDesc, damageType, estimatedLoss,
      additionalInfo, filesCount
    ]]);

    if (contactEmail) {
      const claim = {
        incidentId: incidentId,
        incidentDate: incidentDate,
        claimantName: claimantName,
        policyNumber: policyNumber,
        damageType: damageType,
        estimatedLoss: estimatedLoss,
        filesCount: filesCount,
        incidentDesc: incidentDesc,
        receivedOn: new Date().toLocaleString('en-GB')
      };

      try {
        const attachments = [];
        try {
          attachments.push(buildAcknowledgementPdf(claim));
        } catch (pdfError) {
          console.error('Acknowledgement PDF failed, sending without it:', pdfError);
        }

        MailApp.sendEmail({
          to: contactEmail,
          subject: 'Claim received — ' + incidentId,
          htmlBody: buildClaimEmail(claim),
          name: BRAND.NAME,
          attachments: attachments
        });
      } catch (mailError) {
        console.error('Error sending email:', mailError);
        // Do not interrupt claim submission if email fails
      }
    }

    return json({
      success: true,
      submittedAt: new Date().toISOString(),
      incidentId: incidentId
    });

  } catch (error) {
    console.error('Error submitting claim:', error);
    return json({ success: false, error: error.toString() });
  }
}

/** The link that opens this claim on the status page. */
function statusLink(claim) {
  return BRAND.STATUS_URL +
    '?ref=' + encodeURIComponent(claim.incidentId) +
    '&policy=' + encodeURIComponent(claim.policyNumber) +
    '&date=' + encodeURIComponent(new Date().toLocaleDateString('en-GB'));
}

/**
 * The five stages, mirrored from the status page so the email and the page
 * tell the same story. The claim always leaves here at stage one.
 */
function claimStages() {
  return [
    ['Submitted', 'Received and referenced. Nothing assessed yet.'],
    ['Documents checked', 'The file is checked for completeness.'],
    ['Survey', 'A surveyor attends where the loss warrants it.'],
    ['Adjustment', 'Cause tested against cover, then proportion and deductible.'],
    ['Decision', 'Settlement with its working, or a decline naming the clause.']
  ];
}

function buildClaimEmail(claim) {
  const link = statusLink(claim);

  const track = claimStages().map(function (s, i) {
    const isNow = i === 0;
    const dot = isNow ? '#009fe3' : '#dfe7ef';
    const colour = isNow ? '#0b2d63' : '#8c9aab';
    const weight = isNow ? '700' : '400';
    const tag = isNow
      ? '<span style="background:#009fe3;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px;">YOU ARE HERE</span>'
      : '<span style="color:#a9b6c6;font-size:11px;margin-left:8px;">not reached</span>';
    return '<tr>' +
      '<td width="26" valign="top" style="padding:7px 0;">' +
        '<div style="width:12px;height:12px;border-radius:50%;background:' + dot + ';"></div>' +
      '</td>' +
      '<td style="padding:5px 0;">' +
        '<div style="color:' + colour + ';font-weight:' + weight + ';font-size:14px;">' + s[0] + tag + '</div>' +
        '<div style="color:#8c9aab;font-size:12px;line-height:1.5;">' + s[1] + '</div>' +
      '</td></tr>';
  }).join('');

  return `
  <html><body style="margin:0;padding:0;background:#f5f8fb;font-family:Inter,'Segoe UI',Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;">

      <div style="background:linear-gradient(135deg,#164194,#009fe3);color:#fff;padding:28px 28px 24px;">
        <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em;">TT CIRCLE</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px;">Cargo claims</div>
      </div>

      <div style="padding:28px;color:#16202e;line-height:1.6;">
        <p style="margin:0 0 6px;font-size:15px;">Dear ${claim.claimantName},</p>
        <p style="margin:0 0 20px;font-size:14px;color:#5b6a7e;">
          Your claim has been received and referenced. Nothing has been assessed yet —
          this email confirms it is in the queue, not that it is payable.
        </p>

        <div style="background:#0b2d63;color:#fff;padding:16px 20px;border-radius:10px;margin:0 0 22px;">
          <div style="font-size:10px;letter-spacing:.14em;opacity:.7;">CLAIM REFERENCE</div>
          <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;letter-spacing:1px;margin-top:4px;">
            ${claim.incidentId}
          </div>
          <div style="font-size:12px;opacity:.8;margin-top:8px;">
            Status: <strong>Submitted</strong> — awaiting document check
          </div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin:0 0 24px;">
          <tr><td style="padding:9px 12px;background:#f5f8fb;font-weight:600;width:45%;border-bottom:1px solid #dfe7ef;">Policy number</td>
              <td style="padding:9px 12px;border-bottom:1px solid #dfe7ef;">${claim.policyNumber}</td></tr>
          <tr><td style="padding:9px 12px;background:#f5f8fb;font-weight:600;border-bottom:1px solid #dfe7ef;">Date of incident</td>
              <td style="padding:9px 12px;border-bottom:1px solid #dfe7ef;">${claim.incidentDate}</td></tr>
          <tr><td style="padding:9px 12px;background:#f5f8fb;font-weight:600;border-bottom:1px solid #dfe7ef;">Type of damage</td>
              <td style="padding:9px 12px;border-bottom:1px solid #dfe7ef;">${claim.damageType}</td></tr>
          <tr><td style="padding:9px 12px;background:#f5f8fb;font-weight:600;border-bottom:1px solid #dfe7ef;">Loss as declared</td>
              <td style="padding:9px 12px;border-bottom:1px solid #dfe7ef;">EUR ${claim.estimatedLoss}</td></tr>
          <tr><td style="padding:9px 12px;background:#f5f8fb;font-weight:600;">Documents filed</td>
              <td style="padding:9px 12px;">${claim.filesCount}</td></tr>
        </table>

        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#5b6a7e;margin-bottom:10px;">
          WHERE YOUR CLAIM STANDS
        </div>
        <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">${track}</table>

        <div style="background:#eef6fd;border-left:3px solid #009fe3;padding:14px 16px;font-size:13px;margin:0 0 24px;">
          <strong style="color:#0b2d63;">What this needs from you now:</strong>
          keep the certificate of insurance and the transport document to hand, and do not
          repair, repack or dispose of any of the affected cargo before it has been surveyed.
        </div>

        <a href="${link}"
           style="display:inline-block;background:#164194;color:#fff;text-decoration:none;
                  padding:13px 24px;border-radius:10px;font-weight:700;font-size:14px;">
          Track this claim
        </a>

        <p style="margin:22px 0 0;font-size:13px;color:#5b6a7e;">
          A copy of this acknowledgement is attached as a PDF. Reply to this email if anything
          above is wrong.
        </p>
      </div>

      <div style="background:#f5f8fb;padding:18px 28px;color:#8c9aab;font-size:11.5px;line-height:1.6;">
        ${BRAND.FOOTER}<br>
        Training simulator. Figures are illustrative and do not constitute an insurance decision.
      </div>
    </div>
  </body></html>`;
}

/**
 * A one-page acknowledgement the claimant can file.
 * Built from HTML and converted, so it needs no template document.
 */
function buildAcknowledgementPdf(claim) {
  const rows = [
    ['Claim reference', claim.incidentId],
    ['Policy number', claim.policyNumber],
    ['Claimant', claim.claimantName],
    ['Date of incident', claim.incidentDate],
    ['Type of damage', claim.damageType],
    ['Loss as declared', 'EUR ' + claim.estimatedLoss],
    ['Documents filed', claim.filesCount],
    ['Received on', claim.receivedOn],
    ['Status', 'Submitted — awaiting document check']
  ].map(function (r) {
    return '<tr><td class="k">' + r[0] + '</td><td class="v">' + r[1] + '</td></tr>';
  }).join('');

  const html = `
  <html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Helvetica, Arial, sans-serif; color:#16202e; font-size:11px; }
    .band { background:#0b2d63; color:#fff; padding:16px 18px; }
    .band h1 { margin:0; font-size:20px; letter-spacing:-0.5px; }
    .band div { font-size:10px; opacity:.8; margin-top:3px; letter-spacing:2px; }
    h2 { font-size:10px; letter-spacing:1.5px; color:#0b2d63; margin:22px 0 6px;
         border-bottom:1px solid #d6e0ec; padding-bottom:5px; }
    table { width:100%; border-collapse:collapse; }
    td { padding:7px 0; border-bottom:1px solid #eef2f7; vertical-align:top; }
    td.k { color:#5b6a7e; width:38%; font-size:10px; text-transform:uppercase; letter-spacing:.5px; }
    td.v { font-weight:bold; }
    .desc { font-size:10.5px; line-height:1.6; color:#16202e; }
    .foot { margin-top:26px; padding-top:10px; border-top:1px solid #d6e0ec;
            color:#8c9aab; font-size:8.5px; }
  </style></head><body>
    <div class="band">
      <h1>TT CIRCLE</h1>
      <div>CLAIM ACKNOWLEDGEMENT</div>
    </div>

    <h2>CLAIM DETAILS</h2>
    <table>${rows}</table>

    <h2>AS DECLARED</h2>
    <p class="desc">${claim.incidentDesc || 'No description supplied.'}</p>

    <h2>WHAT HAPPENS NEXT</h2>
    <p class="desc">
      This acknowledgement records that the claim has been received. It is not an admission
      of liability and it is not a settlement. The file will be checked for completeness,
      surveyed where the loss warrants it, and then adjusted: the cause is tested against the
      cover purchased, the loss is measured as a proportion of the insured value, and the
      deductible is applied. You will receive the decision with its working.
    </p>
    <p class="desc">
      Until the cargo has been surveyed, do not repair, repack or dispose of any of it. Keep
      your claim against the carrier alive: carrier liability is capped by convention and runs
      on its own time limits.
    </p>

    <div class="foot">
      ${BRAND.FOOTER}<br>
      Training simulator. Figures are illustrative and do not constitute an insurance decision.
    </div>
  </body></html>`;

  return Utilities.newBlob(html, 'text/html', 'tmp.html')
    .getAs('application/pdf')
    .setName('Claim_Acknowledgement_' + claim.incidentId + '.pdf');
}

/**
 * Log an operation (e.g., claim submission) to "Sheet1".
 */
function logOperation(e) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet1 = spreadsheet.getSheetByName('Sheet1');

    if (!sheet1) {
      sheet1 = spreadsheet.insertSheet('Sheet1');
      sheet1.getRange(1, 1, 1, 7).setValues([[
        'Timestamp', 'Incident ID', 'Policy Number', 'Claimant Name',
        'Status', 'Files Count', 'Operation Type'
      ]]);
    }

    const newRow = sheet1.getLastRow() + 1;
    sheet1.getRange(newRow, 1, 1, 7).setValues([[
      e.parameter.timestamp || new Date().toISOString(),
      e.parameter.incidentId || '',
      e.parameter.policyNumber || '',
      e.parameter.claimantName || '',
      e.parameter.status || 'UNKNOWN',
      e.parameter.filesCount || 0,
      'CLAIM_SUBMISSION'
    ]]);

    return json({ success: true, loggedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Error logging operation:', error);
    return json({ success: false, error: error.toString() });
  }
}

/**
 * Setup initial sheets ("Sheet1", "Sheet2", "Claims") and headers.
 * Run once when initializing the spreadsheet.
 */
function setupSheets() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    let sheet1 = spreadsheet.getSheetByName('Sheet1');
    if (!sheet1) sheet1 = spreadsheet.insertSheet('Sheet1');
    sheet1.clear();
    sheet1.getRange(1, 1, 1, 7).setValues([[
      'Timestamp', 'Incident ID', 'Policy Number', 'Claimant Name',
      'Status', 'Files Count', 'Operation Type'
    ]]);

    let sheet2 = spreadsheet.getSheetByName('Sheet2');
    if (!sheet2) sheet2 = spreadsheet.insertSheet('Sheet2');
    if (sheet2.getLastRow() === 0) {
      sheet2.getRange('A1').setValue('Policy Numbers');
    }

    let claimsSheet = spreadsheet.getSheetByName('Claims');
    if (!claimsSheet) claimsSheet = spreadsheet.insertSheet('Claims');
    if (claimsSheet.getLastRow() === 0) {
      claimsSheet.getRange(1, 1, 1, 11).setValues([[
        'Timestamp', 'Incident ID', 'Incident Date', 'Claimant Name',
        'Contact Email', 'Policy Number', 'Incident Description',
        'Damage Type', 'Estimated Loss', 'Additional Info', 'Files Count'
      ]]);
    }

    console.log('Sheets setup completed successfully');
    return 'Setup completed';
  } catch (error) {
    console.error('Error setting up sheets:', error);
    throw error;
  }
}

/**
 * Basic statistics: total claims, total operations, successful vs failed.
 */
function getClaimStatistics() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const claimsSheet = spreadsheet.getSheetByName('Claims');
    const logsSheet = spreadsheet.getSheetByName('Sheet1');

    if (!claimsSheet || !logsSheet) {
      return { totalClaims: 0, totalOperations: 0, successfulOperations: 0, failedOperations: 0 };
    }

    const claimsData = claimsSheet.getDataRange().getValues();
    const logsData = logsSheet.getDataRange().getValues();

    let successfulOps = 0;
    let failedOps = 0;
    for (let i = 1; i < logsData.length; i++) {
      const status = logsData[i][4];
      if (status === 'SUCCESS') successfulOps++;
      else if (status === 'ERROR') failedOps++;
    }

    return {
      totalClaims: Math.max(0, claimsData.length - 1),
      totalOperations: Math.max(0, logsData.length - 1),
      successfulOperations: successfulOps,
      failedOperations: failedOps,
      lastUpdate: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting statistics:', error);
    return { error: error.toString() };
  }
}

/**
 * Validate that the Drive folder exists and return basic info.
 */
function validateDriveFolder() {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const fileIterator = folder.getFiles();
    let count = 0;
    while (fileIterator.hasNext()) { fileIterator.next(); count++; }
    return {
      success: true,
      folderName: folder.getName(),
      folderId: DRIVE_FOLDER_ID,
      fileCount: count
    };
  } catch (error) {
    console.error('Error validating Drive folder:', error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Prueba sin efectos visibles: genera el acuse en PDF y lo deja en la carpeta
 * de siniestros para que puedas abrirlo. No manda ningun correo.
 */
function testAcknowledgementPdf() {
  const pdf = buildAcknowledgementPdf({
    incidentId: 'INC-TEST-0001',
    policyNumber: 'TT2609VMPFGA',
    claimantName: 'Orlando Reveco',
    incidentDate: '2026-10-18',
    damageType: 'cargo',
    estimatedLoss: '8338',
    filesCount: '1',
    incidentDesc: 'Two pallets in the door end found with collapsed lower cartons and staining consistent with condensation.',
    receivedOn: new Date().toLocaleString('en-GB')
  });

  const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(pdf);
  console.log('Test acknowledgement written:', file.getUrl());
  return file.getUrl();
}

/**
 * GET endpoint for debugging and status check.
 */
function doGet(e) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Inter,Arial,sans-serif;padding:40px;color:#16202e;">' +
    '<h2 style="color:#0b2d63;margin:0 0 6px;">TT CIRCLE — Claims service</h2>' +
    '<p style="color:#5b6a7e;">This address answers the claims form. It is not the form.</p>' +
    '<p><a href="https://portvirtuallab.github.io/ttcircle-insurance/claims.html" ' +
    'style="display:inline-block;margin-top:14px;padding:12px 22px;border-radius:10px;' +
    'background:#164194;color:#fff;text-decoration:none;font-weight:700;">Open the claims form</a></p>' +
    '<p style="color:#8c9aab;font-size:12px;margin-top:24px;">Status: operating normally · ' +
    new Date().toISOString() + '</p></div>'
  );
}

/**
 * Delete rows older than a specified number of days in "Sheet1".
 */
function cleanOldData(daysOld = 30) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet1 = spreadsheet.getSheetByName('Sheet1');
    if (!sheet1) return 'Sheet1 not found';

    const data = sheet1.getDataRange().getValues();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let deletedRows = 0;
    for (let i = data.length - 1; i >= 1; i--) {
      const rowDate = new Date(data[i][0]);
      if (rowDate < cutoffDate) {
        sheet1.deleteRow(i + 1);
        deletedRows++;
      }
    }

    return `Cleaned ${deletedRows} rows older than ${daysOld} days`;
  } catch (error) {
    console.error('Error cleaning old data:', error);
    return `Error: ${error.toString()}`;
  }
}

/**
 * Create a backup copy of the entire spreadsheet in the Drive folder.
 */
function createBackup() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const backupName = `Insurance_Claims_Backup_${new Date().toISOString().split('T')[0]}`;
    const backup = spreadsheet.copy(backupName);

    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const backupFile = DriveApp.getFileById(backup.getId());
    folder.addFile(backupFile);
    DriveApp.getRootFolder().removeFile(backupFile);

    return {
      success: true,
      backupId: backup.getId(),
      backupName: backupName,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error creating backup:', error);
    return { success: false, error: error.toString() };
  }
}
