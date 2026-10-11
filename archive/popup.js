const env = "dev";
let COLLAB_SERVER = "http://localhost:5000/api";
let COLLAB_CLIENT = "http://localhost:5173";

if (env === "prod") {
  COLLAB_SERVER = "https://www.anchors.in/api";
  COLLAB_CLIENT = "https://www.anchors.in";
}

document.addEventListener("DOMContentLoaded", async () => {
  const content = document.body;

  try {
    await chrome.storage.local.get(["jwtToken", "UserType"], function (items) {
      // console.log('jwtToken:', items.jwtToken, 'UserType:', items.UserType);

      if (items.jwtToken && items.UserType === "Influencer") {
        renderWelcome();
      } else {
        checkActiveTabUrl();
      }
    });
  } catch (error) {
    console.error("Error retrieving token from storage:", error);
    renderLoginButton();
  }

  function renderWelcome() {
    onWelcomePageLoad();

    getUser().then(async (res) => {
      // console.log('User:', res);
      if (res && res.success) {
        if (res?.logout) {
          await chrome.storage.local.remove(["jwtToken", "UserType"]);
          renderLoginButton();
          return;
        }

        const name = res?.data?.name;
        if (name) {
          chrome.storage.local.set({ name: name });
          document.getElementById("name").textContent = name;
        }

        if (res?.data?.linkedinLink) {
          const linkedinLink = res?.data?.linkedinLink;
          const urlObj = new URL(linkedinLink);
          const pathname = urlObj.pathname;
          const segments = pathname.split("/");
          const liUserName =
            segments[segments.length - 1] || segments[segments.length - 2];
          chrome.storage.local.set({
            linkedinLink: linkedinLink,
            liUserName: liUserName,
          });
        }

        await chrome.storage.local.get(
          ["linkedinLink", "liUserName"],
          function (items) {
            const savedLinkedinLink = items.linkedinLink;
            const savedLiUserName = items.liUserName;
            const yourUserName = document.getElementById("your_username");
            yourUserName.textContent = savedLiUserName;
            // yourUserName.href = savedLinkedinLink;
          },
        );

        document
          .getElementById("logout")
          .addEventListener("click", async () => {
            await chrome.storage.local.remove(["jwtToken", "UserType"]);
            renderLoginButton();
          });
      } else {
        // renderLoginButton();
        content.innerHTML = "<p>Something went wrong. Please try again.</p>";
      }
    });
  }

  function renderLoginButton() {
    content.style = `align-items: center; display: flex; justify-content: center; flex-direction: column;`;
    content.innerHTML = '<button id="loginButton">Login</button>';
    document.getElementById("loginButton").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "login" });
    });
  }

  async function checkActiveTabUrl() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      // console.log('Active tab:', tab.url);
      if (tab && tab.url.includes(`${COLLAB_CLIENT}/influencer/dashboard`)) {
        chrome.runtime.sendMessage(
          { action: "retrieveToken", tabId: tab.id },
          (response) => {
            if (response && response.success) {
              renderWelcome();
            } else {
              renderLoginButton();
            }
          },
        );
      } else {
        renderLoginButton();
      }
    } catch (error) {
      console.error("Error checking active tab URL:", error);
      renderLoginButton();
    }
  }
});

function onWelcomePageLoad() {
  const messageElement = document.createElement("p");
  messageElement.id = "message";
  document.body.appendChild(messageElement);

  const message = "Click on Analyze Button to analyze the LinkedIn post.";
  const noActiveTabMessage = "No active tab found.";
  const noLinkedInMessage = "Please open LinkedIn website to analyze the post.";
  const loginToLinkedInMessage = "Please login to LinkedIn.";
  const noResponseMessage = "No response from content script.";

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs.length === 0) {
      messageElement.textContent = noActiveTabMessage;
      return;
    }

    const tab = tabs[0];

    if (tab.url.includes("linkedin.com")) {
      messageElement.textContent = "You are at LinkedIn";
      document.getElementById("other_container").style.display = "none";
      document.getElementById("analyze_container").style.display = "flex";
      document.getElementById("control").style.display = "none";

      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: getPubId,
        });

        const pubId = result;

        chrome.storage.local.get(["liUserName"], (items) => {
          if (items.liUserName) {
            const username = items.liUserName;
            if (pubId) {
              if (pubId === username) {
                if (
                  tab.url ===
                  `https://www.linkedin.com/in/${username}/recent-activity/all/`
                ) {
                  document.getElementById("control").style.display = "flex";
                  document.getElementById("open_activity").style.display =
                    "none";
                  messageElement.textContent =
                    "Click on Analyze button to analyze the post.";
                } else {
                  document.getElementById("control").style.display = "none";
                  document.getElementById("open_activity").style.display =
                    "flex";
                  messageElement.textContent =
                    "Please open your activity post page";
                  document
                    .getElementById("open_activity")
                    .addEventListener("click", () => {
                      chrome.tabs.create({
                        url:
                          "https://www.linkedin.com/in/" +
                          username +
                          "/recent-activity/all/",
                      });
                    });
                }
              } else {
                messageElement.textContent = "LinkedIn Account not verified";
              }
            } else {
              messageElement.textContent = "Login to your LinkedIn account";
            }
          } else {
            messageElement.textContent = "Verification failed";
          }
        });
      } catch (error) {
        console.error("Error executing script:", error);
        messageElement.textContent = noResponseMessage;
      }
    } else {
      document.getElementById("analyze_container").style.display = "none";
      document.getElementById("other_container").style.display = "flex";
      document.getElementById("open_activity").style.display = "none";
      messageElement.textContent = noLinkedInMessage;
    }
  });

  function getPubId() {
    const pubId = document.body?.textContent.match(
      /"publicIdentifier":"(.*?)"/,
    )?.[1];
    return pubId;
  }

  // Set up button event listeners
  document.getElementById("open").addEventListener("click", () => {
    chrome.storage.local.get(["liUserName"], (items) => {
      chrome.tabs.create({
        url:
          "https://www.linkedin.com/in/" +
          items.liUserName +
          "/recent-activity/all/",
      });
    });
  });

  document.getElementById("analyze").addEventListener("click", startAnalysis);
  document.getElementById("stop").addEventListener("click", stopAnalysis);

  function startAnalysis() {
    // Send a message to content.js to start the analysis
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "startAnalyze" },
        function (response) {
          if (response.status === "analyzing") {
            // Hide the analyze button and show the stop button
            document.getElementById("analyze").style.display = "none";
            document.getElementById("stop").style.display = "flex";
          }
        },
      );
    });
  }

  function stopAnalysis() {
    var stopButton = document.getElementById("stop");
    stopButton.disabled = true;

    // Send a message to content.js to stop the analysis
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "stopAnalyze" },
        function (response) {
          if (response.status === "stopped") {
            // Re-enable and hide the stop button
            stopButton.disabled = false;
            stopButton.style.display = "none";

            // Show the analyze button again
            document.getElementById("analyze").style.display = "flex";
          }
        },
      );
    });
  }
}

// -----------------------------
async function getUser() {
  try {
    const items = await chrome.storage.local.get(["jwtToken"]);
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
    console.error("Error:", error);
    return null;
  }
}

// ----------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "publicIdentifier") {
    localStorage.setItem("username", request.props?.publicIdentifier);
  }

  if (request.type === "authUpdated") {
    chrome.storage.local.get(["jwtToken", "userType"], (items) => {
      if (items.jwtToken && items.userType) {
        window.location.href = "popup.html";
      } else {
        window.location.href = "login.html";
      }
    });
  }
});
