// Guard against this content script running more than once on the same
// page (e.g. manifest injection racing a programmatic injection, or the
// extension re-injecting on an SPA navigation). A second execution would
// re-declare top-level state and duplicate every fetch/save call below.
if (window.__anchorsCreatorContentScriptLoaded) {
  throw new Error(
    "Anchors creator content script already loaded on this page; skipping re-initialization.",
  );
}
window.__anchorsCreatorContentScriptLoaded = true;

const env = "dev";
let COLLAB_CLIENT = "https://dev.anchors.pro";
let COLLAB_SERVER = "https://dev.anchors.pro/api";

// const env = "prod";
// let COLLAB_CLIENT = "https://www.anchors.in";
// let COLLAB_SERVER = "https://www.anchors.in/api";

try {
  if (typeof anchorsPosthogCapture === "function") {
    anchorsPosthogCapture("creator_extension_content_script_loaded", {
      env,
      page: window?.location?.pathname || "",
    });
  }
} catch (error) {
  console.log("PostHog track failed:", error);
}

let PERCENTAGE = 0;
let TRIGGER_LOG = null;
let IS_TRIGGER_EXPIRED = true;
let AFFILIATE_SYNC_STARTED = false;
let redirectionUrl = "";
let userProfileUrn = "";
let isProfileScrapingFailed = false;
const PROFILE_SCRAPE_FAIL_KEY = "isProfileScrapingFailed";

const getProfileUrnFromVoyager = async () => {
  const options = {
    method: "GET",
    headers: {
      Host: "www.linkedin.com",
      Connection: "Keep-Alive",
      "X-RestLi-Protocol-Version": "2.0.0",
      "Accept-Language": "en-US",
      "Csrf-Token": document.cookie
        .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
        .replace(/^["']|["']$/g, ""),
      "x-li-track":
        '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
      "X-LI-Lang": "en_US",
      Accept: "application/json",
      Cookie: document.cookie,
      "User-Agent": navigator.userAgent,
      "Accept-Encoding": "*",
    },
  };

  const res = await fetch(`https://www.linkedin.com/voyager/api/me`, options);

  if (res.ok) {
    const json = await res.json();
    userProfileUrn =
      json?.miniProfile?.dashEntityUrn?.split("urn:li:fsd_profile:")?.[1] || "";
    return userProfileUrn;
  } else {
    console.error(
      "Daniel getProfileUrnFromVoyager failed to fetch /voyager/api/me:",
      res.status,
    );
  }
};

const initializeProfileUrn = () => {
  if (userProfileUrn) {
    return userProfileUrn;
  }

  const topcardEl = document.querySelector(
    '[componentkey^="com.linkedin.sdui.profile.card.ref"]',
  );

  const extractedFromTopcard =
    topcardEl
      ?.getAttribute("componentkey")
      ?.match(/com\.linkedin\.sdui\.profile\.card\.ref(.+)Topcard/)?.[1] || "";

  if (extractedFromTopcard) {
    userProfileUrn = extractedFromTopcard;
    return userProfileUrn;
  }

  const extractedFromBody = document?.body?.textContent?.match(
    /"entityUrn":"urn:li:fsd_profile:([^\"]+)"/,
  )?.[1];

  if (extractedFromBody) {
    userProfileUrn = extractedFromBody;
  }

  return userProfileUrn;
};

const getProfileScrapeFailFlag = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get([PROFILE_SCRAPE_FAIL_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.log(
          "Error reading profile scrape flag:",
          chrome.runtime.lastError,
        );
        resolve(false);
        return;
      }
      resolve(Boolean(result?.[PROFILE_SCRAPE_FAIL_KEY]));
    });
  });
};

const clearProfileScrapeFailFlag = () => {
  return new Promise((resolve) => {
    chrome.storage.local.remove([PROFILE_SCRAPE_FAIL_KEY], () => {
      if (chrome.runtime.lastError) {
        console.log(
          "Error clearing profile scrape flag:",
          chrome.runtime.lastError,
        );
      }
      resolve();
    });
  });
};

const CONFIG = {
  JWTTOKEN: "jwtToken",
  USERTYPE: "UserType",
  overlay_messages: [
    {
      message: `Scanning your LinkedIn profile <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>`,
      description:
        "We're collecting valuable insights to kick things off </br> Just a moment!",
    },
    {
      message: `Analyzing your content and interactions <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>`,
      description:
        "Looking great so far! We’re extracting key details from your activity",
    },
    {
      message: `Compiling your media kit <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span> Almost done!`,
      description:
        "Thanks for hanging tight! </br> Your kit is shaping up nicely, and you can fine-tune it soon",
    },
  ],
  ERROR_CALLBACK_URL: `${COLLAB_CLIENT}/influencer/plugin/callback`,
};

const createProfileDataOject = (
  profileData,
  topCardData,
  initialCardsData,
  deferredCardsData,
) => {
  const data = {};

  data.name =
    (profileData?.firstName || "") + " " + (profileData?.lastName || "");
  data.tagline = profileData?.headline || "";

  data.badge = topCardData?.topVoiceBadge?.badgeText || null;

  // Add current company if available
  let currentArr = [];
  if (profileData?.profileTopPosition?.elements?.length > 0) {
    const firstPosition = profileData.profileTopPosition.elements[0];
    if (firstPosition?.companyName) {
      currentArr.push({
        title: "current-company",
        value: firstPosition.companyName,
      });
    }
  }
  // Add top education if available
  if (profileData?.profileTopEducation?.elements?.length > 0) {
    const firstEducation = profileData.profileTopEducation.elements[0];
    if (firstEducation?.schoolName) {
      currentArr.push({
        title: "education",
        value: firstEducation.schoolName,
      });
    }
  }
  if (currentArr.length > 0) {
    data.current = currentArr;
  }

  data.page_url = window?.location?.href;
  data.profile_url = `https://linkedin.com/in/${profileData?.publicIdentifier}`;

  let custom_button = [];

  // Handle creatorWebsite (rich text with hyperlink)
  if (topCardData?.creatorWebsite) {
    const text = topCardData?.creatorWebsite?.text || "";
    let link = "";
    // Find hyperlink attribute
    if (Array.isArray(topCardData?.creatorWebsite?.attributesV2)) {
      const hyperlinkAttr = topCardData.creatorWebsite.attributesV2.find(
        (attr) =>
          attr?.detailData?.hyperlink ||
          attr?.detailData?.hyperlinkOpenExternally,
      );
      if (hyperlinkAttr) {
        link =
          hyperlinkAttr.detailData.hyperlink ||
          hyperlinkAttr.detailData.hyperlinkOpenExternally ||
          "";
      }
    }
    if (link) {
      custom_button.push({
        link_text: text,
        link: link,
      });
    }
  }

  // Handle profileTopCardCustomAction (array of buttons)
  if (Array.isArray(topCardData?.profileTopCardCustomAction?.elements)) {
    topCardData.profileTopCardCustomAction.elements.forEach((el) => {
      const link_text = el?.buttonAppearance?.text || el?.controlName || "";
      const link = el?.navigationUrl || "";
      if (link_text && link) {
        custom_button.push({ link_text, link });
      }
    });
  }

  if (custom_button.length > 0) {
    data.custom_button = custom_button;
  }

  data.location = profileData?.geoLocation?.geo?.defaultLocalizedName || "";

  // Set profile_image from profilePicture
  if (
    profileData?.profilePicture?.displayImageReferenceResolutionResult
      ?.vectorImage?.rootUrl &&
    Array.isArray(
      profileData?.profilePicture?.displayImageReferenceResolutionResult
        ?.vectorImage?.artifacts,
    )
  ) {
    // Choose the artifact with the highest resolution (largest width)
    const artifacts =
      profileData.profilePicture.displayImageReferenceResolutionResult
        .vectorImage.artifacts;
    let bestArtifact = artifacts[0];
    for (const artifact of artifacts) {
      if (artifact.width > bestArtifact.width) {
        bestArtifact = artifact;
      }
    }
    data.profile_image =
      profileData.profilePicture.displayImageReferenceResolutionResult
        .vectorImage.rootUrl + bestArtifact.fileIdentifyingUrlPathSegment;
  } else {
    data.profile_image = null;
  }

  data.is_verified = topCardData?.verificationData ? true : false;

  data.gender =
    topCardData?.pronoun?.standardizedPronoun === "HE_HIM"
      ? "male"
      : topCardData?.pronoun?.standardizedPronoun === "SHE_HER"
        ? "female"
        : "";

  data.is_premium_member = topCardData?.premium;

  data.about = profileData?.summary;

  // Extract top skills from initialCardsData
  const elements = initialCardsData?.elements || [];
  const aboutCard = elements.find((e) => e?.pemFeatureKey === "about");
  if (aboutCard) {
    // Try topComponents first (existing logic)
    let foundSkills = false;
    const fixedListComp = aboutCard?.topComponents
      ?.map((tc) => tc?.components?.fixedListComponent)
      .find(Boolean);
    if (fixedListComp) {
      const skillsEntity = fixedListComp?.components
        ?.map((c) => c?.components?.entityComponent)
        .find((ec) => ec?.title?.text === "Top skills");
      if (skillsEntity?.subtitle?.text) {
        const skillsArray = skillsEntity.subtitle.text
          .split("•")
          .map((s) => s.trim())
          .filter(Boolean);
        data.topSkills = skillsArray || [];
        foundSkills = true;
      }
    }
    // If not found in topComponents, try subComponents
    if (!foundSkills && Array.isArray(aboutCard?.subComponents)) {
      for (const sub of aboutCard.subComponents) {
        const subFixedList = sub?.components?.fixedListComponent;
        if (Array.isArray(subFixedList?.components)) {
          for (const c of subFixedList.components) {
            const entity = c?.components?.entityComponent;
            if (
              entity?.title?.text === "Top skills" &&
              entity?.subtitle?.text
            ) {
              const skillsArray = entity.subtitle.text
                .split("•")
                .map((s) => s.trim())
                .filter(Boolean);
              data.topSkills = skillsArray || [];
              foundSkills = true;
              break;
            }
          }
        }
        if (foundSkills) break;
      }
    }
  }

  data.followers = profileData?.followingState?.followerCount;

  // Extract activity types from initial and deferred cards
  let activityTypes = [];
  const allCards = [
    ...(initialCardsData?.elements || []),
    ...(deferredCardsData?.elements || []),
  ];

  const typeMap = {
    $UNKNOWN: undefined,
    ALL_POSTS: "Posts",
    ALL_POSTS_FULL_FEED_CARDS: "Posts",
    ALL_POSTS_MINI: "Posts",
    ARTICLES: "Articles",
    COMMENTS: "Comments",
    COMMENTS_MINI: "Comments",
    DOCUMENTS: "Documents",
    EVENTS: "Events",
    IMAGES_AND_MULTI_PHOTOS: "Images",
    NEWSLETTER_ARTICLES: "Newsletters",
    REACTIONS: undefined,
    REACTIONS_AND_COMMENTS: undefined,
    VIDEOS: "Videos",
  };

  const extractFromCard = (card) => {
    if (!card) return null;
    const components = [
      ...(card?.topComponents || []),
      ...(card?.subComponents || []),
    ];

    for (const comp of components) {
      const collections =
        comp?.components?.profileContentCollectionsComponent ||
        comp?.profileContentCollectionsComponent;
      if (Array.isArray(collections?.contentTypes)) {
        return collections.contentTypes;
      }
    }
    return null;
  };

  // 1. Try finding by feature key "activity" or "member-activity"
  let activityCard = allCards.find(
    (el) =>
      el?.pemFeatureKey === "activity" ||
      el?.pemFeatureKey === "member-activity",
  );

  let rawTypes = extractFromCard(activityCard);

  // 2. If not found, search through all cards for the collections component
  if (!rawTypes || rawTypes.length === 0) {
    for (const card of allCards) {
      rawTypes = extractFromCard(card);
      if (rawTypes && rawTypes.length > 0) break;
    }
  }

  if (Array.isArray(rawTypes)) {
    activityTypes = rawTypes
      .map((ct) => typeMap[ct] || ct)
      .filter((t) => t !== undefined);
    activityTypes = [...new Set(activityTypes)];
  }

  data.activity_type = activityTypes;

  // Extract featured from initial top cards
  const featuredCard = (initialCardsData?.elements || []).find(
    (el) => el?.pemFeatureKey === "featured",
  );

  if (featuredCard) {
    const carousel = featuredCard?.topComponents
      ?.map((tc) => tc?.components?.carouselComponent)
      .find(Boolean);

    if (carousel && Array.isArray(carousel.components)) {
      data.featured = carousel.components
        .map((comp) => {
          const content = comp?.components?.contentComponent;
          if (content) {
            return {
              type: content?.supplementaryInfo?.text || "",
              link: content?.actionTarget || "",
            };
          }
          return null;
        })
        .filter(Boolean);
    }
  }

  // Work experience extraction
  if (Array.isArray(profileData?.profilePositionGroups?.elements)) {
    data.experience = profileData.profilePositionGroups.elements.map(
      (group) => {
        const company = group?.company;
        const positions = (
          group?.profilePositionInPositionGroup?.elements || []
        ).map((pos) => {
          const start = pos?.dateRange?.start;
          const end = pos?.dateRange?.end;
          let duration = "";
          if (start?.year) {
            duration = `${start.month || ""}/${start.year}`;
            if (end?.year) {
              duration += ` - ${end.month || ""}/${end.year}`;
            } else {
              duration += " - Present";
            }
          }

          return {
            position: pos?.title || "",
            duration: duration,
            type: pos?.employmentType?.name || "",
            location: pos?.locationName || pos?.geoLocationName || "",
          };
        });

        // logo extraction
        let logo = null;
        const vectorImage = company?.logoResolutionResult?.vectorImage;
        if (vectorImage?.rootUrl && Array.isArray(vectorImage?.artifacts)) {
          let bestArtifact = vectorImage.artifacts[0];
          for (const artifact of vectorImage.artifacts) {
            if (artifact.width > (bestArtifact?.width || 0)) {
              bestArtifact = artifact;
            }
          }
          if (bestArtifact) {
            logo =
              vectorImage.rootUrl + bestArtifact.fileIdentifyingUrlPathSegment;
          }
        }

        return {
          company_url: company?.url || "",
          company_name: company?.name || group?.companyName || "",
          positions: positions,
          type: positions[0]?.type || "",
          logo: logo,
        };
      },
    );
  }

  //Extract education data
  if (Array.isArray(profileData?.profileEducations?.elements)) {
    data.education = profileData.profileEducations.elements.map((el) => {
      const ed = {
        shool_url: el?.school?.url || "",
        school_name: el?.school?.name || el?.schoolName || "",
        degree: [el?.degreeName, el?.fieldOfStudy].filter(Boolean).join(", "),
        years: "",
        logo: null,
      };

      if (el?.dateRange) {
        const start = el.dateRange.start?.year;
        const end = el.dateRange.end?.year;
        if (start && end) {
          ed.years = `${start} - ${end}`;
        } else if (start) {
          ed.years = `${start} - Present`;
        }
      }

      const vectorImage = el?.school?.logoResolutionResult?.vectorImage;
      if (vectorImage?.rootUrl && Array.isArray(vectorImage?.artifacts)) {
        let bestArtifact = vectorImage.artifacts[0];
        for (const artifact of vectorImage.artifacts) {
          if (artifact.width > (bestArtifact?.width || 0)) {
            bestArtifact = artifact;
          }
        }
        if (bestArtifact) {
          ed.logo =
            vectorImage.rootUrl + bestArtifact.fileIdentifyingUrlPathSegment;
        }
      }

      return ed;
    });
  }

  //Languages extraction
  if (Array.isArray(profileData?.profileLanguages?.elements)) {
    data.languages = profileData.profileLanguages.elements.map((el) => {
      return {
        languages: el?.name || "",
        proficiency: el?.proficiency || "",
      };
    });
  }

  //recommendations extraction
  const recCard = allCards.find(
    (el) => el?.pemFeatureKey === "recommendations",
  );
  if (recCard) {
    const sections =
      recCard?.topComponents
        ?.map((tc) => tc?.components?.tabComponent?.sections)
        .find(Boolean) ||
      recCard?.subComponents
        ?.map((sc) => sc?.components?.tabComponent?.sections)
        .find(Boolean);

    if (Array.isArray(sections)) {
      const receivedSection = sections.find(
        (s) =>
          s?.controlName === "active_tab_received_recommendations" ||
          s?.label?.text === "Received",
      );

      if (receivedSection) {
        const recList =
          receivedSection?.subComponent?.components?.fixedListComponent
            ?.components;
        if (Array.isArray(recList)) {
          data.recommendations = recList
            .map((rec) => {
              const entity = rec?.components?.entityComponent;
              if (entity) {
                const name = entity?.title?.text || "";
                const profileUrl = entity?.textActionTarget || "";
                const tagline = entity?.subtitle?.text || "";
                const title = entity?.caption?.text || "";
                const recommendation =
                  entity?.subComponents?.components?.[0]?.components
                    ?.fixedListComponent?.components?.[0]?.components
                    ?.textComponent?.text?.text || "";

                return {
                  profileUrl,
                  name,
                  tagline,
                  title,
                  recommendation,
                };
              }
              return null;
            })
            .filter(Boolean);
        }
      }
    }
  }

  //Extract honor and awards from user's initial card data.
  const honorsCard = allCards.find(
    (el) => el?.pemFeatureKey === "honors-and-awards",
  );
  if (honorsCard) {
    const fixedList = honorsCard?.topComponents?.find(
      (tc) => tc?.components?.fixedListComponent,
    )?.components?.fixedListComponent;

    if (fixedList && Array.isArray(fixedList.components)) {
      data.honor_and_awards = fixedList.components
        .map((comp) => {
          const entity = comp?.components?.entityComponent;
          if (entity) {
            const title = entity?.title?.text || "";
            let issuer = entity?.subtitle?.text || "";
            if (issuer.includes("Issued by ")) {
              issuer = issuer.split("Issued by ")[1].split(" · ")[0];
            }
            return {
              title,
              issuer,
            };
          }
          return null;
        })
        .filter(Boolean);
    }
  }

  // Public Identifier URL
  data.publicIdentifier = profileData?.publicIdentifier;

  return data;
};

