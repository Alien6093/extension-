// const setStorageKeys = (data) => {
//   return new Promise((resolve) => {
//     chrome.storage.local.set(data, () => {
//       if (chrome.runtime.lastError) {
//         console.error("setStorageKeys error:", chrome.runtime.lastError);
//       }
//       resolve();
//     });
//   });
// };

// const getStorageKeys = (keys) => {
//   return new Promise((resolve) => {
//     chrome.storage.local.get(keys, (result) => {
//       if (chrome.runtime.lastError) {
//         console.error("getStorageKeys error:", chrome.runtime.lastError);
//         resolve({});
//         return;
//       }
//       resolve(result);
//     });
//   });
// };

// const clearStorageKeys = (keys) => {
//   return new Promise((resolve) => {
//     chrome.storage.local.remove(keys, () => {
//       if (chrome.runtime.lastError) {
//         console.error("clearStorageKeys error:", chrome.runtime.lastError);
//       }
//       resolve();
//     });
//   });
// };

// const postScript = async () => {
//   let allPost;
//   let publicIdentifier = "";
//   let scrollIntervalId;
//   let autoScrollStatus = true; // Define and initialize autoScrollStatus
//   let isScrolling = false;

//   // pausing all videos
//   document.querySelectorAll(".vid").forEach((vid) => vid.pause());
//   document.querySelectorAll("video").forEach((vid) => vid.pause());

//   // last index of loaded post data from total post
//   let lastIndex = -1;

//   publicIdentifier = document.body?.textContent.match(
//     /"publicIdentifier":"(.*?)"/,
//   )?.[1];

//   let uname = document
//     .querySelector("#recent-activity-top-card a h3")
//     ?.textContent?.trim();
//   let profileUrl = document.querySelector("#recent-activity-top-card a")?.href;
//   let tagline = document
//     .querySelector("#recent-activity-top-card h4")
//     ?.textContent?.trim();

//   function getAllPost() {
//     const totalPost = document.body.querySelectorAll(
//       "main section div.scaffold-finite-scroll__content ul li.profile-creator-shared-feed-update__container",
//     );
//     // const uniquePost = Array.from(totalPost).filter(e => {
//     //     const firstVisuallyHiddenSpan = e.querySelectorAll(".update-components-actor .update-components-actor__container .update-components-actor__meta span.visually-hidden")?.[0];
//     //     return firstVisuallyHiddenSpan && firstVisuallyHiddenSpan.textContent.trim() === uname;
//     // });

//     let uniquePost = Array.from(totalPost).filter((e, index) => {
//       const firstVisuallyHiddenSpan = e
//         ?.querySelectorAll(
//           ".update-components-actor__container .update-components-actor__meta span.visually-hidden",
//         )?.[0]
//         ?.textContent?.trim();
//       const matches = firstVisuallyHiddenSpan
//         ? firstVisuallyHiddenSpan === uname
//         : false;

//       // console.log(index, "---", firstVisuallyHiddenSpan, " ", matches, " --- ", similarRepost, "  ", similarRepostMatch);

//       if (matches) {
//         const similarRepost = e?.querySelector(
//           "div.update-components-header div.update-components-header__text-wrapper span.update-components-header__text-view span a",
//         )?.href;
//         const similarRepostMatch = similarRepost
//           ? similarRepost === profileUrl
//           : false;

//         if (!similarRepostMatch) {
//           // lastIndex = index;
//           return true;
//         }
//       }

//       return false;
//     });

//     console.log("Total Post: ", totalPost.length);
//     console.log("Unique Post: ", uniquePost.length);

//     allPost = [];
//     for (let i = 0; i < uniquePost.length; i++) {
//       const currentPost = uniquePost[i];
//       const result = getCurrentPostDetails(currentPost, i);
//       allPost.push(result);
//     }

//     // console.log(allPost);
//     return allPost;
//   }

//   function getCurrentPostDetails(currentPost, index) {
//     let postFeedNumber = currentPost
//       ?.querySelector("h2.visually-hidden")
//       ?.textContent?.trim();
//     if (postFeedNumber) {
//       postFeedNumber = postFeedNumber?.split(" ");
//       postFeedNumber = postFeedNumber[postFeedNumber?.length - 1];
//     }
//     postFeedNumber = postFeedNumber ? postFeedNumber : "-1";

//     let postSocialCounts = Array?.from(
//       currentPost?.querySelectorAll(
//         "div.update-v2-social-activity div.social-details-social-counts ul li",
//       ) || [],
//     )?.map((e) =>
//       e?.textContent?.trim()?.replaceAll("\n", "")?.replaceAll(/\s+/g, " "),
//     );

//     // let comments = postSocialCounts?.filter(e => e?.includes("comments") || e?.includes("comment"))?.[0];
//     // comments = comments ? comments?.trim()?.split(" ")?.[0] : "0";

//     // let reposts = postSocialCounts?.filter(e => e?.includes("reposts") || e?.includes("repost"))?.[0];
//     // reposts = reposts ? reposts?.trim()?.split(" ")?.[0] : "0";

//     //  ------------------ counts -------------
//     const parseNumber = (str) => parseInt(str?.replace(/,/g, "") || "0", 10);

//     const likes = parseNumber(
//       currentPost
//         ?.querySelector(
//           "div.update-v2-social-activity div.social-details-social-counts ul > li button[data-reaction-details]",
//         )
//         ?.getAttribute("aria-label")
//         ?.split(" ")?.[0],
//     );

//     const notReactions = currentPost?.querySelector(
//       "div.update-v2-social-activity div.social-details-social-counts ul > li[data-non-reaction-details]",
//     );
//     const [comments, reposts] = Array.from(
//       notReactions?.querySelectorAll("ul > li button") || [],
//     )
//       ?.map((e) => e?.getAttribute("aria-label"))
//       ?.reduce(
//         (acc, item) => {
//           const num = parseNumber(item?.split(" ")?.[0]);
//           item?.includes("comment")
//             ? (acc[0] = num)
//             : item?.includes("repost") && (acc[1] = num);
//           return acc;
//         },
//         [0, 0],
//       );

//     //  --------------- counts -------------

//     postSocialCounts = postSocialCounts ? postSocialCounts : [];

//     let postFeedUrl =
//       "https://www.linkedin.com/feed/update/" +
//       currentPost?.querySelector("div[data-urn]")?.getAttribute("data-urn");
//     postFeedUrl = postFeedUrl ? postFeedUrl : "No Feed Url";

//     // let postDescription = currentPost?.querySelector(".feed-shared-update-v2__description-wrapper");
//     // postDescription = postDescription ? postDescription?.textContent?.trim()?.replaceAll("\n", "")?.replaceAll(/\s+/g, " ") : "No Description";

//     let postDescription = currentPost
//       ?.querySelector(".update-components-update-v2__commentary")
//       ?.innerText?.trim();

//     // let postType = currentPost?.querySelector(".feed-shared-update-v2__description-wrapper")?.nextElementSibling?.getAttribute("class")?.trim()?.split("\n")?.map(e => e?.trim());
//     // postType = postType ? postType : "No Post Type";
//     let postType = currentPost
//       ?.querySelector(".feed-shared-update-v2__description")
//       ?.parentElement?.nextElementSibling?.getAttribute("class")
//       ?.trim()
//       ?.split("\n")
//       ?.map((e) => e?.trim());

//     const allMetaHead = Array?.from(
//       currentPost?.querySelectorAll(
//         ".update-components-actor__meta a span.visually-hidden",
//       ) || [],
//     );
//     let postDate = "No Date";
//     let userName = "No User Name";
//     if (allMetaHead?.length > 0) {
//       postDate = allMetaHead[allMetaHead.length - 1]?.textContent?.trim();
//       userName = allMetaHead[0]?.textContent?.trim();
//     }

//     // let impressions = currentPost?.querySelector(".ca-entry-point__num-views");
//     // if (impressions) {
//     //     impressions = impressions?.textContent?.trim();
//     //     impressions = impressions?.split(" ");
//     //     if (impressions?.length > 0) {
//     //         impressions = impressions?.[0];
//     //     }
//     // }
//     // impressions = impressions ? impressions : "No Impressions";

//     let impressions = parseNumber(
//       currentPost
//         ?.querySelector(".ca-entry-point__num-views")
//         ?.textContent?.trim(),
//     );

//     // let likes = currentPost?.querySelector("div.update-v2-social-activity div.social-details-social-counts ul li button");
//     // if (likes) {
//     //     likes = likes?.getAttribute("aria-label");
//     //     likes = likes?.trim();
//     //     likes = likes?.split(" ");
//     //     if (likes?.length > 0) {
//     //         likes = likes?.[0];
//     //     }
//     // }
//     // likes = likes ? likes : "No Likes";

//     let rawFullPost = currentPost?.querySelector(
//       ".fie-impression-container",
//     ).innerText;

//     const result = {
//       index: index,
//       postFeedNumber,
//       name: userName,
//       profileUrl,
//       postFeedUrl,
//       postDate,
//       postDescription,
//       postType,
//       postSocialCounts,
//       impressions,
//       likes,
//       comments,
//       reposts,
//       rawFullPost,
//     };
//     return result;
//   }

