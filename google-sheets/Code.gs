/**
 * Anchors: LinkedIn investment posts -> Google Sheet
 *
 * Paste this file into your spreadsheet (Extensions -> Apps Script), deploy it
 * as a web app and paste the web app URL into the extension. See
 * google-sheets/README.md for the step-by-step setup.
 *
 * Posts are appended to the FIRST tab of the spreadsheet. Row 1 holds the
 * headers below; posts whose Post ID is already in column A are skipped.
 */

var MAX_LINK_COLUMNS = 5;

// [header, field sent by the extension, type]
var COLUMNS = [
  ["Post ID", "postId", "id"],
  ["Post URL", "postUrl", "text"],
  ["Author", "author", "text"],
  ["Author public ID", "authorPublicId", "text"],
  ["Author member URN", "authorUrn", "id"],
  ["Author profile URL", "authorUrl", "text"],
  ["Author headline", "authorHeadline", "text"],
  ["Posted at", "postedAt", "date"],
  ["Post content", "text", "text"],
  ["Reposted by", "repostedBy", "text"],
  ["Reposted by public ID", "repostedByPublicId", "text"],
  ["Reposted by member URN", "repostedByUrn", "id"],
  ["Reposted by profile URL", "repostedByUrl", "text"],
  ["Reposted at", "repostedAt", "date"],
  ["Repost comment", "repostComment", "text"],
  ["Repost ID", "repostId", "id"],
  ["Repost URL", "repostUrl", "text"],
]
  .concat(
    Array.apply(null, Array(MAX_LINK_COLUMNS)).map(function (_, i) {
      return ["Link " + (i + 1), "link" + (i + 1), "text"];
    }),
  )
  .concat([
    ["Why it was in my feed", "feedContext", "text"],
    ["Feed reason person URL", "feedContextPersonUrl", "text"],
    ["Matched keywords", "matches", "text"],
    ["Score", "score", "number"],
    ["Likes", "likes", "number"],
    ["Comments", "comments", "number"],
    ["Reposts", "reposts", "number"],
    ["Saved at", "savedAt", "date"],
    // Added in v2. Older sheets get these headers appended automatically.
    ["Category", "category", "text"],
    ["Form / application links", "formLinks", "text"],
    ["Why kept", "whyKept", "text"],
  ]);

var HEADERS = COLUMNS.map(function (column) {
  return column[0];
});

function doGet() {
  return jsonResponse({
    ok: true,
    message: "Anchors investment posts web app is running.",
    sheet: getTargetSheet().getName(),
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var posts = Array.isArray(body.posts) ? body.posts : [];
    var sheet = getTargetSheet();

    var headerError = ensureHeaders(sheet);
    if (headerError) return jsonResponse({ ok: false, error: headerError });

    var existingIds = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet
        .getRange(2, 1, lastRow - 1, 1)
        .getDisplayValues()
        .forEach(function (row) {
          if (row[0]) existingIds[String(row[0])] = true;
        });
    }

    var savedAt = new Date();
    var rows = [];
    var skipped = 0;
    posts.forEach(function (post) {
      var postId = String((post && post.postId) || "").trim();
      if (!postId || existingIds[postId]) {
        skipped++;
        return;
      }
      existingIds[postId] = true;
      rows.push(toRow(post, savedAt));
    });

    if (rows.length) {
      var range = sheet.getRange(lastRow + 1, 1, rows.length, HEADERS.length);
      // Long numeric IDs would lose precision as numbers, so keep them as text.
      COLUMNS.forEach(function (column, index) {
        if (column[2] === "id") {
          sheet.getRange(lastRow + 1, index + 1, rows.length, 1).setNumberFormat("@");
        }
      });
      range.setValues(rows);
    }

    return jsonResponse({ ok: true, inserted: rows.length, skipped: skipped, sheet: sheet.getName() });
  } catch (error) {
    return jsonResponse({ ok: false, error: String((error && error.message) || error) });
  } finally {
    lock.releaseLock();
  }
}

function getTargetSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

// Writes the header row into an empty first tab. Refuses to touch a tab whose
// row 1 already holds something else, so existing data is never overwritten.
function ensureHeaders(sheet) {
  var lastColumn = sheet.getLastColumn();
  var current = lastColumn
    ? sheet.getRange(1, 1, 1, Math.max(lastColumn, HEADERS.length)).getDisplayValues()[0]
    : [];
  var isEmpty = current.every(function (cell) {
    return cell === "";
  });

  if (isEmpty) {
    if (sheet.getLastRow() > 1) {
      return "Row 1 of the first tab is empty but the tab has data below it. Add the header row or clear the tab.";
    }
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return null;
  }

  // Row 1 may hold the headers of an older version of this script (fewer
  // columns). If so, add the missing headers after them.
  var known = 0;
  while (known < HEADERS.length && current[known] === HEADERS[known]) known++;
  var restEmpty = current.slice(known).every(function (cell) {
    return cell === "";
  });
  if (known > 0 && known < HEADERS.length && restEmpty) {
    sheet
      .getRange(1, known + 1, 1, HEADERS.length - known)
      .setValues([HEADERS.slice(known)])
      .setFontWeight("bold");
    return null;
  }

  var matches = known === HEADERS.length;
  if (!matches) {
    return (
      'The first tab "' +
      sheet.getName() +
      '" already has different headers in row 1. Move that tab so it is not first, or clear it, and try again.'
    );
  }
  return null;
}

function toRow(post, savedAt) {
  var links = Array.isArray(post.links) ? post.links.filter(Boolean) : [];
  var values = {};
  for (var key in post) values[key] = post[key];
  for (var i = 0; i < MAX_LINK_COLUMNS; i++) {
    values["link" + (i + 1)] =
      i === MAX_LINK_COLUMNS - 1 ? links.slice(i).join("\n") : links[i] || "";
  }
  values.matches = Array.isArray(post.matches) ? post.matches.join(", ") : post.matches;
  values.formLinks = Array.isArray(post.formLinks) ? post.formLinks.join("\n") : post.formLinks;
  values.savedAt = savedAt;

  return COLUMNS.map(function (column) {
    return toCell(values[column[1]], column[2]);
  });
}

function toCell(value, type) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date") {
    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? String(value) : date;
  }
  if (type === "number") {
    var number = Number(value);
    return isNaN(number) ? "" : number;
  }
  var text = String(value);
  if (text.length > 49000) text = text.slice(0, 49000) + "…";
  // Stop text like "=..." or "+91..." from being read as a formula or number.
  return /^[=+\-@]/.test(text) && type !== "id" ? "'" + text : text;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