const profileScriptViaVoyager = async () => {
  try {
    if (!userProfileUrn) {
      initializeProfileUrn();
    }

    console.log("userProfileUrn: ", userProfileUrn);
    if (!userProfileUrn) {
      console.error(
        "No profile URN found, cannot fetch profile data via Voyager API",
      );
      return false;
    }

    //Call to FullProfileWithEntitiesV2
    const options = {
      method: "GET",
      headers: {
        Host: "www.linkedin.com",
        Connection: "Keep-Alive",
        "X-RestLi-Protocol-Version": "2.0.0",
        "Accept-Language": "en-US",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "x-li-track":
          '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
        "X-LI-Lang": "en_US",
        Accept: "application/json",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        "Accept-Encoding": "*",
      },
    };

    const profileUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A${userProfileUrn})&queryName=FullProfileWithEntitiesV2&queryId=voyagerIdentityDashProfiles.8141a8740f8acf83abd29b150c789bc9`;

    const profileTopCardCompleteUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A${userProfileUrn})&queryName=ProfileTopCardComplete&queryId=voyagerIdentityDashProfiles.b7f2a1e4cbe6fb4e235fd27732e29ae7`;

    const profileInitialCardsInTabUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A${userProfileUrn})&queryName=ProfileInitialCardsInTab&queryId=voyagerIdentityDashProfileCards.845a04667abf58bb212b444934e14d3f`;

    const profileDeferredCardsInTabUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A${userProfileUrn})&queryName=ProfileDeferredCardsInTab&queryId=voyagerIdentityDashProfileCards.38ea75985cd7acbd5781fb2c6d3ab5ed`;

    const profileData = await fetch(profileUrl, options);
    const json = await profileData.json();

    const topCardData = await fetch(profileTopCardCompleteUrl, options);
    const topCardJson = await topCardData.json();

    const initialCardsData = await fetch(profileInitialCardsInTabUrl, options);
    const initialCardsJson = await initialCardsData.json();

    const profileDeferredCardsData = await fetch(
      profileDeferredCardsInTabUrl,
      options,
    );
    const profileDeferredCardsJson = await profileDeferredCardsData.json();

    const data = createProfileDataOject(
      json?.data?.identityDashProfilesById,
      topCardJson?.data?.identityDashProfilesById,
      initialCardsJson?.data?.identityDashProfileCardsByInitialCards,
      profileDeferredCardsJson?.data?.identityDashProfileCardsByDeferredCards,
    );

    // console.log("DANIEL Extracted profile data: ", data);
    // await new Promise((resolve) => setTimeout(resolve, 300000)); // Wait for 5 minutes before saving the profile data

    if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
      await chrome.runtime.sendMessage({
        action: "bg-saveGuestProfile",
        data,
      });
    } else {
      await chrome.runtime.sendMessage({ action: "bg-saveProfile", data });
    }

    isProfileScrapingFailed = false;
    await clearProfileScrapeFailFlag();

    return true;
  } catch (error) {
    console.error("profileScriptViaVoyager failed:", error);
    return false;
  }
};

const profileScript = async () => {
  let sectionsName = {
    SUGGESTED_FOR_YOU: "suggested-for-you",
    ANALYTICS: "analytics",
    RESOURCES: "resources",
    SERVICES: "services",
    ACTIVITY: "activity",
    EXPERIENCE: "experience",
    EDUCATION: "education",
    LICENSES_CERTIFICATIONS: "licenses-&-certifications",
    PROJECTS: "projects",
    VOLUNTEERING: "volunteering",
    SKILLS: "skills",
    LANGUAGES: "languages",
    INTERESTS: "interests",
    PROFILE: "profile",
    ABOUT: "about",
    FEATURED: "featured",
    RECOMMENDATIONS: "recommendations",
    PUBLICATIONS: "publications",
    HONORS_AWARDS: "honors-&-awards",
    TEST_SCORES: "test-scores",
    CAUSES: "causes",
  };

  const cleanText = (text) => {
    return text?.trim()?.replace(/\s+/g, " ");
  };

  // function getLinkedInUsername(url) {
  //   const regex = /https:\/\/www\.linkedin\.com\/in\/([^/?#]+)/i;
  //   const match = url.match(regex);
  //   return match ? match[1] : null;
  // }

  let data = {};

  let sections = document?.querySelectorAll("main section.pv-profile-card");

  let allSectionsElements = Array?.from(sections || [])?.map((e) => ({
    e: e,
    section: e
      ?.querySelector("h2.pvs-header__title span")
      ?.textContent?.trim()
      ?.toLowerCase()
      ?.replace(/\s+/g, "-"),
  }));

  // ----------------- PROFILE -----------------
  let profileSection = document?.querySelector("main section.artdeco-card");

  data.name = profileSection
    ?.querySelector("div div.mt2.relative a h1")
    ?.textContent?.trim();
  data.tagline = profileSection
    ?.querySelector("div div.mt2.relative div.text-body-medium.break-words")
    ?.textContent?.trim();
  data.badge = profileSection
    ?.querySelector(
      "div > div.mt2.relative > div:nth-child(1) > div.mt2 > button > span",
    )
    ?.textContent?.trim();
  data.current = Array.from(
    profileSection?.querySelectorAll("div div.mt2.relative ul li") || [],
  )?.map((e) => ({
    title: e
      ?.querySelector("button")
      ?.getAttribute("aria-label")
      ?.split(":")[0]
      ?.trim()
      ?.toLowerCase()
      ?.replace(/\s+/g, "-"),
    value: e?.querySelector("span")?.textContent?.trim(),
  }));
  data.page_url = window.location.href;
  data.profile_url =
    cleanText(
      document?.body?.querySelector(
        "aside.scaffold-layout__aside > div.pv-profile-info-section.artdeco-card > div.relative.display-flex.flex-column > p",
      )?.textContent,
    ) || window?.location?.href?.split("?")?.[0];
  let linkElement = profileSection?.querySelector(
    "div > section > a[data-test-app-aware-link]",
  );
  let linkTextElement = linkElement?.querySelector("strong");

  data.custom_button =
    linkElement && linkTextElement
      ? {
          link_text: cleanText(linkTextElement?.textContent),
          link: linkElement.href,
        }
      : null;

  data.location = profileSection
    ?.querySelector("div > div.mt2.relative > div.mt2 > span")
    ?.textContent?.trim();
  data.profile_image = profileSection?.querySelector("button img")?.src;
  data.is_verified = profileSection?.querySelector(
    'div > span > a svg[data-test-icon="verified-medium"]',
  )
    ? true
    : false;
  let gender =
    cleanText(
      profileSection?.querySelector(
        "div > div > div:nth-child(1) > div > span.text-body-small.v-align-middle.break-words.t-black--light",
      )?.textContent,
    )
      ?.replace(/[()]/g, "")
      ?.toLowerCase() || "";
  if (gender === "he/him") {
    gender = "male";
  } else if (gender === "she/her") {
    gender = "female";
  }

  data.gender = gender;
  data.is_premium_member =
    cleanText(
      profileSection
        ?.querySelector("div > div > div > div > span")
        ?.getAttribute("title"),
    )
      ?.toLowerCase()
      ?.includes("premium member") || false;

  // ----------------- ABOUT -----------------
  let aboutSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.ABOUT,
  )?.e;

  data.about = cleanText(
    aboutSection?.querySelector(" div > div > div > div > span:nth-child(1)")
      ?.textContent,
  );
  data.topSkills = cleanText(
    aboutSection?.querySelector(
      "ul.pvs-list--padded li> div > div > div.display-flex.flex-column.full-width.align-self-center > div > div.display-flex.flex-column.full-width > div:nth-child(2) > div > div > span:nth-child(1)",
    )?.textContent,
  )
    ?.split(" • ")
    ?.map((e) => e?.trim());

  // ----------------- ACTIVITY -----------------
  let activitySection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.ACTIVITY,
  )?.e;

  data.followers = cleanText(
    activitySection?.querySelector(
      "div > div > div.pvs-header__left-container--stack > div > p > span:nth-child(1)",
    )?.textContent,
  )
    ?.split(" ")?.[0]
    ?.replace(/[,]/g, "");
  data.activity_type = Array?.from(
    activitySection?.querySelectorAll("div button span.artdeco-pill__text") ||
      [],
  )?.map((e) => e?.textContent);

  // ----------------- FEATURED -----------------
  let featuredSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.FEATURED,
  )?.e;

  data.featured = Array?.from(
    featuredSection?.querySelectorAll(
      "ul li > div.artdeco-carousel__item-container > div.artdeco-card > div.display-flex",
    ) || [],
  ).map((e) => ({
    type:
      e?.querySelector("a.optional-action-target-wrapper span:nth-child(1)")
        ?.textContent || "",
    link: e?.querySelector("a.optional-action-target-wrapper")?.href || "",
  }));

  // ----------------- EXPERIENCE -----------------
  let experienceSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.EXPERIENCE,
  )?.e;

  data.experience = Array.from(
    experienceSection?.querySelectorAll(
      "ul > li.artdeco-list__item > div[data-view-name=profile-component-entity]",
    ) || [],
  ).map((e) => {
    // Get company URL and logo
    const companyUrl =
      e?.querySelector("[data-field=experience_company_logo]")?.href || "";
    const logoSrc = e?.querySelector("div a img")?.src || "";

    // Check if there are multiple positions (sub-components)
    const subEntities = e?.querySelectorAll(
      ".pvs-entity__sub-components > ul > li > div[data-view-name=profile-component-entity]",
    );

    if (subEntities && subEntities.length > 0) {
      // Case: Multiple positions at the same company

      // For multiple positions, company name is in the top level
      const companyNameElement = e?.querySelector(
        "div.display-flex.flex-row.justify-space-between a div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold span[aria-hidden]",
      );
      let companyName = cleanText(companyNameElement?.innerText || "");

      const positions = Array.from(subEntities).map((positionElement) => {
        // Get position title
        const titleElement = positionElement?.querySelector(
          "div.hoverable-link-text.t-bold span[aria-hidden]",
        );
        const positionTitle = cleanText(titleElement?.innerText || "");

        // Get employment type
        const typeElement = positionElement?.querySelector(
          "span.t-14.t-normal span[aria-hidden]",
        );
        const employmentType = cleanText(typeElement?.innerText || "");

        // Get duration
        const durationElement = positionElement?.querySelector(
          "span.pvs-entity__caption-wrapper[aria-hidden]",
        );
        const duration = cleanText(durationElement?.innerText || "");

        // Get location
        const locationElement = positionElement?.querySelector(
          "span.t-14.t-normal.t-black--light:last-child span[aria-hidden]",
        );
        const location = cleanText(locationElement?.innerText || "");

        // Get skills if available
        const skillsElement = positionElement?.querySelector(
          "div.hoverable-link-text.t-14.t-normal.t-black > strong",
        );
        const skills = cleanText(skillsElement?.innerText || "");

        const position = {
          position: positionTitle,
          duration: duration,
          type: employmentType,
          location: location,
        };

        if (skills) {
          position.skills = skills;
        }

        return position;
      });

      // Get the total duration if available (at company level)
      const totalDurationElement = e?.querySelector(
        "span.t-14.t-normal > span[aria-hidden]",
      );
      const totalDuration = cleanText(totalDurationElement?.innerText || "");

      return {
        company_url: companyUrl,
        company_name: companyName,
        total_duration: totalDuration,
        positions: positions,
        logo: logoSrc,
      };
    } else {
      // Case: Single position
      // For single positions, need special handling

      // 1. Position title is in the first bold text
      const positionTitleElement = e?.querySelector(
        "div.display-flex.flex-row.justify-space-between a div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold span[aria-hidden]",
      );
      const positionTitle = cleanText(positionTitleElement?.innerText || "");

      // 2. Company name and employment type is in the next line with format "Company · Type"
      const companyTypeElement = e?.querySelector(
        "span.t-14.t-normal span[aria-hidden]",
      );
      const companyTypeText = cleanText(companyTypeElement?.innerText || "");

      // Split company name and employment type
      let companyName = "";
      let employmentType = "";

      if (companyTypeText.includes("·")) {
        const parts = companyTypeText.split("·").map((p) => p.trim());
        companyName = parts[0];
        employmentType = parts.length > 1 ? parts[1] : "";
      } else {
        companyName = companyTypeText;
      }

      // 3. Duration is in the first caption
      const durationElement = e?.querySelector(
        "span.pvs-entity__caption-wrapper[aria-hidden]",
      );
      const duration = cleanText(durationElement?.innerText || "");

      // 4. Location is in the last t-black--light span
      const locationElement = e?.querySelector(
        "span.t-14.t-normal.t-black--light:last-child span[aria-hidden]",
      );
      const location = cleanText(locationElement?.innerText || "");

      // 5. Skills if available
      const skillsElement = e?.querySelector(
        "div.hoverable-link-text.t-14.t-normal.t-black > strong",
      );
      const skills = cleanText(skillsElement?.innerText || "");

      const positionObj = {
        position: positionTitle,
        duration: duration,
        type: employmentType,
        location: location,
      };

      if (skills) {
        positionObj.skills = skills;
      }

      return {
        company_url: companyUrl,
        company_name: companyName,
        positions: [positionObj],
        logo: logoSrc,
      };
    }
  });

  // ----------------- EDUCATION -----------------
  let educationSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.EDUCATION,
  )?.e;

  data.education = Array?.from(
    educationSection?.querySelectorAll(
      "ul li > div[data-view-name=profile-component-entity]",
    ) || [],
  ).map((e) => {
    const url = e?.querySelector("a")?.href;
    return {
      shool_url: url || "",
      school_name:
        cleanText(
          e?.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > div span",
          )?.textContent,
        ) || "",
      degree:
        cleanText(
          e?.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > span span.visually-hidden",
          )?.textContent,
        ) || "",
      years:
        cleanText(
          e?.querySelector(
            "div.display-flex.flex-row.justify-space-between > a span span.pvs-entity__caption-wrapper",
          )?.textContent,
        ) || "",
      logo: e?.querySelector("div a img")?.src || "",
    };
  });

  // ------------------ LANGUAGES ------------------
  let languagesSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.LANGUAGES,
  )?.e;

  data.languages = Array?.from(
    languagesSection?.querySelectorAll("div ul li.artdeco-list__item > div") ||
      [],
  ).map((e) => {
    return {
      languages:
        cleanText(
          e.querySelector(
            "div.display-flex.flex-row > div.full-width > div.align-items-center > div > div > div > span:nth-child(1)",
          )?.textContent,
        ) || "",
      proficiency:
        cleanText(
          e.querySelector(
            "div.display-flex.flex-row > div.full-width > span > span.pvs-entity__caption-wrapper",
          )?.textContent,
        ) || "",
    };
  });

  // ------------------ RECOMMENDATIONS ------------------
  let recommendationsSection = allSectionsElements?.find(
    (e) => e?.section === sectionsName.RECOMMENDATIONS,
  )?.e;

  data.recommendations = Array?.from(
    recommendationsSection?.querySelectorAll(
      "div.artdeco-tabpanel ul li.artdeco-list__item > div[data-view-name=profile-component-entity]",
    ) || [],
  )?.map((e) => {
    return {
      profileUrl: e?.querySelector("div:nth-child(2) > div > a")?.href || "",
      name:
        cleanText(
          e?.querySelector(
            "div:nth-child(2) > div > a > div > div.display-flex > div > div > span.visually-hidden",
          )?.textContent,
        ) || "",
      tagline:
        cleanText(
          e?.querySelector(
            "div:nth-child(2) > div > a > span:nth-child(2) > span.visually-hidden",
          )?.textContent,
        ) || "",
      title:
        cleanText(
          e?.querySelector(
            "div:nth-child(2) > div > a > span.t-14.t-normal.t-black--light > span.visually-hidden",
          )?.textContent,
        ) || "",
      recommendation:
        cleanText(
          e?.querySelector(
            "div:nth-child(2) div.pvs-entity__sub-components span.visually-hidden",
          )?.textContent,
        ) || "",
    };
  });

  // ------------------ HONORS AND AWARDS ------------------
  data.honor_and_awards = Array?.from(
    document
      ?.querySelector("#honors_and_awards")
      ?.parentElement?.querySelectorAll(
        "div ul li > div[data-view-name=profile-component-entity]",
      ) || [],
  )?.map((e) => {
    return {
      title:
        cleanText(
          e?.querySelector(
            "div.display-flex.flex-column.full-width > div.full-height > div.display-flex > div > div > span",
          )?.textContent,
        ) || "",
      issuer:
        cleanText(
          e?.querySelector(
            "div.display-flex.flex-column.full-width >  span > span.visually-hidden",
          )?.textContent,
        ) || "",
    };
  });

  data.publicIdentifier = document.body?.textContent.match(
    /"publicIdentifier":"(.*?)"/,
  )?.[1];

  return data;
};