//   function autoScroll() {
//     // Set the scrolling interval (adjust speed as needed)
//     let scrollInterval = 100; // in milliseconds

//     // Set the scrolling amount (adjust as needed)
//     let scrollAmount = 50; // in pixels

//     // Start auto-scrolling only if autoScrollStatus is true
//     scrollIntervalId = setInterval(() => {
//       // Scroll the page by the specified amount

//       // console.log("scrolling...", currentScrolledHeight, fullBodyHeight);
//       // window.scrollBy(0, scrollAmount);

//       if (autoScrollStatus) {
//         let currentScrolledHeight = window?.innerHeight + window?.scrollY;
//         let fullBodyHeight = document?.body?.scrollHeight;
//         // console.log("body Height: ", fullBodyHeight);
//         // console.log("scrolling...", currentScrolledHeight, fullBodyHeight);

//         window.scrollBy(0, scrollAmount);
//         if (currentScrolledHeight >= fullBodyHeight) {
//           //-------------
//           const totalPost = document?.body?.querySelectorAll(
//             "main section div.scaffold-finite-scroll__content ul li.profile-creator-shared-feed-update__container",
//           );
//           // const uniquePost = Array.from(totalPost).filter((e, index) => {
//           //     const firstVisuallyHiddenSpan = e.querySelectorAll(".update-components-actor .update-components-actor__container .update-components-actor__meta span.visually-hidden")?.[0];
//           //     const matches = firstVisuallyHiddenSpan && firstVisuallyHiddenSpan.textContent.trim() === uname;

//           //     if (matches) {
//           //         lastIndex = index;
//           //     }

//           //     return matches;
//           // });
//           let uniquePost = Array?.from(totalPost)?.filter((e, index) => {
//             const firstVisuallyHiddenSpan = e
//               ?.querySelectorAll(
//                 ".update-components-actor .update-components-actor__container .update-components-actor__meta span.visually-hidden",
//               )?.[0]
//               ?.textContent?.trim();
//             const matches = firstVisuallyHiddenSpan
//               ? firstVisuallyHiddenSpan === uname
//               : false;

//             // console.log(index, "---", firstVisuallyHiddenSpan, " ", matches, " --- ", similarRepost, "  ", similarRepostMatch);

//             if (matches) {
//               const similarRepost = e?.querySelector(
//                 "div.update-components-header div.update-components-header__text-wrapper span.update-components-header__text-view span a",
//               )?.href;
//               const similarRepostMatch = similarRepost
//                 ? similarRepost === profileUrl
//                 : false;

//               if (!similarRepostMatch) {
//                 lastIndex = index;
//                 return true;
//               }
//             }

//             return false;
//           });

//           document.title = `Unique Post: ${uniquePost?.length} | Total Post: ${totalPost?.length}`;
//           // console.log(`Unique Post: ${uniquePost.length} | Total Post: ${totalPost.length} | index: ${lastIndex}`);
//           //----------

//           autoScrollStatus = false;
//           // console.log("auto scroll stopped!: ", currentScrolledHeight, "interval id: ", scrollIntervalId);
//           clearInterval(scrollIntervalId);
//           scrollIntervalId = 0;
//           scrollInterval = 0;
//           scrollAmount = 0;
//           return;
//         }
//       }

//       // Stop auto-scrolling when reaching the bottom of the page
//     }, scrollInterval);
//   }

//   function scrollDown() {
//     const currentScrollHeight = document.body.scrollHeight;
//     window.scrollTo(0, currentScrollHeight);
//   }

//   let manualStop = false;
//   async function infiniteScroll() {
//     const MAXIMUM_NUMBER_OF_TRIALS = 5;
//     const MINIMUM_SLEEPING_TIME_IN_MS = 1000;
//     const MAXIMUM_SLEEPING_TIME_IN_MS = 3000;

//     // Utility functions
//     const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
//     const randomNumber = (minimum, maximum) =>
//       Math.floor(Math.random() * maximum) + minimum;
//     const randomSleep = () =>
//       sleep(
//         randomNumber(MINIMUM_SLEEPING_TIME_IN_MS, MAXIMUM_SLEEPING_TIME_IN_MS),
//       );

//     // How to get at the bottom of an infinity scroll
//     let currentScrollHeight = 0;
//     //manual stop
//     let numberOfScrolls = 0;
//     let numberOfTrials = 0;

//     while (numberOfTrials < MAXIMUM_NUMBER_OF_TRIALS && !manualStop) {
//       currentScrollHeight = document.body.scrollHeight;
//       autoScroll();

//       await randomSleep();

//       autoScrollStatus = true;

//       if (currentScrollHeight === document.body.scrollHeight) {
//         numberOfTrials++;
//         // overlay.textContent = `Checking...\nMore Posts.\nRetry ${numberOfTrials}`;
//       } else {
//         numberOfTrials = 0;

//         numberOfScrolls++;

//         // overlay.textContent = `Loading...\nMore posts.`;
//       }
//       const result = getAllPost();

//       PERCENTAGE = Math.min(94, 44 + Math.floor((result?.length / 20) * 70));
//       document.getElementById("gp__overlay_percentage").textContent =
//         `${Math.floor(PERCENTAGE)}%`;
//       let hasMessageChanged = false;
//       if (PERCENTAGE >= 60 && !hasMessageChanged) {
//         document.getElementById("gp__overlay_message").innerHTML =
//           CONFIG.overlay_messages[2].message;
//         document.getElementById("gp__overlay_description").innerHTML =
//           CONFIG.overlay_messages[2].description;
//         hasMessageChanged = true;
//       }

//       // console.log("post: ", result);

//       if (result.length >= 20) {
//         break;
//       }
//     }

//     autoScrollStatus = false;
//     clearInterval(scrollIntervalId);

//     // overlay.textContent = `Congratulation! All posts are loaded!`;

//     // await sleep(2000);
//     // overlay.textContent = `Analyzing...`;
//     // const result = getAllPost();

//     // console.log(result)
//     // await sleep(2000);
//     // overlay.textContent = `Saving Result...`;

//     // await sleep(2000);
//     // await saveToMongoDb(result);
//     // overlay.innerHTML = "<h1 style='padding: 20px; border-radius: 10px; background-color: #f9f9f9; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); font-family: Arial, sans-serif; font-size: 16px; color: #333; line-height: 1.6;'>🎉Done Analyzing!<br/>" + result.length + " unique posts found. <br/>Post analyze until: " + result[result.length - 1]?.postDate + "</h1>";
//     // window.scrollTo(0, 0);

//     // await sleep(5000);
//     // overlay.style.display = 'none';

//     window.scrollTo(0, 0);
//     const result = getAllPost();

//     return result;
//   }

//   const identifier = {
//     pageUrl: window.location.href,
//     profileUrl,
//     name: uname,
//     publicIdentifier,
//     tagline,
//   };

//   const posts = await infiniteScroll();

//   return {
//     posts,
//     identifier,
//   };
// };

// const audienceScriptV2 = async () => {
//   const ownProfileUrn = document?.body?.textContent
//     ?.match(/"entityUrn":"(urn:li:fs_miniProfile:[^"]+)"/)?.[1]
//     ?.replace("fs_miniProfile", "fsd_profile");
//   const pageUrl = window.location.href;
//   const publicIdentifier = document.body?.textContent.match(
//     /"publicIdentifier":"(.*?)"/,
//   )?.[1];

//   // Function to get the Sec-Ch-Ua header
//   function getSecChUaHeader() {
//     const userAgentData = navigator.userAgentData || {};
//     const brands = userAgentData.brands || [
//       { brand: "Opera GX", version: "109" },
//       { brand: "Not:A-Brand", version: "8" },
//       { brand: "Chromium", version: "123" },
//     ];

//     return brands
//       .map((brand) => `"${brand.brand}";v="${brand.version}"`)
//       .join(", ");
//   }

//   async function fetchDemographics(
//     profileUrn,
//     dimensionType,
//     timeRange = "past_90_days",
//   ) {
//     if (!profileUrn) {
//       console.error("No profile URN provided");
//       return null;
//     }

//     const baseUrl = "https://www.linkedin.com/voyager/api/graphql";

//     const modifiedUrn = profileUrn.replace(/:/g, "%3A");

//     const params = `variables=(dimensionType:${dimensionType},edgeInsightsAnalyticsCardUrns:List(urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28CREATOR_AUDIENCE%2C${modifiedUrn}%2CANALYTICS%2CDETAILS%2CPOWER_CREATOR_DETAILS%29),query:(selectedFilters:List((key:resultType,value:List(AUDIENCES)),(key:timeRange,value:List(${timeRange})))))&queryId=voyagerPremiumDashAnalyticsCard.a9380719dba2e28362dffe6f32f884fa`;

//     const referer = `https://www.linkedin.com/analytics/creator/audience/?timeRange=${timeRange}`;

