const env = "dev";
let COLLAB_CLIENT = "https://dev.anchors.pro";
let COLLAB_SERVER = "https://dev.anchors.pro/api";

// const env = "prod";
// let COLLAB_CLIENT = "https://www.anchors.in";
// let COLLAB_SERVER = "https://www.anchors.in/api";

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
      const activeTab = tabs[0];
      const url = activeTab.url;
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
    renderLoading();
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

    const response = await fetch(`${COLLAB_SERVER}/ext/getUser`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Jwttoken: token,
      },
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

async function renderWelcome() {
  getUser().then(async (res) => {
    if (res && res?.success) {
      if (res?.logout) {
        await chrome.storage.local.remove([config.JWTTOKEN, config.USERTYPE]);
        renderLogin();
        return;
      }
      // $('#root').html(`<div class="px-4"> <div class="py-2"> <span>anchors</span> </div> <div class="h-full py-6"> <div> <p>Welcome,</p> <h1 class="text-xl font-bold">${res?.data?.name}</h1> </div> </div> </div>`);
      $("#root").html(
        `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Hi ${res?.data?.name}, <br /> Welcome to anchors, </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Make sure your media is upto date! </p> <div> <button id="gp__update_btn" class="flex px-[16px] py-[8px] items-center gap-[10px] rounded-[6px] bg-[#DC2627]"> <span class="text-[#FFF] text-[14px] not-italic font-medium leading-[24px]"> Update Your Media Kit </span> </button> </div> </div> </div>`,
      );

      $("#gp__update_btn").click(function () {
        trackPosthog("creator_extension_update_media_kit_clicked", { env });
        chrome.tabs.create({
          url:
            res?.data?.updateMediaKitUrl ||
            `${COLLAB_CLIENT}/influencer/dashboard`,
        });
      });

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
  trackPosthog("creator_extension_login_rendered", { env });
  $("#root").html(
    `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Hi, <br /> Welcome to anchors, </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Make sure your media is upto date! </p> <div> <button id="gp__login_btn" class="flex px-[16px] py-[8px] items-center gap-[10px] rounded-[6px] bg-[#DC2627]"> <span class="text-[#FFF] text-[14px] not-italic font-medium leading-[24px]"> Login to Continue </span> </button> </div> </div> </div>`,
  );
  $("#gp__login_btn").click(function () {
    trackPosthog("creator_extension_login_clicked_popup", { env });
    chrome.tabs.create({ url: `${COLLAB_CLIENT}/influencer/login` });
  });
}

function renderLoading() {
  $("#root").html(
    `<div class="h-full w-full bg-[#171717] text-white/70 grid place-items-center"> <div class="flex flex-col justify-center items-center text-center"> <span class="text-[30px]">🚀</span> <h1 class="text-[#FFF] text-center font-inter text-[16px] not-italic font-semibold leading-[normal]"> Loading... </h1> <p class="text-[#A3A3A3] text-center font-inter text-[14px] not-italic font-normal leading-[normal] mt-2 mb-5"> Hold on! </p> </div> </div>`,
  );
}
