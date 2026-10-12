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

  // ---------------------------------------------------------------------------
  // Classifier
  //
  // Every rule belongs to a category and adds `weight` points to it when its
  // pattern is found in the post (each rule counts once). A post is kept when:
  //   - its "Funding opportunity" points reach MIN_SCORE, or
  //   - it has a form link / "fill this form" AND talks about founders,
  //     startups or funding (the form rule), or
  //   - its points across all categories reach MIN_SCORE.
  // An investor headline ("Angel investor", "Partner @ X Ventures") adds
  // HEADLINE_POINTS, which is never enough on its own.
  // ---------------------------------------------------------------------------

  const CATEGORY = {
    OPPORTUNITY: "Funding opportunity",
    FORM: "Form / application (check)",
    GRANT: "Grants & competitions",
    NEWS: "Funding news",
    MARKETS: "Markets & personal finance",
    INSIGHTS: "Fundraising & VC insights",
    CUSTOM: "Custom keyword match",
  };

  // Order used to sort results and to break ties between categories.
  const CATEGORY_PRIORITY = [
    CATEGORY.OPPORTUNITY,
    CATEGORY.FORM,
    CATEGORY.GRANT,
    CATEGORY.NEWS,
    CATEGORY.MARKETS,
    CATEGORY.INSIGHTS,
    CATEGORY.CUSTOM,
  ];

  const HEADLINE_POINTS = 2;

  // weight 3: enough on its own
  // weight 2: strong signal, needs one more
  // weight 1: common word, only counts together with others
  const RULES = [
    // --- Funding opportunity: investors asking for startups -----------------
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "asks for your deck", pattern: "(?:dm|send|share|email|mail|drop|inbox)\\s+(?:me|us)?\\s*(?:your|ur|the)?\\s*(?:pitch\\s*)?decks?" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "share your deck", pattern: "(?:share|send|submit|drop)\\s+(?:your|ur)\\s+(?:pitch\\s*)?(?:deck|pitch)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "pitch to us", pattern: "pitch\\s+(?:to\\s+)?(?:me|us)\\b" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "accepting pitches", pattern: "(?:accepting|open\\s+(?:to|for))\\s+(?:pitch(?:es)?|decks|applications)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "founders raising", pattern: "(?:founders?|startups?)\\s+(?:(?:[\\w&/-]+\\s+){0,4}?(?:who|that)\\s+(?:are|r)\\s+)?(?:currently\\s+|actively\\s+)?raising" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "if you're raising", pattern: "(?:if\\s+)?(?:you(?:'re|’re|\\s+are)|u\\s+r)\\s+(?:currently\\s+|actively\\s+)?raising|raising\\s+(?:your|a)\\s+(?:first\\s+|next\\s+)?(?:round|pre[- ]?seed|seed|series\\s+a)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "looking to invest", pattern: "looking\\s+(?:to\\s+invest|to\\s+back|for\\s+(?:startups|founders|companies)\\s+to\\s+(?:invest|back)|for\\s+(?:investment\\s+)?opportunities)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "we're investing in", pattern: "(?:we(?:'re|’re|\\s+are)|i(?:'m|’m|\\s+am))\\s+(?:actively\\s+)?(?:investing|writing\\s+(?:cheques|checks))" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "writing cheques", pattern: "(?:writing|writes?|cut(?:s|ting)?)\\s+(?:a\\s+|the\\s+)?(?:first\\s+)?(?:cheques?|checks?)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "cheque / ticket size", pattern: "(?:cheque|check|ticket)\\s+sizes?" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "deploying capital", pattern: "deploy(?:ing)?\\s+(?:capital|our\\s+fund|funds)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "backing founders", pattern: "(?:back|backing|partner\\s+with)\\s+(?:early[- ]stage\\s+|ambitious\\s+|exceptional\\s+|great\\s+)?(?:founders|startups)" },
    { category: CATEGORY.OPPORTUNITY, weight: 2, label: "calling all founders", pattern: "calling\\s+(?:all\\s+)?(?:founders|startups|entrepreneurs)" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "investor office hours", pattern: "(?:investor\\s+|vc\\s+|open\\s+)?office\\s+hours" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "meet investors", pattern: "(?:meet|connect\\s+with|get\\s+in\\s+front\\s+of)\\s+(?:top\\s+|leading\\s+)?(?:investors|vcs|angels)" },
    { category: CATEGORY.OPPORTUNITY, weight: 2, label: "fund for startups", pattern: "(?:fund|syndicate|programme|program)\\s+(?:for|to\\s+back|backing|focused\\s+on|investing\\s+in)\\s+(?:[\\w&/-]+\\s+){0,4}(?:startups|founders|companies|entrepreneurs)" },
    { category: CATEGORY.OPPORTUNITY, weight: 2, label: "need funding?", pattern: "(?:need|needs|seeking|looking\\s+for|in\\s+search\\s+of)\\s+(?:funding|investment|capital|investors|an?\\s+investor)" },
    { category: CATEGORY.OPPORTUNITY, weight: 2, label: "invest in early-stage", pattern: "invest(?:s|ing)?\\s+in\\s+(?:early[- ]stage|pre[- ]seed|seed|series\\s+a)\\b" },
    { category: CATEGORY.OPPORTUNITY, weight: 1, label: "DM / reach out", pattern: "dm\\s+(?:me|us)|reach\\s+out|drop\\s+(?:me\\s+)?a\\s+(?:dm|message|note)|email\\s+(?:me|us)|inbox\\s+(?:me|us)|ping\\s+(?:me|us)|would\\s+love\\s+to\\s+(?:chat|hear\\s+from|connect|talk|meet)|tell\\s+us\\s+about\\s+your\\s+(?:startup|company)|let'?s\\s+(?:chat|talk|connect)|(?:our|my)\\s+(?:inbox|dms?)\\s+(?:is|are)\\s+open|dms?\\s+(?:are\\s+)?open" },

    // --- Funding opportunity: accelerators / incubators ----------------------
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "applications open", pattern: "applications?\\s+(?:are\\s+)?(?:now\\s+)?(?:open|live|closing)|(?:now\\s+)?accepting\\s+applications|apply\\s+(?:now|today|before|by)\\b|last\\s+date\\s+to\\s+apply" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "accelerator / incubator", pattern: "(?:accelerator|incubat(?:or|ion))\\s+(?:program(?:me)?s?|cohorts?|batch)|(?:startup|founder)\\s+(?:program(?:me)?|fellowship|residency)" },
    { category: CATEGORY.OPPORTUNITY, weight: 2, label: "accelerator / incubator", pattern: "accelerators?|incubators?|incubation" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "cohort", pattern: "(?:next|new|upcoming|first|second|third|fourth|fifth)\\s+cohort|cohort\\s+(?:\\d+|[ivx]+)\\b" },
    { category: CATEGORY.OPPORTUNITY, weight: 1, label: "cohort", pattern: "cohorts?" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "demo day", pattern: "demo\\s+day" },
    { category: CATEGORY.OPPORTUNITY, weight: 3, label: "known accelerator", pattern: "Y\\s?Combinator|YC\\s+(?:W|S|F|X)\\d{2}|Techstars|Antler|Entrepreneur\\s+First|500\\s+Global|Plug\\s+and\\s+Play|Founders\\s+Factory|Sequoia\\s+Arc|Peak\\s+XV'?s?\\s+Surge|100X\\.VC|Venture\\s+Catalysts|Indian\\s+Angel\\s+Network|Google\\s+for\\s+Startups\\s+Accelerator|Microsoft\\s+for\\s+Startups|NSRCEL|T-Hub|CIIE", caseSensitive: true },
    { category: CATEGORY.OPPORTUNITY, weight: 1, label: "apply", pattern: "apply|applications?" },

    // --- Grants & competitions ----------------------------------------------
    { category: CATEGORY.GRANT, weight: 3, label: "grant", pattern: "(?:startup|innovation|research|equity[- ]free)\\s+grants?|grants?\\s+(?:of|up\\s+to|worth)\\s+(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs|l)?|non[- ]dilutive" },
    { category: CATEGORY.GRANT, weight: 3, label: "government scheme", pattern: "Startup\\s+India\\s+Seed\\s+Fund|SISFS|BIRAC|BIG\\s+grant|seed\\s+fund\\s+scheme|government\\s+(?:grant|scheme|funding)|DPIIT|MeitY\\s+(?:grant|scheme|SAMRIDH)|SAMRIDH" },
    { category: CATEGORY.GRANT, weight: 3, label: "pitch competition", pattern: "pitch(?:ing)?\\s+(?:competition|contest|battle|fest|event|day|session)|startup\\s+(?:competition|challenge|contest)|innovation\\s+challenge" },
    { category: CATEGORY.GRANT, weight: 3, label: "prize money", pattern: "cash\\s+prizes?|prize\\s+(?:money|pool|worth)|win\\s+(?:up\\s+to\\s+)?(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs|l)?" },
    { category: CATEGORY.GRANT, weight: 1, label: "grant", pattern: "grants?" },

    // --- Funding news --------------------------------------------------------
    { category: CATEGORY.NEWS, weight: 3, label: "raised funding", pattern: "rais(?:ed|es)\\s+(?:(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs)?|[\\d.,]+\\s?(?:m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs))" },
    { category: CATEGORY.NEWS, weight: 3, label: "round led by", pattern: "(?:round|funding|investment)\\s+(?:was\\s+)?led\\s+by|with\\s+participation\\s+from|co-led\\s+by" },
    { category: CATEGORY.NEWS, weight: 3, label: "closed round", pattern: "clos(?:e|es|ed|ing)\\s+(?:(?:our|a|the|its|their|his|her|new|maiden|debut|first|second|third)\\s+)+(?:(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs|l)?\\s+)?(?:[\\w-]+\\s+)?(?:round|fund)|oversubscribed|(?:first|final)\\s+close" },
    { category: CATEGORY.NEWS, weight: 2, label: "seed / pre-seed round", pattern: "(?:pre[- ]?seed|seed|bridge|angel)\\s+(?:round|funding|investment)" },
    { category: CATEGORY.NEWS, weight: 2, label: "Series A-F", pattern: "series\\s+[a-f](?:\\s+(?:round|funding))?" },
    { category: CATEGORY.NEWS, weight: 2, label: "funding round", pattern: "funding\\s+rounds?" },
    { category: CATEGORY.NEWS, weight: 2, label: "backed by", pattern: "backed\\s+by" },
    { category: CATEGORY.NEWS, weight: 1, label: "latest round", pattern: "(?:latest|new|recent|fresh)\\s+(?:funding\\s+)?round" },
    { category: CATEGORY.NEWS, weight: 3, label: "IPO", pattern: "IPOs?|pre-IPO", caseSensitive: true },
    { category: CATEGORY.NEWS, weight: 2, label: "M&A", pattern: "M&A", caseSensitive: true },
    { category: CATEGORY.NEWS, weight: 2, label: "new fund", pattern: "fund\\s+(?:I|II|III|IV|V|VI|1|2|3|4|5)\\b|(?:new|maiden|debut)\\s+(?:(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs|l)?\\s+)?fund" },
    { category: CATEGORY.NEWS, weight: 2, label: "AUM", pattern: "AUM", caseSensitive: true },
    { category: CATEGORY.NEWS, weight: 2, label: "portfolio company", pattern: "portfolio\\s+compan(?:y|ies)" },
    { category: CATEGORY.NEWS, weight: 2, label: "valuation", pattern: "(?:\\$|₹|rs\\.?|inr|usd)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores)?\\s+valuation|valued\\s+at\\s+(?:\\$|₹|rs\\.?|inr|usd|eur|£|€)\\s?[\\d.,]+\\s?(?:k|m|mn|million|b|bn|billion|cr|crore|crores|lakh|lakhs|l)?" },
    { category: CATEGORY.NEWS, weight: 1, label: "valuation", pattern: "valuations?|valued\\s+at" },
    { category: CATEGORY.NEWS, weight: 2, label: "raising (news)", pattern: "reportedly\\s+raising|(?<!who\\s)(?<!that\\s)is\\s+raising|in\\s+talks\\s+to\\s+raise|set\\s+to\\s+raise|plans\\s+to\\s+raise" },
    { category: CATEGORY.NEWS, weight: 1, label: "unicorn", pattern: "unicorns?" },
    { category: CATEGORY.NEWS, weight: 1, label: "acquisition", pattern: "acquisitions?|acquired" },
    { category: CATEGORY.NEWS, weight: 1, label: "announcement", pattern: "(?:thrilled|excited|proud|delighted|happy|pleased)\\s+to\\s+(?:announce|share)|announcing" },

    // --- Fundraising & VC insights -------------------------------------------
    { category: CATEGORY.INSIGHTS, weight: 3, label: "investment thesis", pattern: "investment\\s+thesis" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "venture capital", pattern: "venture\\s+capital(?:ists?)?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "VC", pattern: "VCs?", caseSensitive: true },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "angel investor", pattern: "angel\\s+(?:investors?|investing|networks?|syndicates?)" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "private equity", pattern: "private\\s+equity" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "investors", pattern: "investing|investments?|investors?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "fundraising", pattern: "fund\\s?rais(?:e|es|ed|ing)|raising\\s+(?:capital|funds|money|a\\s+round)" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "pitch deck", pattern: "pitch\\s?decks?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "term sheet", pattern: "term\\s?sheets?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "cap table", pattern: "cap\\s+tables?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "family office", pattern: "family\\s+offices?" },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "limited partners", pattern: "limited\\s+partners?|LPs", caseSensitive: false },
    { category: CATEGORY.INSIGHTS, weight: 2, label: "dry powder", pattern: "dry\\s+powder" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "invest", pattern: "invest(?:s|ed)?" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "founders", pattern: "founders?|co-founders?" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "due diligence", pattern: "due\\s+diligence" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "dilution", pattern: "dilution|diluted" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "exit", pattern: "exits?" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "fund", pattern: "funds?|funding|funded" },
    { category: CATEGORY.INSIGHTS, weight: 1, label: "capital", pattern: "capital" },

    // --- Markets & personal finance -------------------------------------------
    { category: CATEGORY.MARKETS, weight: 3, label: "stock market", pattern: "stock\\s?markets?|share\\s?markets?|equity\\s+markets?" },
    { category: CATEGORY.MARKETS, weight: 3, label: "mutual fund", pattern: "mutual\\s+funds?" },
    { category: CATEGORY.MARKETS, weight: 3, label: "index fund", pattern: "index\\s+funds?" },
    { category: CATEGORY.MARKETS, weight: 3, label: "ETF", pattern: "ETFs?", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "SIP", pattern: "SIPs?", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "bull/bear market", pattern: "(?:bull|bear)(?:ish)?\\s+(?:market|run|rally|phase)" },
    { category: CATEGORY.MARKETS, weight: 3, label: "P/E ratio", pattern: "P/E|PE\\s+ratio", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "Nifty / Sensex", pattern: "Nifty(?:\\s?50|\\s+Bank)?|Sensex|SENSEX", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "S&P / Nasdaq / Dow", pattern: "S&P\\s?500|Nasdaq|NASDAQ|Dow\\s+Jones", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "options trading", pattern: "options\\s+trading|F&O|futures\\s+and\\s+options|intraday" },
    { category: CATEGORY.MARKETS, weight: 3, label: "demat", pattern: "demat" },
    { category: CATEGORY.MARKETS, weight: 3, label: "AIF / REIT", pattern: "AIFs?|REITs?|InvITs?", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 3, label: "real estate investing", pattern: "real\\s+estate\\s+(?:investing|investments?|investors?)|rental\\s+yields?" },
    { category: CATEGORY.MARKETS, weight: 3, label: "wealth management", pattern: "wealth\\s+(?:creation|management|manager|building)|asset\\s+allocation" },
    { category: CATEGORY.MARKETS, weight: 2, label: "stocks", pattern: "stocks|equities|shares\\s+of|share\\s+price|stock\\s+price" },
    { category: CATEGORY.MARKETS, weight: 2, label: "dividend", pattern: "dividends?" },
    { category: CATEGORY.MARKETS, weight: 2, label: "bonds", pattern: "bonds|fixed\\s+income|treasury\\s+yields?|FDs?\\s+rates?" },
    { category: CATEGORY.MARKETS, weight: 2, label: "market cap", pattern: "market\\s+cap(?:italisation|italization)?" },
    { category: CATEGORY.MARKETS, weight: 2, label: "NSE / BSE / SEBI", pattern: "NSE|BSE|SEBI|RBI\\s+(?:policy|repo)", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 2, label: "Wall Street / Buffett", pattern: "wall\\s+street|buffett|berkshire" },
    { category: CATEGORY.MARKETS, weight: 2, label: "PMS", pattern: "PMS", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 2, label: "crypto", pattern: "crypto(?:currency|currencies)?" },
    { category: CATEGORY.MARKETS, weight: 2, label: "bitcoin / ethereum", pattern: "bitcoin|BTC|ethereum|ETH" },
    { category: CATEGORY.MARKETS, weight: 2, label: "personal finance", pattern: "financial\\s+(?:planning|freedom|independence)|passive\\s+income|compounding|retirement\\s+(?:planning|corpus)" },
    { category: CATEGORY.MARKETS, weight: 2, label: "CAGR", pattern: "CAGR|XIRR", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 2, label: "hedge fund", pattern: "hedge\\s+funds?" },
    { category: CATEGORY.MARKETS, weight: 1, label: "trading", pattern: "trading|traders?" },
    { category: CATEGORY.MARKETS, weight: 1, label: "returns", pattern: "returns" },
    { category: CATEGORY.MARKETS, weight: 1, label: "portfolio", pattern: "portfolio" },
    { category: CATEGORY.MARKETS, weight: 1, label: "diversification", pattern: "diversif(?:y|ied|ication)" },
    { category: CATEGORY.MARKETS, weight: 1, label: "ROI", pattern: "ROI", caseSensitive: true },
    { category: CATEGORY.MARKETS, weight: 1, label: "gold", pattern: "gold\\s+(?:etf|bonds?|prices?)|sovereign\\s+gold|digital\\s+gold" },
  ];

  // Sites used for application / sign-up forms.
  const FORM_LINK_PATTERN =
    /(?:^|\/\/)(?:[\w-]+\.)*(?:forms\.gle|docs\.google\.com\/forms|typeform\.com|tally\.so|airtable\.com\/(?:app\w+\/)?(?:shr|pag)\w*|jotform\.com|forms\.zohopublic\.(?:com|in)|zfrmz\.(?:com|in)|forms\.office\.com|forms\.microsoft\.com|surveymonkey\.com|share\.hsforms\.com|fillout\.com|paperform\.co|cognitoforms\.com|wufoo\.com|formstack\.com|f6s\.com|gust\.com|forms\.app|formfacade\.com|tripetto\.app|heyflow\.app)/i;

  function phrasePattern(phrases) {
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(?:${phrases.join("|")})(?=$|[^\\p{L}\\p{N}_])`,
      "iu",
    );
  }

  // Wording that clearly points to a form, even when the link isn't visible
  // (e.g. it is in the comments or hidden behind lnkd.in).
  const FORM_PHRASE_PATTERN = phrasePattern([
    "fill(?:ing)?\\s+(?:out\\s+|in\\s+|up\\s+)?(?:this|the|our|below|a)?\\s*(?:short\\s+|quick\\s+)?(?:google\\s+)?form",
    "google\\s+forms?",
    "form\\s+link",
    "application\\s+form",
    "(?:interest|registration|sign[- ]?up)\\s+form",
    "apply\\s+(?:here|via|through|using|at|on)\\b",
  ]);

  // Vaguer wording ("link in comments") is used for anything from blogs to
  // waitlists, so it only counts together with real funding wording.
  const WEAK_FORM_PHRASE_PATTERN = phrasePattern([
    "link\\s+(?:is\\s+)?in\\s+(?:the\\s+)?(?:first\\s+)?comments?",
    "link\\s+(?:is\\s+)?(?:below|in\\s+bio)",
  ]);

  // Founder / startup / funding wording needed for the form rule, so forms for
  // webinars, surveys or jobs aren't kept.
  const FUNDING_CONTEXT_PATTERN =
    /(?:^|[^\p{L}\p{N}_])(?:founders?|co-founders?|fund\s?rais\w*|funding|raising|raise|pitch(?:es|ing)?|pitch\s?decks?|decks?|investors?|investments?|investing|VCs?|venture\s+capital|accelerators?|incubat\w*|cohorts?|pre[- ]seed|seed\s+(?:round|stage|funding)|angels?|cheques?|grants?|demo\s+day)(?=$|[^\p{L}\p{N}_])/iu;
  const STRONG_FUNDING_CONTEXT_PATTERN =
    /(?:^|[^\p{L}\p{N}_])(?:fund\s?rais\w*|funding|raising|raise|pitch(?:es|ing)?|pitch\s?decks?|decks?|investors?|investments?|investing|VCs?|venture\s+capital|accelerators?|incubat\w*|cohorts?|pre[- ]seed|seed\s+(?:round|stage|funding)|angels?|cheques?|grants?|demo\s+day)(?=$|[^\p{L}\p{N}_])/iu;
  const STARTUP_PATTERN = /(?:^|[^\p{L}\p{N}_])(?:startups?|start-ups?|entrepreneurs?)(?=$|[^\p{L}\p{N}_])/iu;
  const HIRING_PATTERN =
    /(?:^|[^\p{L}\p{N}_])(?:hiring|we(?:'re|’re|\s+are)\s+looking\s+for\s+an?\s+\w+|job\s+(?:opening|opportunity|role)|internships?|vacanc(?:y|ies)|open\s+roles?|apply\s+for\s+(?:the|this)\s+(?:role|position)|join\s+(?:our|the)\s+(?:team|startup|company)|(?:product|software|ux|ui|frontend|backend|full[- ]?stack|marketing|sales|growth|graphic|content)\s+(?:designer|engineer|developer|manager|intern|executive|associate|lead|writer)|CTC|salary|walk-?in)(?=$|[^\p{L}\p{N}_])/iu;

  // Author headlines that belong to investors.
  const INVESTOR_HEADLINE_PATTERN =
    /(?:^|[^\p{L}\p{N}_])(?:angel\s+investor|investor(?!\s+relations)|investing\s+in|VC|venture\s+(?:capital(?:ist)?|partner|investor)|general\s+partner|managing\s+partner|limited\s+partner|family\s+office|fund\s+manager|(?:capital|ventures|vc|fund|angels|syndicate)(?=\s*(?:$|[|,•·@)]))|(?:partner|principal|associate|analyst|investment\s+(?:manager|associate|analyst|professional))\s+(?:at|@)\s+[^|,•·]*(?:capital|ventures|vc|fund|partners|angels|syndicate))(?=$|[^\p{L}\p{N}_])/iu;

  const compiledRulesCache = new Map();

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compileRules(extraKeywords = []) {
    const cacheKey = extraKeywords.join("\u0000");
    if (compiledRulesCache.has(cacheKey)) {
      return compiledRulesCache.get(cacheKey);
    }

    const extras = extraKeywords
      .map((keyword) => String(keyword || "").trim())
      .filter(Boolean)
      .map((keyword) => ({
        category: CATEGORY.CUSTOM,
        weight: DEFAULT_MIN_SCORE,
        label: keyword,
        pattern: escapeRegExp(keyword),
      }));

    const compiled = [...RULES, ...extras].map((rule) => ({
      ...rule,
      // \b does not work next to "$", "&", "₹" etc., so use explicit
      // non-word lookarounds instead.
      regex: new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])(?:${rule.pattern})(?=$|[^\\p{L}\\p{N}_])`,
        rule.caseSensitive ? "u" : "iu",
      ),
    }));

    compiledRulesCache.set(cacheKey, compiled);
    return compiled;
  }

  function getFormLinks(links) {
    return (links || []).filter((link) => FORM_LINK_PATTERN.test(link));
  }

  // post: { text, headline, links }
  function classifyPost(post, { extraKeywords = [], minScore = DEFAULT_MIN_SCORE } = {}) {
    const text = post?.text || "";
    const scores = Object.fromEntries(Object.values(CATEGORY).map((c) => [c, 0]));
    const reasons = [];
    const matches = [];
    // Labels already counted, so two rules with the same label (e.g. the
    // strong and weak "cohort" rules) only add the stronger one.
    const countedLabels = new Set();

    for (const rule of compileRules(extraKeywords)) {
      const key = `${rule.category}|${rule.label}`;
      if (countedLabels.has(key) || !rule.regex.test(text)) continue;
      countedLabels.add(key);
      scores[rule.category] += rule.weight;
      matches.push(rule.label);
      reasons.push(`${rule.label} +${rule.weight}`);
    }

    const headline = post?.headline || "";
    const investorHeadline = headline.match(INVESTOR_HEADLINE_PATTERN)?.[0]?.trim() || "";
    if (investorHeadline) {
      // An investor asking for something ("DM me", "apply") is an
      // opportunity; otherwise the headline only supports the post's topic.
      const asks = scores[CATEGORY.OPPORTUNITY] > 0;
      scores[asks ? CATEGORY.OPPORTUNITY : CATEGORY.INSIGHTS] += HEADLINE_POINTS;
      reasons.push(`author headline "${truncate(headline, 60)}" +${HEADLINE_POINTS}`);
    }

    const formLinks = getFormLinks(post?.links);
    const formPhrase = text.match(FORM_PHRASE_PATTERN)?.[0]?.trim() || "";
    const weakFormPhrase = text.match(WEAK_FORM_PHRASE_PATTERN)?.[0]?.trim() || "";
    const fundingContext =
      FUNDING_CONTEXT_PATTERN.test(text) ||
      (STARTUP_PATTERN.test(text) && !HIRING_PATTERN.test(text));
    const formRule = Boolean(
      ((formLinks.length || formPhrase) && fundingContext) ||
        (weakFormPhrase && STRONG_FUNDING_CONTEXT_PATTERN.test(text)),
    );
    if (formLinks.length) reasons.push(`form link (${formLinks.length})`);
    else if (formPhrase || weakFormPhrase) {
      reasons.push(`mentions "${formPhrase || weakFormPhrase}"`);
    }

    const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
    const isOpportunity = scores[CATEGORY.OPPORTUNITY] >= minScore;
    const isInvestment = isOpportunity || formRule || total >= minScore;

    let category = "";
    if (isOpportunity) category = CATEGORY.OPPORTUNITY;
    else if (formRule) category = CATEGORY.FORM;
    else if (isInvestment) {
      category = CATEGORY_PRIORITY.filter(
        (c) => c !== CATEGORY.OPPORTUNITY && c !== CATEGORY.FORM,
      ).reduce((best, c) => (scores[c] > scores[best] ? c : best), CATEGORY.GRANT);
      // Points from weak opportunity words ("apply", "DM me") alone don't
      // make a post an opportunity; if nothing else scored, call it insights.
      if (!scores[category]) category = CATEGORY.INSIGHTS;
    }

    return {
      isInvestment,
      category,
      score: total,
      matches,
      formLinks,
      whyKept: isInvestment
        ? `${category} · score ${total}${formRule ? " · form rule" : ""}: ${reasons.join(", ")}`
        : "",
    };
  }

  function categoryRank(category) {
    const index = CATEGORY_PRIORITY.indexOf(category);
    return index === -1 ? CATEGORY_PRIORITY.length : index;
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

  function postUrlFromId(activityId) {
    return activityId
      ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
      : null;
  }

  // "imgprajapati" from https://www.linkedin.com/in/imgprajapati/
  function publicIdFromUrl(url) {
    const match = String(url || "").match(
      /linkedin\.com\/(?:in|company|school|showcase)\/([^/?#]+)/i,
    );
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }

  function isProfileUrl(url) {
    return Boolean(publicIdFromUrl(url));
  }

  // Links that belong to the post itself, i.e. not mentions or hashtags.
  function normalizePostLink(raw) {
    if (!raw) return null;
    let value = String(raw)
      .trim()
      .replace(/[)\]}>.,!?;:'"…]+$/, "");
    if (/^lnkd\.in\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
        if (
          isProfileUrl(url.href) ||
          /^\/(?:feed\/hashtag|search|mynetwork|messaging)\b/i.test(url.pathname)
        ) {
          return null;
        }
        url.searchParams.delete("trackingId");
        url.searchParams.delete("miniProfileUrn");
      }
      return url.href;
    } catch (error) {
      return null;
    }
  }

  function uniqueLinks(links) {
    return [...new Set(links.map(normalizePostLink).filter(Boolean))];
  }

  function extractUrlsFromText(text) {
    return String(text || "").match(/(?:https?:\/\/|lnkd\.in\/)[^\s<>"']+/gi) || [];
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

  function personFromMiniProfile(mini) {
    const publicId = mini?.publicIdentifier || "";
    return {
      name: [mini?.firstName, mini?.lastName].filter(Boolean).join(" "),
      publicId,
      urn: mini?.objectUrn || "",
      url: publicId ? `https://www.linkedin.com/in/${publicId}` : "",
    };
  }

  function personFromMiniCompany(mini) {
    const publicId = mini?.universalName || "";
    return {
      name: mini?.name || "",
      publicId,
      urn: mini?.objectUrn || "",
      url: publicId ? `https://www.linkedin.com/company/${publicId}` : "",
    };
  }

  function personFromAttributes(attributes) {
    const attribute = (attributes || []).find(
      (item) => item?.miniProfile || item?.miniCompany,
    );
    if (attribute?.miniProfile) return personFromMiniProfile(attribute.miniProfile);
    if (attribute?.miniCompany) return personFromMiniCompany(attribute.miniCompany);
    return null;
  }

  function parseApiActor(actor) {
    const fromAttributes = personFromAttributes(actor?.name?.attributes);
    const url =
      cleanLinkedInUrl(actor?.navigationContext?.actionTarget) ||
      fromAttributes?.url ||
      "";
    return {
      name: actor?.name?.text || fromAttributes?.name || "",
      publicId: fromAttributes?.publicId || publicIdFromUrl(url),
      urn: actor?.urn || fromAttributes?.urn || "",
      url,
      headline: actor?.description?.text || "",
      relativeTime: actor?.subDescription?.text?.split("•")?.[0]?.trim() || "",
    };
  }

  // The line above a feed item, e.g. "Rahul Mehta reposted this" or
  // "Priya Sharma likes this".
  function parseApiHeader(header) {
    const text = header?.text?.text?.trim() || "";
    if (!text) return null;
    const person = personFromAttributes([
      ...(header?.text?.attributes || []),
      ...(header?.image?.attributes || []),
    ]);
    const navigationUrl = cleanLinkedInUrl(header?.navigationContext?.actionTarget);
    const url = person?.url || (isProfileUrl(navigationUrl) ? navigationUrl : "");
    return {
      text,
      isRepost: /\breposted\b/i.test(text),
      name: person?.name || text.split(/\s+reposted\b/i)[0].trim(),
      publicId: person?.publicId || publicIdFromUrl(url),
      urn: person?.urn || "",
      url,
    };
  }

  function getApiLinks(update) {
    if (!update) return [];
    const textView = update?.commentary?.text || {};
    const links = [];

    for (const attribute of textView.attributes || []) {
      if (attribute?.type === "HYPERLINK") links.push(attribute.link || attribute.url);
    }
    for (const attribute of textView.attributesV2 || []) {
      links.push(attribute?.detailData?.hyperlink?.url);
    }
    links.push(...extractUrlsFromText(textView.text));

    const content = update?.content || {};
    for (const component of [
      content["com.linkedin.voyager.feed.render.ArticleComponent"],
      content.articleComponent,
      content["com.linkedin.voyager.feed.render.EventComponent"],
      content.eventComponent,
    ]) {
      links.push(component?.navigationContext?.actionTarget);
    }
    return links;
  }

  function parseFeedApiElement(update) {
    if (!update || typeof update !== "object") return null;

    const reshared = update?.resharedUpdate || null;
    // For a repost with the reposter's own comment, the original post is
    // nested in resharedUpdate. A plain repost has no nesting and is marked
    // only by the "X reposted this" header.
    const original = reshared || update;
    const header = parseApiHeader(update?.header);

    const postId =
      getActivityId(original?.updateMetadata?.urn) ||
      getActivityId(original?.entityUrn);
    const author = parseApiActor(original?.actor);
    const text = original?.commentary?.text?.text || "";

    let reposter = null;
    let repostComment = "";
    let repostId = null;
    if (reshared) {
      reposter = parseApiActor(update?.actor);
      repostComment = update?.commentary?.text?.text || "";
      repostId =
        getActivityId(update?.updateMetadata?.urn) ||
        getActivityId(update?.entityUrn);
    } else if (header?.isRepost) {
      reposter = header;
    }

    const attachmentText = [
      getArticleTitle(original?.content),
      getDocumentTitle(original?.content),
    ]
      .filter(Boolean)
      .join("\n");
    const classifyText = [text, repostComment, attachmentText]
      .filter(Boolean)
      .join("\n\n");
    if (!classifyText.trim()) return null;

    const counts = original?.socialDetail?.totalSocialActivityCounts || {};

    return {
      id: postId || repostId || hashText(classifyText),
      postId: postId || repostId,
      postUrl:
        postUrlFromId(postId || repostId) ||
        cleanLinkedInUrl(original?.socialContent?.shareUrl),
      author: author.name,
      authorPublicId: author.publicId,
      authorUrn: author.urn,
      authorUrl: author.url,
      authorHeadline: author.headline,
      postedAt: activityIdToIsoDate(postId),
      relativeTime: author.relativeTime,
      text: truncate(text),
      repostedBy: reposter?.name || "",
      repostedByPublicId: reposter?.publicId || "",
      repostedByUrn: reposter?.urn || "",
      repostedByUrl: reposter?.url || "",
      repostedAt: activityIdToIsoDate(repostId),
      repostComment: truncate(repostComment),
      repostId,
      repostUrl: postUrlFromId(repostId),
      links: uniqueLinks([...getApiLinks(original), ...(reshared ? getApiLinks(update) : [])]),
      feedContext: header?.text || "",
      feedContextPersonUrl: header?.url || "",
      likes: counts?.numLikes ?? null,
      comments: counts?.numComments ?? null,
      reposts: counts?.numShares ?? null,
      isRepost: Boolean(reposter),
      isPromoted: isPromotedUpdate(update),
      classifyText,
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

  const DOM_RESHARED_SELECTOR =
    ".feed-shared-update-v2__reshared-content, .update-components-mini-update-v2";

  const DOM_TEXT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
    '[data-testid="expandable-text-box"]',
  ];

  const DOM_ATTACHMENT_LINK_SELECTOR =
    ".update-components-article a[href], .update-components-event a[href], .feed-shared-article a[href], .feed-shared-event a[href]";

  const DOM_SEE_MORE_SELECTOR =
    "button.feed-shared-inline-show-more-text__see-more-less-toggle, button.see-more";

  function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return `dom-${(hash >>> 0).toString(36)}`;
  }

  function firstLine(text) {
    return String(text || "").trim().split("\n")[0].trim();
  }

  // Elements matching `selector` inside `root`, ignoring those inside an
  // element matching `excludeSelector` (used to keep a reposter's comment
  // apart from the post they reposted).
  function queryOwn(root, selector, excludeSelector) {
    return [...root.querySelectorAll(selector)].filter((el) => {
      if (!excludeSelector) return true;
      const excluded = el.closest(excludeSelector);
      return !excluded || !root.contains(excluded) || excluded === root;
    });
  }

  function domText(root, excludeSelector) {
    for (const selector of DOM_TEXT_SELECTORS) {
      const parts = queryOwn(root, selector, excludeSelector)
        .filter((el) => !el.parentElement?.closest(selector))
        .map((el) => el.innerText?.trim().replace(/\s*…\s*(?:see )?more$/i, ""))
        .filter(Boolean);
      if (parts.length) return parts.join("\n\n");
    }
    return "";
  }

  function parseDomActor(root, excludeSelector) {
    const actor = queryOwn(root, ".update-components-actor, .feed-shared-actor", excludeSelector)[0] || root;
    const nameEl = actor.querySelector(
      '.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name, .feed-shared-actor__name',
    );
    const link = [...actor.querySelectorAll("a[href]")].find((a) => isProfileUrl(a.href));
    const url = cleanLinkedInUrl(link?.href) || "";
    return {
      name: firstLine(nameEl?.innerText) || firstLine(link?.innerText),
      publicId: publicIdFromUrl(url),
      urn: "",
      url,
      headline: firstLine(
        actor.querySelector(".update-components-actor__description, .feed-shared-actor__description")?.innerText,
      ),
      relativeTime:
        actor
          .querySelector(".update-components-actor__sub-description, .feed-shared-actor__sub-description")
          ?.innerText?.split("•")?.[0]
          ?.trim() || "",
    };
  }

  function domLinks(root, excludeSelector) {
    const links = [];
    for (const selector of DOM_TEXT_SELECTORS) {
      for (const textEl of queryOwn(root, selector, excludeSelector)) {
        links.push(...[...textEl.querySelectorAll("a[href]")].map((a) => a.href));
        links.push(...extractUrlsFromText(textEl.innerText));
      }
    }
    links.push(
      ...queryOwn(root, DOM_ATTACHMENT_LINK_SELECTOR, excludeSelector).map((a) => a.href),
    );
    return links;
  }

  function domActivityId(root, excludeSelector) {
    const urnAttr = root.getAttribute("data-urn") || root.getAttribute("data-id") || "";
    if (getActivityId(urnAttr)) return getActivityId(urnAttr);
    const link = queryOwn(
      root,
      'a[href*="urn:li:activity:"], a[href*="urn%3Ali%3Aactivity%3A"]',
      excludeSelector,
    )[0];
    try {
      return getActivityId(decodeURIComponent(link?.getAttribute("href") || ""));
    } catch (error) {
      return null;
    }
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

  async function expandSeeMore(containers) {
    let clicked = 0;
    for (const container of containers) {
      for (const button of container.querySelectorAll(DOM_SEE_MORE_SELECTOR)) {
        if (button.getAttribute("aria-expanded") === "true") continue;
        if (!/more/i.test(button.innerText || button.getAttribute("aria-label") || "")) {
          continue;
        }
        button.click();
        clicked++;
      }
    }
    if (clicked) await sleep(300);
  }

  function parseDomPost(container) {
    const resharedEl = container.querySelector(DOM_RESHARED_SELECTOR);
    const outerId = domActivityId(container, DOM_RESHARED_SELECTOR);
    const headerEl = container.querySelector(".update-components-header, .feed-shared-header");
    const headerText = headerEl?.innerText?.trim()?.replace(/\s+/g, " ") || "";
    const headerLink = headerEl
      ? [...headerEl.querySelectorAll("a[href]")].find((a) => isProfileUrl(a.href))
      : null;
    const headerUrl = cleanLinkedInUrl(headerLink?.href) || "";

    let original;
    let reposter = null;
    let repostComment = "";
    let repostId = null;
    let postId;

    if (resharedEl) {
      original = {
        actor: parseDomActor(resharedEl),
        text: domText(resharedEl),
        links: domLinks(resharedEl),
      };
      reposter = parseDomActor(container, DOM_RESHARED_SELECTOR);
      repostComment = domText(container, DOM_RESHARED_SELECTOR);
      repostId = outerId;
      // The original post's ID is not always in the DOM; fall back to the
      // repost's ID so the row still has a Post ID.
      postId = domActivityId(resharedEl) || outerId;
    } else {
      original = {
        actor: parseDomActor(container),
        text: domText(container) || container.innerText?.trim() || "",
        links: domLinks(container),
      };
      postId = outerId;
      if (/\breposted\b/i.test(headerText)) {
        reposter = {
          name: firstLine(headerLink?.innerText) || headerText.split(/\s+reposted\b/i)[0].trim(),
          publicId: publicIdFromUrl(headerUrl),
          urn: "",
          url: headerUrl,
        };
      }
    }

    const classifyText = [original.text, repostComment].filter(Boolean).join("\n\n");
    if (!classifyText.trim()) return null;

    return {
      id: postId || hashText(classifyText),
      postId,
      postUrl: postUrlFromId(postId),
      author: original.actor.name,
      authorPublicId: original.actor.publicId,
      authorUrn: "",
      authorUrl: original.actor.url,
      authorHeadline: original.actor.headline,
      postedAt: activityIdToIsoDate(postId),
      relativeTime: original.actor.relativeTime,
      text: truncate(original.text),
      repostedBy: reposter?.name || "",
      repostedByPublicId: reposter?.publicId || "",
      repostedByUrn: "",
      repostedByUrl: reposter?.url || "",
      repostedAt: activityIdToIsoDate(repostId),
      repostComment: truncate(repostComment),
      repostId,
      repostUrl: postUrlFromId(repostId),
      links: uniqueLinks([...original.links, ...(resharedEl ? domLinks(container, DOM_RESHARED_SELECTOR) : [])]),
      feedContext: headerText,
      feedContextPersonUrl: headerUrl,
      likes: null,
      comments: null,
      reposts: null,
      isRepost: Boolean(reposter),
      isPromoted: /(?:^|\n)\s*Promoted\s*(?:\n|$)/.test(container.innerText || ""),
      classifyText,
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
      const containers = findDomPostContainers();
      await expandSeeMore(containers);
      for (const container of containers) {
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

    const candidates = rawPosts.filter((post) => includePromoted || !post.isPromoted);
    const resolvedLinks = await resolveShortLinks(candidates);

    const posts = candidates
      .map(({ classifyText: textToClassify, ...post }) => {
        const links = [
          ...(post.links || []),
          ...(post.links || []).map((link) => resolvedLinks[link]).filter(Boolean),
        ];
        const { isInvestment, category, score, matches, formLinks, whyKept } =
          classifyPost(
            { text: textToClassify, headline: post.authorHeadline, links },
            { extraKeywords, minScore },
          );
        return {
          ...post,
          isInvestment,
          category,
          score,
          matches,
          formLinks: [...new Set(formLinks)],
          whyKept,
        };
      })
      .filter((post) => post.isInvestment)
      .sort(
        (a, b) =>
          categoryRank(a.category) - categoryRank(b.category) || b.score - a.score,
      );

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

    result.historySync = await saveToHistory(posts);
    await saveScanState(result);

    result.sheetSync = await saveToGoogleSheet(posts);
    await saveScanState(result);
    return result;
  }

  const MAX_SHORT_LINKS_PER_SCAN = 60;

  // LinkedIn replaces links in posts with lnkd.in short links, which hides
  // e.g. a Google Form. Asks the background worker for the real destination,
  // only for posts that talk about founders, startups or funding.
  async function resolveShortLinks(posts) {
    const urls = [
      ...new Set(
        posts
          .filter(
            (post) =>
              FUNDING_CONTEXT_PATTERN.test(post.classifyText || "") ||
              STARTUP_PATTERN.test(post.classifyText || ""),
          )
          .flatMap((post) => post.links || [])
          .filter((link) => /^https?:\/\/lnkd\.in\//i.test(link)),
      ),
    ].slice(0, MAX_SHORT_LINKS_PER_SCAN);
    if (!urls.length) return {};

    try {
      const response = await chrome.runtime.sendMessage({
        action: "bg-resolveShortLinks",
        urls,
      });
      return response?.resolved || {};
    } catch (error) {
      console.log("feedScanner: couldn't resolve lnkd.in links", error);
      return {};
    }
  }

  // Adds the investment posts to the history kept by the background worker.
  async function saveToHistory(posts) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "bg-addToInvestmentHistory",
        posts,
      });
      if (!response) throw new Error("No response from the extension background.");
      return response;
    } catch (error) {
      return { status: "error", error: error?.message || String(error) };
    }
  }

  // Sends the investment posts to the Google Sheet web app (through the
  // background worker, which has the host permission for script.google.com).
  async function saveToGoogleSheet(posts) {
    const at = new Date().toISOString();
    if (!posts.length) return { status: "skipped", reason: "No posts to save.", at };
    try {
      const response = await chrome.runtime.sendMessage({
        action: "bg-saveInvestmentPostsToSheet",
        posts,
      });
      if (!response) throw new Error("No response from the extension background.");
      return { ...response, at };
    } catch (error) {
      return { status: "error", error: error?.message || String(error), at };
    }
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
    classifyPost,
    parseFeedApiElement,
    runScan,
  };
})();