//     // const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

//     const headers = {
//       Accept: "application/vnd.linkedin.normalized+json+2.1",
//       "Accept-Encoding": "gzip, deflate, br, zstd",
//       "Accept-Language": "en-US,en;q=0.9",
//       "Csrf-Token": document.cookie
//         .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
//         .replace(/^["']|["']$/g, ""),
//       Referer: referer,
//       "Sec-Ch-Ua": getSecChUaHeader(),
//       "Sec-Ch-Ua-Mobile": "?0",
//       "Sec-Ch-Ua-Platform": '"Windows"',
//       "Sec-Fetch-Dest": "empty",
//       "Sec-Fetch-Mode": "cors",
//       "Sec-Fetch-Site": "same-origin",
//       "User-Agent": navigator.userAgent,
//       "X-Li-Lang": "en_US",
//       "x-li-track":
//         '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
//       "X-Restli-Protocol-Version": "2.0.0",
//     };

//     try {
//       const response = await fetch(`${baseUrl}?${params}`, {
//         method: "GET",
//         headers: headers,
//         credentials: "include",
//       });
//       if (!response.ok)
//         throw new Error(`HTTP error! status: ${response.status}`);
//       const data = await response.json();

//       const jsonString = JSON.stringify(data);

//       const match = jsonString.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/);

//       if (match?.[1]) {
//         userProfileUrn = match[1];
//       }

//       if (data && data.included.length > 0) {
//         const demographics =
//           data?.included[0]?.component?.barChartModule?.dataPoints?.map((d) => {
//             return {
//               value: d?.xLabel?.text,
//               percentage: d?.yFormattedValue?.text,
//               numPercentage: d?.yPercent,
//             };
//           });
//         return {
//           count:
//             data?.included[0]?.component?.barChartModule
//               ?.numOfInitialDataPointToShow,
//           demographics: demographics,
//           rawRes: data,
//         };
//       } else console.log("No demographics data found in the response");
//     } catch (error) {
//       console.error("Error fetching demographics", error);
//     }
//     return null;
//   }

//   const dimensionMapping = {
//     OCCUPATION_SENIORITY: "seniority",
//     REGION_GEO: "location",
//     STRUCTURED_TITLE_OCCUPATION: "jobTitles",
//     INDUSTRY: "industries",
//     ORGANIZATION: "companies",
//     STAFF_COUNT_RANGE: "companySize",
//   };

//   const data = {
//     jobTitles: undefined,
//     location: undefined,
//     seniority: undefined,
//     page_url: pageUrl,
//     publicIdentifier: publicIdentifier,
//   };

//   for (const [dimensionType, mappedType] of Object.entries(dimensionMapping)) {
//     try {
//       const resData = await fetchDemographics(
//         ownProfileUrn,
//         dimensionType,
//         "past_90_days",
//       );

//       if (resData) {
//         // data[mappedType] = {
//         //     count: resData?.count,
//         //     demographics: resData?.demographics,
//         //     rawRes: resData?.rawRes,
//         // };

//         data[mappedType] = resData?.demographics;

//         console.log(
//           `Demographics fetched successfully for ${mappedType}`,
//           resData,
//         );
//       }
//     } catch (error) {
//       console.error(`Error fetching demographics for ${dimensionType}:`, error);
//     }

//     await new Promise((r) => setTimeout(r, 1000));
//   }

//   //In case the profile scraping failed with the profileScript function then we fallback to voyager API
//   if (isProfileScrapingFailed) {
//     await profileScriptViaVoyager();
//   }

//   return data;
// };

// const audienceScript = async () => {
//   function getChartData() {
//     return Array.from(
//       document.body.querySelectorAll(
//         "div.member-analytics-addon-loader ul li.member-analytics-addon-bar-chart__row",
//       ) || [],
//     ).map((e) => {
//       let value = e
//         .querySelector(
//           "label.member-analytics-addon-bar-chart__bar-label > span",
//         )
//         ?.innerText?.trim();
//       let percentage = e
//         .querySelector(
//           "label.member-analytics-addon-bar-chart__bar-label span.member-analytics-addon-bar-chart__bar-label-values",
//         )
//         ?.innerText?.trim();
//       return { value, percentage };
//     });
//   }

//   const publicIdentifier = document?.body?.textContent?.match(
//     /"publicIdentifier":"(.*?)"/,
//   )?.[1];

//   let data = {};

//   function delay(ms) {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   async function extractData() {
//     // Step 1: Job Titles
//     document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.click();
//     await delay(1000); // Wait for data to load
//     document.body
//       .querySelector(
//         '.artdeco-dropdown__content-inner ul[role=menu] li[aria-label*="Job titles"]',
//       )
//       ?.click();
//     await delay(3000); // Wait for data to load
//     let currentSection = document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.innerText?.trim()
//       ?.toLowerCase();
//     if (currentSection.includes("job titles")) {
//       data.jobTitles = getChartData();
//     }

//     // Step 2: Locations
//     document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.click();
//     await delay(1000); // Wait for data to load
//     // document.body.querySelector('[aria-label="Locations"]')?.click();
//     document.body
//       .querySelector(
//         '.artdeco-dropdown__content-inner ul[role=menu] li[aria-label*="Locations"]',
//       )
//       ?.click();
//     await delay(3000); // Wait for data to load
//     currentSection = document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.innerText?.trim()
//       ?.toLowerCase();
//     if (currentSection?.includes("locations")) {
//       data.location = getChartData();
//     }

//     // Step 3: Industries
//     // document.body.querySelector('[data-control-name="analytics_breakdown"]')?.click();
//     // await delay(1000); // Wait for data to load
//     // document.body.querySelector('[aria-label="Industries"]')?.click();
//     // await delay(3000); // Wait for data to load
//     // data.industries = getChartData();

//     // Step 4: Seniority
//     document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.click();
//     await delay(1000); // Wait for data to load
//     // document.body.querySelector('[aria-label="Seniority"]')?.click();
//     document.body
//       .querySelector(
//         '.artdeco-dropdown__content-inner ul[role=menu] li[aria-label*="Seniority"]',
//       )
//       ?.click();
//     await delay(3000); // Wait for data to load
//     currentSection = document.body
//       .querySelector('[data-control-name="analytics_breakdown"]')
//       ?.innerText?.trim()
//       ?.toLowerCase();
//     if (currentSection?.includes("seniority")) {
//       data.seniority = getChartData();
//     }

//     // Step 5: Company Size
//     // document.body.querySelector('[data-control-name="analytics_breakdown"]')?.click();
//     // await delay(1000); // Wait for data to load
//     // document.body.querySelector('[aria-label="Company size"]')?.click();
//     // await delay(3000); // Wait for data to load
//     // data.companySize = getChartData();

//     // Step 6: Companies
//     // document.body.querySelector('[data-control-name="analytics_breakdown"]')?.click();
//     // await delay(1000); // Wait for data to load
//     // document.body.querySelector('[aria-label="Companies"]')?.click();
//     // await delay(3000); // Wait for data to load
//     // data.companies = getChartData();

//     // Final Data Output
//     console.log(data);
//   }

//   // Execute the data extraction
//   await extractData();

//   data.publicIdentifier = publicIdentifier;
//   data.page_url = window.location.href;

//   return data;
// };

// const singlePostScriptV2 = async () => {
//   async function fetchSinglePost(urn, commentsCount = 10, likesCount = 10) {
//     const baseURl = `https://www.linkedin.com/voyager/api/graphql`;
//     const params = `variables=(urnOrNss:urn%3Ali%3Aactivity%3A${urn})&queryId=voyagerFeedDashUpdates.96a2c595132e96b1da2cb7be811e0659`;
//     // const params = `variables=(commentsCount:${commentsCount},likesCount:${likesCount},includeCommentsFirstReply:false,moduleKey:feed-item%3Adesktop,urnOrNss:urn%3Ali%3Aactivity%3A${urn})&queryId=voyagerFeedDashUpdates.05a08ee58d2b9cc9126f67ed649d974f`;
//     const headers = {
//       Accept: "application/vnd.linkedin.normalized+json+2.1",
//       "Accept-Encoding": "gzip, deflate, br, zstd",
//       "Accept-Language": "en-US,en;q=0.9",
//       "Csrf-Token": document.cookie
//         .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
//         .replace(/^["']|["']$/g, ""),
//       Referer: window.location.href,
//       // "Sec-Ch-Ua": getSecChUaHeader(),
//       "Sec-Ch-Ua-Mobile": "?0",
//       "Sec-Ch-Ua-Platform": '"Windows"',
//       "Sec-Fetch-Dest": "empty",
//       "Sec-Fetch-Mode": "cors",
//       "Sec-Fetch-Site": "same-origin",
//       "User-Agent": navigator.userAgent,
//       "X-Li-Lang": "en_US",
//       "x-li-pem-metadata": "Voyager - Feed - Detail=update-detail",
//       "x-li-track":
//         '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
//       "X-Restli-Protocol-Version": "2.0.0",
//     };

