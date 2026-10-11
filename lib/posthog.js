(() => {
  const POSTHOG_API_KEY = "phc_pdkrsTXnYCh7AZqpcbAw4ajctf25LXsjto1WzAfqidY";
  const POSTHOG_HOST = "https://eu.i.posthog.com";

  const STORAGE_KEYS = {
    distinctId: "anchors_posthog_distinct_id",
  };

  const PLACEHOLDER_KEY = "REPLACE_WITH_POSTHOG_PROJECT_API_KEY";

  const isConfigured =
    Boolean(POSTHOG_API_KEY) && POSTHOG_API_KEY !== PLACEHOLDER_KEY;

  const storageGet = (keys) =>
    new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          console.log("PostHog storage get error:", chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    });

  const storageSet = (payload) =>
    new Promise((resolve) => {
      chrome.storage.local.set(payload, () => {
        if (chrome.runtime.lastError) {
          console.log("PostHog storage set error:", chrome.runtime.lastError);
        }
        resolve();
      });
    });

  const generateDistinctId = () => {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `ph_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const getOrCreateDistinctId = async () => {
    const stored = await storageGet([STORAGE_KEYS.distinctId]);
    if (stored?.[STORAGE_KEYS.distinctId]) {
      return stored[STORAGE_KEYS.distinctId];
    }

    const distinctId = generateDistinctId();
    await storageSet({ [STORAGE_KEYS.distinctId]: distinctId });
    return distinctId;
  };

  const buildBaseProperties = () => {
    const manifest = chrome.runtime.getManifest();
    const url = globalThis?.location?.href || "";

    return {
      source: "creator-chrome-extension",
      extension_version: manifest?.version,
      extension_name: manifest?.name,
      $current_url: url,
    };
  };

  const anchorsPosthogCapture = async (event, properties = {}) => {
    if (!isConfigured || !event) return;

    try {
      const distinctId = await getOrCreateDistinctId();
      const payload = {
        api_key: POSTHOG_API_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...buildBaseProperties(),
          ...properties,
        },
      };

      await fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (error) {
      console.log("PostHog capture error:", error);
    }
  };

  const anchorsPosthogIdentify = async (distinctId, userProperties = {}) => {
    if (!isConfigured || !distinctId) return;

    await storageSet({ [STORAGE_KEYS.distinctId]: String(distinctId) });
    await anchorsPosthogCapture("$identify", {
      $identified_id: String(distinctId),
    });

    if (Object.keys(userProperties).length > 0) {
      await anchorsPosthogCapture("$set", {
        $set: userProperties,
      });
    }
  };

  const anchorsPosthogReset = async () => {
    await storageSet({ [STORAGE_KEYS.distinctId]: generateDistinctId() });
  };

  globalThis.anchorsPosthogCapture = anchorsPosthogCapture;
  globalThis.anchorsPosthogIdentify = anchorsPosthogIdentify;
  globalThis.anchorsPosthogReset = anchorsPosthogReset;
})();