// Function to extract LinkedIn URN from URL
// Async because share-URL slugs require a Voyager API call to resolve the real backendUrn.
async function extractLinkedInURN(urnOrUrl) {
  if (!urnOrUrl) {
    return null;
  }

  // Normalize
  let postUrl = urnOrUrl.trim();

  // Decode URL if encoded
  try {
    postUrl = decodeURIComponent(postUrl);
  } catch (_) {}

  // Remove query params + hash
  postUrl = postUrl.split("?")[0].split("#")[0];

  // Direct URN
  const urnRegex = /urn:li:activity:(\d+)/i;
  const match = postUrl.match(urnRegex);

  if (match?.[1]) {
    return match[1];
  }

  // FSD update wrapper (e.g., urn:li:fsd_update:(urn:li:activity:123))
  const fsdMatch = postUrl.match(/urn:li:fsd_update:\(urn:li:activity:(\d+)/i);
  if (fsdMatch?.[1]) {
    return fsdMatch[1];
  }

  let url;

  try {
    url = new URL(postUrl);
  } catch {
    return null;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);

  // Handle:
  // /activity/123
  if (pathParts.includes("activity")) {
    const activityId = pathParts[pathParts.indexOf("activity") + 1];

    if (/^\d+$/.test(activityId)) {
      return activityId;
    }
  }

  // Handle:
  // activity-7279345078945361920
  const activityIndex = pathParts.findIndex((part) =>
    part.startsWith("activity-"),
  );

  if (activityIndex !== -1) {
    const activityPart = pathParts[activityIndex];

    const activityIdMatch = activityPart.match(/activity-(\d+)/i);

    if (activityIdMatch?.[1]) {
      return activityIdMatch[1];
    }
  }

  // Handle modern LinkedIn post URLs:
  // /posts/foo-bar-7462352719698219009-zAHx
  // But if the slug contains a non-activity type such as "-share-" or
  // "-ugcPost-", the embedded number is not the backend activity URN. Resolve
  // the real backendUrn via FeedSingleUpdateByPostSlug.
  const lastPart = pathParts[pathParts.length - 1] || "";

  const slugMatch = lastPart.match(/-(\d{10,})-(?:[\w]+)(?:\/|$)?/i);

  if (slugMatch?.[1]) {
    if (
      pathParts[0] === "posts" &&
      (lastPart.includes("-share-") || lastPart.includes("-ugcPost-"))
    ) {
      // lastPart is the full post slug, e.g. "krishankantchura_partnership-anchor-share-7464669124351315969-cKuX"
      try {
        const slugApiUrl =
          `https://www.linkedin.com/voyager/api/graphql` +
          `?variables=(likesCount:10,postSlug:${encodeURIComponent(lastPart)},commentsCount:10,moduleKey:feed-item%3Aphone)` +
          `&queryName=FeedSingleUpdateByPostSlug` +
          `&queryId=voyagerFeedDashUpdates.f432f1a78cd90a2e5465a7a093ad8fd1`;

        const res = await fetch(slugApiUrl, {
          method: "GET",
          headers: {
            Host: "www.linkedin.com",
            Connection: "Keep-Alive",
            Accept: "*",
            "Accept-Language": "en-US",
            "Csrf-Token": document.cookie
              .replace(
                /(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/,
                "$1",
              )
              .replace(/^["']|["']$/g, ""),
            "X-Li-Lang": "en_US",
            "X-Restli-Protocol-Version": "2.0.0",
            "x-li-graphql-pegasus-client": "true",
            "User-Agent": navigator.userAgent,
          },
          credentials: "include",
        });

        if (res.ok) {
          const json = await res.json();

          const backendUrn =
            json?.data?.feedDashUpdatesByPostSlug?.elements?.[0]?.metadata
              ?.backendUrn;
          const resolvedMatch = backendUrn?.match(/urn:li:activity:(\d+)/i);
          if (resolvedMatch?.[1]) {
            return resolvedMatch[1];
          }
        }
      } catch (err) {
        console.error("extractLinkedInURN: share slug resolution failed", err);
      }
      // Fall through to return the share ID as best-effort if API call failed
    }
    return slugMatch[1];
  }

  // Generic fallback:
  // extract any long numeric LinkedIn activity ID
  const genericMatch = postUrl.match(/\b(\d{18,20})\b/);

  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return null; // No URN found
}

const postScriptV2 = async () => {
  // Extract the profile URN from the document
  const ownProfileUrn = document?.body?.textContent
    ?.match(/"entityUrn":"(urn:li:fs_miniProfile:[^"]+)"/)?.[1]
    ?.replace("fs_miniProfile", "fsd_profile");
  const currentProfileUrn = document?.body?.textContent?.match(
    /(?<="*elements":\[")(urn:li:fsd_profile:[^"]+)/,
  )?.[1];
  const publicIdentifier = document.body?.textContent.match(
    /"publicIdentifier":"(.*?)"/,
  )?.[1];
  const uname = document
    .querySelector("#recent-activity-top-card a h3")
    ?.textContent?.trim();
  const profileUrl = document.querySelector(
    "#recent-activity-top-card a",
  )?.href;
  const tagline = document
    .querySelector("#recent-activity-top-card h4")
    ?.textContent?.trim();
  const pageUrl = window.location.href;
  const vanityName = window.location.href.match(
    /linkedin.com\/in\/(.*?)\//,
  )?.[1];

  // Function to parse post date from urn
  function parsePostDate(urn) {
    const timestamp = urn?.split(":").pop();
    if (!timestamp) return null;
    const binaryTimestamp = BigInt(timestamp).toString(2).slice(0, 41);
    const date = new Date(parseInt(binaryTimestamp, 2));
    return date;
  }

  // Function to check if post is a repost
  function isRepost(post) {
    return post?.header?.image?.attributes?.length > 0;
  }

  // Function to parse post format types (text, image, video, etc.)
  // Function to parse post format types (text, image, video, etc.)
  function parsePostFormatType(post, singlePost = false) {
    if (!post || typeof post !== "object") return []; // Handle invalid or undefined input

    const content = post?.content || {};
    const types = [];

    // Check for text-based commentary
    if (post?.commentary?.text?.text?.trim()) types.push("text");

    // Check if the post is a reshared post
    if (post?.resharedUpdate) types.push("reshared");

    // Check for specific post content types
    if (content["com.linkedin.voyager.feed.render.DocumentComponent"])
      types.push("carousel");
    if (content["com.linkedin.voyager.feed.render.ImageComponent"])
      types.push("image");
    if (
      content["com.linkedin.voyager.feed.render.VideoComponent"] ||
      content["com.linkedin.voyager.feed.render.LinkedInVideoComponent"]
    )
      types.push("video");
    if (content["com.linkedin.voyager.feed.render.ArticleComponent"])
      types.push("newsletter");
    if (content["com.linkedin.voyager.feed.render.PollComponent"])
      types.push("poll");

    return types;
  }

  // Function to get the Sec-Ch-Ua header
  function getSecChUaHeader() {
    const userAgentData = navigator.userAgentData || {};
    const brands = userAgentData.brands || [
      { brand: "Opera GX", version: "109" },
      { brand: "Not:A-Brand", version: "8" },
      { brand: "Chromium", version: "123" },
    ];

    return brands
      .map((brand) => `"${brand.brand}";v="${brand.version}"`)
      .join(", ");
  }

  // Function to fetch posts with pagination
  async function fetchProfilePosts(
    profileUrn,
    start,
    paginationToken,
    count = 100,
  ) {
    if (!profileUrn) {
      console.error("No profile URN provided");
      return { posts: [], paginationToken: null };
    }
    const apiUrl =
      "https://www.linkedin.com/voyager/api/identity/profileUpdatesV2";
    const params = new URLSearchParams({
      count: count.toString(),
      includeLongTermHistory: "true",
      moduleKey: "creator_profile_all_content_view:desktop",
      numComments: "0",
      profileUrn: profileUrn,
      q: "memberShareFeed",
      start: start.toString(),
    });

    if (paginationToken) {
      params.append("paginationToken", paginationToken);
    }

    try {
      const response = await fetch(`${apiUrl}?${params}`, {
        method: "GET",
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          "Csrf-Token": document.cookie
            .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
            .replace(/^["']|["']$/g, ""),
          Referer:
            `https://www.linkedin.com/in/${
              vanityName === "me" ? publicIdentifier : vanityName
            }/recent-activity/all/` || window.location.href,
          "Sec-Ch-Ua": getSecChUaHeader(),
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          "User-Agent": navigator.userAgent,
          "X-Li-Lang": "en_US",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        credentials: "include",
      });

      const data = await response.json();

      if (data?.elements?.length > 0) {
        return {
          posts: data.elements.map((e) => {
            return {
              name: e?.actor?.name?.text,
              profileUrl: `https://www.linkedin.com/in/${e?.actor?.name?.attributes[0]?.miniProfile?.publicIdentifier}`,
              postFeedUrl: `https://www.linkedin.com/feed/update/${e?.updateMetadata?.urn}`,
              postDate: parsePostDate(e?.updateMetadata?.urn)?.toISOString(),
              postDescription: e?.commentary?.text?.text,
              postType: parsePostFormatType(e),
              impressions:
                e?.socialDetail?.totalSocialActivityCounts?.numImpressions,
              likes: e?.socialDetail?.totalSocialActivityCounts?.numLikes,
              comments: e?.socialDetail?.totalSocialActivityCounts?.numComments,
              reposts: e?.socialDetail?.totalSocialActivityCounts?.numShares,
              numViews: e?.socialDetail?.totalSocialActivityCounts?.numViews,
              urn:
                e?.updateMetadata?.urn?.match(/urn:li:activity:(\d+)/i)?.[1] ||
                e?.updateMetadata?.urn,
              shareUrl: e?.socialContent?.shareUrl,
              vanityName:
                e?.actor?.name?.attributes[0]?.miniProfile?.publicIdentifier,
              // postDate: parsePostDate(e?.updateMetadata?.urn)?.toISOString(),
              // numComments: e?.socialDetail?.totalSocialActivityCounts?.numComments,
              // numLikes: e?.socialDetail?.totalSocialActivityCounts?.numLikes,
              // numShares: e?.socialDetail?.totalSocialActivityCounts?.numShares,
              // numImpressions: e?.socialDetail?.totalSocialActivityCounts?.numImpressions,
              // numViews: e?.socialDetail?.totalSocialActivityCounts?.numViews,
              // shareUrl: e?.socialContent?.shareUrl,
              // postFormatType: parsePostFormatType(e),
              // postContent: e?.commentary?.text?.text,
              // postUrl: `https://www.linkedin.com/feed/update/${e?.updateMetadata?.urn}`,
              isReposted: isRepost(e),
              // rawRes: e
            };
          }),
          paginationToken: data?.metadata?.paginationToken,
          rawRes: data,
        };
      } else {
        console.log("No posts found in the response");
        return { posts: [], paginationToken: null };
      }
    } catch (error) {
      console.error("Error fetching profile posts", error);
      return { posts: [], paginationToken: null };
    }
  }

  // Fetch all posts with pagination
  let allPosts = [],
    start = 0,
    hasMore = true,
    paginationToken = null;

  let latestPost = null;
  let lastSavedPostUrn = null;

  try {
    const response = await chrome.runtime.sendMessage({
      action: "bg-fetchLatestPost",
    });
    const { post, error } = response ?? {};
    if (error) throw new Error(error);
    latestPost = post ?? null;
    lastSavedPostUrn = latestPost
      ? await extractLinkedInURN(latestPost.postFeedUrl)
      : null;
  } catch (err) {
    console.error("Failed to get latest post:", err.message);
  }

  const pageSize = 100;

  // LinkedIn's new activity page no longer embeds the profile URN in the HTML; fall back to /voyager/api/me
  const profileUrn =
    currentProfileUrn ||
    ownProfileUrn ||
    `urn:li:fsd_profile:${userProfileUrn || (await getProfileUrnFromVoyager())}`;
  let owner = null;

  try {
    while (hasMore) {
      const { posts, paginationToken: newToken } = await fetchProfilePosts(
        profileUrn,
        start,
        paginationToken,
        pageSize,
      );

      owner ??= posts?.find((p) => p?.vanityName);

      if (posts && posts.length > 0) {
        // Filter out reposts from current batch and count remaining posts
        const filteredBatch = posts.filter(
          (e) => !e?.isReposted && e?.vanityName,
        );
        const filteredBatchCount = filteredBatch.length;

        // Always append the filtered batch first
        allPosts = [...allPosts, ...filteredBatch];

        // Check every batch for the checkpoint post
        if (latestPost) {
          const idx = allPosts.findIndex(
            (p) =>
              p?.postFeedUrl?.includes(lastSavedPostUrn) ||
              p?.urn?.includes(lastSavedPostUrn),
          );
          if (idx >= 0) {
            // Round up to the end of the current 30-post sending batch
            const sendBatchSize = 30;
            const batchEnd =
              Math.ceil((idx + 1) / sendBatchSize) * sendBatchSize;
            allPosts = allPosts.slice(0, batchEnd);
            hasMore = false;
            break;
          }
        }

        start += pageSize;
      } else {
        hasMore = false;
      }

      paginationToken = newToken;
      if (!paginationToken) {
        hasMore = false;
      }
    }

    return {
      posts: allPosts, // allPosts is already filtered
      identifier: {
        pageUrl: pageUrl,
        profileUrl: profileUrl || owner?.profileUrl,
        name: uname || owner?.name,
        publicIdentifier: publicIdentifier || owner?.vanityName,
        tagline: tagline,
      },
    }; // Return all fetched posts
  } catch (error) {
    console.error("Error fetching posts:", error);
    return []; // Return an empty array on error
  }
};

/**
 * Parses the PremiumDashLibraViewByTargetEntity response for audience demographics.
 * Returns an object keyed by schema field names (jobTitles, location, etc.)
 * where each value is an array of { value, percentage, numPercentage }.
 */
function helperToExtractAudienceDemographicsV3(json) {
  // Category enum → schema field name
  const CATEGORY_MAP = {
    STRUCTURED_TITLE_OCCUPATION: "jobTitles",
    REGION_GEO: "location",
    INDUSTRY: "industries",
    OCCUPATION_SENIORITY: "seniority",
    STAFF_COUNT_RANGE: "companySize",
    ORGANIZATION: "companies",
  };

  const result = {
    jobTitles: undefined,
    location: undefined,
    seniority: undefined,
    industries: undefined,
    companies: undefined,
    companySize: undefined,
  };

  const elements = json?.data?.premiumDashLibraViewByTargetEntity?.elements;
  if (!Array.isArray(elements) || elements.length === 0) return result;

  // Find the "Demographics of followers" element (or fall back to first)
  const demoElement =
    elements.find((el) => el?.title?.text === "Demographics of followers") ??
    elements[0];

  // Walk cards → components → barChartList.barCharts[]
  const barCharts = [];
  for (const card of demoElement?.card ?? []) {
    for (const component of card?.components ?? []) {
      const charts =
        component?.leiaComponent?.customComponent?.creatorComponent
          ?.barChartList?.barCharts ?? [];
      barCharts.push(...charts);
    }
  }

  for (const chart of barCharts) {
    const key = CATEGORY_MAP[chart?.category];
    if (!key) continue;

    result[key] = (chart?.dataPoints ?? [])
      .map((dp) => ({
        value: dp?.xLabel?.text ?? null,
        percentage: dp?.yFormattedValue?.text ?? null,
        numPercentage: typeof dp?.yPercent === "number" ? dp.yPercent : null,
      }))
      .filter((d) => d.value !== null);
  }

  return result;
}

async function fetchAudienceDemographicsV3(profileUrn) {
  try {
    const headers = {
      Host: "www.linkedin.com",
      Connection: "Keep-Alive",
      "Accept-Language": "en-US",
      "Csrf-Token": document.cookie
        .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
        .replace(/^["']|["']$/g, ""),
      "X-Li-Lang": "en_US",
      Accept: "application/json",
      Cookie: document.cookie,
      "User-Agent": navigator.userAgent,
      "Accept-Encoding": "gzip, deflate, br",
      "X-RestLi-Protocol-Version": "2.0.0",
      "x-li-graphql-pegasus-client": "false",
    };

    const response = await fetch(
      `https://www.linkedin.com/voyager/api/graphql?variables=(product:CREATOR_AUDIENCE_DEMOGRAPHIC_DETAIL,query:(selectedFilters:(metricType:List(MEMBER_FOLLOWERS))),targetEntityUrn:urn%3Ali%3Afsd_profile%3A${profileUrn})&queryName=PremiumDashLibraViewByTargetEntity&queryId=voyagerPremiumDashLibraView.7998722e438f59f806a453cb67db71ab`,
      {
        method: "GET",
        headers: headers,
        credentials: "include",
      },
    );
    if (!response.ok) {
      //Report this error to Lark Alerts using the reporter function
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const audienceData = await response.json();
    if (audienceData && audienceData.data) {
      return audienceData;
    }
  } catch (err) {
    console.error("Error fetching audience demographics:", err);
    //Call reporter function to log this error to Lark Alerts
    throw err;
  }
}

const audienceScriptV3 = async () => {
  const pageUrl = window.location.href;
  const publicIdentifier = document.body?.textContent.match(
    /"publicIdentifier":"(.*?)"/,
  )?.[1];

  const duragun = await getProfileUrnFromVoyager();
  console.log("Duragun Profile URN: ", duragun);
  const data = {
    jobTitles: undefined,
    location: undefined,
    seniority: undefined,
    industries: undefined,
    companies: undefined,
    companySize: undefined,
    page_url: pageUrl,
    publicIdentifier: publicIdentifier || "",
  };

  if (!userProfileUrn) {
    console.error("No profile URN found in page");
    //Call reporter function to log this error to Lark Alerts
    return data;
  }

  try {
    const rawData = await fetchAudienceDemographicsV3(userProfileUrn);
    const demographics = helperToExtractAudienceDemographicsV3(rawData);

    Object.assign(data, demographics);

    // console.log("Daniel AudienceDemographicsV3 Data: ", data);
  } catch (error) {
    console.error("Error fetching audience demographics:", error);
    //Call reporter function to log this error to Lark Alerts
  }

  // const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // await sleep(60000);
  //In case the profile scraping failed with the profileScript function then we fallback to voyager API
  if (
    typeof isProfileScrapingFailed !== "undefined" &&
    isProfileScrapingFailed
  ) {
    await profileScriptViaVoyager();
  }

  return data;
};

/**
 * Extracts engagement and discovery metrics from LinkedIn post analytics data
 * @param {Array} data - The LinkedIn API response array
 * @returns {Object} Object containing engagement and discovery metrics
 */

// Map categories to our result keys
const categoryMap = {
  STRUCTURED_TITLE_OCCUPATION: "jobTitles",
  REGION_GEO: "location",
  OCCUPATION_SENIORITY: "seniority",
  INDUSTRY: "industries",
  ORGANIZATION: "companies",
  STAFF_COUNT_RANGE: "companySize",
};
function getSecChUaHeader() {
  const userAgentData = navigator.userAgentData || {};
  const brands = userAgentData.brands || [
    { brand: "Opera GX", version: "109" },
    { brand: "Not:A-Brand", version: "8" },
    { brand: "Chromium", version: "123" },
  ];

  return brands
    .map((brand) => `"${brand.brand}";v="${brand.version}"`)
    .join(", ");
}
function extractLinkedInMetrics(data) {
  if (!Array.isArray(data)) {
    throw new Error("Input must be an array");
  }

  // Initialize metrics object with default values
  const metrics = {
    engagement: {
      reactions: 0,
      comments: 0,
      reposts: 0,
      saves: 0,
      sendsOnLinkedIn: 0,
    },
    discovery: {
      impressions: 0,
      membersReached: 0,
    },
    linkEngagement: {
      totalLinkClicks: 0,
      links: [],
    },
  };

  try {
    // Extract engagement metrics (reactions, comments, reposts)
    const engagementCard = data.find(
      (item) =>
        item?.$type ===
          "com.linkedin.voyager.dash.edgeinsightsanalytics.Card" &&
        item?.component?.summary?.detail?.ctaList?.items?.length > 0,
    );

    if (engagementCard?.component?.summary?.detail?.ctaList?.items) {
      const items = engagementCard.component.summary.detail.ctaList.items;

      items.forEach((item) => {
        const title = item?.title?.toLowerCase();
        const value = parseInt(item?.text) || 0;

        switch (title) {
          case "reactions":
            metrics.engagement.reactions = value;
            break;
          case "comments":
            metrics.engagement.comments = value;
            break;
          case "reposts":
            metrics.engagement.reposts = value;
            break;
          case "saves":
            metrics.engagement.saves = value;
            break;
          case "sends on linkedin":
            metrics.engagement.sendsOnLinkedIn = value;
            break;
        }
      });
    }

    // Extract discovery metrics (impressions, members reached)
    const discoveryCard = data.find(
      (item) =>
        item?.$type ===
          "com.linkedin.voyager.dash.edgeinsightsanalytics.Card" &&
        item?.components?.[0]?.summary?.keyMetrics?.items?.length > 0,
    );

    if (discoveryCard?.components?.[0]?.summary?.keyMetrics?.items) {
      const items = discoveryCard.components[0].summary.keyMetrics.items;

      items.forEach((item) => {
        const description = item?.description?.text?.toLowerCase();
        // Remove commas and convert to number
        const value = parseInt(item?.title?.text?.replace(/,/g, "")) || 0;

        switch (description) {
          case "impressions":
            metrics.discovery.impressions = value;
            break;
          case "members reached":
            metrics.discovery.membersReached = value;
            break;
        }
      });
    }

    // Extract link engagement metrics (link clicks and URLs)
    const linkEngagementCard = data.find(
      (item) =>
        item?.$type ===
          "com.linkedin.voyager.dash.edgeinsightsanalytics.Card" &&
        item?.entityUrn?.includes("LINK_INTERACTIONS") &&
        item?.components?.[0]?.customComponent?.creatorComponent?.metricRowList
          ?.items?.length > 0,
    );

    if (
      linkEngagementCard?.components?.[0]?.customComponent?.creatorComponent
        ?.metricRowList?.items
    ) {
      const items =
        linkEngagementCard.components[0].customComponent.creatorComponent
          .metricRowList.items;

      items.forEach((item) => {
        const title = item?.title?.text?.toLowerCase();
        const url = item?.subtitle?.text;
        const clicks = parseInt(item?.value) || 0;

        if (title?.includes("visits to links") && clicks > 0) {
          metrics.linkEngagement.links.push({
            url: url,
            clicks: clicks,
          });
          metrics.linkEngagement.totalLinkClicks += clicks;
        }
      });
    }

    // Validate that we found at least some data
    const hasEngagement = Object.values(metrics.engagement).some(
      (val) => val > 0,
    );
    const hasDiscovery = Object.values(metrics.discovery).some(
      (val) => val > 0,
    );
    const hasLinkEngagement = metrics.linkEngagement.totalLinkClicks > 0;

    if (!hasEngagement && !hasDiscovery && !hasLinkEngagement) {
      throw new Error("No valid metrics found in the data");
    }

    return metrics;
  } catch (error) {
    throw new Error(`Error extracting metrics: ${error.message}`);
  }
}

function parseLinkedInDemographics(data) {
  // Get the bar charts from the nested structure
  const barCharts =
    data[0]?.components[0]?.customComponent?.creatorComponent?.barChartList
      ?.barCharts;

  if (!barCharts) {
    throw new Error("Invalid data structure");
  }

  // Initialize the result object with the required structure
  const result = {
    jobTitles: [],
    location: [],
    seniority: [],
    industries: [],
    companies: [],
    companySize: [],
  };

  // Process each bar chart
  barCharts.forEach((chart) => {
    const category = categoryMap[chart.category];
    if (category) {
      // Map data points to the required format
      const mappedData = chart.dataPoints.map((point) => ({
        value: point.xLabel.text,
        percentage: point.yFormattedValue.text,
      }));
      result[category] = mappedData;
    }
  });

  return result;
}

// Helper function to extract percentage from formatted string
const extractPercentage = (formattedValue) => {
  const match = formattedValue?.text?.match(/\d+/);
  return match ? `${match[0]}%` : "0%";
};

// Helper function to safely extract label text
const getLabel = (dataPoint) => {
  return dataPoint?.xLabel?.text || "Unknown";
};

// Helper function to process data points
const processDataPoints = (dataPoints = []) => {
  return dataPoints.map((point) => ({
    value: getLabel(point),
    percentage: extractPercentage(point.yFormattedValue),
  }));
};

// Helper function to find the bar chart module in the response
const findBarChartModule = (response) => {
  if (!response || !Array.isArray(response)) return null;
  const card = response.find((item) => item?.component?.barChartModule);
  return card?.component?.barChartModule;
};

// Main function to fetch demographics data
/**+
 * Fetches demographics data from LinkedIn for a given post using the provided access token.
 * The function makes asynchronous requests to the LinkedIn GraphQL API to retrieve metrics and demographic data.
 *
 * @param {string} postId - The ID of the LinkedIn post for which to fetch demographics data.
 * @param {string} accessToken - The access token required to authenticate the API requests.
 *+
 * @returns {Promise<Object>} A promise that resolves to an object containing the fetched demographics data.
 * The object has the following structure:
 * {
 *   likes: {
 *     jobTitles: Array<{ value: string, percentage: string }>,
 *     location: Array<{ value: string, percentage: string }>,
 *     seniority: Array<{ value: string, percentage: string }>,
 *     industries: Array<{ value: string, percentage: string }>,
 *     companies: Array<{ value: string, percentage: string }>,
 *     companySize: Array<{ value: string, percentage: string }>,
 *   },
 *   impressions: { ... },
 *   comments: { ... },
 *   reshares: { ... },
 * }
 *
 * Each metric (likes, impressions, comments, reshares) contains demographic data for the specified dimension types.
 * The data points are represented as objects with 'value' and 'percentage' properties.
 *
 * If an error occurs during the API requests, the function logs the error and returns an empty array for the corresponding metric and dimension type.
 */
async function fetchLinkedInDemographics(postUrn) {
  const baseUrl = "https://www.linkedin.com/voyager/api/graphql";
  const metrics = ["REACTIONS", "IMPRESSIONS", "COMMENTS", "RESHARES"];
  const dimensionTypes = {
    STRUCTURED_TITLE_OCCUPATION: "jobTitles",
    REGION_GEO: "location",
    OCCUPATION_SENIORITY: "seniority",
    INDUSTRY: "industries",
    ORGANIZATION: "companies",
    STAFF_COUNT_RANGE: "companySize",
  };

  const referer = `https://www.linkedin.com/analytics/post/urn:li:activity:7240296448490151936/?resultType=REACTIONS`;

  const headers = {
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: document.cookie,
    "Csrf-Token": document.cookie
      .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
      .replace(/^["']|["']$/g, ""),
    Referer: referer,
    "Sec-Ch-Ua": getSecChUaHeader(),
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": navigator.userAgent,
    "X-Li-Lang": "en_US",
    "x-li-track":
      '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
    "X-Restli-Protocol-Version": "2.0.0",
  };

  const cardUrn = `urn:li:fsd_edgeInsightsAnalyticsCard:(POST,urn:li:activity:${postUrn},ANALYTICS,DETAILS,1)`;
  const results = {};

  for (const metric of metrics) {
    const metricKey = metric.toLowerCase().replace("reactions", "likes");
    results[metricKey] = {};

    for (const [dimensionType, resultKey] of Object.entries(dimensionTypes)) {
      try {
        const params = `variables=(dimensionType:${dimensionType},edgeInsightsAnalyticsCardUrns:List(urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28POST%2Curn%3Ali%3Aactivity%3A${postUrn}%2CANALYTICS%2CDETAILS%2C1%29),query:(selectedFilters:List((key:resultType,value:List(${metric})))))&queryId=voyagerPremiumDashAnalyticsCard.eaf1b7e22d8693e353e2dd99d884de7f`;
        const response = await fetch(
          `https://www.linkedin.com/voyager/api/graphql?variables=(dimensionType:${dimensionType},edgeInsightsAnalyticsCardUrns:List(urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28POST%2Curn%3Ali%3Aactivity%3A${postUrn}%2CANALYTICS%2CDETAILS%2C1%29),query:(selectedFilters:List((key:resultType,value:List(${metric})))))&queryId=voyagerPremiumDashAnalyticsCard.148196387b0d370698517fefeced746b`,
          {
            method: "GET",
            headers: headers,
            credentials: "include",
          },
        );

        const data = await response.json();
        const barChartModule = findBarChartModule(data?.included);

        if (barChartModule && barChartModule.dataPoints) {
          results[metricKey][resultKey] = processDataPoints(
            barChartModule.dataPoints,
          );
        } else {
          results[metricKey][resultKey] = [];
        }
      } catch (error) {
        console.error(
          `Error fetching ${metric} data for ${dimensionType}:`,
          error,
        );
        results[metricKey][resultKey] = [];
      }
    }
  }

  return results;
}

async function fetchPostMetricsV3(urnofPost) {
  try {
    const headers = {
      Host: "www.linkedin.com",
      Connection: "Keep-Alive",
      "Accept-Language": "en-US",
      "Csrf-Token": document.cookie
        .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
        .replace(/^["']|["']$/g, ""),
      "X-Li-Lang": "en_US",
      Accept: "application/json",
      Cookie: document.cookie,
      "User-Agent": navigator.userAgent,
      "Accept-Encoding": "gzip, deflate, br",
      "X-RestLi-Protocol-Version": "2.0.0",
      "x-li-graphql-pegasus-client": "false",
    };

    const response = await fetch(
      `https://www.linkedin.com/voyager/api/graphql?variables=(surfaceType:POST_SUMMARY,query:(selectedFilters:()),analyticsEntityUrn:(activityUrn:urn%3Ali%3Aactivity%3A${urnofPost}))&queryName=ViewWithSectionsAndNoFilters&queryId=voyagerPremiumDashAnalyticsView.59b1ce0d489f99502a74d472146d49a5`,
      {
        method: "GET",
        headers: headers,
        credentials: "include",
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const postSummary = await response.json();
    if (postSummary && postSummary.data) {
      return postSummary;
    }
  } catch (err) {
    console.error("Error fetching post summary:", err);
    throw err;
  }
}

const postSummaryScriptV3 = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  //Extract post URN from the URL

  const urlParts = window.location.href.split("/");
  const postUrnPart = urlParts.find((part) =>
    part.startsWith("urn:li:activity:"),
  );
  const fullPostUrn = postUrnPart ? postUrnPart : null;

  let parentPostData = null;

  // Fetch parent post data with error handling
  // try {
  //   parentPostData = await postSummaryScript();
  // } catch (error) {
  //   console.error("Error fetching parent post data:", error);
  //   // Return minimal data structure if parent data fetch fails
  //   return {
  //     postData: {
  //       demographics: { jobTitles: undefined, locations: undefined },
  //       demographicsV2: null,
  //     },
  //   };
  // }

  // console.log("Daniel Parent post data fetched successfully:", parentPostData);

  const partPostUrn = fullPostUrn?.split(":");

  const postUrn = partPostUrn?.[3];

  if (!postUrn || postUrn === undefined || postUrn === "") {
    console.error("Invalid post URN");
    //Call reporter function to log this error to Lark Alerts
    return {
      postData: {
        demographics: { jobTitles: undefined, locations: undefined },
        demographicsV2: null,
      },
    };
  }

  async function fetchPostMetricsV3(urnofPost) {
    try {
      const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${urnofPost}/`;
      const headers = {
        Host: "www.linkedin.com",
        Connection: "Keep-Alive",
        "Accept-Language": "en-US",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "X-Li-Lang": "en_US",
        Accept: "application/json",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        "Accept-Encoding": "gzip, deflate, br",
        "X-RestLi-Protocol-Version": "2.0.0",
        "x-li-graphql-pegasus-client": "false",
      };

      const response = await fetch(
        `https://www.linkedin.com/voyager/api/graphql?variables=(surfaceType:POST_SUMMARY,query:(selectedFilters:()),analyticsEntityUrn:(activityUrn:urn%3Ali%3Aactivity%3A${urnofPost}))&queryName=ViewWithSectionsAndNoFilters&queryId=voyagerPremiumDashAnalyticsView.59b1ce0d489f99502a74d472146d49a5`,
        {
          method: "GET",
          headers: headers,
          credentials: "include",
        },
      );
      if (!response.ok) {
        //Report this error to Lark Alerts using the reporter function
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const postSummary = await response.json();
      if (postSummary && postSummary.data) {
        return postSummary;
      }
    } catch (err) {
      console.error("Error fetching post summary:", err);
      //Call reporter function to log this error to Lark Alerts
      throw err;
    }
  }

  async function fetchPostDemographicsV3(urnofPost) {
    try {
      const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${urnofPost}/`;
      const headers = {
        Host: "www.linkedin.com",
        Connection: "Keep-Alive",
        "Accept-Language": "en-US",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "X-Li-Lang": "en_US",
        Accept: "application/json",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        "Accept-Encoding": "gzip, deflate, br",
        "X-RestLi-Protocol-Version": "2.0.0",
        "x-li-graphql-pegasus-client": "false",
      };

      const response = await fetch(
        `https://www.linkedin.com/voyager/api/graphql?variables=(surfaceType:POST_SUMMARY_DEMOGRAPHIC_DETAIL,query:(selectedFilters:(metricType:List(IMPRESSIONS))),analyticsEntityUrn:(activityUrn:urn%3Ali%3Aactivity%3A${urnofPost}))&queryName=FullView&queryId=voyagerPremiumDashAnalyticsView.74bf0e9637b9cd1142bfb8ef61bd0195`,
        {
          method: "GET",
          headers: headers,
          credentials: "include",
        },
      );
      if (!response.ok) {
        //Report this error to Lark Alerts using the reporter function
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const postDemographics = await response.json();
      if (postDemographics && postDemographics.data) {
        return postDemographics;
      }
    } catch (err) {
      console.error("Error fetching audience demographics:", err);
      //Call reporter function to log this error to Lark Alerts
      throw err;
    }
  }

  async function fetchEngagementDemographicsV3(
    urnofPost,
    engagementType = "reactions",
  ) {
    try {
      // Map engagement type → LinkedIn's resultType enum
      const RESULT_TYPE = {
        reactions: "REACTIONS",
        comments: "COMMENTS",
      };
      const resultType = RESULT_TYPE[engagementType];
      if (!resultType) {
        throw new Error(`Unsupported engagementType: ${engagementType}`);
      }

      // Dimensions to fetch. Comments don't have a REACTION breakdown.
      const DIMENSIONS = [
        "REACTION",
        "STRUCTURED_TITLE_OCCUPATION",
        "REGION_GEO",
        "INDUSTRY",
        "OCCUPATION_SENIORITY",
        "STAFF_COUNT_RANGE",
      ];
      const dimensions =
        engagementType === "comments"
          ? DIMENSIONS.filter((d) => d !== "REACTION")
          : DIMENSIONS;

      const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${urnofPost}/`;
      const headers = {
        Host: "www.linkedin.com",
        Connection: "Keep-Alive",
        "Accept-Language": "en-US",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "X-Li-Lang": "en_US",
        Accept: "application/json",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        "Accept-Encoding": "gzip, deflate, br",
        "X-RestLi-Protocol-Version": "2.0.0",
        "x-li-graphql-pegasus-client": "false",
      };

      const buildUrl = (dimensionType) => {
        return (
          `https://www.linkedin.com/voyager/api/graphql` +
          `?variables=(dimensionType:${dimensionType},` +
          `edgeInsightsAnalyticsCardUrn:urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28POST%2Curn%3Ali%3Aactivity%3A${urnofPost}%2CANALYTICS%2CDETAILS%2C1%29,` +
          `query:(selectedFilters:(resultType:List(${resultType}))))` +
          `&queryName=PremiumAnalyticsCardById` +
          `&queryId=voyagerPremiumDashAnalyticsCard.cfe0f861ff1a19219ddf6642dd522392`
        );
      };

      // Fire all dimension calls in parallel
      const settled = await Promise.allSettled(
        dimensions.map(async (dimensionType) => {
          const response = await fetch(buildUrl(dimensionType), {
            method: "GET",
            headers: headers,
            credentials: "include",
          });

          if (!response.ok) {
            throw new Error(
              `HTTP error for ${dimensionType}! status: ${response.status}`,
            );
          }

          const json = await response.json();
          if (json && json.data) {
            return { engagementType, dimensionType, data: json };
          }
          throw new Error(`Empty data for ${dimensionType}`);
        }),
      );

      // Collect successes; log failures without killing the whole batch
      const results = [];
      for (const s of settled) {
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          console.error(
            "Error fetching engagement demographic:",
            s.reason?.message,
          );
          //Call reporter function to log this error to Lark Alerts
        }
      }

      return results;
    } catch (err) {
      console.error("Error fetching engagement demographics:", err);
      //Call reporter function to log this error to Lark Alerts
      throw err;
    }
  }

  async function fetchLinkEngagementV3(urnofPost) {
    try {
      const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${urnofPost}/`;
      const headers = {
        Host: "www.linkedin.com",
        Connection: "Keep-Alive",
        "Accept-Language": "en-US",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "X-Li-Lang": "en_US",
        Accept: "application/json",
        Cookie: document.cookie,
        "User-Agent": navigator.userAgent,
        "Accept-Encoding": "gzip, deflate, br",
        "X-RestLi-Protocol-Version": "2.0.0",
        "x-li-graphql-pegasus-client": "false",
      };

      const response = await fetch(
        `https://www.linkedin.com/voyager/api/graphql?variables=(product:CREATOR_LINK_CLICKS_DETAIL,query:(selectedFilters:()),targetEntityUrn:urn%3Ali%3Aactivity%3A${urnofPost})&queryName=PremiumDashLibraViewByTargetEntity&queryId=voyagerPremiumDashLibraView.7998722e438f59f806a453cb67db71ab`,
        {
          method: "GET",
          headers: headers,
          credentials: "include",
        },
      );
      if (!response.ok) {
        //Report this error to Lark Alerts using the reporter function
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const linkEngagement = await response.json();
      if (linkEngagement && linkEngagement.data) {
        return linkEngagement;
      }
    } catch (err) {
      console.error("Error fetching link engagement:", err);
      //Call reporter function to log this error to Lark Alerts
      throw err;
    }
  }

  async function fetchImpressionsBreakdownViaSdui(urnofPost) {
    const response = await fetch(SDUI_SLOW_METRICS_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/x-protobuf",
        "Content-Type": "application/x-protobuf",
        "Csrf-Token": document.cookie
          .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
          .replace(/^["']|["']$/g, ""),
        "X-Li-Lang": "en_US",
        "X-RestLi-Protocol-Version": "2.0.0",
      },
      body: sduiEncodeSlowMetricsBody(urnofPost),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return sduiDecodeProtobuf(new Uint8Array(buffer));
  }

  try {
    const data = await fetchPostMetricsV3(postUrn);

    // console.log("Daniel PostMetricsV3 Raw Data: ", data);

    // console.log(
    //   "Daniel PostMetricsV3 Data: ",
    //   helperToExtractEngagementFromPostSummaryV3(data),
    // );

    // await sleep(300000);

    const metricsData = helperToExtractEngagementFromPostSummaryV3(data);

    /*
{
    "impressions": 468,
    "memberReach": 145,
    "likes": 11,
    "comments": 0,
    "reposts": 1,
    "saves": 0,
    "sendsOnLinkedIn": 0,
    "postContent": "𝟭𝟮𝟴 𝗺𝗶𝗹𝗹𝗶𝗼𝗻 𝗩𝗦 𝗖𝗼𝗱𝗲 𝘂𝘀𝗲𝗿𝘀 𝗲𝘅𝗽𝗼𝘀𝗲𝗱 𝘁𝗵𝗿𝗼𝘂𝗴𝗵 𝗽𝗼𝗽𝘂𝗹𝗮𝗿 𝗲𝘅𝘁𝗲𝗻𝘀𝗶𝗼𝗻𝘀\n\nCritical flaws found in Live Server, Code Runner, Markdown Preview Enhanced, and Microsoft Live Preview.\n\n𝗧𝗵𝗲 𝗮𝘁𝘁𝗮𝗰𝗸𝘀:\n- Click a bad link while Live Server runs → attacker steals your local files\n- Paste malicious config into settings.json → remote code execution\n- Open a crafted .md file → JavaScript runs automatically\n\n𝗧𝗵𝗲 𝗽𝗿𝗼𝗯𝗹𝗲𝗺:\nDeveloper machines have API keys, database creds, SSH keys, env variables. One compromised extension = full org access.\n\n𝗪𝗼𝗿𝘀𝗲:\nReported in June 2025. Three maintainers never responded. Still unpatched.\n\n𝗙𝗶𝘅: Audit your extensions. Delete what you don't use. Don't paste random config snippets.\n\nYour IDE isn't safe by default anymore.",
    "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7430880351222185984",
    "pageUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7430880351222185984",
    "postUrn": "urn:li:activity:7430880351222185984",
    "profileUrl": "https://www.linkedin.com/in/yash-x-anchors",
    "imageContentLink": "https://media.licdn.com/dms/image/v2/D5622AQGhtYsXamerxA/feedshare-shrink_2048_1536/B56Zx_KTFQKMAk-/0/1771659932257?e=1778112000&v=beta&t=Z8li_2EuyHfvFeIwTfFOytj_l-z4V2zdXtBXGtMila0"
}
    */

    parentPostData = {
      postData: {
        postUrl: metricsData?.postUrl,
        postContent: metricsData?.postContent,
        imageContentLink: metricsData?.imageContentLink,
        impressions: metricsData?.impressions ?? null,
        memberReach: metricsData?.memberReach ?? null,
        pageUrl: metricsData?.pageUrl,
        profileUrl: metricsData?.profileUrl,
        postUrn: metricsData?.postUrn,
      },
    };

    //Init path
    parentPostData.postData.demographicsV2 =
      parentPostData.postData.demographicsV2 || {};

    parentPostData.postData.demographicsV2.metricsData =
      parentPostData.postData.demographicsV2.metricsData || {};
    //---------

    parentPostData.postData.demographicsV2.metricsData.engagement = {
      reactions: metricsData?.likes ?? null,
      comments: metricsData?.comments ?? null,
      reposts: metricsData?.reposts ?? null,
      saves: metricsData?.saves ?? null,
      sendsOnLinkedIn: metricsData?.sendsOnLinkedIn ?? null,
    };

    // The network split is the only post-summary metric Voyager doesn't return.
    // Primary source is the SDUI action API; the DOM read is the fallback for
    // when that call fails or comes back without the slot. Both yield null
    // rather than throwing, so this is never fatal to the rest of the payload.
    let impressionsBreakdown = {
      inNetworkPercentage: null,
      outOfNetworkPercentage: null,
    };

    try {
      impressionsBreakdown = helperToExtractImpressionsBreakdownFromSdui(
        await fetchImpressionsBreakdownViaSdui(postUrn),
      );
    } catch (err) {
      console.warn("SDUI impressions breakdown failed:", err?.message);
    }

    if (
      impressionsBreakdown.inNetworkPercentage === null &&
      impressionsBreakdown.outOfNetworkPercentage === null
    ) {
      impressionsBreakdown = await helperToExtractImpressionsBreakdownFromDom();
    }

    parentPostData.postData.demographicsV2.metricsData.discovery = {
      impressions: metricsData?.impressions ?? null,
      membersReached: metricsData?.memberReach ?? null,
      inNetworkPercentage: impressionsBreakdown.inNetworkPercentage,
      outOfNetworkPercentage: impressionsBreakdown.outOfNetworkPercentage,
    };

    parentPostData.postData.demographicsV2.metricsData.profileActivity = {
      profileViewers: metricsData?.profileViewers ?? null,
      followersGained: metricsData?.followersGained ?? null,
    };

    if (
      parentPostData?.postData?.impressions === null ||
      parentPostData?.postData?.impressions === undefined
    ) {
      parentPostData.postData.impressions = metricsData?.impressions ?? null;
    }

    const data2 = await fetchPostDemographicsV3(postUrn);

    // console.log(
    //   "Daniel PostDemographicsV3 Data: ",
    //   helperToExtractDemographicsFromPostSummaryV3(data2),
    // );

    const DemographicsData =
      helperToExtractDemographicsFromPostSummaryV3(data2);

    parentPostData.postData.demographicsV2.DemographicsData = DemographicsData;

    // --- Engagement Demographics (Reactions + Comments breakdown) ---
    const [reactionResponses, commentResponses] = await Promise.all([
      fetchEngagementDemographicsV3(postUrn, "reactions"),
      fetchEngagementDemographicsV3(postUrn, "comments"),
    ]);

    const EngagementDemographics = helperToBuildEngagementDemographicsV3([
      ...reactionResponses,
      ...commentResponses,
    ]);

    EngagementDemographics.impressions = DemographicsData;

    // console.log("Daniel Engagement Demographics: ", EngagementDemographics);

    parentPostData.postData.demographicsV2.EngagementDemographics =
      EngagementDemographics;

    // --- Link Engagement ---
    const linkData = await fetchLinkEngagementV3(postUrn);

    const linkEngagement = helperToExtractLinkEngagementV3(linkData);

    parentPostData.postData.demographicsV2.metricsData.linkEngagement =
      linkEngagement;

    // console.log("Daniel Parent Post Data: ", parentPostData);
    // await sleep(300000);
  } catch (error) {
    console.error("Daniel Error fetching post metrics:", error);
    //Call reporter function to log this error to Lark Alerts
    return parentPostData; // Return whatever was built before the failure
  }

  return parentPostData;
};

// utils and helper functions -------------------
const getQueryParams = () => {
  const params = new URLSearchParams(window.location.search);
  const queryParams = {};
  for (const [key, value] of params.entries()) {
    queryParams[key] = value;
  }
  return queryParams;
};

function checkLogin() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "bg-checkLogin" }, (response) => {
      resolve(response);
    });
  });
}

// saving and fetching data from script ---------------

function showSyncConfirmationDialog(name, profileImage) {
  return new Promise((resolve) => {
    const dialogId = "gp__sync_confirm_dialog";
    if (document.getElementById(dialogId)) {
      document.getElementById(dialogId).remove();
    }

    const avatarHtml = profileImage
      ? `<img src="${profileImage}" alt="${name}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid #3B82F6;">`
      : `<div style="width:72px;height:72px;border-radius:50%;background:#3B82F6;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;border:3px solid #60A5FA;">${name ? name.charAt(0).toUpperCase() : "?"}</div>`;

    const html = `
      <div id="${dialogId}" style="position:fixed;inset:0;z-index:10000000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);">
        <div style="background:#1C1C1C;border:1px solid #2E2E2E;border-radius:16px;padding:36px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
          <div style="display:flex;justify-content:center;margin-bottom:20px;">
            ${avatarHtml}
          </div>
          <p style="margin:0 0 6px;color:#A3A3A3;font-size:13px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;">LinkedIn Profile</p>
          <h2 style="margin:0 0 10px;color:#FFFFFF;font-size:20px;font-weight:700;line-height:1.3;">${name}</h2>
          <p style="margin:0 0 28px;color:#A3A3A3;font-size:14px;line-height:1.6;">Is this your profile? Please confirm to proceed with syncing.</p>
          <div style="display:flex;gap:12px;">
            <button id="gp__sync_cancel" style="flex:1;padding:12px 0;border-radius:8px;border:1px solid #3E3E3E;background:transparent;color:#D4D4D4;font-size:14px;font-weight:600;cursor:pointer;transition:background 0.2s;">Cancel</button>
            <button id="gp__sync_confirm" style="flex:1;padding:12px 0;border-radius:8px;border:none;background:#3B82F6;color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:background 0.2s;">Yes, Sync Now</button>
          </div>
        </div>
      </div>`;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const overlay = document.getElementById("gp__overlay");
    (overlay || document.body).appendChild(wrapper);

    const dialog = document.getElementById(dialogId);
    const confirmBtn = document.getElementById("gp__sync_confirm");
    const cancelBtn = document.getElementById("gp__sync_cancel");

    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.background = "#2563EB";
    });
    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.background = "#3B82F6";
    });
    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "#2E2E2E";
    });
    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "transparent";
    });

    confirmBtn.addEventListener("click", () => {
      dialog.remove();
      resolve(true);
    });

    cancelBtn.addEventListener("click", () => {
      dialog.remove();
      resolve(false);
    });
  });
}