//     try {
//       const response = await fetch(`${baseURl}?${params}`, {
//         method: "GET",
//         headers: headers,
//         credentials: "include",
//       });
//       if (!response.ok)
//         throw new Error(`HTTP error! status: ${response.status}`);
//       const data = await response.json();
//       if (data && data?.included?.length > 0) {
//         const postDetails = data?.included?.find(
//           (d) =>
//             d?.["$type"] === "com.linkedin.voyager.dash.feed.Update" &&
//             d?.entityUrn?.includes("urn:li:fsd_update") &&
//             d?.entityUrn?.includes(`urn:li:activity:${urn}`),
//         );

//         const socialCounts = data?.included?.find(
//           (d) =>
//             d?.["$type"] ===
//               "com.linkedin.voyager.dash.feed.SocialActivityCounts" &&
//             (d?.entityUrn?.includes(
//               `urn:li:fsd_socialActivityCounts:urn:li:ugcPost:`,
//             ) ||
//               d?.entityUrn?.includes(
//                 `urn:li:fsd_socialActivityCounts:urn:li:activity:${urn}`,
//               )),
//         );

//         return {
//           postDetails: {
//             // urn: extractLinkedInURN(postDetails?.metadata?.backendUrn) || postDetails?.metadata?.backendUrn,
//             // postDate: parsePostDate(postDetails?.metadata?.backendUrn)?.toISOString(),
//             numComments: socialCounts?.numComments,
//             numLikes: socialCounts?.numLikes,
//             numShares: socialCounts?.numShares,
//             numImpressions: socialCounts?.numImpressions,
//             numViews: socialCounts?.numViews,
//             // postFormatType: parsePostFormatType(postDetails, true),
//             postContent: postDetails?.commentary?.text?.text,
//             postUrl: `https://www.linkedin.com/feed/update/${postDetails?.metadata?.backendUrn}`,
//             shareUrl: postDetails?.socialContent?.shareUrl,
//           },
//           rawRes: data,
//         };
//       } else console.log("No post data found in the response");
//     } catch (error) {
//       console.error("Error fetching single post data", error);
//     }

//     return null;
//   }
// };

// const singlePostScript = async () => {
//   let data = {};

//   let conditions = {
//     postVisible: false,
//     userLoggedin: false,
//     matchedCondition: 0,
//     ownPost: false,
//   };

//   if (document?.body?.querySelector("main#main-content > section article")) {
//     conditions = {
//       ...conditions,
//       postVisible: true,
//       userLoggedin: false,
//       matchedCondition: 1,
//     };
//   }

//   if (document?.body?.querySelector("main > div > section")) {
//     let own_post = false;
//     if (
//       document?.body?.querySelector(
//         "main > div > section div.content-analytics-entry-point",
//       )
//     ) {
//       own_post = true;
//     }
//     conditions = {
//       ...conditions,
//       postVisible: true,
//       userLoggedin: true,
//       matchedCondition: 2,
//       ownPost: own_post,
//       pageUrl: window.location.href,
//     };
//   }

//   const identifier = document.body?.textContent.match(
//     /"publicIdentifier":"(.*?)"/,
//   )?.[1];

//   if (identifier) {
//     conditions.identifier = identifier;
//   }

//   function getPostDetails1() {
//     function plaintext(element) {
//       if (element && element.textContent) {
//         let cleanedText = element.textContent.replace(/\s+/g, " ").trim();
//         return cleanedText;
//       }
//       return undefined;
//     }

//     const loginModalDismissBtn = document.querySelector(
//       'section button.modal__dismiss[data-tracking-control-name="public_post_contextual-sign-in-modal_modal_dismiss"]',
//     );
//     if (loginModalDismissBtn) {
//       loginModalDismissBtn.click();
//     }
//     const CTAModalDismissbtn = document.querySelector(
//       "div.cta-modal button.cta-modal__dismiss-btn",
//     );
//     if (CTAModalDismissbtn) {
//       CTAModalDismissbtn.click();
//     }

//     const mainSection = document.querySelector("#main-content > section");
//     if (!mainSection) {
//       return null;
//     }
//     const articleSection = mainSection?.querySelector("article");
//     const profileSection = articleSection?.querySelector(
//       '[data-test-id="main-feed-activity-card__entity-lockup"]',
//     );
//     const postContentSection = articleSection?.querySelector(
//       "div.attributed-text-segment-list__container",
//     );
//     const socialCountSection = articleSection?.querySelector(
//       "div.main-feed-activity-card__social-actions",
//     );

//     if (postContentSection && postContentSection.querySelector("button")) {
//       postContentSection.querySelector("button")?.click();
//     }

//     const title = mainSection.querySelector("h1")?.textContent?.trim();
//     let name = profileSection?.querySelector("div > div > a");
//     const tagline = profileSection
//       ?.querySelector("div > p")
//       ?.textContent?.trim();
//     const time = profileSection
//       ?.querySelector("div time")
//       ?.textContent?.trim()
//       ?.replace(/\s+/g, " ");
//     const postContent = postContentSection?.textContent?.trim();
//     const otherContentClass = postContentSection?.nextElementSibling
//       ?.getAttribute("class")
//       ?.trim();

//     const socialCount =
//       Array.from(socialCountSection?.querySelectorAll("a") || []).map((i) =>
//         i?.textContent?.trim(),
//       ) || [];

//     if (socialCount && socialCount.length > 0) {
//       likes = socialCount[0];
//       if (socialCount.length > 1) {
//         comments = socialCount[1]?.replace(" Comments", "");
//       }
//     }
//     let likes;
//     let comments;

//     if (socialCount && socialCount.length > 0) {
//       likes = parseInt(socialCount?.[0]?.replace(/[,\s]/g, "") ?? "", 10) || 0;
//       if (socialCount.length > 1) {
//         comments =
//           parseInt(
//             socialCount?.[1]?.replace(" Comments", "").replace(/[,\s]/g, "") ??
//               "",
//             10,
//           ) || 0;
//       }
//     }

//     const postUrn = articleSection?.getAttribute("data-activity-urn") || "";

//     const linkedinLink =
//       profileSection
//         ?.querySelector("div > div > a")
//         ?.getAttribute("href")
//         ?.split("?")?.[0] || "";

//     let postType = "";
//     let videoLink = "";
//     let imageLink = "";

//     if (plaintext(postContentSection)?.length > 0) {
//       postType = "text";
//     }

//     if (otherContentClass?.includes("video")) {
//       postType = "video";
//       if (plaintext(postContentSection)?.length > 0) {
//         postType = "text/video";
//       }
//       videoLink =
//         postContentSection?.nextElementSibling
//           ?.querySelector("video")
//           ?.getAttribute("src") || "";
//     }

//     if (otherContentClass?.includes("image")) {
//       postType = "image";
//       if (plaintext(postContentSection)?.length > 0) {
//         postType = "text/image";
//       }
//       imageLink =
//         postContentSection?.nextElementSibling
//           ?.querySelector("img")
//           ?.getAttribute("src") || "";
//     }

//     const followersSelector =
//       "div.public-post-author-card > div p.public-post-author-card__followers";
//     const totalPostsSelector =
//       "div.public-post-author-card > div > div > ul > li.public-post-author-card__posts";

//     const followersText = document.body
//       .querySelector(followersSelector)
//       ?.textContent?.trim();
//     const totalPostsText = document.body
//       .querySelector(totalPostsSelector)
//       ?.textContent?.trim();

//     const followers = followersText
//       ? parseInt(followersText.split(" ")[0].replace(/[,\s]/g, ""))
//       : 0;
//     const totalPosts = totalPostsText
//       ? parseInt(totalPostsText.split(" ")[0].replace(/[,\s]/g, ""))
//       : 0;

//     const postData = {
//       followers,
//       totalPosts,
//       title,
//       name: name ? plaintext(name) || "" : "",
//       tagline,
//       linkedinLink,
//       time,
//       postContent,
//       otherContentClass,
//       postType,
//       imageLink,
//       videoLink,
//       likes,
//       comments,
//       postUrn,
//       pageUrl: window.location.href,
//       postUrl: postUrn
//         ? `https://www.linkedin.com/feed/update/${postUrn}`
//         : window.location.href?.split("?")?.[0],
//       authorVanityName: linkedinLink?.split("/in/")?.[1]?.split("/")?.[0],
//     };
//     return postData;
//   }

//   function getPostDetails2() {
//     let postData = {};

//     let mainSection = document.querySelector("main > div > section");
//     let articleSection = mainSection?.querySelector(
//       "div.fie-impression-container",
//     );
//     let profileSection = articleSection?.querySelector(
//       "div.relative div.update-components-actor__container",
//     );
//     let postContentSection = articleSection?.querySelector(
//       "div.feed-shared-update-v2__description",
//     );
//     let socialCountSection = articleSection?.querySelector(
//       "div.social-details-social-counts",
//     );

//     postData.postUrn = document.body
//       .querySelector(
//         "div[data-view-name=feed-full-update] div.feed-shared-update-v2--minimal-padding",
//       )
//       ?.getAttribute("data-urn");
//     // ?.split("urn:li:activity:")?.[1];

