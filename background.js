// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ai-autofill-run",
    title: "🤖 运行 AI 自动填写",
    contexts: ["editable", "page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ai-autofill-run") {
    chrome.tabs.sendMessage(tab.id, { action: "run-autofill" });
  }
});