async function profileFetchNsave() {
  // console.log('Fetching profile...');

  initializeProfileUrn();

  const data = await profileScript();

  if (data && data?.name) {
    // console.log("profile fetched", data);
    if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
      await chrome.runtime.sendMessage({ action: "bg-saveGuestProfile", data });
    } else {
      await chrome.runtime.sendMessage({ action: "bg-saveProfile", data });
    }

    // console.log(`${data?.name}'s profile saved!`);
    isProfileScrapingFailed = false;
    await clearProfileScrapeFailFlag();
  } else {
    //Mark the profile scraping as failed so that later we can fallback to the voyager method

    isProfileScrapingFailed = true;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [PROFILE_SCRAPE_FAIL_KEY]: true }, () => {
        if (chrome.runtime.lastError) {
          console.log(
            "Error saving profile scrape flag:",
            chrome.runtime.lastError,
          );
        }
        resolve();
      });
    });

    initializeProfileUrn();
    await profileScriptViaVoyager();
  }

  // console.log('Profile fetch and save completed');
}

async function postsScrollNSave() {
  // console.log('Fetching posts...');

  // const data = await postScript();
  const data = await postScriptV2();

  if (data?.posts.length > 0) {
    // console.log('Posts fetched', data);
    if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
      await chrome.runtime.sendMessage({ action: "bg-saveGuestPosts", data });
    } else {
      await chrome.runtime.sendMessage({ action: "bg-savePosts", data });
    }

    // console.log('Posts saved!');
  }

  // console.log('Posts fetch and save completed');
  return data;
}

