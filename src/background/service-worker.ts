// Background service worker for PrivacyLens
// Currently unused in Phase 1, prepared for future API requests.

chrome.runtime.onInstalled.addListener(() => {
  console.log("PrivacyLens extension installed.");
});