//     postData.name = profileSection
//       ?.querySelector(
//         "div.update-components-actor__meta a.update-components-actor__meta-link span.update-components-actor__title span.t-bold span[dir='ltr'] span.visually-hidden",
//       )
//       ?.textContent?.trim();
//     postData.tagline = profileSection?.querySelector(
//       "div.update-components-actor__meta a.update-components-actor__meta-link span.update-components-actor__description span.visually-hidden",
//     )?.innerText;
//     postData.postDate = profileSection
//       ?.querySelector(
//         "div.update-components-actor__meta a.update-components-actor__sub-description-link .update-components-actor__sub-description span.visually-hidden",
//       )
//       ?.innerText?.trim();

//     postData.linkedinLink = profileSection
//       ?.querySelector(
//         "div.update-components-actor__meta a.update-components-actor__meta-link",
//       )
//       ?.href?.split("?")?.[0];

//     let postSocialCounts = Array?.from(
//       articleSection?.querySelectorAll(
//         "div.update-v2-social-activity div.social-details-social-counts ul li",
//       ) || [],
//     )?.map((e) =>
//       e?.textContent?.trim()?.replaceAll("\n", "")?.replaceAll(/\s+/g, " "),
//     );

//     // ---------------- counts ----------------
//     const parseNumber = (str) => parseInt(str?.replace(/,/g, "") || "0", 10);

//     postData.likes = parseNumber(
//       articleSection?.querySelector(
//         "div.update-v2-social-activity div.social-details-social-counts ul > li button[data-reaction-details] span span.social-details-social-counts__social-proof-fallback-number",
//       )?.textContent,
//     );

//     const notReactions = articleSection?.querySelector(
//       "div.update-v2-social-activity div.social-details-social-counts ul > li[data-non-reaction-details]",
//     );
//     const [comments, reposts] = Array.from(
//       notReactions?.querySelectorAll("ul > li button") || [],
//     )
//       ?.map((e) => e?.getAttribute("aria-label"))
//       ?.reduce(
//         (acc, item) => {
//           const num = parseNumber(item?.split(" ")?.[0]);
//           item?.includes("comment")
//             ? (acc[0] = num)
//             : item?.includes("repost") && (acc[1] = num);
//           return acc;
//         },
//         [0, 0],
//       );

//     postData.impressions = parseNumber(
//       mainSection
//         ?.querySelector(".ca-entry-point__num-views")
//         ?.textContent?.trim(),
//     );

//     postData.comments = comments;
//     postData.reposts = reposts;

//     //  --------------- counts -------------

//     // let comments = postSocialCounts?.filter(e => e?.includes("comments") || e?.includes("comment"))?.[0];
//     // // postData.comments = comments ? comments?.trim()?.split(" ")?.[0] : "0";
//     // comments = comments?.trim()?.split(" ")?.[0]?.replace(/[,\s]/g, "");

//     // if (comments?.length > 0) {
//     //     postData.comments = parseInt(comments);
//     // }

//     // let reposts = postSocialCounts?.filter(e => e?.includes("reposts") || e?.includes("repost"))?.[0];
//     // // postData.reposts = reposts ? reposts?.trim()?.split(" ")?.[0] : "0";
//     // reposts = reposts?.trim()?.split(" ")?.[0]?.replace(/[,\s]/g, "");

//     // if (reposts?.length > 0) {
//     //     postData.reposts = parseInt(reposts);
//     // }

//     postSocialCounts = postSocialCounts ? postSocialCounts : [];

//     // let impressions = mainSection?.querySelector(".ca-entry-point__num-views");
//     // if (impressions) {
//     //     impressions = impressions?.textContent?.trim();
//     //     impressions = impressions?.split(" ");
//     //     if (impressions?.length > 0) {
//     //         impressions = impressions?.[0]?.trim()?.replace(/[,\s]/g, "")
//     //         if (impressions?.length > 0) {
//     //             postData.impressions = parseInt(impressions)
//     //         }
//     //     }
//     // }

//     postData.postContent = postContentSection?.innerText?.trim();

//     // let likes = articleSection?.querySelector("div.update-v2-social-activity div.social-details-social-counts ul li button")?.getAttribute("aria-label")?.trim()?.split(" ")?.[0];
//     // let likes2 = articleSection?.querySelector("div.update-v2-social-activity div.social-details-social-counts span.social-details-social-counts__social-proof-fallback-number")?.textContent?.trim();

//     // likes = likes?.trim()?.replace(/[,\s]/g, "");
//     // likes2 = likes2?.trim()?.replace(/[,\s]/g, "");

//     // if (likes?.length > 0 && likes2?.length > 0) {
//     //     likes = Math.max(parseInt(likes), parseInt(likes2));
//     // } else if (likes?.length > 0) {
//     //     likes = parseInt(likes);
//     // } else if (likes2?.length > 0) {
//     //     likes = parseInt(likes2);
//     // }

//     // if (likes > 0) {
//     //     postData.likes = likes;
//     // }

//     postData.postUrl = postData?.postUrn
//       ? `https://www.linkedin.com/feed/update/${postData?.postUrn}`
//       : window.location.href?.split("?")?.[0];
//     postData.pageUrl = window.location.href;
//     postData.analyticsPageUrl = document?.querySelector(
//       ".content-analytics-entry-point a",
//     )?.href;
//     postData.authorVanityName = postData?.linkedinLink
//       ?.split("/in/")?.[1]
//       ?.split("/")?.[0];

//     postData.rawFullPost = articleSection?.innerText;

//     return postData;
//   }

//   if (conditions.matchedCondition === 1) {
//     data = getPostDetails1();
//   } else if (conditions.matchedCondition === 2) {
//     data = getPostDetails2();
//   }

//   return {
//     postData: data,
//     conditions,
//   };
// };

// /**
//  * Fetches all LinkedIn comments for a post with pagination
//  * @returns {Promise<Array>} Array of processed comment data
//  */
// async function fetchAllLinkedInComments() {
//   let allComments = [];
//   let currentStart = 0;
//   let pageSize = 2;
//   let total = Infinity;
//   let postType = "activity",
//     postId;

//   try {
//     // Keep fetching until we've received all comments
//     while (currentStart < total) {
//       // Get comment ID and post information on first run only
//       const commentId = currentStart === 0 ? getCommentId() : null;

//       if (currentStart === 0 && !commentId) {
//         console.error("Could not find a comment ID");
//         return [];
//       }

//       // Extract post type and ID from the comment ID (only needed on first run)

//       if (currentStart === 0) {
//         console.log("Found comment ID:", commentId);

//         if (commentId.includes("ugcPost")) {
//           // Format: urn:li:comment:(ugcPost:7307366421280256001,7307374135087616000)
//           const match = commentId.match(/ugcPost:(\d+)/);
//           if (match && match[1]) {
//             postType = "ugcPost";
//             postId = match[1];
//           }
//         } else if (commentId.includes("activity")) {
//           // Format: urn:li:comment:(activity:7305437386581123072,7305612663735132161)
//           const match = commentId.match(/activity:(\d+)/);
//           if (match && match[1]) {
//             postType = "activity";
//             postId = match[1];
//           }
//         }

//         if (!postType || !postId) {
//           console.error(
//             "Could not parse post type and ID from comment ID:",
//             commentId,
//           );
//           return [];
//         }

//         console.log(`Detected post type: ${postType}, post ID: ${postId}`);
//       }

//       // API endpoint base URL
//       const baseUrl = "https://www.linkedin.com/voyager/api/graphql";

//       // Query parameters with pagination
//       const queryParams = `includeWebMetadata=true&variables=(count:${pageSize},numReplies:1,socialDetailUrn:urn%3Ali%3Afsd_socialDetail%3A%28urn%3Ali%3A${postType}%3A${postId}%2Curn%3Ali%3A${postType}%3A${postId}%2Curn%3Ali%3AhighlightedReply%3A-%29,sortOrder:REVERSE_CHRONOLOGICAL,start:${currentStart})&queryId=voyagerSocialDashComments.95ed44bc87596acce7c460c70934d0ff`;

//       // Complete URL
//       const url = `${baseUrl}?${queryParams}`;

//       // Organize headers
//       const headers = {
//         // Content negotiation
//         accept: "application/vnd.linkedin.normalized+json+2.1",
//         "accept-encoding": "gzip, deflate, br, zstd",
//         "accept-language": "en-US,en;q=0.9",
//         "content-type": "application/json",

//         // Authentication & security
//         "csrf-token": document.cookie
//           .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
//           .replace(/^["']|["']$/g, ""),

//         // Request context
//         referer: window.location.href,
//         "x-li-lang": "en_US",
//         "x-li-page-instance":
//           "urn:li:page:d_flagship3_detail_base;Ccib7xyQQxWJqksw9mCfOA==",
//         "x-li-pem-metadata": "Voyager - Feed - Comments=sort-comments",
//         "x-restli-protocol-version": "2.0.0",

