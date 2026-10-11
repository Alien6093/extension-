const env = "dev";
let COLLAB_CLIENT = "https://dev.anchors.pro";
let COLLAB_SERVER = "https://dev.anchors.pro/api";

// const env = "prod";
// let COLLAB_CLIENT = "https://www.anchors.in";
// let COLLAB_SERVER = "https://www.anchors.in/api";

try {
  importScripts("../lib/posthog.js");
} catch (error) {
  console.log("PostHog script import failed:", error);
}

const trackPosthog = (event, properties = {}) => {
  try {
    if (typeof anchorsPosthogCapture === "function") {
      anchorsPosthogCapture(event, properties);
    }
  } catch (error) {
    console.log("PostHog track failed:", error);
  }
};

const EXTENSION_VERSION = chrome.runtime.getManifest().version;

const appendExtensionVersionToBody = (data) => {
  if (data && typeof data === "object") {
    return {
      ...data,
      extensionVersion: EXTENSION_VERSION,
    };
  } else if (typeof data === "string") {
    try {
      const parsedData = JSON.parse(data);
      return JSON.stringify({
        ...parsedData,
        extensionVersion: EXTENSION_VERSION,
      });
    } catch (e) {
      console.error("Error parsing data string:", e);
      return data;
    }
  } else {
    return data;
  }
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    trackPosthog("creator_extension_installed", { env });
    // chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
    chrome.tabs.create({
      url: `${COLLAB_CLIENT}/influencer/plugin/callback?source=extension`,
    });

    // chrome.runtime.setUninstallURL(`${COLLAB_CLIENT}/influencer/extension-survey`);
  } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
    const thisVersion = chrome.runtime.getManifest().version;
    console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`);
    trackPosthog("creator_extension_updated", {
      env,
      previousVersion: details.previousVersion,
      version: thisVersion,
    });
  }
});

// async function saveToMongoDb(data) {
//     chrome.storage.local.get(['jwtToken'], async (result) => {
//         const token = result.jwtToken;
//         const response = await fetch('http://localhost:5000/api/ext/save/all/linkedin-post', {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'jwtToken': token
//             },
//             body: JSON.stringify(data),
//         });

//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }
//         const res = await response.json();
//         console.log('Success: ', res?.message);
//     });
// }

// async function savePostsToMongoDb(data) {
//     chrome.storage.local.get(['jwtToken'], async (result) => {
//         const token = result.jwtToken;
//         const response = await fetch(`${COLLAB_SERVER}/ext/save/all/linkedin-post`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'jwtToken': token
//             },
//             body: JSON.stringify(data),
//         });

//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }
//         const res = await response.json();
//         console.log('Success: ', res?.message);
//     });
// }

// async function savePostScoreToDb() {
//     try {
//         chrome.storage.local.get(['jwtToken'], async (result) => {
//             const token = result.jwtToken;
//             try {
//                 const response = await fetch(`${COLLAB_SERVER}/influencer/ai-linkedin-post-score/stream`, {
//                     method: 'GET',
//                     headers: {
//                         'jwtToken': token
//                     }
//                 });

//                 if (!response.ok) {
//                     throw new Error(`HTTP error! status: ${response.status}`);
//                 }
//                 // const res = await response.json();
//                 // console.log('Success: ', res?.message);
//                 console.log('Posts Success');
//             } catch (fetchError) {
//                 console.error('Fetch error: ', fetchError);
//             }
//         });
//     } catch (storageError) {
//         console.error('Storage error: ', storageError);
//     }
// }

const IDTAG = {
  LI_PROFILES: "liprofiles",
};

let TRIGGER_LOG = null;
const AFFILIATE_POST_SYNC_TOKEN_KEY = "affiliatePostSyncToken";

function isAllowedAffiliateUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const isAnchorsDomain =
      hostname === "anchors.in" || hostname.endsWith(".anchors.in");

    return (
      (isLocalhost && ["http:", "https:"].includes(url.protocol)) ||
      (isAnchorsDomain && url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

async function clearAffiliatePostSyncStorage() {
  TRIGGER_LOG = null;
  await chrome.storage.local.remove([
    AFFILIATE_POST_SYNC_TOKEN_KEY,
    "scriptTrigger",
  ]);
}

async function restoreAffiliatePostSyncExpiry() {
  const stored = await chrome.storage.local.get([
    AFFILIATE_POST_SYNC_TOKEN_KEY,
    "scriptTrigger",
  ]);
  const context = JSON.parse(stored?.scriptTrigger || "null");
  if (!stored?.[AFFILIATE_POST_SYNC_TOKEN_KEY]) return;

  if (!context?.expiry || context.expiry <= Date.now()) {
    await clearAffiliatePostSyncStorage();
  }
}

restoreAffiliatePostSyncExpiry().catch((error) =>
  console.error("Unable to restore affiliate post sync expiry:", error),
);

function handleAffiliatePostSyncTrigger(data, senderUrl, sendResponse) {
  const manifest = chrome.runtime.getManifest();
  const { affiliateToken, ...affiliateSyncContext } = data || {};

  if (
    !affiliateToken ||
    !affiliateSyncContext?.contentPieceId ||
    !affiliateSyncContext?.requestedPostUrl ||
    !affiliateSyncContext?.redirect_url ||
    !affiliateSyncContext?.affiliateApiUrl ||
    !affiliateSyncContext?.code ||
    !affiliateSyncContext?.expiry ||
    affiliateSyncContext.expiry <= Date.now() ||
    !isAllowedAffiliateUrl(senderUrl) ||
    !isAllowedAffiliateUrl(affiliateSyncContext.redirect_url) ||
    !isAllowedAffiliateUrl(affiliateSyncContext.affiliateApiUrl)
  ) {
    sendResponse({
      success: false,
      error: "Invalid affiliate post sync request",
    });
    return true;
  }

  TRIGGER_LOG = {
    ...affiliateSyncContext,
    affiliateStage: "singlePost",
  };

  chrome.storage.local.set(
    {
      scriptTrigger: JSON.stringify(TRIGGER_LOG),
      [AFFILIATE_POST_SYNC_TOKEN_KEY]: affiliateToken,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error storing affiliate post sync:",
          chrome.runtime.lastError,
        );
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
      } else {
        sendResponse({ success: true, version: manifest.version });
      }
    },
  );
  return true;
}

async function submitAffiliatePostSync(postData) {
  const stored = await chrome.storage.local.get([
    AFFILIATE_POST_SYNC_TOKEN_KEY,
    "scriptTrigger",
  ]);
  const token = stored?.[AFFILIATE_POST_SYNC_TOKEN_KEY];
  const context = JSON.parse(stored?.scriptTrigger || "null");

  if (
    !token ||
    context?.ref !== "anchorsGuest" ||
    context?.page !== "singlePost" ||
    !context?.contentPieceId ||
    !context?.requestedPostUrl ||
    !context?.code ||
    !context?.expiry ||
    context.expiry <= Date.now()
  ) {
    throw new Error("Affiliate post sync is missing or expired");
  }

  if (!isAllowedAffiliateUrl(context?.affiliateApiUrl)) {
    throw new Error("Affiliate API URL is not allowed");
  }

  const endpoint = `${context.affiliateApiUrl.replace(/\/+$/, "")}/content/content-piece/linkedin-post-tracking/post`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      contentPieceId: context.contentPieceId,
      requestedPostUrl: context.requestedPostUrl,
      correlationCode: context.code,
      expiresAt: context.expiry,
      postData,
    }),
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.success) {
    throw new Error(
      result?.error || `Affiliate post sync failed (${response.status})`,
    );
  }

  return result;
}

// ------------- Fetch redirect URL from event ID --------
async function saveRedirectionUrlFromEventId(eventId) {
  try {
    const res = await fetch(
      `${COLLAB_SERVER}/ext/redirection/fetchViaEventId?eventId=${eventId}`,
    );

    const data = await res.json();
    if (data?.success) {
      if (data?.data) {
        return {
          success: true,
          url: data?.data,
        };
      }
    } else {
      return {
        success: false,
      };
    }
  } catch (error) {
    console.log("Error while fetching redirection url: ", error);
    return {
      success: false,
    };
  }
}

// ------------- Save Logged In User Data ----------------
async function saveProfileToMongoDb(data) {
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result?.jwtToken;
      try {
        const response = await fetch(
          `${COLLAB_SERVER}/ext/save/current-profile`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              jwtToken: token,
            },
            body: appendExtensionVersionToBody(JSON.stringify(data)),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // const res = await response.json();
        // console.log('Success: ', res?.message);
        // console.log('Profile Success');
        if (response.status === 200) {
          const res = await response.json();
          if (res && res.success) {
            console.log("Res: Profile Success: ", res?.message);
          }
        } else {
          console.log("Res: Profile Failed");
        }
      } catch (fetchError) {
        console.error("Fetch error: ", fetchError);
      }
    });
  } catch (storageError) {
    console.error("Storage error: ", storageError);
  }
}

async function saveDemographicsToMongoDb(data) {
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result?.jwtToken;
      try {
        const response = await fetch(`${COLLAB_SERVER}/ext/save/demographics`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            jwtToken: token,
          },
          body: appendExtensionVersionToBody(JSON.stringify(data)),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (response.status === 200) {
          const res = await response.json();
          if (res && res.success) {
            console.log("Res: Audience Demographics Success: ", res?.message);
          }
        } else {
          console.log("Res: Audience Demographics Failed");
        }
      } catch (fetchError) {
        console.log("Fetch error: ", fetchError);
      }
    });
  } catch (storageError) {
    console.error("Storage error: ", storageError);
  }
}

async function savePostsToMongoDb(data) {
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result.jwtToken;
      try {
        const response = await fetch(
          `${COLLAB_SERVER}/ext/save/all/linkedin-post`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              jwtToken: token,
            },
            body: appendExtensionVersionToBody(JSON.stringify(data)),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // const res = await response.json();
        // console.log('Success: ', res?.message);
        if (response.status === 200) {
          const res = await response.json();
          if (res && res.success) {
            console.log("Res: Posts Success: ", res?.message);
          }
        } else {
          console.log("Res: Posts Failed");
        }
      } catch (fetchError) {
        console.log("Fetch error: ", fetchError);
      }
    });
  } catch (storageError) {
    console.log("Storage error: ", storageError);
  }
}

async function sendPostsInBatches(data) {
  // Function to split the post array into chunks of a specified size
  function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  // Recursive function to handle batch sending with automatic size reduction on 413 errors
  async function sendBatchWithRetry(posts, token, batchSize = posts.length) {
    // If batch size is 1 and still getting 413, we can't split further
    if (batchSize < 1) {
      console.error("Cannot split batch further - minimum batch size reached");
      return false;
    }

    // Split posts into chunks of the current batch size
    const chunks = chunkArray(posts, batchSize);
    const totalBatches = chunks.length;
    const totalPosts = posts.length;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const chunkData = {
        ...data,
        posts: chunk,
        syncMeta: {
          batchIndex: chunkIndex + 1,
          totalBatches,
          totalPosts,
          isLastBatch: chunkIndex === chunks.length - 1,
        },
      };

      try {
        const response = await fetch(
          `${COLLAB_SERVER}/ext/save/all/linkedin-post`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              jwtToken: token,
            },
            body: appendExtensionVersionToBody(JSON.stringify(chunkData)),
          },
        );

        if (response.status === 413) {
          // Payload too large - split this chunk in half and retry
          console.log(
            `Batch size ${chunk.length} too large, splitting in half...`,
          );
          const halfSize = Math.ceil(chunk.length / 2);

          // Recursively try with smaller batch size
          const success = await sendBatchWithRetry(chunk, token, halfSize);
          if (!success) {
            console.error("Failed to send batch even after splitting");
            return false;
          }
        } else if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        } else {
          const res = await response.json();
          console.log(`Success: ${res?.message} (batch size: ${chunk.length})`);
        }
      } catch (error) {
        if (
          error.message.includes("413") ||
          error.message.includes("Payload Too Large")
        ) {
          // Handle 413 error that might be caught as a generic error
          console.log(
            `Batch size ${chunk.length} too large, splitting in half...`,
          );
          const halfSize = Math.ceil(chunk.length / 2);

          const success = await sendBatchWithRetry(chunk, token, halfSize);
          if (!success) {
            console.error("Failed to send batch even after splitting");
            return false;
          }
        } else {
          console.error("Error sending batch:", error);
          return false;
        }
      }
    }

    return true;
  }

  // Main function logic
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result.jwtToken;

      if (!token) {
        console.error("JWT token not found");
        return;
      }
      console.log("Daniel: ", data?.posts);

      const success = await sendBatchWithRetry(data?.posts, token, 30);

      if (success) {
        console.log("All posts sent successfully");
      } else {
        console.error("Failed to send all posts");
      }
    });
  } catch (storageError) {
    console.log("Storage error: ", storageError);
  }
}

async function saveCollabPostToMongoDb(data) {
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result.jwtToken;
      try {
        const response = await fetch(
          `${COLLAB_SERVER}/ext/update/collab-post`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              jwtToken: token,
            },
            body: appendExtensionVersionToBody(JSON.stringify(data)),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // const res = await response.json();
        // console.log('Success: ', res?.message);
        if (response.status === 200) {
          const res = await response.json();
          if (res && res.success) {
            console.log("Res: Collab Post Success: ", res?.message);
          }
        } else {
          console.log("Res: Collab Post Failed");
        }
      } catch (fetchError) {
        console.log("Fetch error: ", fetchError);
      }
    });
  } catch (storageError) {
    console.log("Storage error: ", storageError);
  }
}

async function savePostSummaryToMongoDb(data) {
  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result.jwtToken;
      try {
        const response = await fetch(
          `${COLLAB_SERVER}/ext/lkd/save/post-demographics`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              jwtToken: token,
            },
            body: appendExtensionVersionToBody(JSON.stringify(data)),
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // const res = await response.json();
        // console.log('Success: ', res?.message);
        if (response.status === 200) {
          const res = await response.json();
          if (res && res.success) {
            console.log("Res: Collab Post Success: ", res?.message);
          }
        } else {
          console.log("Res: Collab Post Failed");
        }
      } catch (fetchError) {
        console.log("Fetch error: ", fetchError);
      }
    });
  } catch (storageError) {
    console.log("Storage error: ", storageError);
  }
}

// ------------- start save guest user data ----------------

async function saveGuestProfileToMongoDb(data) {
  try {
    const response = await fetch(
      `${COLLAB_SERVER}/ext/lkd/save/guest-profile`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: appendExtensionVersionToBody(JSON.stringify(data)),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (response.status === 200) {
      const res = await response.json();
      if (res && res.success) {
        console.log("Res: Guest Profile Success: ", res?.message);
      }
    } else {
      console.log("Res: Guest Profile Failed");
    }
  } catch (fetchError) {
    console.error("Fetch error: ", fetchError);
  }
}

async function saveGuestDemographicsToMongoDb(data) {
  try {
    const response = await fetch(
      `${COLLAB_SERVER}/ext/lkd/save/guest-demographics`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: appendExtensionVersionToBody(JSON.stringify(data)),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (response.status === 200) {
      const res = await response.json();
      if (res && res.success) {
        console.log("Res: Guest Audience Demographics Success: ", res?.message);
      }
    } else {
      console.log("Res: Guest Audience Demographics Failed");
    }
  } catch (fetchError) {
    console.log("Fetch error: ", fetchError);
  }
}

async function saveGuestPostsToMongoDb(data) {
  // /ext/lkd/save/all/linkedin-post
  try {
    const response = await fetch(
      `${COLLAB_SERVER}/ext/lkd/save/all/guest-posts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: appendExtensionVersionToBody(JSON.stringify(data)),
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    // const res = await response.json();
    // console.log('Success: ', res?.message);
    if (response.status === 200) {
      const res = await response.json();
      if (res && res.success) {
        console.log("Res: Posts Success: ", res?.message);
      }
    } else {
      console.log("Res: Posts Failed");
    }
  } catch (fetchError) {
    console.log("Fetch error: ", fetchError);
  }
}

