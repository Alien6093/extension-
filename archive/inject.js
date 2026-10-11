
// ------------------- comments of a post ---------------------

const singlePostScript = async () => {

    let data = {};

    let conditions = {
        postVisible: false,
        userLoggedin: false,
        matchedCondition: 0,
        ownPost: false,
    }

    if (document?.body?.querySelector("main#main-content > section article")) {
        conditions = {
            ...conditions,
            postVisible: true,
            userLoggedin: false,
            matchedCondition: 1
        }
    }

    if (document?.body?.querySelector("main > div > section")) {

        let own_post = false;
        if (document?.body?.querySelector('main > div > section div.content-analytics-entry-point')) {
            own_post = true;
        }
        conditions = {
            ...conditions,
            postVisible: true,
            userLoggedin: true,
            matchedCondition: 2,
            ownPost: own_post,
            pageUrl: window.location.href
        }
    }

    const identifier = document.body?.textContent.match(/"publicIdentifier":"(.*?)"/)?.[1];

    if (identifier) {
        conditions.identifier = identifier
    }

    function getPostDetails1() {
        function plaintext(element) {
            if (element && element.textContent) {
                let cleanedText = element.textContent.replace(/\s+/g, " ").trim()
                return cleanedText
            }
            return undefined
        }

        const loginModalDismissBtn = document.querySelector(
            'section button.modal__dismiss[data-tracking-control-name="public_post_contextual-sign-in-modal_modal_dismiss"]'
        )
        if (loginModalDismissBtn) {
            loginModalDismissBtn.click()
        }
        const CTAModalDismissbtn = document.querySelector(
            "div.cta-modal button.cta-modal__dismiss-btn"
        )
        if (CTAModalDismissbtn) {
            CTAModalDismissbtn.click()
        }

        const mainSection = document.querySelector("#main-content > section")
        if (!mainSection) {
            return null
        }
        const articleSection = mainSection?.querySelector("article")
        const profileSection = articleSection?.querySelector(
            '[data-test-id="main-feed-activity-card__entity-lockup"]'
        )
        const postContentSection = articleSection?.querySelector(
            "div.attributed-text-segment-list__container"
        )
        const socialCountSection = articleSection?.querySelector(
            "div.main-feed-activity-card__social-actions"
        )

        if (postContentSection && postContentSection.querySelector("button")) {
            postContentSection.querySelector("button")?.click()
        }

        const title = mainSection.querySelector("h1")?.textContent?.trim()
        let name = profileSection?.querySelector("div > div > a")
        const tagline = profileSection?.querySelector("div > p")?.textContent?.trim()
        const time = profileSection
            ?.querySelector("div time")
            ?.textContent?.trim()
            ?.replace(/\s+/g, " ")
        const postContent = postContentSection?.textContent?.trim()
        const otherContentClass = postContentSection?.nextElementSibling
            ?.getAttribute("class")
            ?.trim()

        const socialCount =
            Array.from(socialCountSection?.querySelectorAll("a") || []).map(i =>
                i?.textContent?.trim()
            ) || []

        // if (socialCount && socialCount.length > 0) {
        //     likes = socialCount[0];
        //     if (socialCount.length > 1) {
        //         comments = socialCount[1]?.replace(" Comments", "");
        //     }
        // }
        let likes
        let comments

        if (socialCount && socialCount.length > 0) {
            likes = parseInt(socialCount?.[0]?.replace(/[,\s]/g, "") ?? "", 10) || 0
            if (socialCount.length > 1) {
                comments =
                    parseInt(
                        socialCount?.[1]?.replace(" Comments", "").replace(/[,\s]/g, "") ?? "",
                        10
                    ) || 0
            }
        }

        const postUrn = articleSection?.getAttribute("data-activity-urn") || ""

        const linkedinLink =
            profileSection?.querySelector("div > div > a")?.getAttribute("href") || ""

        let postType = ""
        let videoLink = ""
        let imageLink = ""

        if (plaintext(postContentSection)?.length > 0) {
            postType = "text"
        }

        if (otherContentClass?.includes("video")) {
            postType = "video"
            if (plaintext(postContentSection)?.length > 0) {
                postType = "text/video"
            }
            videoLink =
                postContentSection?.nextElementSibling
                    ?.querySelector("video")
                    ?.getAttribute("src") || ""
        }

        if (otherContentClass?.includes("image")) {
            postType = "image"
            if (plaintext(postContentSection)?.length > 0) {
                postType = "text/image"
            }
            imageLink =
                postContentSection?.nextElementSibling
                    ?.querySelector("img")
                    ?.getAttribute("src") || ""
        }

        const followersSelector =
            "div.public-post-author-card > div p.public-post-author-card__followers"
        const totalPostsSelector =
            "div.public-post-author-card > div > div > ul > li.public-post-author-card__posts"

        const followersText = document.body
            .querySelector(followersSelector)
            ?.textContent?.trim()
        const totalPostsText = document.body
            .querySelector(totalPostsSelector)
            ?.textContent?.trim()

        const followers = followersText
            ? parseInt(followersText.split(" ")[0].replace(/[,\s]/g, ""))
            : 0
        const totalPosts = totalPostsText
            ? parseInt(totalPostsText.split(" ")[0].replace(/[,\s]/g, ""))
            : 0

        const postData = {
            followers,
            totalPosts,
            title,
            name: name ? plaintext(name) || "" : "",
            tagline,
            linkedinLink,
            time,
            postContent,
            otherContentClass,
            postType,
            imageLink,
            videoLink,
            likes,
            comments,
            postUrn,
            postUrl: window.location.href?.split("?")?.[0],   // remove query params
        }
        return postData;
    }

    function getPostDetails2() {
        let postData = {}

        let mainSection = document.querySelector("main > div > section")
        let articleSection = mainSection?.querySelector("div.fie-impression-container")
        let profileSection = articleSection?.querySelector(
            'div.relative div.update-components-actor__container'
        )
        let postContentSection = articleSection?.querySelector("div.feed-shared-update-v2__description-wrapper")
        let socialCountSection = articleSection?.querySelector(
            "div.social-details-social-counts"
        )

        postData.postUrn = document.body.querySelector("div[data-view-name=feed-full-update] div.feed-shared-update-v2[role=region]")?.getAttribute("data-urn")
        // ?.split("urn:li:activity:")?.[1];

        postData.name = profileSection?.querySelector('div.update-components-actor__meta a.update-components-actor__meta-link span.update-components-actor__title span.update-components-actor__name span.visually-hidden'
        )?.innerText
        postData.tagline = profileSection?.querySelector('div.update-components-actor__meta a.update-components-actor__meta-link span.update-components-actor__description span.visually-hidden'
        )?.innerText

        postData.linkedinLink = profileSection?.querySelector('div.update-components-actor__meta a.update-components-actor__meta-link')?.href

        let postSocialCounts = Array?.from(articleSection?.querySelectorAll("div.update-v2-social-activity div.social-details-social-counts ul li") || [])?.map(e => e?.textContent?.trim()?.replaceAll("\n", "")?.replaceAll(/\s+/g, " "));

        let comments = postSocialCounts?.filter(e => e?.includes("comments") || e?.includes("comment"))?.[0];
        // postData.comments = comments ? comments?.trim()?.split(" ")?.[0] : "0";
        comments = comments?.trim()?.split(" ")?.[0]?.replace(/[,\s]/g, "");

        if (comments?.length > 0) {
            postData.comments = parseInt(comments);
        }

        let reposts = postSocialCounts?.filter(e => e?.includes("reposts") || e?.includes("repost"))?.[0];
        // postData.reposts = reposts ? reposts?.trim()?.split(" ")?.[0] : "0";
        reposts = reposts?.trim()?.split(" ")?.[0]?.replace(/[,\s]/g, "");

        if (reposts?.length > 0) {
            postData.reposts = parseInt(reposts);
        }

        postSocialCounts = postSocialCounts ? postSocialCounts : [];

        let impressions = mainSection?.querySelector(".ca-entry-point__num-views");
        if (impressions) {
            impressions = impressions?.textContent?.trim();
            impressions = impressions?.split(" ");
            if (impressions?.length > 0) {
                impressions = impressions?.[0]?.trim()?.replace(/[,\s]/g, "")
                if (impressions?.length > 0) {
                    postData.impressions = parseInt(impressions)
                }
            }
        }

        postData.postContent = postContentSection?.innerText?.trim()

        let likes = articleSection?.querySelector("div.update-v2-social-activity div.social-details-social-counts ul li button")?.getAttribute("aria-label")?.trim()?.split(" ")?.[0];
        let likes2 = articleSection?.querySelector("div.update-v2-social-activity div.social-details-social-counts span.social-details-social-counts__social-proof-fallback-number")?.textContent?.trim();

        likes = likes?.trim()?.replace(/[,\s]/g, "");
        likes2 = likes2?.trim()?.replace(/[,\s]/g, "");

        if (likes?.length > 0 && likes2?.length > 0) {
            likes = Math.max(parseInt(likes), parseInt(likes2));
        } else if (likes?.length > 0) {
            likes = parseInt(likes);
        } else if (likes2?.length > 0) {
            likes = parseInt(likes2);
        }

        if (likes > 0) {
            postData.likes = likes;
        }

        postData.postUrl = window.location.href?.split("?")?.[0];
        postData.analyticsPageUrl = document?.querySelector(".content-analytics-entry-point a")?.href

        return postData;
    }

    if (conditions.matchedCondition === 1) {
        data = getPostDetails1();
    } else if (conditions.matchedCondition === 2) {
        data = getPostDetails2();
    }

    return {
        postData: data,
        conditions
    };

}