//         // Browser/client information
//         priority: "u=1, i",
//         "sec-ch-prefers-color-scheme": "dark",
//         "sec-ch-ua":
//           '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
//         "sec-ch-ua-mobile": "?0",
//         "sec-ch-ua-platform": '"Windows"',
//         "sec-fetch-dest": "empty",
//         "sec-fetch-mode": "cors",
//         "sec-fetch-site": "same-origin",
//         "user-agent": navigator.userAgent,
//         "x-li-track":
//           '{"clientVersion":"1.13.33064","mpVersion":"1.13.33064","osName":"web","timezoneOffset":5.5,"timezone":"Asia/Calcutta","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1.25,"displayWidth":1920,"displayHeight":1080}',
//       };

//       console.log(`Fetching comments with URL (start=${currentStart}): ${url}`);

//       // Make the API request
//       const response = await fetch(url, {
//         method: "GET",
//         headers: headers,
//         redirect: "follow",
//       });

//       // Parse response as JSON
//       const result = await response.json();

//       // Update total from response if this is the first request
//       if (
//         result.data.data &&
//         result.data.data.socialDashCommentsBySocialDetail &&
//         result.data.data.socialDashCommentsBySocialDetail.paging
//       ) {
//         total = result.data.data.socialDashCommentsBySocialDetail.paging.total;
//         console.log(`Total comments to fetch: ${total}`);
//       }

//       // Process the comments from this page
//       if (result.included && Array.isArray(result.included)) {
//         const commentsOnThisPage = result.included.filter(
//           (item) => item.$type === "com.linkedin.voyager.dash.social.Comment",
//         );

//         console.log(`Found ${commentsOnThisPage.length} comments on this page`);

//         // Process these comments and add to our collection
//         const processedComments = extractLinkedInComments(
//           commentsOnThisPage,
//           result.included,
//         );
//         allComments = allComments.concat(processedComments);
//       }

//       // Update for next iteration
//       currentStart += pageSize;
//       pageSize = 10;

//       // Optional: Add a small delay to avoid hitting rate limits
//       await new Promise((resolve) => setTimeout(resolve, 300));
//     }

//     console.log(`Successfully fetched all ${allComments.length} comments`);
//     return allComments;
//   } catch (error) {
//     console.error("Error while fetching LinkedIn comments:", error);
//     // Return whatever comments we've managed to collect so far
//     return allComments;
//   }
// }

// /**
//  * Get comment ID from the current LinkedIn post
//  */
// function getCommentId() {
//   let commentContainer = document?.body?.querySelector(
//     "div.feed-shared-update-v2__comments-container",
//   );
//   let commentList = commentContainer?.querySelector(
//     "div.comments-comment-list__container",
//   );
//   let allComments = Array.from(
//     commentList?.querySelectorAll(":scope > article.comments-comment-entity") ||
//       [],
//   );
//   let comment = allComments[0];
//   const commentDataId = comment?.getAttribute("data-id");
//   return commentDataId;
// }

// /**
//  * Extract relevant data from LinkedIn comments
//  */
// function extractLinkedInComments(commentsData, includedArray) {
//   // Convert input to array if it's not already
//   const commentsList = Array.isArray(commentsData)
//     ? commentsData
//     : [commentsData];

//   const extractedComments = [];

//   commentsList.forEach((comment) => {
//     try {
//       // Extract mentions from commentary
//       const mentions = [];
//       if (comment.commentary && comment.commentary.attributesV2) {
//         comment.commentary.attributesV2.forEach((attr) => {
//           if (attr.detailData && attr.detailData.hyperlink) {
//             mentions.push({
//               text: comment.commentary.text.substring(
//                 attr.start,
//                 attr.start + attr.length,
//               ),
//               url: attr.detailData.hyperlink,
//             });
//           }
//         });
//       }

//       // Determine connection degree (1st, 2nd, 3rd+)
//       let connectionDegree = null;
//       if (
//         comment.commenter &&
//         comment.commenter.supplementaryActorInfo &&
//         comment.commenter.supplementaryActorInfo.text
//       ) {
//         const connectionText = comment.commenter.supplementaryActorInfo.text;
//         connectionDegree = connectionText.trim();
//       }

//       // Determine if it's a reply and get parent info
//       const isReply =
//         comment.permalink && comment.permalink.includes("replyUrn");
//       let parentCommentId = null;

//       if (isReply && comment.permalink) {
//         // Extract parent comment ID from permalink if available
//         const urlParams = new URLSearchParams(comment.permalink.split("?")[1]);
//         const commentUrn = urlParams.get("commentUrn");

//         if (commentUrn) {
//           // Extract the parent comment ID from the commentUrn parameter
//           // Format: urn:li:comment:(activity:7313182139095691265,7313594628614565888)
//           const match = commentUrn.match(/,(\d+)\)/);
//           if (match && match[1]) {
//             parentCommentId = match[1];
//           }
//         }
//       }

//       // For simplicity, we'll determine comment ID from the URN
//       const commentUrnParts = comment.urn ? comment.urn.split(",") : ["", ""];
//       const commentId = commentUrnParts[1]
//         ? commentUrnParts[1].replace(")", "")
//         : null;

//       let likesCount = 0;
//       let repliesCount = 0;
//       let reactions = [];

//       if (includedArray && Array.isArray(includedArray) && commentId) {
//         // Find social activity data for this comment
//         const socialActivity = includedArray.find(
//           (item) =>
//             item.$type ===
//               "com.linkedin.voyager.dash.feed.SocialActivityCounts" &&
//             item.entityUrn &&
//             item.entityUrn.includes(commentId),
//         );

//         if (socialActivity) {
//           repliesCount = socialActivity.numComments || 0;

//           // Extract reaction counts
//           if (
//             socialActivity.reactionTypeCounts &&
//             Array.isArray(socialActivity.reactionTypeCounts)
//           ) {
//             socialActivity.reactionTypeCounts.forEach((reaction) => {
//               likesCount += reaction.count || 0;

//               reactions.push({
//                 type: reaction.reactionType,
//                 count: reaction.count || 0,
//               });
//             });
//           }
//         }
//       }

//       const commentData = {
//         commentText: comment.commentary ? comment.commentary.text : null,
//         isAuthorComment: comment.commenter ? comment.commenter.author : false,
//         profileUrn:
//           comment.commenter && comment.commenter.actor
//             ? comment.commenter.actor["*profileUrn"]
//             : null,
//         profileLink: comment.commenter ? comment.commenter.navigationUrl : null,
//         tagline: comment.commenter ? comment.commenter.subtitle : null,
//         commenterId:
//           comment.commenter && comment.commenter.title
//             ? comment.commenter.title.text
//             : null,
//         postedTime: comment.createdAt,
//         isEdited: comment.edited || false,
//         isPinned: comment.pinned || false,
//         mentions: mentions,
//         connectionDegree: connectionDegree,
//         commentDataId: commentId,
//         isReply: isReply,
//         parentDataId: parentCommentId,
//         actorType:
//           comment.commenter &&
//           comment.commenter.actor &&
//           comment.commenter.actor["*companyUrn"]
//             ? "company"
//             : "person",
//         likesCount: likesCount,
//         repliesCount: repliesCount,
//         reactions: reactions,
//       };

//       extractedComments.push(commentData);
//     } catch (error) {
//       console.error("Error processing comment:", error);
//     }
//   });

//   return extractedComments;
// }

// /**
//  * Main function to fetch and process all comments
//  */
// async function getAllLinkedInComments() {
//   try {
//     const allProcessedComments = await fetchAllLinkedInComments();
//     console.log(
//       `Successfully processed ${allProcessedComments.length} LinkedIn comments`,
//     );
//     return allProcessedComments;
//   } catch (error) {
//     console.error("Failed to get LinkedIn comments:", error);
//     return [];
//   }
// }

// const postSummaryScript = async () => {
//   let data = {};
//   let targetElementList = [];
//   const identifier = document.body?.textContent.match(
//     /"publicIdentifier":"(.*?)"/,
//   )?.[1];

//   let mainSection = document?.body?.querySelector(
//     "main[aria-label='Post analytics']",
//   );

//   let postAnalyticsSection = mainSection?.querySelector(
//     "main .member-analytics-mini-post",
//   );

//   let otherSectionList = Array?.from(
//     mainSection?.querySelectorAll(
//       "div.member-analytics-addon-card-list section.member-analytics-addon-card__base-card",
//     ) || [],
//   );

//   let discoverySection = otherSectionList?.find(
//     (e) =>
//       e
//         ?.querySelector(
//           ".member-analytics-addon-header__content h2.member-analytics-addon-header__title",
//         )
//         ?.innerText?.trim()
//         ?.toLowerCase() === "discovery",
//   );

//   targetElementList = Array.from(
//     discoverySection?.querySelectorAll(
//       "ul.member-analytics-addon-summary li",
//     ) || [],
//   );

