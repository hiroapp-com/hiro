// Small Hiro Background Lib
var HBG  = {
	tabs: [],
	socket: null,
	init: function() {
		// If the user clicks the browser icon
		chrome.browserAction.onClicked.addListener(HBG.click);

		// Or the apps icon
		if (chrome.app.runtime) chrome.app.runtime.onLaunched.addListener(HBG.click);

		// If a tab is closed we check if we should remove it from our list
		if (chrome.tabs) chrome.tabs.onRemoved.addListener(function(tab){
			if (HBG.tabs.indexOf(tab) > -1) HBG.tabs.splice(HBG.tabs.indexOf(tab));
		})

		// Listen to incoming messages
		chrome.runtime.onMessageExternal.addListener( HBG.messagehandler );	

		// Build a socket
		chrome.runtime.onConnectExternal.addListener(function(port) { 
			// Double check it's us
			if (port.name == 'Hiro') {
				// Set local reference
				HBG.socket = port;

				// Add message listener
				port.onMessage.addListener( HBG.messagehandler );	
			}		
		});						
	},

	// Handle incoming messages
	messagehandler: function(msg,sender,sendResponse) {
		// Init connection
		if (msg == 'init') sendResponse({ version: chrome.runtime.getManifest().version })
		// Update badge
		if (msg.unseen && chrome.browserAction) chrome.browserAction.setBadgeText = msg.unseen;
	},

	// Display the latest tab or spawn a new one
	click: function(event) {
		// If the click happened while we were on a Hiro page, spawn a new session right away
		if (event.url.indexOf('hiroapp.com') > -1) {
			HBG.spawn();
		// Try to find a proper tab	
		} else {
			HBG.returntolast();
		}
	},

	// Try to find the latest Hiro tab
	returntolast: function() {
		var tab;

		// If we can query tabs (starting Chrome 16)
		if (chrome.tabs.query) {
			// Finally see if any there's any tab on hiroapp.com
			chrome.tabs.query({ url:'https://*.hiroapp.com/*' },function(tabs) {
				// Cycle through those tabs
				for (i = tabs.length; i > 0; i-- ) {
					tab = tabs[i -1];
					// If the user clicked while on active tab, abort
					if (tab.active) {
						// See if it's the active widow
						chrome.windows.getCurrent(function(win){			
							// If it indeed was the current window
							if (win.id == tab.windowId)	HBG.spawn();
						})
					}	
				}
				// Otherwise just go for the latest one
				HBG.bringtofront(tabs.pop());								
			});	
		// Try our know tabs as fallback					
		} else {
			for (i = this.tabs.length; i > 0; i-- ) {
				chrome.tabs.get(this.tabs[i - 1], function(tab){
					// If the tab is active, the user most likely wants to open a new one
					if (tab.status == 'active') HBG.spawn();
					// Fall back to latest one
					HBG.bringtofront(tabs.pop());
				});
			}
		}
	},

	// Make specific tab seen, requires full tab object
	bringtofront: function(tab) {
		chrome.tabs.update(tab.id,{ active: true });
		// Also switch windows
		chrome.windows.getCurrent(function(win){			
			// If the current window is not the one we're looking for, focus it and also drawAttention as fallback
			if (win.id != tab.windowId)	chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
		})
	},

	// Create a new tab
	spawn: function() { 
		chrome.tabs.create({ url: 'https://www.hiroapp.com/backdoor' },function(tab){
			HBG.tabs.push(tab.id);
		}); 
	}	
}
HBG.init();