// ------------- end save guest user data ----------------

async function savePostsCommentToMongoDb(data) {
  console.log(data);
  function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  const jointData = data?.comments?.concat(
    data?.replies?.length ? data?.replies : [],
  );

  const chunks = chunkArray(jointData, 50);

  try {
    chrome.storage.local.get(["jwtToken"], async (result) => {
      const token = result.jwtToken;
      for (const chunk of chunks) {
        // Create a new data object for each chunk, maintaining the structure of the initial data
        const chunkData = {
          ...data,
          comments: chunk,
        };

        try {
          const response = await fetch(
            `${COLLAB_SERVER}/ext/lkd/save/post-comments`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                jwtToken: token,
              },
              body: appendExtensionVersionToBody(JSON.stringify(chunkData)),
            },
          );

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const res = await response.json();
          console.log("Success: ", res?.message);
        } catch (error) {
          console.error("Error sending batch:", error);
        }
      }
    });
  } catch (storageError) {
    console.log("Storage error: ", storageError);
  }
}

async function getLatestPostOfUser(token) {
  if (!token) {
    throw new Error("JWT token is required");
  }
  try {
    const response = await fetch(
      `${COLLAB_SERVER}/ext/lkd/getLatestPostOfUser`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          jwtToken: token,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function handleFetchLatestPost() {
  const result = await chrome.storage.local.get(["jwtToken"]);
  const token = result?.jwtToken;
  if (!token) {
    throw new Error("JWT token not found in storage");
  }

  return await getLatestPostOfUser(token);
}

// ---------------------------------------------------------------------------
// Investment posts -> Google Sheet (Apps Script web app, see google-sheets/)
// ---------------------------------------------------------------------------

const INVESTMENT_SHEET_URL_KEY = "investmentSheetWebAppUrl";
const INVESTMENT_SHEET_FIELDS = [
  "postId",
  "postUrl",
  "author",
  "authorPublicId",
  "authorUrn",
  "authorUrl",
  "authorHeadline",
  "postedAt",
  "text",
  "repostedBy",
  "repostedByPublicId",
  "repostedByUrn",
  "repostedByUrl",
  "repostedAt",
  "repostComment",
  "repostId",
  "repostUrl",
  "links",
  "feedContext",
  "feedContextPersonUrl",
  "matches",
  "score",
  "likes",
  "comments",
  "reposts",
];

function isValidInvestmentSheetUrl(url) {
  return /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(
    String(url || "").trim(),
  );
}

async function callInvestmentSheet(url, init) {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    redirect: "follow",
  });
  const body = await response.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (error) {
    // Apps Script answers with an HTML page when the deployment isn't
    // reachable (wrong access setting, deleted deployment, ...).
  }
  if (!response.ok || !data) {
    throw new Error(
      `Google Sheet web app didn't answer as expected (HTTP ${response.status}). Check that it is deployed with access set to "Anyone".`,
    );
  }
  if (!data.ok) throw new Error(data.error || "Google Sheet web app reported an error.");
  return data;
}

// ---------------------------------------------------------------------------
// Investment posts history (kept in chrome.storage.local, downloadable as CSV
// from the popup)
// ---------------------------------------------------------------------------

const INVESTMENT_HISTORY_KEY = "investmentPostsHistory";
let investmentHistoryQueue = Promise.resolve();

// Posts are matched on Post ID. A post read from the page without an ID is
// matched on author + text instead.
function investmentHistoryKey(post) {
  if (post?.postId) return `id:${post.postId}`;
  const text = String(post?.text || "").replace(/\s+/g, " ").trim();
  return `text:${String(post?.author || "").trim()}|${text}`;
}

async function addToInvestmentHistory(posts) {
  const items = await chrome.storage.local.get([INVESTMENT_HISTORY_KEY]);
  const history = Array.isArray(items?.[INVESTMENT_HISTORY_KEY])
    ? items[INVESTMENT_HISTORY_KEY]
    : [];
  const known = new Set(history.map(investmentHistoryKey));
  const savedAt = new Date().toISOString();

  let added = 0;
  let alreadyStored = 0;
  for (const post of Array.isArray(posts) ? posts : []) {
    const key = investmentHistoryKey(post);
    if (known.has(key)) {
      alreadyStored++;
      continue;
    }
    known.add(key);
    history.push({
      ...Object.fromEntries(
        INVESTMENT_SHEET_FIELDS.map((field) => [field, post?.[field] ?? null]),
      ),
      savedAt,
    });
    added++;
  }

  if (added) await chrome.storage.local.set({ [INVESTMENT_HISTORY_KEY]: history });
  return { status: "saved", added, alreadyStored, total: history.length };
}

function queueAddToInvestmentHistory(posts) {
  const run = investmentHistoryQueue.then(() => addToInvestmentHistory(posts));
  investmentHistoryQueue = run.catch(() => {});
  return run;
}

async function testInvestmentSheet(url) {
  if (!isValidInvestmentSheetUrl(url)) {
    throw new Error(
      "That doesn't look like an Apps Script web app URL (https://script.google.com/macros/s/.../exec).",
    );
  }
  return callInvestmentSheet(url.trim(), { method: "GET" });
}

async function saveInvestmentPostsToSheet(posts) {
  const items = await chrome.storage.local.get([INVESTMENT_SHEET_URL_KEY]);
  const url = items?.[INVESTMENT_SHEET_URL_KEY];
  if (!url) {
    return {
      status: "not-configured",
      error: "Connect a Google Sheet to save posts automatically.",
    };
  }

  const rows = (Array.isArray(posts) ? posts : []).map((post) =>
    Object.fromEntries(
      INVESTMENT_SHEET_FIELDS.map((field) => [field, post?.[field] ?? null]),
    ),
  );
  const withId = rows.filter((row) => row.postId);

  const data = await callInvestmentSheet(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ posts: withId }),
  });
  return {
    status: "saved",
    inserted: data.inserted ?? 0,
    skipped: data.skipped ?? 0,
    missingId: rows.length - withId.length,
    sheet: data.sheet || "",
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received:", request);

  if (request?.action === "bg-saveInvestmentPostsToSheet") {
    saveInvestmentPostsToSheet(request?.posts)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ status: "error", error: error?.message || String(error) }),
      );
    return true;
  }

  if (request?.action === "bg-addToInvestmentHistory") {
    queueAddToInvestmentHistory(request?.posts)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ status: "error", error: error?.message || String(error) }),
      );
    return true;
  }

  if (request?.action === "bg-testInvestmentSheet") {
    testInvestmentSheet(request?.url)
      .then((data) => sendResponse({ ok: true, sheet: data.sheet || "" }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }

  if (request?.action === "bg-affiliate-post-sync-trigger") {
    return handleAffiliatePostSyncTrigger(
      request?.data,
      sender?.url,
      sendResponse,
    );
  }

  if (request?.action === "bg-log") {
    console.log("[content-script]", ...request.args);
    return;
  }

  if (request.action === "bg-getRedirectionUrl") {
    const eventId = request.eventId;
    (async () => {
      try {
        const { jwtToken } = await chrome.storage.local.get(["jwtToken"]);
        const res = await fetch(
          `${COLLAB_SERVER}/ext/redirection/fetchViaEventId?eventId=${eventId}`,
          {
            headers: { jwtToken: jwtToken },
          },
        );
        const data = await res.json();
        if (data?.success && data?.data) {
          sendResponse({ success: true, url: data?.data });
        } else {
          sendResponse({ success: false });
        }
      } catch (e) {
        console.error("bg-fetchRedirectionUrl failed:", e);
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (request.action === "bg-fetchLatestPost") {
    (async () => {
      try {
        const { jwtToken } = await chrome.storage.local.get(["jwtToken"]);
        const res = await fetch(
          `${COLLAB_SERVER}/ext/lkd/getLatestPostOfUser`,
          {
            headers: { jwtToken: jwtToken },
          },
        );
        const data = await res.json();
        const latestPost = data?.post;
        if (!latestPost) {
          sendResponse({ error: "Unable to find the latest post." });
          return;
        }
        sendResponse({ post: latestPost });
      } catch (e) {
        console.error("bg-fetchLatestPost failed:", e);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (request.action === "bg-submitAffiliatePostSync") {
    (async () => {
      try {
        const result = await submitAffiliatePostSync(request?.data?.postData);
        sendResponse({ success: true, data: result });
      } catch (error) {
        console.error("Affiliate post sync failed:", error);
        sendResponse({
          success: false,
          error: error?.message || "Affiliate post sync failed",
        });
      } finally {
        await clearAffiliatePostSyncStorage();
      }
    })();
    return true;
  }

  if (request.action === "bg-updateAffiliatePostSync") {
    TRIGGER_LOG = { ...TRIGGER_LOG, ...request?.data };
    chrome.storage.local.set(
      { scriptTrigger: JSON.stringify(TRIGGER_LOG) },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          sendResponse({ success: true });
        }
      },
    );
    return true;
  }

  if (request.action === "bg-clearAffiliatePostSync") {
    clearAffiliatePostSyncStorage()
      .then(() => sendResponse({ success: true }))
      .catch((error) =>
        sendResponse({ success: false, error: error?.message }),
      );
    return true;
  }

  // Fire-and-forget actions — no sendResponse needed
  (async () => {
    if (request.action === "saveData") {
      const data = {
        posts: request?.props?.data,
        identifier: request?.props?.identifier,
      };
      saveToMongoDb(data).catch((error) => console.log("Error:", error));
    } else if (request.action === "login") {
      trackPosthog("creator_extension_login_clicked", { env });
      chrome.tabs.create(
        { url: `${COLLAB_CLIENT}/influencer/dashboard` },
        (tab) => {
          const tabId = tab.id;

          const listener = async (updatedTabId, changeInfo, updatedTab) => {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  func: (clientUrl) => {
                    const token = localStorage.getItem("jwtToken");
                    const UserType = localStorage.getItem("UserType");
                    // console.log('Token:', token, 'UserType:', UserType);

                    if (!token || !UserType || UserType !== "Influencer") {
                      window.location.href = `${clientUrl}/influencer/login`;
                    } else {
                      chrome.runtime.sendMessage({
                        action: "storeToken",
                        token,
                        UserType,
                      });
                    }
                  },
                  args: [COLLAB_CLIENT],
                });
              } catch (error) {
                console.error("Error executing script:", error);
              } finally {
                chrome.tabs.onUpdated.removeListener(listener);
              }
            }
          };

          chrome.tabs.onUpdated.addListener(listener);
        },
      );
    } else if (request.action === "bg-retrieveToken") {
      const tabId = request.tabId;

      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          func: () => {
            return {
              token: localStorage.getItem("jwtToken"),
              UserType: localStorage.getItem("UserType"),
            };
          },
        },
        (results) => {
          if (results && results[0] && results[0].result) {
            const { token, UserType } = results[0].result;
            if (token && UserType === "Influencer") {
              chrome.storage.local.set(
                { jwtToken: token, UserType: UserType },
                () => {
                  if (chrome.runtime.lastError) {
                    console.log(
                      "Error storing token:",
                      chrome.runtime.lastError,
                    );
                    sendResponse({ success: false });
                  } else {
                    sendResponse({ success: true });
                  }
                },
              );
            } else {
              sendResponse({ success: false });
            }
          } else {
            sendResponse({ success: false });
          }
        },
      );

      return true; // Indicates that the response will be sent asynchronously
    } else if (request?.action === "storeToken") {
      trackPosthog("creator_extension_token_stored", {
        env,
        userType: request?.UserType,
      });
      chrome.storage.local.set(
        { jwtToken: request.token, UserType: request.UserType },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error storing token:", chrome.runtime.lastError);
          }
        },
      );
    } else if (request?.action === "bg-updateTriggerPayload") {
      TRIGGER_LOG = {
        ...TRIGGER_LOG,
        ...request?.data,
      };

      // console.log('Trigger log:', TRIGGER_LOG);

      chrome.storage.local.set(
        {
          scriptTrigger: JSON.stringify(TRIGGER_LOG),
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error storing trigger:", chrome.runtime.lastError);
          }
        },
      );
    } else if (request?.action === "bg-removeTriggerPayload") {
      TRIGGER_LOG = null;

      chrome.storage.local.set(
        {
          scriptTrigger: null,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error removing trigger:", chrome.runtime.lastError);
          }
        },
      );
    } else if (request?.action === "bg-saveProfile") {
      console.log("Saving profile");
      trackPosthog("creator_extension_profile_save_started", { env });

      try {
        await saveProfileToMongoDb(request.data);
        console.log("1. Profile saved process completed");
      } catch (error) {
        console.error("Error saving profile:", error);
      }
    } else if (request?.action === "bg-saveAudienceDemographics") {
      console.log("Saving audience demographics");
      trackPosthog("creator_extension_demographics_save_started", { env });

      try {
        await saveDemographicsToMongoDb(request.data);
        console.log("2. Audience demographics process complete");
      } catch (error) {
        console.error("Error saving audience demographics:", error);
      }
    } else if (request?.action === "bg-savePosts") {
      console.log("Saving post");
      trackPosthog("creator_extension_posts_save_started", { env });

      try {
        // await savePostsToMongoDb(request.data);
        await sendPostsInBatches(request.data);
        console.log("3. Post saved process completed");
        // await new Promise(resolve => setTimeout(resolve, 3000));
        // await savePostScoreToDb();
        // console.log('Post score saved successfully');
      } catch (error) {
        console.error("Error:", error);
      }
    } else if (request?.action === "bg-saveCollabPost") {
      console.log("Saving collab post");
      try {
        await saveCollabPostToMongoDb(request?.data);
        console.log("1. Collab post saved process completed");
      } catch (error) {
        console.error("Error saving collab post:", error);
      }
    } else if (request?.action === "bg-savePostSummary") {
      console.log("Saving post summary");
      console.log(request?.data);
      try {
        // await saveCollabPostToMongoDb(request?.data);
        await savePostSummaryToMongoDb(request?.data);
        console.log("2. Post Summary saved process completed");
      } catch (error) {
        console.error("Error:", error);
      }
    } else if (request?.action === "bg-saveGuestProfile") {
      console.log("Saving guest profile");

      try {
        await saveGuestProfileToMongoDb(request?.data);
        console.log("1. Guest profile saved process completed");
      } catch (error) {
        console.error("Error saving guest profile:", error);
      }
    } else if (request?.action === "bg-saveGuestDemographics") {
      console.log("Saving guest audience demographics");

      try {
        await saveGuestDemographicsToMongoDb(request?.data);
        console.log("2. Guest audience demographics process complete");
      } catch (error) {
        console.error("Error saving guest audience demographics:", error);
      }
    } else if (request?.action === "bg-saveGuestPosts") {
      console.log("Saving guest posts");

      try {
        await saveGuestPostsToMongoDb(request?.data);
        console.log("3. Guest Posts saved process completed");
      } catch (error) {
        console.error("Error:", error);
      }
    } else if (request?.action === "bg-saveComments") {
      console.log("Saving comments");
      console.log("comments: ", request?.data?.comments?.length);
      console.log("reply: ", request?.data?.replies?.length);
      trackPosthog("creator_extension_comments_save_started", {
        env,
        commentsCount: request?.data?.comments?.length || 0,
        repliesCount: request?.data?.replies?.length || 0,
      });

      try {
        await savePostsCommentToMongoDb(request?.data);
        console.log("4. Comments saved process completed");
      } catch (error) {
        console.error("Error:", error);
      }
    }
  })();
});