//   data.impressions = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("p.member-analytics-addon-list-item__description")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("impression"),
//       )
//       ?.querySelector("p.text-heading-large")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.memberReach = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("p.member-analytics-addon-list-item__description")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("reach"),
//       )
//       ?.querySelector("p.text-heading-large")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   let engagementSection = otherSectionList?.find(
//     (e) =>
//       e
//         ?.querySelector(
//           ".member-analytics-addon-header__content h2.member-analytics-addon-header__title",
//         )
//         ?.innerText?.trim()
//         ?.toLowerCase() === "social engagement",
//   );

//   targetElementList = Array.from(
//     engagementSection?.querySelectorAll(
//       "ul[aria-labelledby*='member-analytics-addon-card'] li",
//     ) || [],
//   );

//   data.likes = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("span.member-analytics-addon__cta-list-item-title")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("reaction"),
//       )
//       ?.querySelector("span.member-analytics-addon__cta-list-item-text")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.comments = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("span.member-analytics-addon__cta-list-item-title")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("comment"),
//       )
//       ?.querySelector("span.member-analytics-addon__cta-list-item-text")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.reposts = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("span.member-analytics-addon__cta-list-item-title")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("repost"),
//       )
//       ?.querySelector("span.member-analytics-addon__cta-list-item-text")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.saves = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("span.member-analytics-addon__cta-list-item-title")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("saves"),
//       )
//       ?.querySelector("span.member-analytics-addon__cta-list-item-text")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.sendsOnLinkedIn = parseInt(
//     targetElementList
//       ?.find((e) =>
//         e
//           ?.querySelector("span.member-analytics-addon__cta-list-item-title")
//           ?.innerText?.trim()
//           ?.toLowerCase()
//           ?.includes("sends on linkedin"),
//       )
//       ?.querySelector("span.member-analytics-addon__cta-list-item-text")
//       ?.innerText?.trim()
//       ?.replace(/,/g, ""),
//   );

//   data.imageContentLink = postAnalyticsSection?.querySelector(
//     "img.feed-mini-update-commentary__image",
//   )?.src;

//   data.postContent = postAnalyticsSection?.querySelector(
//     "a.feed-mini-update-optional-navigation-context-wrapper[data-test-app-aware-link] > div[class*=inline-show-more-text]",
//   )?.innerText;
//   data.postUrl = postAnalyticsSection
//     ?.querySelector("a")
//     ?.href?.split("?")?.[0];

//   async function getAudience() {
//     function getChartData() {
//       return Array.from(
//         document.body.querySelectorAll(
//           "div.member-analytics-addon-loader ul li.member-analytics-addon-bar-chart__row",
//         ) || [],
//       ).map((e) => {
//         let value = e
//           .querySelector(
//             "label.member-analytics-addon-bar-chart__bar-label > span",
//           )
//           ?.innerText?.trim();
//         let percentage = e
//           .querySelector(
//             "label.member-analytics-addon-bar-chart__bar-label span.member-analytics-addon-bar-chart__bar-label-values",
//           )
//           ?.innerText?.trim();
//         return { value, percentage };
//       });
//     }

//     function delay(ms) {
//       return new Promise((resolve) => setTimeout(resolve, ms));
//     }

//     async function extractData() {
//       let data = {};

//       await delay(1000); // Wait for data to load
//       // Step 2: Locations
//       document.body
//         .querySelector('button[data-control-name="analytics_breakdown"]')
//         ?.click(); // open dropdown
//       await delay(1000); // Wait for data to load
//       // document.body.querySelector('li[aria-label="Locations"]')?.click(); // click on locations
//       document.body
//         .querySelector(
//           '.artdeco-dropdown__content-inner ul[role=menu] li[aria-label*="Locations"]',
//         )
//         ?.click();
//       await delay(3000); // Wait for data to load
//       currentSection = document.body
//         .querySelector('[data-control-name="analytics_breakdown"]')
//         ?.innerText?.trim()
//         ?.toLowerCase();
//       if (currentSection?.includes("locations")) {
//         data.locations = getChartData();
//       }

//       // Step 1: Job Titles
//       document.body
//         .querySelector('button[data-control-name="analytics_breakdown"]')
//         ?.click(); // open dropdown
//       await delay(1000); // Wait for data to load
//       // document.body.querySelector('li[aria-label="Job titles"]')?.click(); // click on job titles
//       document.body
//         .querySelector(
//           '.artdeco-dropdown__content-inner ul[role=menu] li[aria-label*="Job titles"]',
//         )
//         ?.click();
//       await delay(3000); // Wait for data to load
//       currentSection = document.body
//         .querySelector('[data-control-name="analytics_breakdown"]')
//         ?.innerText?.trim()
//         ?.toLowerCase();
//       if (currentSection?.includes("job titles")) {
//         data.jobTitles = getChartData();
//       }

//       // Final Data Output
//       console.log(data);
//       return data;
//     }

//     // Execute the data extraction
//     return await extractData();
//   }

//   // data.demographics = await getAudience();
//   data.pageUrl =
//     document
//       .querySelector(
//         "div.member-analytics-mini-post a[data-test-app-aware-link]",
//       )
//       .href?.split("?")?.[0]
//       ?.trim() || window.location.href;
//   const match = data?.pageUrl?.match(/urn:li:activity:\d+/);

//   if (match) {
//     data.postUrn = match?.[0];
//   }

//   data.identifier = identifier;
//   data.profileUrl = `https://www.linkedin.com/in/${identifier}`;
//   data.authorVanityName = identifier;

//   return { postData: data };
// };

// const postSummaryScriptV2 = async () => {
//   let parentPostData = null;

//   // Fetch parent post data with error handling
//   try {
//     parentPostData = await postSummaryScript();
//   } catch (error) {
//     console.error("Error fetching parent post data:", error);
//     // Return minimal data structure if parent data fetch fails
//     return {
//       postData: {
//         demographics: { jobTitles: undefined, locations: undefined },
//         demographicsV2: null,
//       },
//     };
//   }

//   const baseUrl = "https://www.linkedin.com/voyager/api/graphql";

//   async function fetchAudienceDemographcs(dimensionType, postUrn) {
//     const partPostUrn = postUrn?.split(":");

//     if (partPostUrn?.length > 3) {
//       postUrn = partPostUrn?.[3];
//     } else {
//     }
//     const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${postUrn}/`;
//     const headers = {
//       Accept: "application/vnd.linkedin.normalized+json+2.1",
//       "Accept-Encoding": "gzip, deflate, br, zstd",
//       "Accept-Language": "en-US,en;q=0.9",
//       "Csrf-Token": document.cookie
//         .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
//         .replace(/^["']|["']$/g, ""),
//       Referer: referer,
//       "Sec-Ch-Ua": getSecChUaHeader(),
//       "Sec-Ch-Ua-Mobile": "?0",
//       "Sec-Ch-Ua-Platform": '"Windows"',
//       "Sec-Fetch-Dest": "empty",
//       "Sec-Fetch-Mode": "cors",
//       "Sec-Fetch-Site": "same-origin",
//       "User-Agent": navigator.userAgent,
//       "X-Li-Lang": "en_US",
//       "x-li-track":
//         '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
//       "X-Restli-Protocol-Version": "2.0.0",
//     };

//     // const queryParams = `includeWebMetadata=true&variables=(dimensionType:${dimensionType},edgeInsightsAnalyticsCardUrns:List(urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28POST_SUMMARY%2Curn%3Ali%3Aactivity%3A${postUrn}%2CANALYTICS%2CDETAILS%2CTEXT_POST_IMPRESSION_DETAILS%29),query:())&queryId=voyagerPremiumDashAnalyticsCard.eaf1b7e22d8693e353e2dd99d884de7f`

//     const queryParams = `variables=(dimensionType:${dimensionType},edgeInsightsAnalyticsCardUrns:List(urn%3Ali%3Afsd_edgeInsightsAnalyticsCard%3A%28POST_SUMMARY%2Curn%3Ali%3Aactivity%3A${postUrn}%2CANALYTICS%2CDETAILS%2CTEXT_POST_IMPRESSION_DETAILS%29),query:())&queryId=voyagerPremiumDashAnalyticsCard.eaf1b7e22d8693e353e2dd99d884de7f`;

//     try {
//       const response = await fetch(`${baseUrl}?${queryParams}`, {
//         method: "GET",
//         headers: headers,
//         credentials: "include",
//       });

//       if (!response.ok)
//         throw new Error(`HTTP error! status: ${response.status}`);
//       const data = await response.json();
//       if (data && data.included.length > 0) {
//         const demographics =
//           data?.included[0]?.component?.barChartModule?.dataPoints?.map((d) => {
//             return {
//               value: d?.xLabel?.text,
//               percentage: d?.yFormattedValue?.text,
//               numPercentage: d?.yPercent,
//             };
//           });
//         return {
//           count:
//             data?.included[0]?.component?.barChartModule
//               ?.numOfInitialDataPointToShow,
//           demographics: demographics,
//           rawRes: data,
//         };
//       } else console.log("No demographics data found in the response");
//     } catch (error) {
//       console.error(`Error fetching demographics for ${dimensionType}:`, error);
//     }
//   }

