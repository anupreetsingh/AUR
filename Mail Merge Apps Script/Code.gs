// Google script mail merge based on
//    https://github.com/googleworkspace/solutions/tree/master/mail-merge
//    https://hawksey.info/blog/2020/04/a-bulk-email-mail-merge-with-gmail-and-google-sheets-solution-evolution-using-v8/
// Copyright Martin Hawksey 2020
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License.  You may obtain a copy
// of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the
// License for the specific language governing permissions and limitations under
// the License.
//
// Very heavily modified by Marc Olano
//
// Changes:
//.  - setup dialog to get names of status and recipient columns
//.  - remember status & recipient columns (& header row) in named ranges
//   - don't send to hidden rows
//   - option to either save as email drafts or immediately send

// only needs access to current google sheet
// @OnlyCurrentDoc
 
/**
 * Names of named ranges for status and recipient header cells
*/
const STATUS_NAME    = "mergeStatus";
const RECIPIENT_NAME = "mergeRecipient";

/**
 * References to apps script objects
 */
const gUI = SpreadsheetApp.getUi();
const gCache = CacheService.getUserCache();
const gProperties = PropertiesService.getScriptProperties();
const gUserAddr = Session.getActiveUser().getEmail();

/** 
 * Creates the menu item "Email" for user to run scripts on drop-down.
 */
function onOpen() {
  gUI.createMenu('EMail')
    .addItem('Merge setup',     'mergeSetup')
    .addItem('Merge to drafts', 'mergeDraft')
    .addItem('Merge and send',  'mergeSend')
    .addToUi();
}

/**
 * Menu choice to setup column headers
*/
function mergeSetup(ss=SpreadsheetApp.getActiveSpreadsheet()) {
  try {
    // find existing header names
    const statusRange    = ss.getRangeByName(STATUS_NAME);
    const recipientRange = ss.getRangeByName(RECIPIENT_NAME);

    // set up template
    var template = HtmlService.createTemplateFromFile("Setup.html");
    template.status    = statusRange    && statusRange.getValue()    || "";
    template.recipient = recipientRange && recipientRange.getValue() || "";
    template.fromAddr  = gProperties.getProperty('FromAddr') || gUserAddr || "";
    template.replyAddr = gProperties.getProperty('ReplyAddr') || gUserAddr || "";

    // create dialog (will call setHeaders when done)
    var dialog = template.evaluate()
      .setWidth(300)
      .setHeight(150);
    gUI.showModalDialog(dialog, "Email setup");
  }
  catch (error) {
    gUI.alert('Merge error', error.toString(), gUI.ButtonSet.OK);
  }
}

/**
 * Callback from dialog to actually do the setup
 */
function doSetup(inRecipient, inStatus, inFromAddr, inReplyAddr, ss=SpreadsheetApp.getActiveSpreadsheet()) {
  try {
    if (!inRecipient || !inStatus) return;

    // find header row
    const dataRange = ss.getDataRange();
    var datavals = dataRange.getValues();
    var headRow = 0;
    while(headRow < datavals.length && datavals[headRow].indexOf(inStatus) < 0) {
      ++headRow;
    }

    if (headRow == datavals.length)
      throw new Error('Could not find "'+inStatus+'" merge status header.');

    var statusCol    = datavals[headRow].indexOf(inStatus);
    var recipientCol = datavals[headRow].indexOf(inRecipient);
    if (recipientCol < 0)
      throw new Error('Could not find "'+inRecipient+'" merge recipient header.');

    ss.setNamedRange(STATUS_NAME,    dataRange.offset(headRow, statusCol,   1,1));
    ss.setNamedRange(RECIPIENT_NAME, dataRange.offset(headRow, recipientCol,1,1));

    // set from addresses
    if (!inFromAddr || inFromAddr == gUserAddr)
      gProperties.deleteProperty('FromAddr');
    else
      gProperties.setProperty('FromAddr', inFromAddr);
    
    // set reply address
    if (!inReplyAddr || inReplyAddr == gUserAddr)
      gProperties.deleteProperty('ReplyAddr');
    else
      gProperties.setProperty('ReplyAddr', inReplyAddr);
  }
  catch (error) {
    gUI.alert('Merge error', error.toString(), gUI.ButtonSet.OK);
  }
}

/**
 * Callback from Progress.html to figure out how far along we are
 */
function getProgress() {
  return {
    currRow:   gCache.get('currRow'), 
    currMerge: gCache.get('currMerge'),
    done:      gCache.get('done')
  };
}

/**
 * Callback from Progress.html to cleanly cancel in-progress merge
 */
function cancelMerge() {
  gCache.put('cancel',true);
}

/**
 * Menu choice to save drafts
*/
function mergeDraft() {
  try {
    mergeEmails('createDraft');
  }
  catch (error) {
    gUI.alert('Merge error', error.toString(), gUI.ButtonSet.OK);
  }
}

/**
 * Menu choice to immediately send
*/
function mergeSend() {
  try {
    mergeEmails('sendEmail');
  }
  catch (error) {
    gUI.alert('Merge error', error.toString(), gUI.ButtonSet.OK);
  }
}

