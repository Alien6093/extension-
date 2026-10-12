const env = "dev";
let COLLAB_CLIENT = "https://dev.anchors.pro";
let COLLAB_SERVER = "https://dev.anchors.pro/api";

// const env = "prod";
// let COLLAB_CLIENT = "https://www.anchors.in";
// let COLLAB_SERVER = "https://www.anchors.in/api";

const GET_USER_TIMEOUT_MS = 10000;

const config = {
  JWTTOKEN: "jwtToken",
  USERTYPE: "UserType",
  UserData: "UserData",
};

const trackPosthog = (event, properties = {}) => {
  try {
    if (typeof anchorsPosthogCapture === "function") {
      anchorsPosthogCapture(event, properties);
    }
  } catch (error) {
    console.log("PostHog track failed:", error);
  }
};

function checkActiveTabUrl() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      // Chrome leaves `url` undefined when the extension has no access to
      // the tab; that used to throw here and leave the popup on "Loading...".
      const url = activeTab?.url || "";
      if (url.includes(`${COLLAB_CLIENT}/influencer`)) {
        chrome.runtime.sendMessage(
          { action: "bg-retrieveToken", tabId: activeTab?.id },
          (response) => {
            if (response && response.success) {
              renderWelcome();
            } else {
              renderLogin();
            }
          },
        );
      } else {
        renderLogin();
      }
    });
  } catch (error) {
    renderLogin();
  }
}

async function getUser() {
  try {
    const items = await chrome.storage.local.get([config.JWTTOKEN]);
    const token = items.jwtToken;

    if (!token) {
      console.log("Token not found");
      return null;
    }

    // Without a timeout a server that never answers leaves the popup on
    // "Loading..." forever.
    const response = await fetch(`${COLLAB_SERVER}/ext/getUser`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Jwttoken: token,
      },
      signal: AbortSignal.timeout(GET_USER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.log("Error:", error);
    return null;
  }
}

// initial load
$(document).ready(async function () {
  // console.log('Document_ready');
  trackPosthog("creator_extension_popup_opened", { env });
  renderLoading();

  try {
    const items = await chrome.storage.local.get([
      config.JWTTOKEN,
      config.USERTYPE,
    ]);
    if (items.jwtToken && items.UserType === "Influencer") {
      // console.log('token_found');
      renderWelcome();
    } else {
      // console.log('token_not_found');
      // renderLogin();
      checkActiveTabUrl();
    }
  } catch (error) {
    // console.error('Error retrieving token from storage:', error);
    renderLogin();
  }
});

// The start-up checks can finish after the user already opened the
// investment-posts screen from the loading screen; don't replace it then.
function isFeedScannerOpen() {
  return Boolean(document.getElementById("fs__results"));
}

async function renderWelcome() {
  getUser().then(async (res) => {
    if (isFeedScannerOpen()) return;
    if (res && res?.success) {
      if (res?.logout) {
        await chrome.storage.local.remove([config.JWTTOKEN, config.USERTYPE]);
        renderLogin();
        return;
      }
      // $('#root').html(`<div class="px-4"> <div class="py-2"> <span>anchors</span> </div> <div class="h-full py-6"> <div> <p>Welcome,</p> <h1 class="text-xl font-bold">${res?.data?.name}</h1> </div> </div> </div>`);
      $("#root").html(
        `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Hi ${res?.data?.name}, <br /> Welcome to anchors, </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Make sure your media is upto date! </p> <div> <button id="gp__update_btn" class="flex px-[16px] py-[8px] items-center gap-[10px] rounded-[6px] bg-[#DC2627]"> <span class="text-[#FFF] text-[14px] not-italic font-medium leading-[24px]"> Update Your Media Kit </span> </button> </div> ${feedScannerEntryHtml()} </div> </div>`,
      );

      $("#gp__update_btn").click(function () {
        trackPosthog("creator_extension_update_media_kit_clicked", { env });
        chrome.tabs.create({
          url:
            res?.data?.updateMediaKitUrl ||
            `${COLLAB_CLIENT}/influencer/dashboard`,
        });
      });
      bindFeedScannerEntry();

      try {
        chrome.storage.local.set({
          [config.UserData]: JSON.stringify(res?.data),
        });
      } catch (error) {
        console.log("Error:", error);
      }
      // $('#logout').click(async function () {
      //     await chrome.storage.local.remove([config.JWTTOKEN, config.USERTYPE]);
      //     renderLogin();
      // });
    } else {
      renderLogin();
    }
  });
}

function renderLogin() {
  if (isFeedScannerOpen()) return;
  trackPosthog("creator_extension_login_rendered", { env });
  $("#root").html(
    `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Hi, <br /> Welcome to anchors, </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Make sure your media is upto date! </p> <div> <button id="gp__login_btn" class="flex px-[16px] py-[8px] items-center gap-[10px] rounded-[6px] bg-[#DC2627]"> <span class="text-[#FFF] text-[14px] not-italic font-medium leading-[24px]"> Login to Continue </span> </button> </div> ${feedScannerEntryHtml()} </div> </div>`,
  );
  $("#gp__login_btn").click(function () {
    trackPosthog("creator_extension_login_clicked_popup", { env });
    chrome.tabs.create({ url: `${COLLAB_CLIENT}/influencer/login` });
  });
  bindFeedScannerEntry();
}

function renderLoading() {
  $("#root").html(
    `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Loading... </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Hold on! </p> ${feedScannerEntryHtml()} </div> </div>`,
  );
  bindFeedScannerEntry();
}

// ---------------------------------------------------------------------------
// Investment posts from feed
// ---------------------------------------------------------------------------

const FEED_SCAN_STORAGE_KEY = "investmentFeedScan";
const FEED_SCAN_SETTINGS_KEY = "investmentFeedScanSettings";
const FEED_SCAN_STALE_MS = 5 * 60 * 1000;
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const INVESTMENT_SHEET_URL_KEY = "investmentSheetWebAppUrl";
const INVESTMENT_HISTORY_KEY = "investmentPostsHistory";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLinkedInUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.linkedin.com"
      ? parsed.href
      : "";
  } catch (error) {
    return "";
  }
}