//   async function fetchPostSumary(postUrn) {
//     let metricsData = null;
//     let DemographicsData = null;
//     let EngagementDemographics = null;

//     try {
//       const partPostUrn = postUrn?.split(":");

//       if (partPostUrn?.length > 3) {
//         postUrn = partPostUrn?.[3];
//       } else {
//       }
//       const referer = `https://www.linkedin.com/analytics/post-summary/urn:li:activity:${postUrn}/`;
//       const headers = {
//         Accept: "application/vnd.linkedin.normalized+json+2.1",
//         "Accept-Encoding": "gzip, deflate, br, zstd",
//         "Accept-Language": "en-US,en;q=0.9",
//         "Csrf-Token": document.cookie
//           .replace(/(?:(?:^|.*;\s*)JSESSIONID\s*\=\s*([^;]*).*$)|^.*$/, "$1")
//           .replace(/^["']|["']$/g, ""),
//         Referer: referer,
//         "Sec-Ch-Ua": getSecChUaHeader(),
//         "Sec-Ch-Ua-Mobile": "?0",
//         "Sec-Ch-Ua-Platform": '"Windows"',
//         "Sec-Fetch-Dest": "empty",
//         "Sec-Fetch-Mode": "cors",
//         "Sec-Fetch-Site": "same-origin",
//         "User-Agent": navigator.userAgent,
//         "X-Li-Lang": "en_US",
//         "x-li-track":
//           '{"clientVersion":"1.10.*","mpVersion":"1.10.*","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web","displayDensity":1,"displayWidth":1920,"displayHeight":1080}',
//         "X-Restli-Protocol-Version": "2.0.0",
//       };
//       //.................................
//       // Fetch metrics data with individual error handling
//       try {
//         const MetricsResponse = await fetch(
//           `https://www.linkedin.com/voyager/api/graphql?variables=(analyticsEntityUrn:(activityUrn:urn%3Ali%3Aactivity%3A${postUrn}),query:(),surfaceType:POST_SUMMARY)&queryId=voyagerPremiumDashAnalyticsView.4907e6ea65a8497d9f4c4aeb11136b13`,
//           {
//             method: "GET",
//             headers: headers,
//             credentials: "include",
//           },
//         );

//         if (MetricsResponse?.ok) {
//           const MetricsResponseData = await MetricsResponse?.json();
//           // console.log("MetricsResponseData", MetricsResponseData);
//           try {
//             metricsData = await extractLinkedInMetrics(
//               MetricsResponseData?.included,
//             );
//           } catch (error) {
//             console.error("Error extracting metrics data:", error);
//           }
//         }
//       } catch (error) {
//         console.error("Error fetching metrics response:", error);
//       }

//       // Fetch link engagement data with individual error handling
//       try {
//         const LinkEngagementResponse = await fetch(
//           `https://www.linkedin.com/voyager/api/graphql?variables=(product:CREATOR_LINK_CLICKS_DETAIL,targetEntityUrn:urn%3Ali%3Aactivity%3A${postUrn},query:(selectedFilters:List()))&queryId=voyagerPremiumDashLibraView.1463d0449cd44787292d3ec13c8d47e1`,
//           {
//             method: "GET",
//             headers: headers,
//             credentials: "include",
//           },
//         );

//         if (LinkEngagementResponse?.ok && metricsData) {
//           const LinkEngagementResponseData =
//             await LinkEngagementResponse?.json();
//           // console.log("LinkEngagementResponseData", LinkEngagementResponseData);
//           try {
//             // Extract link engagement data from the new API response
//             const linkItems =
//               LinkEngagementResponseData?.included?.[0]?.components?.[0]
//                 ?.leiaComponent?.customComponent?.creatorComponent
//                 ?.metricRowList?.items;

//             if (linkItems && Array.isArray(linkItems)) {
//               metricsData.linkEngagement = {
//                 totalLinkClicks: 0,
//                 links: [],
//               };

//               linkItems.forEach((item) => {
//                 const url = item?.title?.text;
//                 const clicks = parseInt(item?.value) || 0;

//                 if (url && clicks > 0) {
//                   metricsData.linkEngagement.links.push({
//                     url: url,
//                     clicks: clicks,
//                   });
//                   metricsData.linkEngagement.totalLinkClicks += clicks;
//                 }
//               });
//             }
//           } catch (error) {
//             console.error("Error extracting link engagement data:", error);
//           }
//         }
//       } catch (error) {
//         console.error("Error fetching link engagement response:", error);
//       }

//       // Fetch demographics data with individual error handling
//       try {
//         const DemographicsResponse = await fetch(
//           `https://www.linkedin.com/voyager/api/graphql?variables=(analyticsEntityUrn:(activityUrn:urn%3Ali%3Aactivity%3A${postUrn}),query:(),surfaceType:POST_SUMMARY_DEMOGRAPHIC_DETAIL)&queryId=voyagerPremiumDashAnalyticsView.08a0ce1b625fe246dc8159cbf3d31552`,
//           {
//             method: "GET",
//             headers: headers,
//             credentials: "include",
//           },
//         );
//         // console.log("DemographicsResponse", DemographicsResponse);

//         if (DemographicsResponse?.ok) {
//           const DemographicsResponseData = await DemographicsResponse?.json();
//           try {
//             DemographicsData = await parseLinkedInDemographics(
//               DemographicsResponseData?.included,
//             );
//           } catch (error) {
//             console.error("Error extracting demographics data:", error);
//           }
//         }
//       } catch (error) {
//         console.error("Error fetching demographics response:", error);
//       }

//       // Fetch engagement demographics with individual error handling
//       try {
//         EngagementDemographics = await fetchLinkedInDemographics(postUrn);
//       } catch (error) {
//         console.error("Error fetching engagement demographics:", error);
//       }
//       // ...........................................................

//       return {
//         metricsData,
//         DemographicsData,
//         EngagementDemographics,
//       };
//     } catch (error) {
//       console.error("Error in fetchPostSumary:", error);
//       // Return partial data even if there's an error
//       return {
//         metricsData,
//         DemographicsData,
//         EngagementDemographics,
//       };
//     }
//   }

//   const dimensionMapping = {
//     // OCCUPATION_SENIORITY: "seniority",
//     REGION_GEO: "locations",
//     STRUCTURED_TITLE_OCCUPATION: "jobTitles",
//   };

//   const demogData = {
//     jobTitles: undefined,
//     locations: undefined,
//   };

//   // Fetch audience demographics with error handling for each dimension
//   for (const [dimensionType, mappedType] of Object.entries(dimensionMapping)) {
//     try {
//       const resData = await fetchAudienceDemographcs(
//         dimensionType,
//         parentPostData?.postData?.postUrn,
//       );

//       if (resData) {
//         demogData[mappedType] = resData?.demographics;
//         console.log(
//           `Demographics fetched successfully for ${mappedType}`,
//           resData,
//         );
//       } else {
//         console.log(`No data returned for ${mappedType}`);
//       }
//     } catch (error) {
//       console.error(`Error fetching demographics for ${dimensionType}:`, error);
//       // Continue with next dimension even if this one fails
//     }

//     // Add delay between requests
//     try {
//       await new Promise((r) => setTimeout(r, 1000));
//     } catch (error) {
//       console.error("Error in delay:", error);
//     }
//   }

//   // Fetch detailed demographics with error handling
//   let DemogDataV2 = null;
//   try {
//     DemogDataV2 = await fetchPostSumary(parentPostData?.postData?.postUrn);
//   } catch (error) {
//     console.error("Error fetching detailed demographics (DemogDataV2):", error);
//   }

//   // Safely assign data to parent object
//   try {
//     if (parentPostData && parentPostData.postData) {
//       parentPostData.postData.demographics = demogData;
//       parentPostData.postData.demographicsV2 = DemogDataV2;
//     }
//   } catch (error) {
//     console.error("Error assigning demographics to parentPostData:", error);
//   }

//   return parentPostData;
// };
// function checkLogin() {
//   return new Promise((resolve, reject) => {
//     chrome.runtime.sendMessage({ action: "bg-checkLogin" }, (response) => {
//       resolve(response);
//     });
//   });
// }
// async function securityChecks() {
//   function getVanityName(url) {
//     if (url.includes("linkedin.com/in/")) {
//       const parts = url.split("?")[0].split("/");
//       return parts[parts.length - 1] || parts[parts.length - 2] || null;
//     }
//     return null;
//   }

//   const currentUrl = window.location.href;

//   if (currentUrl.includes("linkedin.com")) {
//     const publicIdentifier = document.body.textContent.match(
//       /"publicIdentifier":"(.*?)"/,
//     )?.[1];

//     if (publicIdentifier) {
//       const result = await new Promise((resolve) => {
//         chrome.storage.local.get("UserData", resolve);
//       });

//       if (result?.UserData) {
//         const UserData = JSON.parse(result.UserData || "{}");
//         return getVanityName(UserData.linkedinLink) === publicIdentifier;
//       }
//     }
//   }

//   return false;
// }