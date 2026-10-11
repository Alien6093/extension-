// Investment feed scanner.
//
// Reads posts from the signed-in user's LinkedIn home feed and keeps the ones
// that talk about investing (startup funding, VC, public markets, personal
// finance, crypto, real estate, ...). Triggered from the popup via
// chrome.tabs.sendMessage({ action: "feedScanner-scan" }). Progress and results
// are written to chrome.storage.local under FEED_SCAN_STORAGE_KEY so the popup
// can be closed while a scan runs and reopened later to see the results.
//
// Posts are read from LinkedIn's Voyager feed API first; if that fails (the
// endpoint changes from time to time) we fall back to scrolling the feed page
// and reading the posts from the DOM.
(() => {
  if (window.__anchorsFeedScannerLoaded) return;
  window.__anchorsFeedScannerLoaded = true;

  const FEED_SCAN_STORAGE_KEY = "investmentFeedScan";
  const MAX_TEXT_LENGTH = 3000;
  const API_PAGE_SIZE = 25;
  const API_MAX_PAGES = 40;
  const API_PAGE_DELAY_MS = 700;
  const DOM_SCROLL_DELAY_MS = 1800;
  const DOM_MAX_IDLE_SCROLLS = 4;
  const DEFAULT_MIN_SCORE = 3;

  // weight 3: almost always about investing on its own
  // weight 2: strong signal, occasionally used in other contexts
  // weight 1: ambiguous on its own ("portfolio", "exit"), only counts together
  //           with other signals
  const INVESTMENT_KEYWORDS = [
    // general
    { term: "invest", weight: 2, pattern: "invest(?:s|ed)?" },
    { term: "investing", weight: 3, pattern: "investing|investments?|investors?" },
    { term: "investment thesis", weight: 3 },
    { term: "wealth creation", weight: 3 },
    { term: "wealth management", weight: 3 },
    { term: "asset management", weight: 3 },
    { term: "asset allocation", weight: 3 },
    { term: "financial planning", weight: 2 },
    { term: "financial freedom", weight: 2 },
    { term: "passive income", weight: 2 },
    { term: "compounding", weight: 2 },
    { term: "returns", weight: 1 },
    { term: "portfolio", weight: 1 },
    { term: "capital", weight: 1 },
    { term: "diversification", weight: 1, pattern: "diversif(?:y|ied|ication)" },
    { term: "risk appetite", weight: 2 },
    { term: "CAGR", weight: 2, caseSensitive: true },
    { term: "ROI", weight: 1, caseSensitive: true },

    // startup funding / VC / PE
    { term: "venture capital", weight: 3 },
    { term: "VC", weight: 2, pattern: "VCs?", caseSensitive: true },
    { term: "angel investor", weight: 3, pattern: "angel (?:investor|investors|investing|round)" },
    { term: "private equity", weight: 3 },
    { term: "hedge fund", weight: 3, pattern: "hedge funds?" },
    { term: "family office", weight: 2, pattern: "family offices?" },
    { term: "limited partner", weight: 3, pattern: "limited partners?|LPs", caseSensitive: false },
    { term: "pre-seed", weight: 3, pattern: "pre[- ]seed" },
    { term: "seed round", weight: 3, pattern: "seed (?:round|funding|stage|investment)" },
    { term: "Series A-F", weight: 3, pattern: "series [a-f](?: round| funding)?" },
    { term: "funding round", weight: 3, pattern: "funding rounds?" },
    { term: "raised funding", weight: 3, pattern: "raised (?:(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs)?|[\\d.,]+\\s?(?:m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs))" },
    { term: "fundraise", weight: 2, pattern: "fund ?rais(?:e|es|ed|ing)" },
    { term: "term sheet", weight: 3, pattern: "term ?sheets?" },
    { term: "valuation", weight: 2, pattern: "valuations?" },
    { term: "cap table", weight: 3 },
    { term: "dilution", weight: 1 },
    { term: "unicorn", weight: 1, pattern: "unicorns?" },
    { term: "AUM", weight: 3, caseSensitive: true },
    { term: "dry powder", weight: 3 },
    { term: "IPO", weight: 3, pattern: "IPOs?", caseSensitive: true },
    { term: "pre-IPO", weight: 3, pattern: "pre-IPO", caseSensitive: true },
    { term: "acquisition", weight: 1, pattern: "acquisitions?|acquired" },
    { term: "M&A", weight: 2, pattern: "M&A", caseSensitive: true },
    { term: "exit", weight: 1, pattern: "exits?" },
    { term: "portfolio company", weight: 3, pattern: "portfolio compan(?:y|ies)" },
    { term: "fund", weight: 1, pattern: "funds?" },
    { term: "Fund I-V", weight: 3, pattern: "fund (?:I|II|III|IV|V|VI|1|2|3|4|5)\\b", caseSensitive: false },
    { term: "due diligence", weight: 2 },

    // public markets
    { term: "stock market", weight: 3, pattern: "stock ?markets?|share ?markets?" },
    { term: "stocks", weight: 2, pattern: "stocks|equities|equity markets?" },
    { term: "mutual fund", weight: 3, pattern: "mutual funds?" },
    { term: "index fund", weight: 3, pattern: "index funds?" },
    { term: "ETF", weight: 3, pattern: "ETFs?", caseSensitive: true },
    { term: "SIP", weight: 3, pattern: "SIPs?", caseSensitive: true },
    { term: "dividend", weight: 2, pattern: "dividends?" },
    { term: "bonds", weight: 2, pattern: "bonds|fixed income|treasury yields?" },
    { term: "bull/bear market", weight: 3, pattern: "(?:bull|bear) (?:market|run|rally)" },
    { term: "market cap", weight: 2, pattern: "market cap(?:italisation|italization)?" },
    { term: "P/E ratio", weight: 3, pattern: "P/E|PE ratio", caseSensitive: true },
    { term: "Nifty", weight: 3, pattern: "Nifty(?: ?50)?", caseSensitive: true },
    { term: "Sensex", weight: 3 },
    { term: "NSE/BSE", weight: 2, pattern: "NSE|BSE", caseSensitive: true },
    { term: "SEBI", weight: 2, caseSensitive: true },
    { term: "S&P 500", weight: 3, pattern: "S&P ?500" },
    { term: "Nasdaq", weight: 3 },
    { term: "Dow Jones", weight: 3 },
    { term: "Wall Street", weight: 2 },
    { term: "Warren Buffett", weight: 2, pattern: "buffett|berkshire" },
    { term: "trading", weight: 1, pattern: "trading|traders?" },
    { term: "options trading", weight: 3, pattern: "options trading|F&O|futures and options" },
    { term: "demat", weight: 3 },
    { term: "PMS", weight: 2, caseSensitive: true },
    { term: "AIF", weight: 3, pattern: "AIFs?", caseSensitive: true },
    { term: "REIT", weight: 3, pattern: "REITs?", caseSensitive: true },

    // crypto
    { term: "crypto", weight: 2, pattern: "crypto(?:currency|currencies)?" },
    { term: "bitcoin", weight: 2, pattern: "bitcoin|BTC" },
    { term: "ethereum", weight: 2 },

    // real estate / alternatives
    { term: "real estate investing", weight: 3, pattern: "real estate (?:investing|investment|investor)s?" },
    { term: "rental yield", weight: 3, pattern: "rental yields?" },
    { term: "gold", weight: 1, pattern: "gold (?:etf|bonds?|prices?)|sovereign gold" },
  ];

  const compiledKeywordsCache = new Map();

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compileKeywords(extraKeywords = []) {
    const cacheKey = extraKeywords.join("\u0000");
    if (compiledKeywordsCache.has(cacheKey)) {
      return compiledKeywordsCache.get(cacheKey);
    }

    const extras = extraKeywords
      .map((keyword) => String(keyword || "").trim())
      .filter(Boolean)
      .map((keyword) => ({ term: keyword, weight: DEFAULT_MIN_SCORE }));

    const compiled = [...INVESTMENT_KEYWORDS, ...extras].map((keyword) => {
      const source = keyword.pattern || escapeRegExp(keyword.term);
      // \b does not work next to "$", "&", "₹" etc., so use explicit
      // non-word lookarounds instead.
      const regex = new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])(?:${source})(?=$|[^\\p{L}\\p{N}_])`,
        keyword.caseSensitive ? "u" : "iu",
      );
      return { ...keyword, regex };
    });

    compiledKeywordsCache.set(cacheKey, compiled);
    return compiled;
  }

  function classifyText(text, { extraKeywords = [], minScore = DEFAULT_MIN_SCORE } = {}) {
    const matches = [];
    let score = 0;

    if (text) {
      for (const keyword of compileKeywords(extraKeywords)) {
        if (keyword.regex.test(text)) {
          matches.push(keyword.term);
          score += keyword.weight;
        }
      }
    }

    return { isInvestment: score >= minScore, score, matches };
  }

  function getCsrfToken() {
    return document.cookie
      .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
      .replace(/^["']|["']$/g, "");
  }

  function getSecChUaHeader() {
    const brands = navigator.userAgentData?.brands || [];
    return brands
      .map((brand) => `"${brand.brand}";v="${brand.version}"`)
      .join(", ");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function truncate(text, maxLength = MAX_TEXT_LENGTH) {
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }

  // LinkedIn activity ids embed the creation time in their first 41 bits.
  function activityIdToIsoDate(activityId) {
    try {
      if (!activityId || !/^\d+$/.test(activityId)) return null;
      const ms = Number(BigInt(activityId) >> 22n);
      const date = new Date(ms);
      // Sanity check: LinkedIn did not exist before 2003.
      return date.getFullYear() > 2003 ? date.toISOString() : null;
    } catch (error) {
      return null;
    }
  }

  function getActivityId(value) {
    return String(value || "").match(/urn:li:activity:(\d+)/i)?.[1] || null;
  }

  function cleanLinkedInUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, "https://www.linkedin.com");
      if (parsed.hostname !== "www.linkedin.com") return null;
      return `${parsed.origin}${parsed.pathname}`;
    } catch (error) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Voyager API source
  // ---------------------------------------------------------------------------

  function getArticleTitle(content) {
    const article =
      content?.["com.linkedin.voyager.feed.render.ArticleComponent"] ||
      content?.articleComponent;
    return [article?.title?.text, article?.subtitle?.text]
      .filter(Boolean)
      .join(" — ");
  }

  function getDocumentTitle(content) {
    const doc =
      content?.["com.linkedin.voyager.feed.render.DocumentComponent"] ||
      content?.documentComponent;
    return doc?.document?.title || "";
  }

  function isPromotedUpdate(update) {
    const urn = update?.updateMetadata?.urn || "";
    return (
      /sponsored/i.test(urn) ||
      Boolean(update?.updateMetadata?.trackingData?.sponsoredTracking) ||
      /\bpromoted\b/i.test(update?.actor?.subDescription?.text || "")
    );
  }

  function parseFeedApiElement(update) {
    if (!update || typeof update !== "object") return null;

    const urn = update?.updateMetadata?.urn || update?.entityUrn || "";
    const activityId = getActivityId(urn) || getActivityId(update?.entityUrn);
    const reshared = update?.resharedUpdate;

    const ownText = update?.commentary?.text?.text || "";
    const resharedText = reshared?.commentary?.text?.text || "";
    const attachmentText = [
      getArticleTitle(update?.content),
      getDocumentTitle(update?.content),
      getArticleTitle(reshared?.content),
      getDocumentTitle(reshared?.content),
    ]
      .filter(Boolean)
      .join("\n");

    const text = [ownText, resharedText, attachmentText]
      .filter(Boolean)
      .join("\n\n");
    if (!text.trim()) return null;

    const actor = update?.actor || reshared?.actor || {};
    const counts = update?.socialDetail?.totalSocialActivityCounts || {};

    return {
      id: activityId || urn,
      activityId,
      postUrl: activityId
        ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
        : cleanLinkedInUrl(update?.socialContent?.shareUrl),
      author: actor?.name?.text || "",
      authorHeadline: actor?.description?.text || "",
      authorUrl: cleanLinkedInUrl(actor?.navigationContext?.actionTarget),
      feedContext: update?.header?.text?.text || "",
      text: truncate(text),
      postedAt: activityIdToIsoDate(activityId),
      relativeTime:
        actor?.subDescription?.text?.split("•")?.[0]?.trim() || "",
      likes: counts?.numLikes ?? null,
      comments: counts?.numComments ?? null,
      reposts: counts?.numShares ?? null,
      isRepost: Boolean(reshared),
      isPromoted: isPromotedUpdate(update),
    };
  }

  async function fetchFeedPage(start, paginationToken) {
    const params = new URLSearchParams({
      commentsCount: "0",
      count: String(API_PAGE_SIZE),
      likesCount: "0",
      moduleKey: "home-feed:desktop",
      q: "feed",
      sortOrder: "RELEVANCE",
      start: String(start),
    });
    if (paginationToken) params.append("paginationToken", paginationToken);

    const headers = {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Csrf-Token": getCsrfToken(),
      "X-Li-Lang": "en_US",
      "X-Restli-Protocol-Version": "2.0.0",
      "x-li-track":
        '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
    };
    const secChUa = getSecChUaHeader();
    if (secChUa) headers["Sec-Ch-Ua"] = secChUa;

    const response = await fetch(
      `https://www.linkedin.com/voyager/api/feed/updatesV2?${params}`,
      { method: "GET", headers, credentials: "include" },
    );
    if (!response.ok) {
      throw new Error(`Feed API responded with ${response.status}`);
    }

    const data = await response.json();
    return {
      elements: Array.isArray(data?.elements) ? data.elements : [],
      paginationToken: data?.metadata?.paginationToken || null,
    };
  }

  async function collectPostsFromApi({ maxPosts, onProgress }) {
    const posts = new Map();
    let start = 0;
    let paginationToken = null;

    for (let page = 0; page < API_MAX_PAGES && posts.size < maxPosts; page++) {
      const { elements, paginationToken: nextToken } = await fetchFeedPage(
        start,
        paginationToken,
      );
      if (!elements.length) break;

      for (const element of elements) {
        const post = parseFeedApiElement(element);
        if (post && !posts.has(post.id)) posts.set(post.id, post);
      }

      onProgress?.(posts.size);
      start += elements.length;
      paginationToken = nextToken;
      await sleep(API_PAGE_DELAY_MS);
    }

    return [...posts.values()].slice(0, maxPosts);
  }

  // ---------------------------------------------------------------------------
  // DOM source (fallback): scrolls the feed page and reads the rendered posts
  // ---------------------------------------------------------------------------

  const DOM_POST_SELECTORS = [
    '[data-urn*="urn:li:activity:"]',
    '[data-id*="urn:li:activity:"]',
    "div.feed-shared-update-v2",
  ];

  const DOM_TEXT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
    '[data-testid="expandable-text-box"]',
  ];

  const DOM_AUTHOR_SELECTORS = [
    '.update-components-actor__title span[aria-hidden="true"]',
    ".update-components-actor__name",
    ".feed-shared-actor__name",
  ];

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return `dom-${(hash >>> 0).toString(36)}`;
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const parts = [...root.querySelectorAll(selector)]
        .map((el) => el.innerText?.trim())
        .filter(Boolean);
      if (parts.length) return parts.join("\n\n");
    }
    return "";
  }

  function findDomPostContainers() {
    const containers = [];
    const seen = new Set();

    for (const el of document.querySelectorAll(DOM_POST_SELECTORS.join(","))) {
      if (seen.has(el)) continue;
      // Keep the outermost post container only; reshared posts nest one
      // update inside another.
      const outer = el.parentElement?.closest(DOM_POST_SELECTORS.join(","));
      if (outer) continue;
      seen.add(el);
      containers.push(el);
    }

    // LinkedIn's newer server-driven feed has no stable class names; fall back
    // to the list items of the main feed.
    if (!containers.length) {
      for (const el of document.querySelectorAll(
        'main [role="listitem"], main [role="article"]',
      )) {
        if (el.parentElement?.closest('[role="listitem"], [role="article"]')) {
          continue;
        }
        containers.push(el);
      }
    }

    return containers;
  }

  function parseDomPost(container) {
    const urnAttr =
      container.getAttribute("data-urn") ||
      container.getAttribute("data-id") ||
      "";
    const postLink = container.querySelector(
      'a[href*="urn:li:activity:"], a[href*="/feed/update/"], a[href*="/posts/"]',
    );
    const activityId =
      getActivityId(urnAttr) ||
      getActivityId(decodeURIComponent(postLink?.getAttribute("href") || ""));

    const text = firstText(container, DOM_TEXT_SELECTORS) ||
      container.innerText?.trim() ||
      "";
    if (!text) return null;

    const authorLink = container.querySelector(
      'a[href*="/in/"], a[href*="/company/"], a[href*="/school/"]',
    );
    const author =
      firstText(container, DOM_AUTHOR_SELECTORS).split("\n")[0] ||
      authorLink?.innerText?.trim()?.split("\n")[0] ||
      "";

    return {
      id: activityId || hashText(text),
      activityId,
      postUrl: activityId
        ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
        : cleanLinkedInUrl(postLink?.href),
      author,
      authorHeadline:
        container
          .querySelector(".update-components-actor__description")
          ?.innerText?.trim()
          ?.split("\n")[0] || "",
      authorUrl: cleanLinkedInUrl(authorLink?.href),
      feedContext:
        container
          .querySelector(".update-components-header")
          ?.innerText?.trim() || "",
      text: truncate(text),
      postedAt: activityIdToIsoDate(activityId),
      relativeTime: "",
      likes: null,
      comments: null,
      reposts: null,
      isRepost: Boolean(
        container.querySelector(".feed-shared-update-v2__reshared-content, .update-components-mini-update-v2"),
      ),
      isPromoted: /(?:^|\n)\s*Promoted\s*(?:\n|$)/.test(container.innerText || ""),
    };
  }

  async function collectPostsFromDom({ maxPosts, onProgress }) {
    if (!window.location.pathname.startsWith("/feed")) {
      throw new Error(
        "Open your LinkedIn home feed (linkedin.com/feed) and try again.",
      );
    }

    const posts = new Map();
    const originalScrollY = window.scrollY;
    let idleScrolls = 0;

    while (posts.size < maxPosts && idleScrolls < DOM_MAX_IDLE_SCROLLS) {
      const before = posts.size;
      for (const container of findDomPostContainers()) {
        const post = parseDomPost(container);
        if (post && !posts.has(post.id)) posts.set(post.id, post);
      }
      onProgress?.(posts.size);

      idleScrolls = posts.size === before ? idleScrolls + 1 : 0;
      if (posts.size >= maxPosts) break;

      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(DOM_SCROLL_DELAY_MS);
    }

    window.scrollTo({ top: originalScrollY });
    return [...posts.values()].slice(0, maxPosts);
  }

  // ---------------------------------------------------------------------------
  // Scan orchestration
  // ---------------------------------------------------------------------------

  let scanInProgress = false;

  async function saveScanState(state) {
    try {
      await chrome.storage.local.set({ [FEED_SCAN_STORAGE_KEY]: state });
    } catch (error) {
      console.log("feedScanner: failed to save scan state", error);
    }
  }

  async function runScan(options = {}) {
    const maxPosts = Math.min(Math.max(Number(options.maxPosts) || 100, 10), 500);
    const extraKeywords = Array.isArray(options.extraKeywords)
      ? options.extraKeywords
      : [];
    const includePromoted = Boolean(options.includePromoted);
    const minScore = Number(options.minScore) || DEFAULT_MIN_SCORE;

    const startedAt = new Date().toISOString();
    const baseState = { status: "running", startedAt, maxPosts, scanned: 0, source: "api" };
    await saveScanState(baseState);

    let lastProgressSave = 0;
    const makeProgressHandler = (source) => (scanned) => {
      const now = Date.now();
      if (now - lastProgressSave < 500) return;
      lastProgressSave = now;
      saveScanState({ ...baseState, source, scanned });
    };

    let rawPosts = [];
    let source = "api";

    try {
      rawPosts = await collectPostsFromApi({
        maxPosts,
        onProgress: makeProgressHandler("api"),
      });
    } catch (error) {
      console.log("feedScanner: feed API failed, falling back to DOM", error);
    }

    if (!rawPosts.length) {
      source = "dom";
      rawPosts = await collectPostsFromDom({
        maxPosts,
        onProgress: makeProgressHandler("dom"),
      });
    }

    const posts = rawPosts
      .filter((post) => includePromoted || !post.isPromoted)
      .map((post) => {
        const { isInvestment, score, matches } = classifyText(post.text, {
          extraKeywords,
          minScore,
        });
        return { ...post, isInvestment, score, matches };
      })
      .filter((post) => post.isInvestment)
      .sort((a, b) => b.score - a.score);

    const result = {
      status: "done",
      startedAt,
      finishedAt: new Date().toISOString(),
      maxPosts,
      source,
      scanned: rawPosts.length,
      posts,
    };
    await saveScanState(result);
    return result;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === "feedScanner-ping") {
      sendResponse({ ok: true });
      return;
    }

    if (request?.action !== "feedScanner-scan") return;

    if (scanInProgress) {
      sendResponse({ started: false, error: "A scan is already running in this tab." });
      return;
    }

    scanInProgress = true;
    // Respond right away; the popup may close before a long scan finishes, so
    // results are delivered through chrome.storage instead.
    sendResponse({ started: true });

    runScan(request.options)
      .catch((error) => {
        console.error("feedScanner: scan failed", error);
        return saveScanState({
          status: "error",
          finishedAt: new Date().toISOString(),
          error: error?.message || String(error),
        });
      })
      .finally(() => {
        scanInProgress = false;
      });
  });

  // Exposed for debugging from the DevTools console of the content script.
  window.__anchorsFeedScanner = {
    classifyText,
    parseFeedApiElement,
    runScan,
  };
})();