async function saveTAudienceDemographics() {
  // console.log('Fetching audience demographics...');

  // const data = await audienceScriptV2();
  const data = await audienceScriptV3();

  if (data) {
    // console.log('Audience demographics fetched', data);
    if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
      await chrome.runtime.sendMessage({
        action: "bg-saveGuestDemographics",
        data,
      });
    } else {
      await chrome.runtime.sendMessage({
        action: "bg-saveAudienceDemographics",
        data,
      });
    }

    // console.log('Audience demographics saved!');
  }

  // console.log('Audience demographics fetch and save completed');
}

async function saveCollabPost(collabId) {
  // console.log('Fetching single post...');

  // const data = await singlePostScript();
  // const data = await singlePostScriptV3();
  const data = await singlePostScriptV4();

  if (data) {
    data.collabId = collabId;
    // console.log('Single post fetched', data);
    console.log("Single post fetched");
    await chrome.runtime.sendMessage({ action: "bg-saveCollabPost", data });

    // let allComments = await getAllLinkedInComments();
    // if (allComments.length > 0) {
    //   chrome.runtime.sendMessage({
    //     action: "bg-saveComments",
    //     data: {
    //       comments: allComments,
    //       postData: {
    //         postContent: data?.postData?.postContent,
    //         postUrl: data?.postData?.postUrl,
    //         postUrn: data?.postData?.postUrn,
    //         name: data?.postData?.name,
    //         likes: data?.postData?.likes,
    //         comments: data?.postData?.comments,
    //         reposts: data?.postData?.reposts,
    //         impressions: data?.postData?.impressions,
    //         profileLink: data?.postData?.linkedinLink,
    //         conditions: data?.conditions,
    //       },
    //       pageUrl: window.location.href,
    //       authorVanityName: data?.postData?.authorVanityName,
    //     },
    //   });
    // }
    // console.log('Single post saved!');
  }

  return data;

  // console.log('Single post fetch and save completed');
}

async function savePostSummary(collabId) {
  // console.log('Fetching post summary...');

  // const data = await postSummaryScriptV2();
  const data = await postSummaryScriptV3();

  if (data) {
    data.collabId = collabId;
    // console.log('Post summary fetched', data);
    await chrome.runtime.sendMessage({ action: "bg-savePostSummary", data });
    // console.log('Post summary saved!');
  }

  // console.log('Post summary fetch and save completed');
}

async function saveCurrentPost() {
  // save post to raw and update in ops before comments saving
  // let pd = await singlePostScript();
  const pd = await singlePostScriptV3();
  // const pd = await singlePostScriptV4();

  const identifier = {
    pageUrl: pd?.postData?.postUrl,
    profileUrl: pd?.postData?.linkedinLink,
    name: pd?.postData?.name,
    publicIdentifier: pd?.postData?.authorVanityName,
    tagline: pd?.postData?.tagline,
  };

  let data = {
    posts: [
      {
        index: 0,
        name: pd?.postData?.name,
        profileUrl: pd?.postData?.linkedinLink,
        postFeedUrl: pd?.postData?.postUrl,
        postDate: pd?.postData?.postDate,
        postDescription: pd?.postData?.postContent,
        impressions: pd?.postData?.impressions,
        likes: pd?.postData?.likes,
        comments: pd?.postData?.comments,
        reposts: pd?.postData?.reposts,
        imageContentLink: pd?.postData?.imageLink,
      },
    ],
    identifier: identifier,
  };

  // console.log("Daniel at saveCurrentPost postScriptV3 data: ", data.identifier);
  // const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // await sleep(300000);

  if (data?.posts?.length > 0) {
    await chrome.runtime.sendMessage({ action: "bg-savePosts", data });
  }

  return data;
}

// overlay ui rendering functions -------------------

function getStyle() {
  return `#gp__overlay {  position: fixed;  top: 0;  left: 0;  width: 100%;  height: 100vh;  background-color: #171717;  color: white;  z-index: 1000000;  }   #gp__overlay .gp__container {  margin-left: auto;  margin-right: auto;  max-width: 1440px;  height: 100%;  position: relative;  }   #gp__overlay .gp__header {  padding: 13px 40px;  position: absolute;  top: 0;  left: 0;  width: calc(100% - 17px);  background-color: #171717;  z-index: 1000001;  box-sizing: border-box;  }   #gp__overlay .gp__header img {  height: 32px;  }   #gp__overlay .gp__main {  padding: 0 40px;  display: flex;  flex-direction: column;  align-items: center;  justify-content: center;  height: 100%;  }   #gp__overlay .gp__percentage_container {  display: inline-flex;  height: 80px;  width: 80px;  padding: 24px;  justify-content: center;  align-items: center;  flex-shrink: 0;  border-radius: 100%;  border: 5px solid #6D6D6D;  }   #gp__overlay #gp__overlay_percentage {  color: #FFF;  font-size: 16px;  font-style: normal;  font-weight: 700;  line-height: normal;  }   #gp__overlay #gp__overlay_message {  all: unset;  text-align: center;  color: #FFF;  font-size: 16px;  font-style: normal;  font-weight: 600;  line-height: normal;  padding-top: 20px;  padding-bottom: 8px;  }   #gp__overlay #gp__overlay_description {  all: unset;  text-align: center;  color: #A3A3A3;  font-size: 14px;  font-style: normal;  font-weight: 400;  line-height: normal;  text-align: center;  }   #gp__overlay .gp__warning {  all: unset;  color: #EF9645;  font-size: 12px;  font-style: normal;  font-weight: 400;  line-height: normal;  text-transform: uppercase;  padding-top: 80px;  text-align: center;  }   #gp__overlay .gp__blinking-dots span {  display: inline-block;  animation: gp__blink 1.5s infinite ease-in-out;  }   #gp__overlay .gp__blinking-dots span:nth-child(2) {  animation-delay: 0.3s;  }   #gp__overlay .gp__blinking-dots span:nth-child(3) {  animation-delay: 0.6s;  }   @keyframes gp__blink {   0%,  40% {  opacity: 1;  }   41%,  100% {  opacity: 0;  }  }`;
}

function getOverlayElement({ message, description, percentage }) {
  message = message || "Scanning your LinkedIn profile...";
  description =
    description ||
    "We're collecting valuable insights to kick things off </br> Just a moment!";
  percentage = percentage || "1%";

  const logo = chrome.runtime.getURL("assets/icons/logo.svg");

  return `<div id="gp__overlay"> <div class="gp__container"> <div class="gp__header"> <img src="${logo}" alt=""> </div> <div class="gp__main"> <div class="gp__percentage_container"> <div id="gp__overlay_percentage"> ${percentage} </div> </div> <span id="gp__overlay_message"> ${message} </span> <p id="gp__overlay_description"> ${description} </p> <p class="gp__warning"> PLEASE DO NOT SWITCH TABS, CLOSE OR REFRESH THIS WINDOW </br> ALSO, DO NOT CLICK ON THE SCREEN WHILE THE SYNC IS ON </p> </div> </div> </div>`;
}

function renderOverlay({ ...props }) {
  const gp__style = document.createElement("style");
  gp__style.textContent = getStyle();
  document.head.appendChild(gp__style);

  document.body.style.overflow = "hidden";
  // document.title = "Anchors-x-LinkedIn";

  const overlay = document.createElement("div");
  overlay.innerHTML = getOverlayElement({ ...props });

  document.body.appendChild(overlay);
}

// ------ script functions -------------------