/**
 * Send emails from sheet data.
 * @param {string} sendMode, either 'createDraft' or 'sendEmail'
 * @param {string} subjectLine (optional) for the email draft message
 * @param {ss} sheet to read data from
*/
function mergeEmails(sendMode, subjectLine, ss=SpreadsheetApp.getActiveSpreadsheet()) {
  // check for defined recipient and status headers
  const statusRange    = ss.getRangeByName(STATUS_NAME);
  const recipientRange = ss.getRangeByName(RECIPIENT_NAME);
  if (!statusRange || !recipientRange)
    throw new Error("Missing required headers. Run Merge setup.");

  // recipient and status headers musut be on the same sheet
  const dataSheet = SpreadsheetApp.getActiveSheet();
  const dataSheetName = dataSheet.getName();
  const statusSheetName = statusRange.getSheet().getName();
  const recipientSheetName = recipientRange.getSheet().getName();
  if (statusSheetName != dataSheetName || recipientSheetName != dataSheetName)
    throw new Error("Status, recipient and data all need to be on the same sheet. Re-run merge setup.");
  
  // recipeint and status headers must be in the same (header) row
  const headerRow = statusRange.getRow();
  if (headerRow != recipientRange.getRow())
    throw new Error("Status and recipeint headers must be on the same row. Re-run merge setup.");

  // name and column of recipient and stutus
  const statusCol = statusRange.getColumn();
  const statusName = statusRange.getValue();
  const recipientName = recipientRange.getValue();

  // get the data from the passed sheet
  var dataRange = dataSheet.getDataRange();
  dataRange = dataRange.offset(headerRow-1, 0, dataRange.getHeight() - headerRow + 1, dataRange.getWidth());

  // Fetch displayed values for each row in the Range HT Andrew Roberts 
  // https://mashe.hawksey.info/2020/04/a-bulk-email-mail-merge-with-gmail-and-google-sheets-solution-evolution-using-v8/#comment-187490
  // @see https://developers.google.com/apps-script/reference/spreadsheet/range#getdisplayvalues
  var datavals = dataRange.getDisplayValues();
  
  // split header from data
  const heads = datavals.shift();

  // convert 2d array into object array
  // @see https://stackoverflow.com/a/22917499/1027723
  // for pretty version see https://mashe.hawksey.info/?p=17869/#comment-184945
  var data = datavals.map(r => (heads.reduce((o, k, i) => (o[k] = r[i] || '', o), {})));

  // filter hidden and already sent rows
  const ssId = ss.getId();
  const range = dataSheetName + "!" + dataRange.offset(1, 0, dataRange.getHeight() - 1).getA1Notation();
  const metadata = Sheets.Spreadsheets.get(ssId, {
    fields: 'sheets(data(rowMetadata(hiddenByFilter,hiddenByUser)))', 
    ranges: [range]
  }).sheets[0].data[0].rowMetadata;
  metadata.map((mdrow,i) => {
    const sent = data[i][statusName] != '';
    const hbf = mdrow.getHiddenByFilter();
    const hbu = mdrow.getHiddenByUser();
    data[i].readyToSend = !sent && !hbf && !hbu;
  })

  // count remaining active rows
  var count=0;
  data.map((row,i) => {count += row.readyToSend});

  // option to skip browser prompt if you want to use this code in other projects
  if (count > 0 && !subjectLine){
    const result = gUI.prompt("Mail Merge", 
        count + (count==1 ? " message" : " messages") + " ready to merge and " + 
        (sendMode == 'sendEmail' ? "immediately send.\n" : "save to Drafts.\n\n") +
        "Enter subject of Gmail template message in Drafts folder.\n" +
        "Any {{header}} in the subject or message will be replaced with spreadsheet data\n",
        gUI.ButtonSet.OK_CANCEL);

    const button = result.getSelectedButton();
    subjectLine = result.getResponseText();
  }
  if (subjectLine) {
    // get the draft Gmail message to use as a template
    const emailTemplate = getGmailTemplateFromDrafts(subjectLine);
    let emailOptions = {
      attachments: emailTemplate.attachments,
      inlineImages: emailTemplate.inlineImages
    };
    var fromAddr = gProperties.getProperty('FromAddr');
    if (fromAddr)
      emailOptions.from = fromAddr;
    var replyAddr = gProperties.getProperty('ReplyAddr');
    if (replyAddr)
      emailOptions.replyTo = replyAddr;
  
    // status window
    let currRow = 0, currMerge = 0;
    gCache.put('currRow',currRow);
    gCache.put('currMerge',currMerge);
    gCache.remove('cancel');
    gCache.remove('done');
    var template = HtmlService.createTemplateFromFile("Progress.html");
    template.rowCount = data.length;
    template.mergeCount = count;
    var dialog = template.evaluate()
      .setWidth(300)
      .setHeight(100);
    gUI.showModalDialog(dialog, "Progress");

    // used to record sent emails
    var out = [];
    var statusStart=1;

    // loop through all the rows of data
    for (const row of data) {
      if (gCache.get('cancel')) break;
      if (currMerge >= count) break;
      gCache.put('currRow',++currRow);

      // only send emails if row is not hidden and status cell is blank
      if (row.readyToSend){
        try {
          gCache.put('currMerge',++currMerge);
          const msgObj = fillInTemplateFromObject(emailTemplate.message, row);

          // @see https://developers.google.com/apps-script/reference/gmail/gmail-app#sendEmail(String,String,String,Object)
          // if you need to send emails with unicode/emoji characters change GmailApp for MailApp
          // Uncomment advanced parameters as needed (see docs for limitations)
          emailOptions.cc = msgObj.cc;
          emailOptions.bcc = msgObj.bcc;
          emailOptions.htmlBody = msgObj.html;
          GmailApp[sendMode](row[recipientName], msgObj.subject, msgObj.text, emailOptions);
          
          // modify cell to record email sent date
          out.push([new Date()]);
        } catch(e) {
          // modify cell to record error
          out.push([e.message]);
        }
      }
      else {
        // leave status cell contents alone
        out.push([row[statusName]]);
      }

      // update status along the way
      if (out.length == 20) {
        dataRange.offset(statusStart, statusCol-1, out.length, 1).setValues(out);
        statusStart += out.length;
        out = [];
        SpreadsheetApp.flush();
      }
    }

    // update the sheet with remaining status data
    if (out.length > 0) {
      dataRange.offset(statusStart, statusCol-1, out.length, 1).setValues(out);
      SpreadsheetApp.flush();
    }

    // tell the progress dialog that we're done
    gCache.put('done',true);
}
  
  /**
   * Get a Gmail draft message by matching the subject line.
   * @param {string} subject_line to search for draft message
   * @return {object} containing the subject, plain and html message body and attachments
  */
  function getGmailTemplateFromDrafts(subject_line){
    try {
      // get drafts
      const drafts = GmailApp.getDrafts();
      // filter the drafts that match subject line
      const draft = drafts.filter(subjectFilter(subject_line))[0];
      // get the message object
      const msg = draft.getMessage();

      // Handling inline images and attachments so they can be included in the merge
      // Based on https://stackoverflow.com/a/65813881/1027723
      // Get all attachments and inline image attachments
      const allInlineImages = msg.getAttachments({includeInlineImages: true,includeAttachments:false});
      const attachments = msg.getAttachments({includeInlineImages: false});
      const htmlBody = msg.getBody();
      const textBody = msg.getPlainBody();
      const toAddr = msg.getTo();
      const ccAddr = msg.getCc();
      const bccAddr = msg.getBcc();

      // Create an inline image object with the image name as key 
      // (can't rely on image index as array based on insert order)
      const img_obj = allInlineImages.reduce((obj, i) => (obj[i.getName()] = i, obj) ,{});

      //Regexp to search for all img string positions with cid
      const imgexp = RegExp('<img.*?src="cid:(.*?)".*?alt="(.*?)"[^\>]+>', 'g');
      const matches = [...htmlBody.matchAll(imgexp)];

      //Initiate the allInlineImages object
      const inlineImagesObj = {};
      // built an inlineImagesObj from inline image matches
      matches.forEach(match => inlineImagesObj[match[1]] = img_obj[match[2]]);

      return {message: {to: toAddr, cc: ccAddr, bcc: bccAddr, subject: subject_line, text: textBody, html:htmlBody}, 
              attachments: attachments, inlineImages: inlineImagesObj };
    } catch(e) {
      throw new Error("Can't find Gmail draft");
    }

    /**
     * Filter draft objects with the matching subject linemessage by matching the subject line.
     * @param {string} subject_line to search for draft message
     * @return {object} GmailDraft object
    */
    function subjectFilter(subject_line){
      return function(element) {
        if (element.getMessage().getSubject() === subject_line) {
          return element;
        }
      }
    }
  }
  
  /**
   * Fill template string with data object
   * @see https://stackoverflow.com/a/378000/1027723
   * @param {string} template string containing {{}} markers which are replaced with data
   * @param {object} data object used to replace {{}} markers
   * @return {object} message replaced with data
  */
  function fillInTemplateFromObject(template, data) {
    // we have two templates one for plain text and the html body
    // stringifing the object means we can do a global replace
    var template_string = JSON.stringify(template);

    // token replacement
    template_string = template_string.replace(/{{[^{}]+}}/g, key => {
      return escapeData(data[key.replace(/[{}]+/g, "")] || "");
    });
    return  JSON.parse(template_string);
  }

  /**
   * Escape cell data to make JSON safe
   * @see https://stackoverflow.com/a/9204218/1027723
   * @param {string} str to escape JSON special characters from
   * @return {string} escaped string
  */
  function escapeData(str) {
    return str
      .replace(/[\\]/g, '\\\\')
      .replace(/[\"]/g, '\\\"')
      .replace(/[\/]/g, '\\/')
      .replace(/[\b]/g, '\\b')
      .replace(/[\f]/g, '\\f')
      .replace(/[\n]/g, '\\n')
      .replace(/[\r]/g, '\\r')
      .replace(/[\t]/g, '\\t');
  };
}