function feedScannerEntryHtml() {
  return `<button id="fs__open_btn" class="fs-link-btn">📈 Investment posts in my feed</button>`;
}

function bindFeedScannerEntry() {
  $("#fs__open_btn").click(function () {
    trackPosthog("creator_extension_feed_scanner_opened", { env });
    renderFeedScanner();
  });
}

async function getFeedScanSettings() {
  const defaults = { maxPosts: 100, extraKeywords: "", includePromoted: false };
  try {
    const items = await chrome.storage.local.get([FEED_SCAN_SETTINGS_KEY]);
    return { ...defaults, ...(items?.[FEED_SCAN_SETTINGS_KEY] || {}) };
  } catch (error) {
    return defaults;
  }
}

async function getFeedScanState() {
  try {
    const items = await chrome.storage.local.get([FEED_SCAN_STORAGE_KEY]);
    const state = items?.[FEED_SCAN_STORAGE_KEY] || null;
    if (
      state?.status === "running" &&
      Date.now() - new Date(state.startedAt).getTime() > FEED_SCAN_STALE_MS
    ) {
      return {
        status: "error",
        error: "The last scan stopped before finishing (was the LinkedIn tab closed?).",
      };
    }
    return state;
  } catch (error) {
    return null;
  }
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs?.[0] || null),
    );
  });
}