function initialGetProfile() {
  const queryParams = getQueryParams();
  // console.log(queryParams);
  if (
    (queryParams?.eventId && queryParams?.page === "profile") ||
    (TRIGGER_LOG?.ref === "anchorsGuest" &&
      TRIGGER_LOG?.page === "profile" &&
      !IS_TRIGGER_EXPIRED)
  ) {
    renderOverlay({
      message: CONFIG.overlay_messages[0].message,
      description: CONFIG.overlay_messages[0].description,
      percentage: `${PERCENTAGE}%`,
    });

    // if(!isOK) {
    //     window.open(CONFIG?.ERROR_CALLBACK_URL+"?error=mismatch", '_self');
    //     return
    // }

    async function profilePage() {
      // if(!isOK) {
      //     window.open(CONFIG?.ERROR_CALLBACK_URL+"?error=mismatch")
      // }

      await new Promise((resolve) => {
        const interval = setInterval(() => {
          PERCENTAGE += 2;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 4 * 2) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
      // console.log('profile script started');

      let quickName, quickImage;
      try {
        const meOptions = {
          method: "GET",
          headers: {
            "X-RestLi-Protocol-Version": "2.0.0",
            "Csrf-Token": document.cookie
              .replace(
                /(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/,
                "$1",
              )
              .replace(/^["']|["']$/g, ""),
            Accept: "application/json",
            Cookie: document.cookie,
          },
        };
        const meRes = await fetch(
          "https://www.linkedin.com/voyager/api/me",
          meOptions,
        );
        if (meRes.ok) {
          const meJson = await meRes.json();
          const mini = meJson?.miniProfile;
          quickName = `${mini?.firstName || ""} ${mini?.lastName || ""}`.trim();
          const artifacts =
            mini?.picture?.["com.linkedin.common.VectorImage"]?.artifacts;
          const rootUrl =
            mini?.picture?.["com.linkedin.common.VectorImage"]?.rootUrl;
          if (rootUrl && artifacts?.length) {
            const best = artifacts.reduce((a, b) =>
              b.width > a.width ? b : a,
            );
            quickImage = rootUrl + best.fileIdentifyingUrlPathSegment;
          }
        }
      } catch (e) {
        console.log("Could not fetch quick profile for dialog:", e);
      }

      const confirmed = await showSyncConfirmationDialog(quickName, quickImage);
      if (!confirmed) {
        window.open(`${COLLAB_CLIENT}/influencer/dashboard`, "_self");
        return;
      }

      await profileFetchNsave();

      // console.log('Going to posts page...');

      await new Promise((resolve) => {
        const interval = setInterval(() => {
          PERCENTAGE += 2;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 8 + 3 * 2) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
        updateTriggerPayload({
          page: "audience",
          expiry: Date.now() + 1000 * 60 * (TRIGGER_LOG?.expiresIn || 5),
        });
        window.location.href = `https://www.linkedin.com/analytics/creator/audience/?timeRange=past_90_days&code=${TRIGGER_LOG?.code}`;
        // window.open(`https://www.linkedin.com/analytics/creator/audience/?timeRange=past_90_days&code=${TRIGGER_LOG?.code}`, '_self');
      } else {
        queryParams.page = "audience";
        const otherParams = Object.keys(queryParams)
          .map((key) => `${key}=${queryParams[key]}`)
          .join("&");

        window.open(
          `https://www.linkedin.com/analytics/creator/audience/?timeRange=past_90_days&${otherParams}`,
          "_self",
        );
      }

      // window.open(`https://www.linkedin.com/in/me/recent-activity/all/?${otherPramas}`, '_self');

      // window.open(`https://www.linkedin.com/in/me/recent-activity/all?ref=${queryParams?.ref}&code=${queryParams?.code}&page=posts`, '_self');
    }

    profilePage();
  }
}

function initialGetTopDemographics() {
  const queryParams = getQueryParams();

  if (
    (queryParams?.eventId && queryParams?.page === "audience") ||
    (TRIGGER_LOG?.ref === "anchorsGuest" &&
      TRIGGER_LOG?.page === "audience" &&
      !IS_TRIGGER_EXPIRED)
  ) {
    PERCENTAGE = 18;
    renderOverlay({
      message: CONFIG.overlay_messages[1].message,
      description: CONFIG.overlay_messages[1].description,
      percentage: `${PERCENTAGE}%`,
    });

    // if(!isOK) {
    //     window.open(CONFIG?.ERROR_CALLBACK_URL+"?error=mismatch", '_self');
    //     return
    // }

    async function audiencePage() {
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          PERCENTAGE += 2;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 3 * 2 + 18) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      document
        .getElementById("gp__overlay")
        .addEventListener("mousedown", function (event) {
          // console.log('click')
          event.preventDefault();
          event.stopPropagation();
        });

      const interval = setInterval(() => {
        PERCENTAGE += 1;
        document.getElementById("gp__overlay_percentage").textContent =
          `${Math.floor(PERCENTAGE)}%`;

        if (PERCENTAGE >= 8 * 1 + 24) {
          clearInterval(interval);
        }
      }, 1000);

      await saveTAudienceDemographics();

      if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
        updateTriggerPayload({
          page: "posts",
          expiry: Date.now() + 1000 * 60 * (TRIGGER_LOG?.expiresIn || 5),
        });
        window.location.href = `https://www.linkedin.com/in/me/recent-activity/all/?code=${TRIGGER_LOG?.code}`;
        // window.open(`https://www.linkedin.com/in/me/recent-activity/all/?code=${TRIGGER_LOG?.code}`, '_self');
      } else {
        queryParams.page = "posts";
        delete queryParams?.timeRange;
        const otherPramas = Object.keys(queryParams)
          .map((key) => `${key}=${queryParams[key]}`)
          .join("&");

        window.open(
          `https://www.linkedin.com/in/me/recent-activity/all/?${otherPramas}`,
          "_self",
        );
      }
    }

    audiencePage();
  }
}

function initialGetPosts() {
  const queryParams = getQueryParams();
  // console.log(queryParams);

  if (
    (queryParams?.eventId && queryParams?.page === "posts") ||
    (TRIGGER_LOG?.ref === "anchorsGuest" &&
      TRIGGER_LOG?.page === "posts" &&
      !IS_TRIGGER_EXPIRED)
  ) {
    PERCENTAGE = 34;
    renderOverlay({
      message: CONFIG.overlay_messages[1].message,
      description: CONFIG.overlay_messages[1].description,
      percentage: `${PERCENTAGE}%`,
    });

    // if(!isOK) {
    //     window.open(CONFIG?.ERROR_CALLBACK_URL+"?error=mismatch", '_self');
    //     return
    // }

    async function postspage() {
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          PERCENTAGE += 2;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 4 * 2 + 34) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });

      // console.log('posts script started');

      const data = await postsScrollNSave();

      document.getElementById("gp__overlay_message").innerHTML =
        CONFIG.overlay_messages[2].message;
      document.getElementById("gp__overlay_description").innerHTML =
        CONFIG.overlay_messages[2].description;

      // changes
      await new Promise((resolve) => {
        const increment = (100 - PERCENTAGE) / 3;

        const interval = setInterval(() => {
          PERCENTAGE += increment;

          if (PERCENTAGE > 100) PERCENTAGE = 100;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 100) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      // return true; // for testing - remove later

      try {
        const { success, url } = await chrome.runtime.sendMessage({
          action: "bg-getRedirectionUrl",
          eventId: queryParams?.eventId,
        });
        if (success) {
          redirectionUrl = url;
        }
      } catch (err) {
        console.error("Failed to get redirection URL:", err.message);
      }

      if (TRIGGER_LOG?.ref === "anchorsGuest" && !IS_TRIGGER_EXPIRED) {
        const redirectUrl = TRIGGER_LOG?.redirect_url;
        removeTriggerPayload();
        if (redirectUrl) {
          const userParam = `username=${data?.identifier?.publicIdentifier}`;
          const separator = redirectUrl.includes("?") ? "&" : "?";
          const modifiedRedirectUrl = `${redirectUrl}${separator}${userParam}`;

          window.location.href = modifiedRedirectUrl;
        } else {
          window.open(`${COLLAB_CLIENT}/influencer/plugin/callback`, "_blank");
          window.close();
        }
      } else {
        queryParams.ref = "linkedin";
        delete queryParams?.code;
        delete queryParams?.page;
        delete queryParams?.eventId;
        const otherPramas = Object.keys(queryParams)
          .map((key) => `${key}=${queryParams[key]}`)
          .join("&");

        if (redirectionUrl) {
          window.open(
            `${COLLAB_CLIENT}${redirectionUrl}?${otherPramas}`,
            "_blank",
          );
        } else {
          window.open(`${COLLAB_CLIENT}/influencer/plugin/callback`, "_blank");
        }

        window.close();
      }

      // window.open(`${COLLAB_CLIENT}/influencer/dashboard?preview-data=true&callback=true&ref=linkedin&data=done&code=${queryParams?.code}`, '_self');
    }

    postspage();
  }
}

function initialGetSingleCollabPost() {
  const queryParams = getQueryParams();
  // console.log('function called')

  if (
    queryParams?.eventId &&
    queryParams?.page === "singlePost" &&
    queryParams?.collabId
  ) {
    // console.log('condition matched');

    PERCENTAGE = 0;
    renderOverlay({
      message:
        'Getting Post Details <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>',
      description: "We are collecting post details. Please wait...",
      percentage: `${PERCENTAGE}%`,
    });

    async function singlePostPage() {
      await new Promise((resolve) => {
        const increment = 50 / 4;
        const interval = setInterval(() => {
          PERCENTAGE += increment;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 4 * 2) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      await saveCurrentPost();

      // sleep for 2 sec
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve();
        }, 2000);
      });

      const postData = await saveCollabPost(queryParams?.collabId);

      if (
        postData?.postData?.postUrn
        // postData?.postData?.analyticsPageUrl ||
        // (postData?.postData?.postUrn && postData?.conditions?.ownPost)
      ) {
        queryParams.page = "postSummary";

        const otherParams = Object.keys(queryParams)
          .map((key) => `${key}=${queryParams[key]}`)
          .join("&");

        // postData?.postData?.analyticsPageUrl
        //   ? window.open(
        //       `${postData?.postData?.analyticsPageUrl}?${otherParams}`,
        //       "_self",
        //     )
        //   :
        window.open(
          `https://www.linkedin.com/analytics/post-summary/${postData?.postData?.postUrn}?${otherParams}`,
          "_self",
        );
      } else {
        await new Promise((resolve) => {
          const increment = 50 / 2;
          const interval = setInterval(() => {
            PERCENTAGE += increment;

            if (PERCENTAGE > 100) PERCENTAGE = 100;
            document.getElementById("gp__overlay_percentage").textContent =
              `${Math.floor(PERCENTAGE)}%`;

            if (PERCENTAGE >= 100) {
              clearInterval(interval);
              resolve();
            }
          }, 1000);
        });

        try {
          const { success, url } = await chrome.runtime.sendMessage({
            action: "bg-getRedirectionUrl",
            eventId: queryParams?.eventId,
          });
          if (success) {
            redirectionUrl = url;
          }
        } catch (err) {
          console.error("Failed to get redirection URL:", err.message);
        }

        delete queryParams?.code;
        delete queryParams?.page;
        delete queryParams?.eventId;
        const otherParams = Object.keys(queryParams)
          .map((key) => `${key}=${queryParams[key]}`)
          .join("&");

        if (redirectionUrl) {
          window.open(
            `${COLLAB_CLIENT}${redirectionUrl}?${otherParams}`,
            "_blank",
          );
          // window.open(redirectUrl, '_blank');
        } else {
          window.open(`${COLLAB_CLIENT}/influencer/plugin/callback`, "_blank");
        }
        window.close();
      }
    }

    singlePostPage();
  }
}

function helperToExtractEngagementFromPostSummaryV3(json) {
  const WANTED = {
    reactions: "likes",
    comments: "comments",
    reposts: "reposts",
    saves: "saves",
    "sends on linkedin": "sendsOnLinkedIn",
    impressions: "impressions",
    "members reached": "memberReach",
  };

  // Metrics start null, not 0, so "LinkedIn returned no value" stays
  // distinguishable from "the value really is zero". A 0 default made a failed
  // read look like a genuine zero-engagement post, and the server then dropped
  // it silently as a falsy value.
  const result = {
    impressions: null,
    memberReach: null,
    likes: null,
    comments: null,
    reposts: null,
    saves: null,
    sendsOnLinkedIn: null,
    profileViewers: null,
    followersGained: null,
    postContent: null,
    postUrl: null,
    pageUrl: null,
    postUrn: null,
    profileUrl: "https://www.linkedin.com/in/undefined",
    imageContentLink: null,
  };

  const toNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const match = cleaned.match(/-?\d+/);
    if (!match) return null;
    const parsed = parseInt(match[0], 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const setMetric = (title, value) => {
    const key =
      WANTED[
        String(title || "")
          .trim()
          .toLowerCase()
      ];
    if (!key) return;
    const parsed = toNumber(value);
    if (parsed !== null) {
      result[key] = parsed;
    }
  };

  const elements =
    json?.data?.premiumDashAnalyticsViewByAnalyticsEntity?.elements ?? [];

  const cards = elements
    .flatMap((el) => el.sections ?? [])
    .flatMap((sec) => sec.card ?? [])
    .filter(Boolean);

  for (const card of cards) {
    const ctaItems =
      card?.component?.summary?.detail?.ctaList?.items ??
      card?.components?.[0]?.summary?.detail?.ctaList?.items ??
      [];
    for (const item of ctaItems) {
      // LinkedIn moved both halves onto structured text nodes - primaryTitle
      // and primaryText - and now always sends `text` as null while leaving the
      // legacy `title` string populated. Read the new shape first and keep the
      // old one as a fallback so older payloads still parse.
      setMetric(
        item?.primaryTitle?.text ?? item?.title,
        item?.primaryText?.text ?? item?.text,
      );
    }

    const keyMetrics =
      card?.components?.[0]?.summary?.keyMetrics?.items ??
      card?.component?.summary?.keyMetrics?.items ??
      [];
    for (const item of keyMetrics) {
      setMetric(
        item?.description?.text ?? item?.primaryTitle?.text,
        item?.title?.text ?? item?.primaryText?.text,
      );
    }

    // "Profile activity" card. These rows carry a raw numeric `value` instead
    // of formatted text, so they don't go through setMetric/WANTED.
    const metricRows = (card?.components ?? []).flatMap(
      (component) =>
        component?.customComponent?.creatorComponent?.metricRowList?.items ??
        component?.leiaComponent?.customComponent?.creatorComponent
          ?.metricRowList?.items ??
        [],
    );
    for (const row of metricRows) {
      const title = String(row?.title?.text || "")
        .trim()
        .toLowerCase();
      const value = toNumber(row?.value);
      if (value === null) continue;

      // LinkedIn labels these "… from this post" — match on the prefix so a
      // wording tweak to the suffix doesn't silently drop the metric.
      if (title.startsWith("profile viewers")) {
        result.profileViewers = value;
      } else if (title.startsWith("followers gained")) {
        result.followersGained = value;
      }
    }
  }

  const miniUpdate = elements?.[0]?.entityMiniUpdate;
  result.postContent = miniUpdate?.commentary?.commentaryText?.text ?? null;

  const rawPostUrl =
    miniUpdate?.commentary?.navigationContext?.target ??
    miniUpdate?.contextualDescription?.navigationContext?.target ??
    null;

  result.postUrl = rawPostUrl ? rawPostUrl.split("?")[0] : null;
  result.pageUrl = result.postUrl;

  result.postUrn = miniUpdate?.metadata?.backendUrn ?? null;
  if (!result.postUrn && result.postUrl) {
    result.postUrn = result.postUrl.match(/urn:li:activity:\d+/)?.[0] ?? null;
  }

  const rawProfileUrl = miniUpdate?.actor?.navigationContext?.target;
  if (typeof rawProfileUrl === "string" && rawProfileUrl.trim()) {
    result.profileUrl = rawProfileUrl.split("?")[0];
  }

  const bestImage = (miniUpdate?.commentary?.image?.attributes ?? [])
    .map((attr) => attr?.detailData?.vectorImage)
    .filter(Boolean)
    .flatMap((vectorImage) =>
      (vectorImage?.artifacts ?? []).map((artifact) => ({
        rootUrl: vectorImage?.rootUrl,
        pathSegment: artifact?.fileIdentifyingUrlPathSegment,
        score: (artifact?.width || 0) * (artifact?.height || 0),
      })),
    )
    .filter((img) => img?.rootUrl && img?.pathSegment)
    .sort((a, b) => b.score - a.score)?.[0];

  if (bestImage) {
    result.imageContentLink = `${bestImage.rootUrl}${bestImage.pathSegment}`;
  }

  return result;
}

function helperToExtractDemographicsFromPostSummaryV3(json) {
  // Map LinkedIn's stable category enums → schema field names
  const CATEGORY_MAP = {
    STRUCTURED_TITLE_OCCUPATION: "jobTitles",
    REGION_GEO: "location",
    OCCUPATION_SENIORITY: "seniority",
    INDUSTRY: "industries",
    ORGANIZATION: "companies",
    STAFF_COUNT_RANGE: "companySize",
  };

  // Fallback: map by title text if category is ever missing
  const TITLE_MAP = {
    "Job title": "jobTitles",
    Location: "location",
    Seniority: "seniority",
    Industry: "industries",
    Company: "companies",
    "Company size": "companySize",
  };

  // Initialize every field as empty array
  const result = Object.fromEntries(
    Object.values(CATEGORY_MAP).map((k) => [k, []]),
  );

  // Flatten every card from every section, drop nulls
  const cards = (
    json?.data?.premiumDashAnalyticsViewByAnalyticsEntity?.elements ?? []
  )
    .flatMap((el) => el.sections ?? [])
    .flatMap((sec) => sec.card ?? [])
    .filter(Boolean);

  for (const card of cards) {
    const barCharts =
      card?.components?.[0]?.customComponent?.creatorComponent?.barChartList
        ?.barCharts ?? [];

    for (const chart of barCharts) {
      const key =
        CATEGORY_MAP[chart?.category] ?? TITLE_MAP[chart?.title?.text];
      if (!key) continue;

      const items = (chart?.dataPoints ?? [])
        .map((dp) => ({
          value: dp?.xLabel?.text ?? null,
          percentage: dp?.yFormattedValue?.text ?? null,
        }))
        .filter((it) => it.value !== null);

      // Merge in case the same category appears in multiple cards
      result[key].push(...items);
    }
  }

  return result;
}

/**
 * Parses one PremiumAnalyticsCardById response (a single dimension).
 * Auto-detects which dimension it is from the dropdown's `selected: true` item.
 * Returns { key, items } where key is a schema field name.
 *
 * NOTE: The REACTION dimension (breakdown of reaction types: Like / Insightful /
 * Celebrate etc.) is intentionally skipped because the backend DemographicsSchema
 * doesn't have a `reactionBreakdown` field. If the schema is ever extended to
 * include it, uncomment the REACTION entry in DIMENSION_MAP / LABEL_MAP below.
 */
function helperToExtractEngagementDemographicCardV3(json) {
  // Stable enum → schema field
  const DIMENSION_MAP = {
    // REACTION: "reactionBreakdown", // Dropped — schema has no matching field
    STRUCTURED_TITLE_OCCUPATION: "jobTitles",
    REGION_GEO: "location",
    INDUSTRY: "industries",
    OCCUPATION_SENIORITY: "seniority",
    STAFF_COUNT_RANGE: "companySize",
  };

  // Fallback: dropdown label → schema field
  const LABEL_MAP = {
    // Reactions: "reactionBreakdown", // Dropped — schema has no matching field
    "Job titles": "jobTitles",
    Locations: "location",
    Industries: "industries",
    Seniority: "seniority",
    "Company size": "companySize",
  };

  const barChart =
    json?.data?.premiumDashAnalyticsCardById?.component?.barChartModule;
  if (!barChart) return { key: null, items: [] };

  // Detect which dimension this response is for
  const selected = barChart?.dropdown?.items?.find((i) => i?.selected);
  const dimensionType = selected?.value?.dimensionType;
  const label = selected?.label;
  const key = DIMENSION_MAP[dimensionType] ?? LABEL_MAP[label] ?? null;

  // Skip unmapped dimensions (e.g. REACTION — see note above)
  if (!key) return { key: null, items: [] };

  const items = (barChart?.dataPoints ?? [])
    .map((dp) => {
      const value = dp?.xLabel?.text ?? null;

      // Most dimensions have yFormattedValue ("5%", "33%"). Fallback to yPercent.
      let percentage = dp?.yFormattedValue?.text ?? null;
      if (!percentage && typeof dp?.yPercent === "number") {
        percentage = Math.round(dp.yPercent * 100) + "%";
      }

      return { value, percentage };
    })
    .filter((it) => it.value !== null);

  return { key, items };
}

/**
 * Aggregates multiple PremiumAnalyticsCardById responses into the final
 * engagementDemographics shape matching the backend DemographicsSchema.
 *
 * Input engagementType is mapped to backend keys:
 *   reactions → likes
 *   comments  → comments
 *
 * @param {Array<{engagementType: 'reactions'|'comments', data: object}>} responses
 */
function helperToBuildEngagementDemographicsV3(responses) {
  // Maps our internal engagementType → backend storage key
  const BUCKET_MAP = {
    reactions: "likes",
    comments: "comments",
  };

  const emptyBucket = () => ({
    jobTitles: [],
    location: [],
    industries: [],
    seniority: [],
    companySize: [],
    // `companies` field exists in schema but LinkedIn doesn't return
    // a Company breakdown at the engagement-demographic level — left out.
  });

  const result = {
    likes: emptyBucket(),
    comments: emptyBucket(),
  };

  for (const { engagementType, data } of responses ?? []) {
    const bucketKey = BUCKET_MAP[engagementType];
    const bucket = result[bucketKey];
    if (!bucket) continue;

    const { key, items } = helperToExtractEngagementDemographicCardV3(data);
    if (!key || !(key in bucket)) continue;

    bucket[key] = items;
  }

  return result;
}

/**
 * Parses the PremiumDashLibraViewByTargetEntity response for link clicks.
 * Returns { totalLinkClicks, links } matching the backend schema shape.
 */
function helperToExtractLinkEngagementV3(json) {
  const emptyResult = { totalLinkClicks: 0, links: [] };

  const elements = json?.data?.premiumDashLibraViewByTargetEntity?.elements;
  if (!Array.isArray(elements) || elements.length === 0) return emptyResult;

  // Find the "Visits to links in this post" element. Usually only one, but we
  // search by title to be safe in case LinkedIn adds more siblings later.
  const linksElement =
    elements.find((el) => el?.title?.text === "Visits to links in this post") ??
    elements[0];

  // Flatten metricRowList.items across all cards & components
  const items = [];
  for (const card of linksElement?.card ?? []) {
    for (const component of card?.components ?? []) {
      const rowItems =
        component?.leiaComponent?.customComponent?.creatorComponent
          ?.metricRowList?.items ?? [];
      items.push(...rowItems);
    }
  }

  const links = items
    .map((item) => {
      const url = item?.title?.text ?? null;
      const clicks =
        typeof item?.value === "number" ? Math.round(item.value) : 0;
      return { url, clicks };
    })
    .filter((l) => l.url);

  const totalLinkClicks = links.reduce((sum, l) => sum + (l.clicks || 0), 0);

  return { totalLinkClicks, links };
}

// The SDUI action API is the only source for the in-network / out-of-network
// impressions split — no Voyager query returns it. Verified against live
// traffic: cookie auth only (no bearer token), and none of the LinkedIn Android
// client identity is enforced. The request body below is the minimal one that
// still answers; the whole Android client-context block was stripped and the
// endpoint still returned 200 with identical data, so no device fingerprint is
// sent.
const SDUI_SLOW_METRICS_URL =
  "https://www.linkedin.com/sdui/flagship/actionApi/getAction?sduiid=com.linkedin.sdui.requests.creatoranalytics.spaSlowMetrics";
const SDUI_SLOW_METRICS_ID =
  "com.linkedin.sdui.requests.creatoranalytics.spaSlowMetrics";
// Inert telemetry: verified that a trackingId belonging to a *different* post
// still returns the requested post's data, so the server keys off activityId.
const SDUI_INERT_TRACKING_ID = "2r4cSz90kExZwsOqsOPf6Q==";

/**
 * Builds the protobuf request body for the SDUI slow-metrics call.
 *
 * LinkedIn's SDUI wire format is protobuf with numeric field tags and no schema
 * exposed, so this hand-encodes the message shape captured from live traffic:
 *
 *   5 → the sduiid
 *   6 → params: an `updateKey` naming the post, plus an execution id
 *
 * `feedType` is a float64 (47.0) and `isVideoCarousel` a 2-byte blob; both are
 * copied verbatim as raw bytes since their meaning isn't needed here.
 */
function sduiEncodeSlowMetricsBody(activityId) {
  const textEncoder = new TextEncoder();

  const varint = (value) => {
    const out = [];
    let remaining = value;
    do {
      let byte = remaining & 0x7f;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) byte |= 0x80;
      out.push(byte);
    } while (remaining > 0);
    return out;
  };

  // Every field we emit is length-delimited (wire type 2).
  const encode = (node) => {
    const parts = [];
    // Numeric-string keys iterate in ascending numeric order, which is exactly
    // protobuf's canonical field ordering.
    for (const key of Object.keys(node)) {
      const field = Number(key);
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        const payload =
          typeof child === "string"
            ? textEncoder.encode(child)
            : child instanceof Uint8Array
              ? child
              : encode(child);
        parts.push(...varint((field << 3) | 2), ...varint(payload.length));
        parts.push(...payload);
      }
    }
    return Uint8Array.from(parts);
  };

  const named = (name, value) => ({ 1: name, 2: value });
  const executionId =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000000";

  return encode({
    5: SDUI_SLOW_METRICS_ID,
    6: {
      1: {
        1: [
          named("updateKey", {
            5: {
              1: [
                named("feedType", {
                  2: Uint8Array.from([0, 0, 0, 0, 0, 0x80, 0x47, 0x40]),
                }),
                named("items", {
                  6: {
                    1: {
                      5: {
                        1: [
                          named("feedUpdateUrn", {
                            5: {
                              1: named("updateUrnActivityUrn", {
                                5: {
                                  1: named("activityUrn", {
                                    5: {
                                      1: named("activityId", { 3: activityId }),
                                    },
                                  }),
                                },
                              }),
                            },
                          }),
                          named("trackingId", { 3: SDUI_INERT_TRACKING_ID }),
                        ],
                      },
                    },
                  },
                }),
                named("isVideoCarousel", Uint8Array.from([0x20, 0x00])),
              ],
            },
          }),
          named("_ExecutionId", { 3: executionId }),
        ],
      },
      3: {
        1: {
          3: "",
          10: {
            2: "MemoryNamespace",
            3: {
              1: `identitySwitcherActorContext-urn:li:activity:${activityId}`,
            },
          },
        },
      },
    },
  });
}

/**
 * Schema-free protobuf reader → a plain object keyed by field number, the same
 * shape LinkedIn's own tooling shows. Repeated fields collapse into arrays.
 *
 * Length-delimited fields are ambiguous without a schema (string vs nested
 * message), so clean printable text wins and anything else is parsed as a
 * message. C0 bytes count as "not text" on purpose — 0x0A is the tag byte that
 * starts most nested messages, and allowing it through makes length prefixes
 * get mistaken for content.
 */
function sduiDecodeProtobuf(bytes) {
  const textDecoder = new TextDecoder("utf-8");
  const CONTROL = /[\u0000-\u001f]/;

  const readVarint = (buf, start) => {
    let result = 0;
    let scale = 1;
    let pos = start;
    let byte;
    do {
      if (pos >= buf.length) throw new Error("varint overran buffer");
      byte = buf[pos++];
      result += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    return [result, pos];
  };

  const decode = (buf) => {
    const out = {};
    let pos = 0;

    const put = (field, value) => {
      if (field in out) {
        if (Array.isArray(out[field])) out[field].push(value);
        else out[field] = [out[field], value];
      } else {
        out[field] = value;
      }
    };

    while (pos < buf.length) {
      let tag;
      [tag, pos] = readVarint(buf, pos);
      const field = Math.floor(tag / 8);
      const wire = tag & 7;
      if (field === 0) throw new Error("invalid field number 0");

      if (wire === 0) {
        let value;
        [value, pos] = readVarint(buf, pos);
        put(field, value);
      } else if (wire === 1) {
        pos += 8;
      } else if (wire === 5) {
        pos += 4;
      } else if (wire === 2) {
        let length;
        [length, pos] = readVarint(buf, pos);
        const slice = buf.subarray(pos, pos + length);
        if (slice.length !== length) throw new Error("truncated field");
        pos += length;

        let text = null;
        try {
          text = textDecoder.decode(slice);
        } catch (err) {
          text = null;
        }

        if (text !== null && slice.length > 0 && !CONTROL.test(text)) {
          put(field, text);
        } else {
          try {
            put(field, slice.length ? decode(slice) : {});
          } catch (err) {
            put(field, null);
          }
        }
      } else {
        throw new Error(`unsupported wire type ${wire}`);
      }
    }
    return out;
  };

  return decode(bytes);
}

/**
 * Pulls the network split out of a decoded slow-metrics response.
 *
 * The payload is a list of UI slots; the one we want is keyed
 * "impressionsBreakdown" — the same identifier the web page uses for its DOM id.
 * Collecting every text node inside it yields, in render order:
 *   ["In-network (followers and connections)", "94%", "Out-of-network", "6%"]
 * so each label is paired with the next percentage after it. Matching by label
 * rather than by index keeps this working if LinkedIn reorders the bars.
 */
function helperToExtractImpressionsBreakdownFromSdui(decoded) {
  const SDUI_TEXT_COMPONENT = 26316;

  const collectText = (node, out = []) => {
    if (Array.isArray(node)) {
      node.forEach((child) => collectText(child, out));
      return out;
    }
    if (!node || typeof node !== "object") return out;

    if (node["35"]?.["1"] === SDUI_TEXT_COMPONENT) {
      const text = node["35"]?.["2"]?.["1"]?.["1"];
      if (typeof text === "string") out.push(text);
    }
    for (const value of Object.values(node)) collectText(value, out);
    return out;
  };

  const slots = [].concat(decoded?.["3"]?.["3"]?.["5"] ?? []);
  const slot = slots.find(
    (entry) => entry?.["2"]?.["7"]?.["1"] === "impressionsBreakdown",
  );
  const strings = collectText(slot?.["2"]?.["6"]);

  const percentageAfter = (label) => {
    const index = strings.findIndex((text) =>
      text.toLowerCase().startsWith(label.toLowerCase()),
    );
    if (index === -1) return null;
    const hit = strings
      .slice(index + 1)
      .find((text) => /^\d+(\.\d+)?\s*%$/.test(text.trim()));
    return hit ? parseFloat(hit) : null;
  };

  return {
    inNetworkPercentage: percentageAfter("In-network"),
    outOfNetworkPercentage: percentageAfter("Out-of-network"),
  };
}

/**
 * Reads the in-network / out-of-network impressions split off the post-summary
 * page DOM.
 *
 * This is the one post-summary metric LinkedIn does NOT expose through Voyager
 * — POST_SUMMARY, POST_SUMMARY_DEMOGRAPHIC_DETAIL and the edgeInsights card
 * queries all come back without it. It is server-rendered into the page and
 * hydrated client-side, so the DOM is the only source.
 *
 * `#impressionsBreakdown` is a stable semantic hook; the class names on that
 * node are hashed build output and must never be matched against.
 *
 * The component hydrates after first paint (it renders as empty skeleton bars
 * initially), so poll rather than read once. On timeout both values come back
 * null and the rest of the payload still saves.
 */
async function helperToExtractImpressionsBreakdownFromDom({
  timeoutMs = 8000,
  intervalMs = 250,
} = {}) {
  const readPercentage = (text, label) => {
    // The UI label carries a qualifier — "In-network (followers and
    // connections)" — so match the prefix, then the next percentage after it.
    const match = text.match(
      new RegExp(`${label}[^\\n]*\\n+\\s*(\\d+(?:\\.\\d+)?)\\s*%`, "i"),
    );
    return match ? parseFloat(match[1]) : null;
  };

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text =
      document.getElementById("impressionsBreakdown")?.innerText ?? "";

    if (text.includes("%")) {
      const inNetworkPercentage = readPercentage(text, "In-network");
      const outOfNetworkPercentage = readPercentage(text, "Out-of-network");

      if (inNetworkPercentage !== null || outOfNetworkPercentage !== null) {
        return { inNetworkPercentage, outOfNetworkPercentage };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.warn(
    "impressionsBreakdown did not hydrate before timeout; network split unavailable",
  );
  return { inNetworkPercentage: null, outOfNetworkPercentage: null };
}

function initialGetPostSummary() {
  const queryParams = getQueryParams();

  if (
    queryParams?.eventId &&
    queryParams?.page === "postSummary" &&
    queryParams?.collabId
  ) {
    PERCENTAGE = 50;
    renderOverlay({
      message:
        'Getting Post Summary <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>',
      description: "We are collecting post summary. Please wait...",
      percentage: `${PERCENTAGE}%`,
    });

    async function postSummaryPage() {
      document
        .getElementById("gp__overlay")
        .addEventListener("mousedown", function (event) {
          // console.log('click')
          event.preventDefault();
          event.stopPropagation();
        });

      await new Promise((resolve) => {
        const increment = 25 / 4;
        const interval = setInterval(() => {
          PERCENTAGE += increment;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 4 * 2) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      await savePostSummary(queryParams?.collabId);

      await new Promise((resolve) => {
        const increment = 25 / 2;
        const interval = setInterval(() => {
          PERCENTAGE += increment;

          if (PERCENTAGE > 100) PERCENTAGE = 100;
          document.getElementById("gp__overlay_percentage").textContent =
            `${Math.floor(PERCENTAGE)}%`;

          if (PERCENTAGE >= 100) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
      });

      try {
        const { success, url } = await chrome.runtime.sendMessage({
          action: "bg-getRedirectionUrl",
          eventId: queryParams?.eventId,
        });
        if (success) {
          redirectionUrl = url;
        }
      } catch (err) {
        console.error("Failed to get redirection URL:", err.message);
      }

      delete queryParams?.code;
      delete queryParams?.page;
      delete queryParams?.eventId;
      const otherParams = Object.keys(queryParams)
        .map((key) => `${key}=${queryParams[key]}`)
        .join("&");

      if (redirectionUrl) {
        window.open(
          `${COLLAB_CLIENT}${redirectionUrl}?${otherParams}`,
          "_blank",
        );
      } else {
        window.open(
          `${COLLAB_CLIENT}/influencer/plugin/callback${otherParams ? `?${otherParams}` : ""}`,
          "_blank",
        );
      }

      window.close();
    }

    postSummaryPage();
  }
}

// ----- main functions -------

function updateTriggerPayload(payload) {
  chrome.runtime.sendMessage({
    action: "bg-updateTriggerPayload",
    data: payload,
  });
}

function removeTriggerPayload() {
  chrome.runtime.sendMessage({ action: "bg-removeTriggerPayload" });
}

function normalizeAffiliateLinkedInPostUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${pathname}`;
  } catch {
    return null;
  }
}

function isAllowedAffiliateCallbackUrl(value) {
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

function redirectAffiliatePostSync(context, status, error) {
  if (!isAllowedAffiliateCallbackUrl(context?.redirect_url)) {
    console.error("Affiliate callback URL is not allowed");
    return;
  }

  const callbackUrl = new URL(context.redirect_url);
  callbackUrl.searchParams.set("linkedinSync", status);
  callbackUrl.searchParams.set("code", context.code);
  callbackUrl.searchParams.set("contentPieceId", context.contentPieceId);
  if (error) callbackUrl.searchParams.set("error", String(error).slice(0, 180));
  window.location.replace(callbackUrl.toString());
}

async function failAffiliatePostSync(context, error) {
  console.error("Affiliate post sync failed:", error);
  try {
    await chrome.runtime.sendMessage({ action: "bg-clearAffiliatePostSync" });
  } catch (cleanupError) {
    console.error("Affiliate post sync cleanup failed:", cleanupError);
  }
  redirectAffiliatePostSync(
    context,
    "error",
    error?.message || "LinkedIn post sync failed",
  );
}

function mergeAffiliatePostData(publicPostData, analyticsPostData) {
  // Analytics may be partial or entirely absent, so read through optional
  // chaining and fall back to the public scrape rather than throwing.
  const analytics = analyticsPostData || {};
  const engagement = analytics?.demographicsV2?.metricsData?.engagement || {};

  return {
    ...publicPostData,
    ...analytics,
    name: publicPostData.name,
    title: publicPostData.title,
    tagline: publicPostData.tagline,
    followers: publicPostData.followers,
    linkedinLink: publicPostData.linkedinLink,
    profileUrl: analytics.profileUrl || publicPostData.linkedinLink || null,
    authorVanityName: publicPostData.authorVanityName,
    postUrl: publicPostData.postUrl,
    pageUrl: publicPostData.pageUrl,
    postUrn: publicPostData.postUrn,
    postContent: analytics.postContent ?? publicPostData.postContent ?? null,
    postType: publicPostData.postType,
    imageLink: publicPostData.imageLink,
    imageContentLink:
      analytics.imageContentLink ?? publicPostData.imageLink ?? null,
    videoLink: publicPostData.videoLink,
    likes: engagement.reactions ?? publicPostData.likes ?? null,
    comments: engagement.comments ?? publicPostData.comments ?? null,
    reposts: engagement.reposts ?? publicPostData.reposts ?? null,
    saves: engagement.saves ?? null,
    sendsOnLinkedIn: engagement.sendsOnLinkedIn ?? null,
  };
}

async function matchesAffiliateRequestedPost(context) {
  const currentUrl = normalizeAffiliateLinkedInPostUrl(window.location.href);
  const requestedUrl = normalizeAffiliateLinkedInPostUrl(
    context?.requestedPostUrl,
  );
  if (currentUrl && requestedUrl && currentUrl === requestedUrl) return true;

  const [currentActivityId, requestedActivityId] = await Promise.all([
    extractLinkedInURN(window.location.href),
    extractLinkedInURN(context?.requestedPostUrl),
  ]);
  return Boolean(
    currentActivityId &&
    requestedActivityId &&
    currentActivityId === requestedActivityId,
  );
}

async function runAffiliateSinglePostSync(context) {
  AFFILIATE_SYNC_STARTED = true;
  PERCENTAGE = 10;
  renderOverlay({
    message:
      'Getting Post Details <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>',
    description: "We are collecting the post and creator profile.",
    percentage: `${PERCENTAGE}%`,
  });

  try {
    const result = await singlePostScriptV3();
    const postData = result?.postData;
    const profileUrl = postData?.linkedinLink || postData?.profileUrl;

    if (
      !postData?.postUrn ||
      !postData?.postUrl ||
      !postData?.name ||
      !profileUrl
    ) {
      throw new Error("LinkedIn post or profile data is incomplete");
    }

    // Activity-ID matching between the scrape and the request was removed: the
    // ids arrive in inconsistent shapes and the comparison rejected legitimate
    // syncs. Routing already guarantees we are on the requested post, and the
    // backend authorises the write via content-piece ownership.
    const updateResponse = await chrome.runtime.sendMessage({
      action: "bg-updateAffiliatePostSync",
      data: {
        affiliateStage: "postSummary",
        publicPostData: postData,
        resolvedPostUrn: postData.postUrn,
      },
    });
    if (!updateResponse?.success) {
      throw new Error(
        updateResponse?.error || "Unable to save the LinkedIn sync progress",
      );
    }

    window.location.replace(
      `https://www.linkedin.com/analytics/post-summary/${postData.postUrn}`,
    );
  } catch (error) {
    await failAffiliatePostSync(context, error);
  }
}

async function runAffiliatePostSummarySync(context) {
  AFFILIATE_SYNC_STARTED = true;
  PERCENTAGE = 60;
  renderOverlay({
    message:
      'Getting Post Summary <span class="gp__blinking-dots"><span>.</span><span>.</span><span>.</span></span>',
    description: "We are collecting analytics and demographics.",
    percentage: `${PERCENTAGE}%`,
  });

  try {
    // The analytics-page id check was removed for the same reason as the
    // stage-1 one: routing below already gates this stage on the post-summary
    // URL for the resolved post.
    // Analytics are best-effort. If the summary page yields nothing at all we
    // still submit the stage-1 public scrape rather than discarding it — the
    // backend persists what arrived and reports every gap to Lark.
    let analyticsPostData = null;
    try {
      const analyticsResult = await postSummaryScriptV3();
      analyticsPostData = analyticsResult?.postData || null;
    } catch (analyticsError) {
      console.error("Affiliate analytics scrape failed:", analyticsError);
    }

    const mergedPostData = mergeAffiliatePostData(
      context.publicPostData,
      analyticsPostData,
    );
    const response = await chrome.runtime.sendMessage({
      action: "bg-submitAffiliatePostSync",
      data: { postData: mergedPostData },
    });
    if (!response?.success) {
      throw new Error(response?.error || "Unable to save LinkedIn post data");
    }

    redirectAffiliatePostSync(context, "success");
  } catch (error) {
    await failAffiliatePostSync(context, error);
  }
}

async function affiliatePostSyncMain(context) {
  if (
    AFFILIATE_SYNC_STARTED ||
    context?.ref !== "anchorsGuest" ||
    context?.page !== "singlePost"
  ) {
    return;
  }

  const currentUrl = window.location.href;
  const isRequestedSinglePost =
    context.affiliateStage === "singlePost" &&
    (currentUrl.includes("linkedin.com/posts/") ||
      currentUrl.includes("linkedin.com/feed/update/")) &&
    (await matchesAffiliateRequestedPost(context));

  let isRequestedPostSummary = false;
  if (
    context.affiliateStage === "postSummary" &&
    currentUrl.includes("linkedin.com/analytics/post-summary/")
  ) {
    const currentActivityId = await extractLinkedInURN(currentUrl);
    const expectedActivityId = await extractLinkedInURN(
      context.resolvedPostUrn,
    );
    isRequestedPostSummary = Boolean(
      currentActivityId &&
      expectedActivityId &&
      currentActivityId === expectedActivityId,
    );
  }

  if (!isRequestedSinglePost && !isRequestedPostSummary) return;

  if (!context?.expiry || context.expiry <= Date.now()) {
    await failAffiliatePostSync(context, new Error("LinkedIn sync expired"));
    return;
  }

  if (isRequestedSinglePost) {
    await runAffiliateSinglePostSync(context);
  } else if (isRequestedPostSummary) {
    await runAffiliatePostSummarySync(context);
  }
}

function guestMain() {
  const currentUrl = window.location.href;
  if (currentUrl?.includes("linkedin.com/in/me")) {
    if (currentUrl?.includes("recent-activity/all")) {
      initialGetPosts();
      // console.log('guest-posts');
    } else {
      initialGetProfile();
      // console.log('guest-profile');
    }
  } else if (currentUrl?.includes("analytics/creator/audience")) {
    initialGetTopDemographics();
    // console.log('guest-audience');
  }
}

async function main() {
  const currentUrl = window.location.href;
  isProfileScrapingFailed = await getProfileScrapeFailFlag();

  if (currentUrl?.includes("linkedin.com/in/me")) {
    initializeProfileUrn();

    if (currentUrl?.includes("recent-activity/all")) {
      initialGetPosts();
    } else {
      initialGetProfile();
    }
  } else if (currentUrl?.includes("analytics/creator/audience")) {
    initialGetTopDemographics();
  }

  // collab post
  else if (
    currentUrl?.includes("linkedin.com/posts/") ||
    currentUrl?.includes("linkedin.com/feed/update/")
  ) {
    initialGetSingleCollabPost();
  } else if (currentUrl?.includes("linkedin.com/analytics/post-summary/")) {
    console.log("starting single-collab summary");
    initialGetPostSummary();
  }

  chrome.storage.local.get(["scriptTrigger"], async function (result) {
    if (chrome.runtime.lastError) {
      console.log("Error:", chrome.runtime.lastError);
    } else {
      TRIGGER_LOG = JSON.parse(result?.scriptTrigger || null);

      // console.log('trigger log:', TRIGGER_LOG);
      if (
        TRIGGER_LOG?.ref === "anchorsGuest" &&
        TRIGGER_LOG?.page === "singlePost"
      ) {
        await affiliatePostSyncMain(TRIGGER_LOG);
        return;
      }

      const queryParams = getQueryParams();
      if (queryParams?.code) {
        if (
          TRIGGER_LOG &&
          queryParams?.code === TRIGGER_LOG?.code &&
          TRIGGER_LOG?.expiry > Date.now()
        ) {
          // console.log('Valid Code');
          IS_TRIGGER_EXPIRED = false;
          if (TRIGGER_LOG?.ref === "anchorsGuest") {
            guestMain();
            // console.log('guest-main');
          }
        } else {
          IS_TRIGGER_EXPIRED = true;
        }
      }
    }
  });

  // console.log('main function executed');
}

main();

const singlePostScriptV3 = async () => {
  /*
  postData = {
    followers,
    totalPosts,       // null - not available via API
    title,
    name,
    tagline,
    linkedinLink,
    time,             // relative string only e.g. "3 months ago"
    postContent,
    otherContentClass, // null - not available via API
    postType,
    imageLink,
    videoLink,
    likes,
    comments,
    reposts,
    impressions,
    postUrn,
    pageUrl,
    postUrl,
    authorVanityName,
  }
  */

  function buildVoyagerHeaders() {
    return {
      Host: "www.linkedin.com",
      Connection: "Keep-Alive",
      "Accept-Language": "en-US",
      "Csrf-Token": document.cookie
        .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
        .replace(/^["']|["']$/g, ""),
      "X-Li-Lang": "en_US",
      Accept: "application/json",
      Cookie: document.cookie,
      "User-Agent": navigator.userAgent,
      "Accept-Encoding": "gzip, deflate, br",
      "X-RestLi-Protocol-Version": "2.0.0",
      "x-li-track":
        '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
    };
  }

  function getBestImageUrl(vectorImage) {
    if (!vectorImage?.rootUrl || !Array.isArray(vectorImage?.artifacts))
      return null;
    const best = vectorImage.artifacts.reduce((a, b) =>
      (b.width || 0) > (a.width || 0) ? b : a,
    );
    return best?.fileIdentifyingUrlPathSegment
      ? vectorImage.rootUrl + best.fileIdentifyingUrlPathSegment
      : null;
  }

  function extractPostTypesFromFeedUpdate(update) {
    if (!update || typeof update !== "object") return [];

    const types = [];
    const content = update?.content || {};

    if (update?.commentary?.text?.text?.trim()) types.push("text");
    if (update?.resharedUpdate) types.push("reshared");

    if (
      content?.documentComponent ||
      content?.["com.linkedin.voyager.feed.render.DocumentComponent"]
    ) {
      types.push("carousel");
    }

    if (
      content?.imageComponent ||
      content?.["com.linkedin.voyager.feed.render.ImageComponent"]
    ) {
      types.push("image");
    }

    if (
      content?.linkedInVideoComponent ||
      content?.videoComponent ||
      content?.["com.linkedin.voyager.feed.render.VideoComponent"] ||
      content?.["com.linkedin.voyager.feed.render.LinkedInVideoComponent"]
    ) {
      types.push("video");
    }

    if (
      content?.articleComponent ||
      content?.newsletterComponent ||
      content?.["com.linkedin.voyager.feed.render.ArticleComponent"]
    ) {
      types.push("newsletter");
    }

    if (
      content?.pollComponent ||
      content?.["com.linkedin.voyager.feed.render.PollComponent"]
    ) {
      types.push("poll");
    }

    return Array.from(new Set(types));
  }

  // Extract activity URN from current page URL
  // Supports: /feed/update/urn:li:activity:123 and /analytics/post-summary/urn:li:activity:123
  const activityId = await extractLinkedInURN(window.location.href);

  if (!activityId) {
    console.error("singlePostScriptV3: no activity URN in URL");
    return { postData: {} };
  }

  const activityUrn = `urn:li:activity:${activityId}`;
  const headers = buildVoyagerHeaders();

  // --- API 1: Post metrics + author info (4.json shape) ---
  const metricsRaw = await fetchPostMetricsV3(activityId).catch((e) => {
    console.error("singlePostScriptV3: metrics fetch failed", e);
    return null;
  });
  const metrics = metricsRaw
    ? helperToExtractEngagementFromPostSummaryV3(metricsRaw)
    : {};

  // --- API 2: Feed single update - post type, video link, richer counts (5.json shape) ---
  let feedData = null;
  try {
    const feedUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(likesCount:10,commentsCount:10,urnOrNss:urn%3Ali%3Aactivity%3A${activityId},moduleKey:feed-item%3Aphone)&queryName=FeedSingleUpdateByBackendUrnOrNss&queryId=voyagerFeedDashUpdates.ea391ef23f490d4eaf628692eeac3ef9`;
    const feedRes = await fetch(feedUrl, {
      method: "GET",
      headers,
      credentials: "include",
    });
    if (feedRes.ok) feedData = await feedRes.json();
  } catch (e) {
    console.error("singlePostScriptV3: feed fetch failed", e);
  }

  const feedEl =
    feedData?.data?.feedDashUpdatesByBackendUrnOrNss?.elements?.[0] ?? null;
  const feedActor = feedEl?.actor ?? null;
  const feedSocial = feedEl?.socialDetail?.totalSocialActivityCounts ?? null;
  const feedVideo =
    feedEl?.content?.linkedInVideoComponent?.videoPlayMetadata ?? null;

  // --- API 3: Full profile (3.json shape) ---
  let profileData = null;
  try {
    // Prefer profile URN from feed actor entityUrn, fall back to global userProfileUrn
    const profileUrnFromFeed = feedActor?.name?.attributesV2
      ?.find((a) => a?.detailData?.profileFullName?.entityUrn)
      ?.detailData?.profileFullName?.entityUrn?.split(
        "urn:li:fsd_profile:",
      )?.[1];

    const profileUrn =
      profileUrnFromFeed || userProfileUrn || initializeProfileUrn();
    if (profileUrn) {
      const profileUrl = `https://www.linkedin.com/voyager/api/graphql?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A${profileUrn})&queryName=FullProfileWithEntitiesV2&queryId=voyagerIdentityDashProfiles.6620d95ba71d48eaf926f8d41cc1d060`;
      const profileRes = await fetch(profileUrl, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (profileRes.ok) {
        const profileJson = await profileRes.json();
        profileData = profileJson?.data?.identityDashProfilesById ?? null;
      }
    }
  } catch (e) {
    console.error("singlePostScriptV3: profile fetch failed", e);
  }

  // --- Extract: name ---
  const name =
    feedActor?.name?.text ||
    (profileData
      ? `${profileData.firstName ?? ""} ${profileData.lastName ?? ""}`.trim()
      : null) ||
    metrics.name ||
    null;

  // --- Extract: tagline ---
  const tagline =
    feedActor?.description?.text ||
    profileData?.headline ||
    metrics.tagline ||
    null;

  // --- Extract: linkedinLink ---
  const linkedinLinkRaw =
    feedActor?.navigationContext?.actionTarget || metrics.profileUrl || null;
  const linkedinLink = linkedinLinkRaw ? linkedinLinkRaw.split("?")[0] : null;

  // --- Extract: authorVanityName ---
  const authorVanityName =
    profileData?.publicIdentifier ||
    linkedinLink?.split("/in/")?.[1]?.replace(/\/$/, "") ||
    null;

  // --- Extract: followers ---
  const followers = profileData?.followingState?.followerCount ?? null;

  // --- Extract: title (current job) ---
  const title =
    profileData?.profilePositionGroups?.elements?.[0]
      ?.profilePositionInPositionGroup?.elements?.[0]?.title ?? null;

  // --- Extract: postUrn / postUrl / pageUrl ---
  const postUrn = metrics.postUrn || activityUrn;
  const postUrl =
    metrics.postUrl || `https://www.linkedin.com/feed/update/${activityUrn}`;
  const pageUrl = window.location.href;

  // --- Extract: postContent ---
  const postContent =
    feedEl?.commentary?.text?.text || metrics.postContent || null;

  // --- Extract: time (relative string) ---
  const time =
    feedActor?.subDescription?.accessibilityText?.split("•")?.[0]?.trim() ||
    null;

  // --- Extract: postType ---
  const postType = extractPostTypesFromFeedUpdate(feedEl);

  // --- Extract: videoLink (HLS preferred) ---
  let videoLink = null;
  if (feedVideo?.adaptiveStreams?.length) {
    const hls = feedVideo.adaptiveStreams.find(
      (s) => s.mediaType === "application/vnd.apple.mpegURL",
    );
    const fallback = feedVideo.adaptiveStreams[0];
    const stream = hls || fallback;
    videoLink = stream?.masterPlaylists?.[0]?.url ?? null;
  }

  // --- Extract: imageLink ---
  const imageLink = metrics.imageContentLink ?? null;

  // --- Extract: counts ---
  // Feed API counts take priority as they're direct (not analytics-estimated)
  const likes = feedSocial?.numLikes ?? metrics.likes ?? null;
  const comments = feedSocial?.numComments ?? metrics.comments ?? null;
  const reposts = feedSocial?.numShares ?? metrics.reposts ?? null;
  const impressions = feedSocial?.numImpressions ?? metrics.impressions ?? null;

  const postData = {
    followers,
    totalPosts: null,
    title,
    name: name || "",
    tagline,
    linkedinLink,
    time,
    postContent,
    otherContentClass: null,
    postType,
    imageLink,
    videoLink,
    likes,
    comments,
    reposts,
    impressions,
    postUrn,
    pageUrl,
    postUrl,
    authorVanityName,
  };

  return { postData };
};

const singlePostScriptV4 = async () => {
  // Important step as must get activity ID correctly.
  const activityId = await extractLinkedInURN(window.location.href);

  let failedToGetImpressions = false;

  if (activityId) {
    const activityUrn = `urn:li:activity:${activityId}`;

    // --- API 1: Post metrics + author info ---
    const metricsRaw = await fetchPostMetricsV3(activityId).catch((e) => {
      console.error("singlePostScriptV4: metrics fetch failed", e);
      return null;
    });
    const metrics = metricsRaw
      ? helperToExtractEngagementFromPostSummaryV3(metricsRaw)
      : {};

    // `metrics` is {} when the metrics fetch itself failed, so treat undefined
    // as failure too - otherwise the HTML fallback below is unreachable.
    failedToGetImpressions =
      metrics.impressions === null || metrics.impressions === undefined;

    if (!failedToGetImpressions) {
      const postData = {
        followers: null,
        totalPosts: null,
        title: null,
        name: metrics.name || "",
        tagline: metrics.tagline || null,
        linkedinLink: metrics.profileUrl || null,
        time: null,
        postContent: metrics.postContent || null,
        otherContentClass: null,
        postType: [],
        imageLink: metrics.imageContentLink ?? null,
        videoLink: null,
        likes: metrics.likes ?? null,
        comments: metrics.comments ?? null,
        reposts: metrics.reposts ?? null,
        impressions: metrics.impressions ?? null,
        postUrn: metrics.postUrn || activityUrn,
        pageUrl: window.location.href,
        postUrl:
          metrics.postUrl ||
          `https://www.linkedin.com/feed/update/${activityUrn}`,
        authorVanityName:
          metrics.profileUrl?.split("/in/")?.[1]?.replace(/\/$/, "") || null,
        source: "API",
      };

      return { postData, screenshot: null };
    }
  } else {
    failedToGetImpressions = true;
  }

  if (failedToGetImpressions) {
    console.log("singlePostScriptV4: falling back to HTML scraping");

    const pageText = document.body.innerText || "";
    const impressionRegex = /(\d{1,3}(?:,\d{3})*)\s+impressions/gi;
    const matches = [...pageText.matchAll(impressionRegex)];

    let scrapedImpressions = null;
    if (matches.length > 0) {
      for (const match of matches) {
        const numberStr = match[1];
        if (numberStr && /\d/.test(numberStr)) {
          scrapedImpressions = parseInt(numberStr.replace(/,/g, ""), 10);
          console.log(
            `singlePostScriptV4: scraped impressions = ${scrapedImpressions}`,
          );
          break;
        }
      }
    }

    const source =
      scrapedImpressions !== null ? "HTML" : "Failed (No Data found)";

    const postData = {
      followers: null,
      totalPosts: null,
      title: null,
      name: "",
      tagline: null,
      linkedinLink: null,
      time: null,
      postContent: null,
      otherContentClass: null,
      postType: [],
      imageLink: null,
      videoLink: null,
      likes: null,
      comments: null,
      reposts: null,
      impressions: scrapedImpressions,
      postUrn: activityId ? `urn:li:activity:${activityId}` : null,
      pageUrl: window.location.href,
      postUrl: activityId
        ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}`
        : null,
      authorVanityName: null,
      source,
    };

    return { postData };
  }
};