chrome.runtime.onMessageExternal.addListener(
  function (request, sender, sendResponse) {
    const isAffiliatePostSync =
      request?.message === "trigger" &&
      request?.data?.ref === "anchorsGuest" &&
      request?.data?.page === "singlePost";
    const loggedRequest = isAffiliatePostSync
      ? {
          ...request,
          data: { ...request.data, affiliateToken: "[redacted]" },
        }
      : request;
    console.log("External Message received:", loggedRequest);

    if (request && request.message === "affiliate-post-sync-capability") {
      sendResponse({ supported: true });
      return true;
    }

    if (request && request.message === "version") {
      const manifest = chrome.runtime.getManifest();
      chrome.storage.local.set(
        {
          jwtToken: request?.data?.jwtToken,
          UserType: request?.data?.UserType,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error storing version:", chrome.runtime.lastError);
          }
        },
      );
      sendResponse({
        version: manifest.version, // Responding with version
      });
    } else if (request && request?.message === "trigger") {
      const manifest = chrome.runtime.getManifest();

      if (isAffiliatePostSync) {
        return handleAffiliatePostSyncTrigger(
          request?.data,
          sender?.url,
          sendResponse,
        );
      }

      TRIGGER_LOG = request?.data; // defined as global variable

      chrome.storage.local.set(
        {
          scriptTrigger: JSON.stringify(TRIGGER_LOG),
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error storing trigger:", chrome.runtime.lastError);
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            sendResponse({
              success: true,
              version: manifest.version,
            });
          }
        },
      );
    } else {
      sendResponse({
        error: "Invalid request",
      });
    }
    return true;
  },
);

console.log("Welcome");