function formatPostDate(post) {
  if (post?.postedAt) {
    const date = new Date(post.postedAt);
    if (!isNaN(date)) {
      return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
  }
  return post?.relativeTime || "";
}

function feedPostCardHtml(post) {
  const postUrl = safeLinkedInUrl(post.postUrl);
  const authorUrl = safeLinkedInUrl(post.authorUrl);
  const text = post.text || "";
  const snippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  const stats = [
    post.likes != null ? `👍 ${post.likes}` : "",
    post.comments != null ? `💬 ${post.comments}` : "",
    post.links?.length ? `🔗 ${post.links.length}` : "",
    formatPostDate(post),
  ]
    .filter(Boolean)
    .join(" · ");

  const author = escapeHtml(post.author || "Unknown author");
  return `
    <div class="fs-card">
      <div class="fs-card-head">
        ${
          authorUrl
            ? `<a class="fs-author" href="${escapeHtml(authorUrl)}" target="_blank">${author}</a>`
            : `<span class="fs-author">${author}</span>`
        }
        <span class="fs-score" title="Relevance score">${escapeHtml(post.score)}</span>
      </div>
      ${post.authorHeadline ? `<div class="fs-headline">${escapeHtml(post.authorHeadline)}</div>` : ""}
      ${
        post.repostedBy
          ? `<div class="fs-repost">🔁 Reposted by ${escapeHtml(post.repostedBy)}${
              post.repostComment ? `: “${escapeHtml(post.repostComment.slice(0, 140))}${post.repostComment.length > 140 ? "…" : ""}”` : ""
            }</div>`
          : post.feedContext
            ? `<div class="fs-repost">${escapeHtml(post.feedContext)}</div>`
            : ""
      }
      <div class="fs-snippet">${escapeHtml(snippet)}</div>
      <div class="fs-chips">${post.matches
        .map((match) => `<span class="fs-chip">${escapeHtml(match)}</span>`)
        .join("")}</div>
      <div class="fs-card-foot">
        <span>${escapeHtml(stats)}</span>
        ${postUrl ? `<a class="fs-open" href="${escapeHtml(postUrl)}" target="_blank">Open post ↗</a>` : ""}
      </div>
    </div>`;
}

function feedScanResultsHtml(state) {
  if (!state) {
    return `<p class="fs-muted">Open your LinkedIn feed in this tab and hit <b>Scan feed</b>.</p>`;
  }
  if (state.status === "running") {
    return `<p class="fs-muted">Scanning your feed… ${escapeHtml(state.scanned || 0)} posts read so far.<br/>You can close this popup, results will be saved.</p>`;
  }
  if (state.status === "error") {
    return `<p class="fs-error">${escapeHtml(state.error || "Scan failed.")}</p>`;
  }

  const posts = state.posts || [];
  const summary = `<p class="fs-summary">Found <b>${posts.length}</b> investment posts in ${escapeHtml(state.scanned)} feed posts${
    state.finishedAt
      ? ` · ${escapeHtml(new Date(state.finishedAt).toLocaleString())}`
      : ""
  }</p>`;
  if (!posts.length) {
    return `${summary}<p class="fs-muted">No investment-related posts this time. Try scanning more posts or adding your own keywords.</p>`;
  }
  return `
    ${summary}
    ${historySyncHtml(state.historySync)}
    ${sheetSyncHtml(state.sheetSync)}
    <div class="fs-actions">
      <button id="fs__csv_btn" class="fs-secondary-btn">Export this scan</button>
      <button id="fs__copy_btn" class="fs-secondary-btn">Copy links</button>
    </div>
    ${posts.map(feedPostCardHtml).join("")}`;
}

function historySyncHtml(sync) {
  if (!sync) return "";
  if (sync.status === "saved") {
    const parts = [`<b>${escapeHtml(sync.added)}</b> new posts added to history`];
    if (sync.alreadyStored) parts.push(`${escapeHtml(sync.alreadyStored)} already there`);
    return `<p class="fs-sync fs-sync-ok">📚 ${parts.join(" · ")}</p>`;
  }
  if (sync.status === "error") {
    return `<p class="fs-sync fs-sync-error">⚠️ Couldn't add to history: ${escapeHtml(sync.error)}</p>`;
  }
  return "";
}

function sheetSyncHtml(sync) {
  if (!sync) return "";
  if (sync.status === "saved") {
    const parts = [`<b>${escapeHtml(sync.inserted)}</b> new rows saved to Google Sheet`];
    if (sync.skipped) parts.push(`${escapeHtml(sync.skipped)} already there`);
    if (sync.missingId) parts.push(`${escapeHtml(sync.missingId)} without a post ID not saved`);
    return `<p class="fs-sync fs-sync-ok">✅ ${parts.join(" · ")}</p>`;
  }
  if (sync.status === "not-configured") {
    return `<p class="fs-sync">Not saved: connect a Google Sheet above to save posts automatically.</p>`;
  }
  if (sync.status === "error") {
    return `<p class="fs-sync fs-sync-error">⚠️ Couldn't save to Google Sheet: ${escapeHtml(sync.error)} <button id="fs__retry_sheet_btn" class="fs-inline-btn">Retry</button></p>`;
  }
  return "";
}

// Same columns, in the same order, as the Google Sheet (google-sheets/Code.gs).
const CSV_MAX_LINK_COLUMNS = 5;
const CSV_COLUMNS = [
  ["postId", "Post ID", "id"],
  ["postUrl", "Post URL"],
  ["author", "Author"],
  ["authorPublicId", "Author public ID"],
  ["authorUrn", "Author member URN"],
  ["authorUrl", "Author profile URL"],
  ["authorHeadline", "Author headline"],
  ["postedAt", "Posted at", "date"],
  ["text", "Post content"],
  ["repostedBy", "Reposted by"],
  ["repostedByPublicId", "Reposted by public ID"],
  ["repostedByUrn", "Reposted by member URN"],
  ["repostedByUrl", "Reposted by profile URL"],
  ["repostedAt", "Reposted at", "date"],
  ["repostComment", "Repost comment"],
  ["repostId", "Repost ID", "id"],
  ["repostUrl", "Repost URL"],
  ...Array.from({ length: CSV_MAX_LINK_COLUMNS }, (_, i) => [
    `link${i + 1}`,
    `Link ${i + 1}`,
  ]),
  ["feedContext", "Why it was in my feed"],
  ["feedContextPersonUrl", "Feed reason person URL"],
  ["matches", "Matched keywords"],
  ["score", "Score"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["reposts", "Reposts"],
  ["savedAt", "Saved at", "date"],
];

// "2026-10-11 15:30" in local time: Excel and Google Sheets both read this as
// a date, unlike the ISO "2026-10-11T10:00:00.000Z" format.
function formatCsvDate(value) {
  const date = new Date(value);
  if (!value || isNaN(date)) return value ?? "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function csvCell(value, type) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date") value = formatCsvDate(value);
  let text = Array.isArray(value) ? value.join(", ") : String(value);
  if (type === "id") {
    // 19-digit IDs: Excel would show 7.38E+18 and drop digits, so make
    // spreadsheet apps keep them as text.
    return `"=""${text.replace(/"/g, "")}"""`;
  }
  // Stop spreadsheet apps from evaluating cells as formulas.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function postsToCsv(posts, fallbackSavedAt) {
  const rows = posts.map((post) => {
    const links = Array.isArray(post.links) ? post.links.filter(Boolean) : [];
    const values = { ...post, savedAt: post.savedAt || fallbackSavedAt };
    for (let i = 0; i < CSV_MAX_LINK_COLUMNS; i++) {
      values[`link${i + 1}`] =
        i === CSV_MAX_LINK_COLUMNS - 1
          ? links.slice(i).join("\n")
          : links[i] || "";
    }
    return CSV_COLUMNS.map(([key, , type]) => csvCell(values[key], type)).join(",");
  });
  return [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(","), ...rows].join("\r\n");
}

function downloadCsv(name, posts, fallbackSavedAt) {
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(
    `${name}-${date}.csv`,
    "\ufeff" + postsToCsv(posts, fallbackSavedAt),
    "text/csv;charset=utf-8",
  );
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindFeedScanResultActions(state) {
  const posts = state?.posts || [];
  $("#fs__retry_sheet_btn").click(function () {
    $(this).prop("disabled", true).text("Saving…");
    chrome.runtime.sendMessage(
      { action: "bg-saveInvestmentPostsToSheet", posts },
      async (response) => {
        const sheetSync = chrome.runtime.lastError
          ? { status: "error", error: chrome.runtime.lastError.message }
          : { ...response, at: new Date().toISOString() };
        // Writing the state re-renders the results via storage.onChanged.
        await chrome.storage.local.set({
          [FEED_SCAN_STORAGE_KEY]: { ...state, sheetSync },
        });
      },
    );
  });
  $("#fs__csv_btn").click(function () {
    trackPosthog("creator_extension_feed_scanner_exported", { env, count: posts.length });
    downloadCsv("linkedin-investment-posts-scan", posts, state?.finishedAt);
  });
  $("#fs__copy_btn").click(async function () {
    const text = posts
      .map((post) => `${post.author} — ${post.postUrl || ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      $(this).text("Copied!");
    } catch (error) {
      $(this).text("Copy failed");
    }
  });
}

function updateFeedScanResults(state) {
  $("#fs__results").html(feedScanResultsHtml(state));
  $("#fs__scan_btn")
    .prop("disabled", state?.status === "running")
    .text(
      state?.status === "running"
        ? "Scanning…"
        : $("#fs__scan_btn").data("idle-label") || "Scan feed",
    );
  bindFeedScanResultActions(state);
}

async function startFeedScan() {
  const tab = await getActiveTab();
  if (!tab?.url?.startsWith("https://www.linkedin.com/")) {
    chrome.tabs.create({ url: LINKEDIN_FEED_URL });
    return;
  }

  const extraKeywords = $("#fs__keywords")
    .val()
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const settings = {
    maxPosts: Number($("#fs__max_posts").val()) || 100,
    extraKeywords: extraKeywords.join(", "),
    includePromoted: $("#fs__promoted").is(":checked"),
  };
  chrome.storage.local.set({ [FEED_SCAN_SETTINGS_KEY]: settings });
  trackPosthog("creator_extension_feed_scanner_started", {
    env,
    maxPosts: settings.maxPosts,
  });

  chrome.tabs.sendMessage(
    tab.id,
    {
      action: "feedScanner-scan",
      options: { ...settings, extraKeywords },
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        updateFeedScanResults({
          status: "error",
          error:
            "Couldn't reach the LinkedIn page. Reload the LinkedIn tab and try again.",
        });
        return;
      }
      if (!response.started) {
        updateFeedScanResults({ status: "error", error: response.error });
      }
    },
  );
}

async function renderFeedScanner() {
  document.body.classList.add("fs-wide");
  const [settings, state, tab, sheetItems] = await Promise.all([
    getFeedScanSettings(),
    getFeedScanState(),
    getActiveTab(),
    chrome.storage.local.get([INVESTMENT_SHEET_URL_KEY]).catch(() => ({})),
  ]);
  const sheetUrl = sheetItems?.[INVESTMENT_SHEET_URL_KEY] || "";
  const onLinkedIn = tab?.url?.startsWith("https://www.linkedin.com/");
  const maxPostOptions = [50, 100, 200, 300]
    .map(
      (count) =>
        `<option value="${count}" ${Number(settings.maxPosts) === count ? "selected" : ""}>${count} posts</option>`,
    )
    .join("");

  $("#root").html(`
    <div class="fs-view">
      <div class="fs-header">
        <button id="fs__back_btn" class="fs-icon-btn" title="Back">←</button>
        <h1>Investment posts in my feed</h1>
      </div>
      <div class="fs-controls">
        <label>Scan
          <select id="fs__max_posts">${maxPostOptions}</select>
        </label>
        <label class="fs-check"><input type="checkbox" id="fs__promoted" ${settings.includePromoted ? "checked" : ""}/> Include promoted</label>
      </div>
      <input id="fs__keywords" class="fs-input" placeholder="Extra keywords, comma separated (e.g. zerodha, fintech)" value="${escapeHtml(settings.extraKeywords)}"/>
      <button id="fs__scan_btn" class="fs-primary-btn" data-idle-label="${onLinkedIn ? "Scan feed" : "Open LinkedIn feed"}"></button>
      <div id="fs__history" class="fs-sheet-row fs-history"></div>
      <div id="fs__sheet" class="fs-sheet"></div>
      <div id="fs__results" class="fs-results"></div>
    </div>`);

  $("#fs__back_btn").click(() => window.location.reload());
  $("#fs__scan_btn").click(startFeedScan);
  renderHistory();
  renderSheetConnection(sheetUrl);
  updateFeedScanResults(state);
}

async function getInvestmentHistory() {
  try {
    const items = await chrome.storage.local.get([INVESTMENT_HISTORY_KEY]);
    return Array.isArray(items?.[INVESTMENT_HISTORY_KEY])
      ? items[INVESTMENT_HISTORY_KEY]
      : [];
  } catch (error) {
    return [];
  }
}

async function renderHistory() {
  const history = await getInvestmentHistory();
  $("#fs__history").html(`
    <span>📚 History: <b>${history.length}</b> posts stored</span>
    <span>
      <button id="fs__history_download_btn" class="fs-secondary-btn" ${history.length ? "" : "disabled"}>Download all (CSV)</button>
      <button id="fs__history_clear_btn" class="fs-inline-btn" ${history.length ? "" : "disabled"}>Clear</button>
    </span>`);

  $("#fs__history_download_btn").click(async function () {
    const posts = await getInvestmentHistory();
    trackPosthog("creator_extension_feed_scanner_history_downloaded", { env, count: posts.length });
    downloadCsv("linkedin-investment-posts-history", posts);
  });

  $("#fs__history_clear_btn").click(async function () {
    const count = (await getInvestmentHistory()).length;
    if (!window.confirm(`Delete all ${count} stored posts from the history? This can't be undone. Download them first if you need them.`)) {
      return;
    }
    await chrome.storage.local.remove(INVESTMENT_HISTORY_KEY);
    trackPosthog("creator_extension_feed_scanner_history_cleared", { env, count });
  });
}

function renderSheetConnection(sheetUrl, editing = false) {
  if (sheetUrl && !editing) {
    $("#fs__sheet").html(`
      <div class="fs-sheet-row">
        <span>📄 Auto-saving to your Google Sheet</span>
        <button id="fs__sheet_change_btn" class="fs-inline-btn">Change</button>
      </div>`);
    $("#fs__sheet_change_btn").click(() => renderSheetConnection(sheetUrl, true));
    return;
  }

  $("#fs__sheet").html(`
    <details class="fs-sheet-setup" ${sheetUrl ? "" : "open"}>
      <summary>📄 Connect Google Sheet (auto-save after each scan)</summary>
      <ol>
        <li>Open your Google Sheet → <b>Extensions → Apps Script</b>.</li>
        <li>Delete what's there and paste the script <button id="fs__copy_script_btn" class="fs-inline-btn">Copy script</button></li>
        <li><b>Deploy → New deployment</b> → type <b>Web app</b>, execute as <b>Me</b>, access <b>Anyone</b> → Deploy, and allow access.</li>
        <li>Paste the <b>Web app URL</b> here:</li>
      </ol>
      <div class="fs-sheet-row">
        <input id="fs__sheet_url" class="fs-input" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(sheetUrl || "")}"/>
        <button id="fs__sheet_connect_btn" class="fs-secondary-btn">Connect</button>
      </div>
      ${sheetUrl ? `<button id="fs__sheet_disconnect_btn" class="fs-inline-btn">Disconnect</button>` : ""}
      <p id="fs__sheet_msg" class="fs-sheet-msg"></p>
    </details>`);

  $("#fs__copy_script_btn").click(async function () {
    try {
      const res = await fetch(chrome.runtime.getURL("google-sheets/Code.gs"));
      await navigator.clipboard.writeText(await res.text());
      $(this).text("Copied!");
    } catch (error) {
      $(this).text("Copy failed");
    }
  });

  $("#fs__sheet_connect_btn").click(function () {
    const url = $("#fs__sheet_url").val().trim();
    const $btn = $(this).prop("disabled", true).text("Checking…");
    $("#fs__sheet_msg").removeClass("fs-sync-error").text("");
    chrome.runtime.sendMessage({ action: "bg-testInvestmentSheet", url }, async (response) => {
      $btn.prop("disabled", false).text("Connect");
      if (chrome.runtime.lastError || !response?.ok) {
        $("#fs__sheet_msg")
          .addClass("fs-sync-error")
          .text(response?.error || chrome.runtime.lastError?.message || "Couldn't connect.");
        return;
      }
      await chrome.storage.local.set({ [INVESTMENT_SHEET_URL_KEY]: url });
      trackPosthog("creator_extension_feed_scanner_sheet_connected", { env });
      renderSheetConnection(url);
    });
  });

  $("#fs__sheet_disconnect_btn").click(async function () {
    await chrome.storage.local.remove(INVESTMENT_SHEET_URL_KEY);
    renderSheetConnection("");
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !document.getElementById("fs__results")) return;
  if (changes[FEED_SCAN_STORAGE_KEY]) {
    updateFeedScanResults(changes[FEED_SCAN_STORAGE_KEY].newValue);
  }
  if (changes[INVESTMENT_HISTORY_KEY]) renderHistory();
});
