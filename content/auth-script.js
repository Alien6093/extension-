let config = {
  JWTTOKEN: "jwtToken",
  USERTYPE: "UserType",
};

function trackPosthog(event, properties = {}) {
  try {
    if (typeof anchorsPosthogCapture === "function") {
      anchorsPosthogCapture(event, properties);
    }
  } catch (error) {
    console.log("PostHog track failed:", error);
  }
}

async function authCheck() {
  const jwtToken = localStorage.getItem(config.JWTTOKEN);
  const UserType = localStorage.getItem(config.USERTYPE);

  if (jwtToken && UserType === "Influencer") {
    trackPosthog("creator_extension_auth_token_found", {
      userType: UserType,
    });
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ jwtToken, UserType }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(true);
        }
      });
    });
  } else {
    return false;
  }
}

(async () => {
  try {
    const auth = await authCheck();
    // console.log(auth);
  } catch (error) {
    console.error("Error checking auth:", error);
  }
})();

const AFFILIATE_EXTENSION_REQUEST = "anchors-affiliate-extension-request";
const AFFILIATE_EXTENSION_RESPONSE = "anchors-affiliate-extension-response";

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== "anchors-affiliate-app" ||
    event.data?.type !== AFFILIATE_EXTENSION_REQUEST ||
    !event.data?.requestId
  ) {
    return;
  }

  const { requestId, message } = event.data;
  const respond = (response) => {
    window.postMessage(
      {
        source: "anchors-creator-extension",
        type: AFFILIATE_EXTENSION_RESPONSE,
        requestId,
        response,
      },
      event.origin,
    );
  };

  if (message?.message === "affiliate-post-sync-capability") {
    respond({ supported: true });
    return;
  }

  if (
    message?.message !== "trigger" ||
    message?.data?.ref !== "anchorsGuest" ||
    message?.data?.page !== "singlePost"
  ) {
    respond({ error: "Invalid request" });
    return;
  }

  chrome.runtime.sendMessage(
    {
      action: "bg-affiliate-post-sync-trigger",
      data: message.data,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        respond({
          success: false,
          error: chrome.runtime.lastError.message || "Extension is unavailable",
        });
        return;
      }
      respond(response ?? {});
    },
  );
});