const postCommentScript = async (singlePostScript) => {

    //  ---------- Hashing function  ------------
    async function sha256Hash(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function verifyHash(inputStr, originalHash) {
        const hash = await sha256Hash(inputStr);
        return hash === originalHash;
    }

    // --------- Script start --------------------

    let authorPost = await singlePostScript();
    let authorVanityName = getVanityName(authorPost?.postData?.linkedinLink);
    let postUrl = authorPost?.postData?.postUrl;

    function getVanityName(profileUrl) {
        let vanityName = profileUrl?.split("/in/")?.[1]?.split("/")?.[0];
        return vanityName;
    }

    function getLinkType(link, label, authorVanityName) {
        if (link === label || label?.includes("http")) {
            return "URL";
        }
        else if (link?.startsWith("mailto:") && label?.includes("@")) {
            return "EMAIL";
        }
        else if (link?.includes(authorVanityName)) {
            return "MENTION_AUTHOR";
        }
        else if (link?.includes("linkedin.com/company/")) {
            return "MENTION_COMPANY";
        }
        else if (link?.includes("linkedin.com/in/")) {
            return "MENTION_PROFILE";
        }
        else if (link?.includes("linkedin.com/feed/hashtag") || label?.startsWith("#")) {
            return "HASHTAG";
        }
        else if (link?.includes("linkedin.com/feed/update") || link?.includes("linkedin.com/posts")) {
            return "POST";
        }

        else {
            return "WEBSITE";
        }

    }

    async function setMostRecentComments() {
        let maxIterations = 10;
        let iterationCount = 0;

        const commentContainer = document?.body?.querySelector("div.feed-shared-update-v2__comments-container");
        const commentSortOrderButton = commentContainer?.querySelector("button.comments-sort-order-toggle__trigger");

        while (iterationCount < maxIterations) {
            const matchingText = "most recent";
            console.log("sorting comments");
            commentSortOrderButton?.click();
            await new Promise(r => setTimeout(r, 1000));
            Array.from(commentContainer?.querySelectorAll(".artdeco-dropdown__content-inner ul[role=listbox] li") || [])?.find((item) => item?.innerText?.toLowerCase()?.includes?.(matchingText))?.click();
            await new Promise(r => setTimeout(r, 1000));
            if (commentSortOrderButton?.innerText?.toLowerCase()?.includes(matchingText)) {
                console.log("sorting done");
                break;
            }
            iterationCount++;
        }
    }

    function getCommentData(comment) {

        const commentDataId = comment?.getAttribute("data-id");
        const MetaActor = comment?.querySelector(":scope > .comments-comment-meta__container .comments-comment-meta__actor");
        let name = MetaActor?.querySelector("a h3.comments-comment-meta__description span.comments-comment-meta__description-title")?.innerText?.trim();
        const commentBadge = MetaActor?.querySelector("a h3.comments-comment-meta__description span.comments-comment-meta__badge")?.innerText?.trim();
        let isAuthorComment = commentBadge?.toLowerCase()?.includes("author") || false;
        let tagline = MetaActor?.querySelector("a div.comments-comment-meta__description-subtitle")?.innerText?.trim();
        let profileLink = MetaActor?.querySelector("a")?.href;

        const MetaInfo = comment?.querySelector(":scope > .comments-comment-meta__container .comments-comment-meta__info");
        let time = MetaInfo?.querySelector("time")?.innerText?.trim();
        const vanityName = getVanityName(profileLink);

        const contentSection = comment?.querySelector(":scope > .comments-thread-entity .comments-thread-item section.comments-comment-entity__content .comments-comment-item__main-content");
        let text = contentSection?.innerText?.trim();

        if (text && text?.endsWith("...more")) {
            text = text?.slice(0, -"...more".length);
        }

        const SocialCountSection = comment?.querySelector(":scope > .comment-social-activity > .comments-thread-entity > .comments-thread-item > .comments-comment-social-bar--cr")

        const likesCount = parseInt(SocialCountSection?.querySelector("button.comments-comment-social-bar__reactions-count--cr > span")?.innerText?.trim() || 0);
        const repliesCount = parseInt(SocialCountSection?.querySelector("span.comments-comment-social-bar__replies-count")?.innerText?.trim()?.split(" ")?.[0]?.trim() || 0);

        const embedLinks = Array.from(contentSection?.querySelectorAll("a.app-aware-link") || [])?.map((item) => {
            let link = item?.href?.trim();
            if (link?.includes("linkedin.com/in/")) {
                link = item?.querySelector("a.ember-view")?.href?.trim();
            }
            let label = item?.innerText?.trim();
            const type = getLinkType(link, label, authorVanityName);
            if (type === "HASHTAG") {
                label = label?.replace("hashtag", "")?.trim();
            }
            return {
                link,
                label,
                type,
            }
        })

        return { commentDataId, postedTime: time, name, tagline, profileLink, vanityName, commentText: text, likesCount, repliesCount, mentions: embedLinks, isAuthorComment, postUrl };
    }

    async function getReplies(allReplies, length, parentComment) {
        let data = {};

        data.replies = await Promise.all(allReplies?.map(async (reply, index) => {

            const parentDataId = parentComment?.commentDataId;
            const parentCommenterId = parentComment?.commenterId;
            const parentIndex = parentComment?.index;

            const commenterId = await sha256Hash(getCommentData(reply)?.vanityName);

            return {
                parentIndex, replySequence: index + 1, commenterId, parentCommenterId, parentDataId,
                commentType: "reply",
                ...getCommentData(reply)
            };
        }));

        data.totalReplies = data.replies?.length;

        return data;
    }

    async function getComments(allComments, length) {
        let data = {};
        // let uniqueIndex = length - 1;
        data.comments = await Promise.all(allComments?.map(async (comment, index) => {
            // uniqueIndex += 1;

            const commentData = getCommentData(comment);
            const commenterId = await sha256Hash(commentData?.vanityName);

            return {
                index: length + index, commenterId,
                commentType: "comment",
                ...getCommentData(comment)
            };
        }));

        data.totalComments = data.comments?.length;

        return data;
    }

    if (authorPost?.postData?.comments > 0) {
        console.log(authorPost?.postData?.comments, " comment(s) available");

        await setMostRecentComments();
    }


    let finalData = {
        commentsData: {
            comments: [],
            totalComments: 0
        },
        repliesData: {
            replies: [],
            totalReplies: 0
        }
    };

    let BREAK_LOOP = false;
    const COMMENT_LIMIT = 0;
    const REPLY_LIMIT = 0;

    async function fetchAllReplies(allComments) {
        let commentContainer = document?.body?.querySelector("div.feed-shared-update-v2__comments-container");
        let commentList = commentContainer?.querySelector("div.comments-comment-list__container");

        await Promise.all(allComments?.map(async (comment) => {

            if (comment?.repliesCount > 0) {
                const selectedComment = commentList?.querySelector(`article[data-id="${comment?.commentDataId}"]`);
                const replyContainer = selectedComment?.querySelector(":scope > div.comment-social-activity > div.comments-replies-list");

                let commentRepliesCount = 0;

                while (!BREAK_LOOP) {
                    const commentReplies = finalData?.repliesData?.replies?.filter((reply) => reply?.parentDataId === comment?.commentDataId);
                    const newRepliesCount = commentReplies?.length;

                    commentRepliesCount = Math.max(commentRepliesCount, newRepliesCount);


                    if (REPLY_LIMIT > 0 && commentReplies?.length >= REPLY_LIMIT) {
                        break;
                    }

                    const loadMoreReplies = replyContainer?.querySelector(":scope > .comments-thread-entity div.comments-replies-list__load-replies button.comments-replies-list__replies-button");

                    if (loadMoreReplies) {
                        loadMoreReplies.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }


                    const lastReply = commentReplies?.[commentReplies?.length - 1];

                    let replyCursor = lastReply?.commentDataId;

                    let allReplies = [];

                    if (replyCursor) {
                        let reply = replyContainer?.querySelector(`:scope > div.comments-thread-entity > .comments-thread-item > article.comments-comment-entity--reply[data-id="${replyCursor}"]`);
                        if (reply) {
                            let nextSibling = reply.parentElement?.parentElement?.nextElementSibling?.querySelector('article.comments-comment-entity--reply');
                            while (nextSibling) {
                                // allReplies.push(nextSibling);
                                // nextSibling = nextSibling.parentElement?.parentElement?.nextElementSibling?.querySelector('article.comments-comment-entity--reply');
                                const replyDataId = nextSibling.getAttribute('data-id');

                                // Only add if this reply is not already in finalData.repliesData.replies
                                if (replyDataId && !finalData.repliesData.replies.some(r => r.commentDataId === replyDataId)) {
                                    allReplies.push(nextSibling);
                                }

                                nextSibling = nextSibling.parentElement?.parentElement?.nextElementSibling?.querySelector('article.comments-comment-entity--reply');
                            }
                        }
                    } else {
                        // Fetch the top-level replies initially
                        allReplies = Array.from(replyContainer?.querySelectorAll(":scope > div.comments-thread-entity > .comments-thread-item > article.comments-comment-entity--reply") || []);
                    }

                    // console.log("replies", comment?.commentDataId, "...", commentRepliesCount)
                    // Process the fetched replies
                    if (allReplies.length > 0) {
                        const newRepliesData = await getReplies(allReplies, commentRepliesCount, comment);
                        finalData.repliesData.totalReplies += newRepliesData?.replies?.length || 0;
                        finalData.repliesData.replies = finalData?.repliesData?.replies?.concat(newRepliesData?.replies || []);
                    }

                    // Update reply cursor for the next batch
                    let lastFetchedReply = finalData?.repliesData?.replies?.filter((reply) => reply?.commentDataId === comment?.commentDataId);
                    replyCursor = lastFetchedReply?.[lastFetchedReply?.length - 1]?.commentDataId;

                    if (!loadMoreReplies || loadMoreReplies?.innerText?.trim()?.toLowerCase()?.includes("collapse")) {
                        break;
                    }

                    loadMoreReplies.click();
                    await waitForNewReplies(replyContainer, replyCursor);

                }
            }

        }));

    }

    async function waitForNewReplies(replyList, previousCursor) {
        let timeout = 5000; // Max wait time of 5 seconds
        let interval = 100; // Check every 100ms
        let elapsedTime = 0;

        return new Promise((resolve) => {
            let intervalId = setInterval(() => {
                let lastReply = replyList.querySelector(`article[data-id="${previousCursor}"]`);
                let nextSibling = lastReply?.parentElement?.parentElement?.nextElementSibling?.querySelector('article.comments-comment-entity--reply');
                if (nextSibling || elapsedTime >= timeout) {
                    clearInterval(intervalId);
                    resolve();
                }
                elapsedTime += interval;
            }, interval);
        });
    }

    async function fetchAllComments() {
        let commentContainer = document?.body?.querySelector("div.feed-shared-update-v2__comments-container");
        if (!commentContainer) return;

        let commentList = commentContainer?.querySelector("div.comments-comment-list__container");

        while (!BREAK_LOOP && (COMMENT_LIMIT <= 0 || finalData?.commentsData?.comments?.length < COMMENT_LIMIT)) {
            // window.scrollTo({
            //     top: document.body.scrollHeight,
            //     behavior: 'smooth'
            // });

            let loadMoreComments = commentContainer?.querySelector("div.comments-comment-list__load-more-container button.comments-comments-list__load-more-comments-button--cr");

            if (loadMoreComments) {
                loadMoreComments.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            let lastComment = finalData?.commentsData?.comments?.[finalData?.commentsData?.comments?.length - 1];
            let commentCursor = lastComment?.commentDataId;

            let allComments = [];

            if (commentCursor) {

                let comment = commentList?.querySelector(`article[data-id="${commentCursor}"]`);
                if (comment) {
                    let nextSibling = comment.nextElementSibling;
                    while (nextSibling && nextSibling.tagName.toLowerCase() === 'article') {
                        // allComments.push(nextSibling);
                        // nextSibling = nextSibling.nextElementSibling;
                        const commentDataId = nextSibling.getAttribute('data-id');
                        if (commentDataId && !finalData.commentsData.comments.some(c => c.commentDataId === commentDataId)) {
                            allComments.push(nextSibling);
                        }
                        nextSibling = nextSibling.nextElementSibling;
                    }
                }
            } else {
                // Fetch the top-level comments initially
                allComments = Array.from(commentList?.querySelectorAll(":scope > article.comments-comment-entity") || []);
            }

            // Process the fetched comments
            if (allComments.length > 0) {
                let newCommentsData = await getComments(allComments, finalData?.commentsData?.comments?.length); // Assume getComments parses and returns structured data
                finalData.commentsData.totalComments += newCommentsData?.comments?.length || 0;
                finalData.commentsData.comments = finalData?.commentsData?.comments?.concat(newCommentsData?.comments || []);

                if (newCommentsData?.comments?.length > 0) {
                    await fetchAllReplies(newCommentsData?.comments);
                }
            }



            // Update comment cursor for the next batch
            let lastFetchedComment = finalData?.commentsData?.comments?.[finalData?.commentsData?.comments?.length - 1];
            commentCursor = lastFetchedComment?.commentDataId;



            if (!loadMoreComments || !loadMoreComments?.innerText?.trim()?.toLowerCase()?.includes("load more") || allComments.length === 0) {
                break;
            }

            loadMoreComments.click();
            await waitForNewComments(commentList, commentCursor);
        }
    }


    // Helper function to dynamically wait for new comments to load
    async function waitForNewComments(commentList, previousCursor) {
        let timeout = 5000; // Max wait time of 5 seconds
        let interval = 100; // Check every 100ms
        let elapsedTime = 0;

        return new Promise((resolve) => {
            let intervalId = setInterval(() => {
                let lastComment = commentList.querySelector(`article[data-id="${previousCursor}"]`);
                let nextSibling = lastComment?.nextElementSibling;
                if (nextSibling || elapsedTime >= timeout) {
                    clearInterval(intervalId);
                    resolve();
                }
                elapsedTime += interval;
            }, interval);
        });
    }

    // Call the function to fetch all comments
    await fetchAllComments().then(() => {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
        console.log("All comments fetched successfully");
    });

    finalData.authorPostData = authorPost;

    return finalData;

}

await postCommentScript(singlePostScript);


// -------------------- Test codes for the above script -------------------

// to auto load all comments
let interval1 = setInterval(() => {
    const button = document?.body?.querySelector("div.feed-shared-update-v2__comments-container")?.querySelector("div.comments-comment-list__load-more-container button.comments-comments-list__load-more-comments-button--cr");
    if (!button) {
        console.log("No more comments to load");
        clearInterval(interval1);
    }
    button.click()
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
}, 2000);

// to select load more replies button
document?.querySelector(`article[data-id="urn:li:comment:(activity:7238754599401123840,7238918369981173760)"]`)?.querySelector(":scope > div.comment-social-activity > div.comments-replies-list")?.querySelector(":scope > .comments-thread-entity button.comments-replies-list__replies-button")

// clearInterval(interval1)
// https://www.linkedin.com/posts/devanbhalla_adani-business-motivation-activity-7238754599401123840-dsgQ/?code=udi1kk

// ------------------------------ Likes reactors -----------------------



// function getVanityName(profileUrl) {
//     return profileUrl?.split("?")?.[0]?.split("/in/")?.[1]?.split("/")?.[0];
// }

// function getReactorData(reactor) {
//     const name = reactor?.querySelector("a .artdeco-entity-lockup__title")?.innerText?.split('\n')?.[0]?.trim();
//     const profileLink = reactor?.querySelector("a")?.href;
//     const tagline = reactor?.querySelector("a .artdeco-entity-lockup__caption")?.innerText?.trim();
//     const reactionType = reactor?.querySelector("a img[data-test-reactions-icon-type]").getAttribute("data-test-reactions-icon-type")?.trim();
//     const encodedVanityName = getVanityName(profileLink);
//     const elementId = reactor?.querySelector("a")?.getAttribute("id");

//     return { elementId, name, tagline, profileLink, reactionType, encodedVanityName };
// }

// async function getReactors(allReactors, length) {
//     const reactions = await Promise.all(
//         allReactors.map((reactor, index) => ({ sequence: index + length + 1, ...getReactorData(reactor) }))
//     );
//     return { reactions, totalReactions: reactions.length };
// }

// let reactionData = {
//     reactions: [],
//     totalReactions: 0
// }

// let BREAK_LOOP = false;
// const REACTION_LIMIT = 0;

// async function fetchAllReactions() {
//     console.log("Fetching all reactions started");

//     const modalButton = document.body.querySelector("[data-reaction-details]");
//     if (!modalButton) return console.warn("Modal button not found");

//     modalButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
//     modalButton.click();
//     await new Promise(r => setTimeout(r, 1000));

//     const modal = document.body.querySelector(`[aria-labelledby="social-details-reactors-modal__header"]`);
//     const reactorsSection = modal?.querySelector(`.social-details-reactors-tab-body .scaffold-finite-scroll__content`);
//     const processedIds = new Set(reactionData.reactions.map(r => r.elementId));

//     while (!BREAK_LOOP && (REACTION_LIMIT <= 0 || reactionData.reactions.length < REACTION_LIMIT)) {
//         const showMoreButton = modal.querySelector(`.scaffold-finite-scroll__load-button`);
//         showMoreButton?.scrollIntoView({ behavior: 'smooth', block: 'center' });

//         let allReactors = [];
//         const lastReactor = reactionData.reactions.at(-1);
//         const lastReactorElement = lastReactor ? reactorsSection.querySelector(`ul > li a[id="${lastReactor.elementId}"]`) : null;

//         if (lastReactorElement) {
//             let nextSibling = lastReactorElement.closest("li").nextElementSibling;
//             while (nextSibling) {
//                 const elementId = nextSibling.querySelector("a")?.getAttribute("id");
//                 if (elementId && !processedIds.has(elementId)) {
//                     allReactors.push(nextSibling);
//                     processedIds.add(elementId);
//                 }
//                 nextSibling = nextSibling.nextElementSibling;
//             }
//         } else {
//             allReactors = Array.from(reactorsSection.querySelectorAll("ul > li.social-details-reactors-tab-body-list-item"));
//         }

//         if (allReactors.length === 0) break;

//         const newReactionsData = await getReactors(allReactors, reactionData.reactions.length);
//         reactionData.totalReactions += newReactionsData.totalReactions;
//         reactionData.reactions.push(...newReactionsData.reactions);

//         if (!showMoreButton || !showMoreButton.innerText.trim().toLowerCase().includes("show more")) break;

//         showMoreButton.click();
//         await waitForNewReactions(reactorsSection, lastReactor?.elementId);
//         await new Promise(r => setTimeout(r, 1000));
//     }

//     console.log("All reactions fetched successfully", reactionData);
// }

// function waitForNewReactions(reactionList, previousCursor) {
//     const timeout = 5000;
//     const interval = 100;
//     let elapsedTime = 0;

//     return new Promise((resolve) => {
//         const intervalId = setInterval(() => {
//             const lastReactor = previousCursor ? reactionList.querySelector(`a[id="${previousCursor}"]`) : null;
//             const nextSibling = lastReactor?.closest("li")?.nextElementSibling;

//             if (nextSibling || elapsedTime >= timeout) {
//                 clearInterval(intervalId);
//                 resolve();
//             }
//             elapsedTime += interval;
//         }, interval);
//     });
// }

// await fetchAllReactions().then(() => {
//     console.log("All reactions fetched successfully");
//     console.log(reactionData);
// });

// // ------------------

// // let com = cleanText(e?.querySelector("div:nth-child(2) > div > div > div span")?.innerText) || ""
// let com = cleanText(e?.querySelector("div:nth-child(2) > div > div > span > span")?.innerText) || ""

// Array.from(experienceSection?.querySelectorAll("ul > li.artdeco-list__item > div[data-view-name=profile-component-entity]") || []).map(e => {

//     let com = cleanText(e?.querySelector("div:nth-child(2) > div > div > span > span")?.innerText) || ""

//     let pos = [{
//         position: cleanText(e?.querySelector("div:nth-child(2) > div > div > div span")?.innerText) || "",
//         duration: cleanText(e?.querySelector("div:nth-child(2) > div > div > span > span.pvs-entity__caption-wrapper")?.innerText) || ""
//     }]

//     if (com === '' && pos?.[0]?.position === '' && pos?.[0]?.duration === '') {
//         com = cleanText(e?.querySelector("div:nth-child(2) > div > a > div span")?.innerText) || ""
//         pos = Array.from(e?.querySelectorAll("div.pvs-entity__sub-components ul li > div[data-view-name=profile-component-entity]") || [])?.map(e => ({
//             position: cleanText(e?.querySelector("div:nth-child(2) div a > div span")?.innerText) || "",
//             duration: cleanText(e?.querySelector("div:nth-child(2) div a > span > span.pvs-entity__caption-wrapper")?.innerText) || "",
//         }))
//     }

//     return {
//         company_url: e?.querySelector("[data-field=experience_company_logo]")?.href || "",
//         company_name: com?.split(" · ")?.[0]?.trim(),
//         positions: pos,
//         type: com?.split(" · ")?.[1]?.trim() || "",
//         logo: e?.querySelector("div a img")?.src || "",
//     }
// });

// ======================= linkedin voyager ========================

