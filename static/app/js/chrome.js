// If the user clicks the browser icon
chrome.browserAction.onClicked.addListener(spawn)

// Create a new tab
function spawn() { chrome.tabs.create({ url: 'https://www.hiroapp.com'	}) }