/*

	Hiro client lib

	Hiro.folio: Manages the document list and the left hand folio sidebar
	Hiro.folio.docs: Internal doclist management

	Hiro.canvas: The currently loaded document
	Hiro.canvas.sync: Diff/patch of current document

	Hiro.context: Search and right hand sidebar related functions

	Hiro.sharing: Add/remove user access

	Hiro.publish: Publish selections to various external services

	Hiro.store: Data store abstraction that works online (Ajax/ws) and offline (localStorage)

	Hiro.comm: Ajax, longpolling and websockets	
	Hiro.comm.messaging: Abstracted send/receive message API	

	Hiro.lib: External libraries like Facebook or analytics

	Hiro.ui: Basic UI related functions like showing/hiding dialogs, sliding menu etc
	Hiro.ui.swipe: Custom swipe functionality for touch devices
	Hiro.ui.hprogres: Thin progress bar on very top of page

	Hiro.sys: Core functionality like setup, logging etc
	Hiro.sys.user: Internal user management and methods

	Hiro.util: Utilities like event attachment, humanized timestamps etc

*/


var Hiro = {
	version: '1.10.3',

	// Folio is the nav piece on the left, and holding all docs' metadata internally
	folio: {
		// DOM elements
		el_folio: document.getElementById('folio'),
		el_logio: document.getElementById('logio'),
		el_doclist: document.getElementById('doclist'),
		el_counter: document.getElementById('a_counter'),
		el_archive: document.getElementById('archivelist'),			
		el_updatebubble: document.getElementById('updatebubble'),

		// Number of archived docs
		archived: 0,
		archiveOpen: false,
		unseenupdates: 0,		

		// Array of docs
		docs: [],
		// Lookup object. Usage: Hiro.folio.lookup[<docid>]
		lookup: {},

		// Last server sync timestamp
		lastsync: 0,
		// Time to live in ms, how long before we request a new version from the server to make sure we're in sync
		ttl: 0,

		// Timer for display update
		updatetimeout: null,		

		init: function() {
			// Basic Folio Setup
			// Load list of documents from server or create localdoc if user is unknown			
			if (Hiro.sys.user.level==0) {
				// See if we can find a local doc
				var ld = localStorage.getItem('WPCdoc');
				if (ld) {
					this.loadlocal(ld);
				} else {
					this.el_doclist.innerHTML='';
					this.newdoc();
				}
			} else {
				this.loaddocs();
			}

			// Register "close folio" events to rest of the page
			Hiro.util.registerEvent(document.getElementById(Hiro.canvas.canvasId),'mouseover', Hiro.ui.menuHide);
			Hiro.util.registerEvent(document.getElementById(Hiro.context.id),'mouseover', Hiro.ui.menuHide);			
			Hiro.util.registerEvent(document.getElementById(Hiro.canvas.contentId),'touchstart', Hiro.ui.menuHide);				

			// Register event that cancels the delayed opening of the menu if cursor leaves browser
			Hiro.util.registerEvent(document,'mouseout', function(e) {
			    e = e ? e : window.event;
			    var from = e.relatedTarget || e.toElement;
			    if (!from || from.nodeName == "HTML") {
			    	if (Hiro.ui.delayedtimeout) {
			    		clearTimeout(Hiro.ui.delayedtimeout);
			    		Hiro.ui.delayedtimeout = null;
			    	}
			    }			
			});	

			// Attach delegated event handler to document list
			Hiro.util.registerEvent(this.el_doclist,'click',Hiro.folio.docclick);
			Hiro.util.registerEvent(this.el_archive,'click',Hiro.folio.docclick);						
		},

		docclick: function(e) {
			// Clickhandler, this happens if a user clicks on a doc in the folio
			var target = e.relatedTarget || e.toElement,
				docid = target.id || target.parentNode.id || target.parentNode.parentNode.id;

			// Stop default behaviour first
			Hiro.util.stopEvent(e);	

			// Strip doc_ from id
			docid = docid.slice(-12);	

			// If click was on archive then change status and return
			if (target.className == 'archive') {
				Hiro.folio.archive(docid);
				return;
			}					

			// Close menu
			Hiro.ui.menuHide();								

			// Loaddoc and reset order of array
			if (docid != Hiro.canvas.docid) {
				Hiro.canvas.loaddoc(docid, Hiro.folio.lookup[docid].title);
			}				
		},

		showSettings: function(section,field,event) {
			// Show settings dialog
			if (Hiro.sys.user.level==0) {
				if (!field) {
					field = 'signup_mail';
					section = 's_signup';
				}
				if (analytics) analytics.track('Sees Signup/Sign Screen');
			} 
			Hiro.ui.showDialog(event,'',section,field);
		},		

		loaddocs: function(folioonly) {
			// Get the list of documents from the server
			var that = this;

			// Start progres bar
			if (!folioonly) Hiro.ui.hprogress.begin();			

			Hiro.store.handle({
			    url: '/docs/',
			    success: function(req,data) {
					// See if we have any docs and load to internal model, otherwise create a new one (signup with no localdoc)
					// or because we got invited via token
					if (!data.documents) {	
						if (Hiro.sharing.token) {
							// If we have a token we just call loaddocand let it figure out the rest via url / token
							Hiro.canvas.loaddoc();
							return;
						} else {
							// User just signed up without playing around, create first doc from server
							that.newdoc();
							return;
						}					
					} else {
						that.docs = data.documents;
					}							
					that.update();

					// load top doc if not already on canvas (or on first load when the doc is preloaded and we have no internal values yet) 
					var doc = data.documents[0];
					if (!folioonly && data.documents && doc.id != Hiro.canvas.docid) {
						Hiro.canvas.loaddoc(doc.id,doc.title);
					}

					// Update the document counter
				    if (Hiro.sys.user.level > 0) Hiro.folio.documentcounter();	

					// Check our Hiroversion and initiate upgradepopup if we have a newer one
					if (!Hiro.sys.version) { Hiro.sys.version = data.hiroversion; }
					else if (Hiro.sys.version != data.hiroversion) Hiro.sys.upgradeavailable(data.hiroversion);				    

			    },
			    error: function(req) {
			    	// Refresh page if loaddocs throws 401 (user most likely logged out of system)
			    	if (Hiro.sys.user.level > 0 && (req.status == 401 || req.status == 403)) window.location.href = '/'; 
			    }
			});						
		},

		loadlocal: function(localdoc) {	
			// Load locally saved document
			var ld = JSON.parse(localdoc);					
			Hiro.sys.log('Localstorage doc found, loading ', ld);						
			document.getElementById('landing').style.display = 'none';

			// Render doc in folio
			this.docs.push(ld);

			// Fix for different namings in frontend/backend
			this.docs[0].updated = ld.last_updated;
			this.update();

			// Render doc on canvas
			Hiro.canvas.loadlocal(ld);
		},
	
		update: function() {
			// update the document list from the active / archive arrays
			// We use absolute pointers as this can also be called as event handler
			var that = Hiro.folio,			
				wastebin = document.getElementById('wastebin'),
				seen = this.unseenupdates, 
				urlid = window.location.pathname.split('/')[2];	

			// Kick off regular updates, only once
			if (!that.updatetimeout) {
				that.updatetimeout = setInterval(Hiro.folio.update,61000);
			}					

			// Update our lookup object
			that.updatelookup();

			// Create placeholder divs
			var newdocs = document.createElement('div'),
				newarchive = document.createElement('div');

			that.unseenupdates = that.archived = 0;	

			// Add all elements & events to new DOM object, count elements in same step
			for (i=0,l=that.docs.length;i<l;i++) {	
				if (that.docs[i].status == 'active') {
					newdocs.appendChild(that.renderlink(that.docs[i].id)); 														
					// iterate unseen doc counter except for document to be loaded
					if (that.docs[i].unseen && that.docs[i].shared && i != 0) that.unseenupdates++;	
				} else {
					newarchive.appendChild(that.renderlink(that.docs[i].id));
					that.archived++;
				}								    
			}
			
			// Check if something changed, otherwise discard to wastebin and abort
			if (that.el_doclist.innerHTML == newdocs.innerHTML && that.el_archive.innerHTML == newarchive.innerHTML) {
				wastebin.appendChild(newdocs);
				wastebin.innerHTML = '';
				return;
			}			

			// Switch current DOM object with new one
			that.el_doclist.innerHTML = newdocs.innerHTML;
			if (that.el_archive) that.el_archive.innerHTML = newarchive.innerHTML;	

			// Update the document counter
			that.documentcounter();									

			// Show bubble if we have unseen updates
			if (that.unseenupdates > 0) {
				that.el_updatebubble.innerHTML = that.unseenupdates;
				that.el_updatebubble.style.display = 'block';
				if (seen < that.unseenupdates && !Hiro.ui.windowfocused) Hiro.ui.playaudio('unseen',0.7);
			} else {
				that.el_updatebubble.style.display = 'none';
			}
		},		

		updatelookup: function() {
			// Takes the two document arrays (active/archive) and creates a simple lookup reference object
			// Usage: Hiro.folio.lookup['79asjdkl3'].title = 'Foo'
			this.lookup = {};
			for (var i = 0, l = this.docs.length; i < l; i++) {
			    this.lookup[this.docs[i].id] = this.docs[i];			    
			}
		},


		updateunseen: function(increment) {
			// Updates the small visible counter (red bubble next to showmenu icon) and internal values
			// A negative value substracts one from the counter, a positive resets counter to value
			var i = this.unseenupdates = (increment < 0) ? this.unseenupdates + increment : increment;;
			if (i = 0) {
				this.el_updatebubble.style.display = 'none';
				return;
			}
			if (i > 1) {
				this.el_updatebubble.innerHTML = i;
				this.el_updatebubble.style.display = 'block';
			}
		},

		renderlink: function(docid) {
			// Render active and archived document link
			var lvl = Hiro.sys.user.level,
				doc = this.lookup[docid],
				lastupdate = (doc.last_doc_update && doc.updated <= doc.last_doc_update.updated) ? doc.last_doc_update.updated : doc.updated;

			var d = document.createElement('div');
			d.className = 'document';
			d.setAttribute('id','doc_'+doc.id);

			var link = document.createElement('a');
			link.setAttribute('href','/note/'+doc.id);	

			var t = document.createElement('span');
			t.className = 'doctitle';
			t.innerHTML = doc.title || 'Untitled Note';

			var stats = document.createElement('small');

			if (doc.updated) {
				var statline = Hiro.util.humanizeTimestamp(lastupdate) + " ago";
				// Check if document was last updated by somebody else
				// We also have to check the time difference including slight deviatian because our own updates are set by two different functions
				if (doc.last_doc_update) {
					statline = statline + ' by ' + (doc.last_doc_update.name || doc.last_doc_update.email); 
				}					
				stats.appendChild(document.createTextNode(statline));
			} else {
				stats.appendChild(document.createTextNode('Not saved yet'))							
			}	


			link.appendChild(t);
			link.appendChild(stats);

			if (doc.shared) {
				// Add sharing icon to document and change class to shared
				var s = document.createElement('div');
				s.className = 'sharing';
				var tooltip = 'Shared with others';	
				if (doc.unseen) {
					// Show that document has unseen updates
					var sn = document.createElement('div');
					sn.className = "bubble red";
					sn.innerHTML = '*';
					link.appendChild(sn);
					tooltip = tooltip + ', just updated';					
				}			
				s.setAttribute('title',tooltip);	
				link.appendChild(s);
				d.className = 'document shared';					
			}

			d.appendChild(link);	

			// Add archive icons
			if ( lvl >= 1) {
				var a = document.createElement('div');
				a.className = 'archive';
				if (doc.status == 'active' && lvl == 1) a.title = "Move to archive";						
				d.appendChild(a);
			}			

			return d;			
		},

		documentcounter: function() {
			// Updates the field in the settings with the current plan & document count
			var val, level = Hiro.sys.user.level, upgradelink, 
				target = (document.getElementById('dialog').contentDocument) ? document.getElementById('dialog').contentDocument.getElementById('s_account') : null,
				doccount = Hiro.sys.user.doccount = Hiro.folio.docs.length,
				archivecount = Hiro.folio.archived;


			// Visual archive updates
			if (archivecount > 0 && !this.archiveOpen) {
				this.el_counter.innerHTML = 'Archive (' + archivecount + ')';			
			}	
			
			if (!target) {
				// If the settings dialog is not loaded yet try again later 
				setTimeout(function(){
					Hiro.folio.documentcounter();			
				},500);					
			} else {
				// If the user level is 0 we dont have the form yet
				if (level==0 || !target.getElementsByTagName('input')[2]) return;
				upgradelink = target.getElementsByTagName('input')[2].nextSibling;
				// Get the plan name
				switch (level) {
					case 0:
					case 1:
						val = 'Basic';
						upgradelink.style.display = 'block';
						break;
					case 2:
						val = 'Advanced';
						upgradelink.style.display = 'block';					
						break;
					case 3:
						val = 'Pro';
						upgradelink.style.display = 'none';					
						break;		
				}
				val = val + ((document.body.offsetWidth>480) ? ' plan: ' : ': ');				
				if (Hiro.folio.docs) val = val + doccount;

				// See if we have plan limits or mobile device
				if (level < 2) val = val + ' of 10';
				
				target.getElementsByTagName('input')[3].value = val + ' notes';
			}
		},
		

		creatingDoc: false,
		newdoc: function() {
			// Initiate the creation of a new document
			// Avoid creating multiple docs at once and check for user level
			if (this.creatingDoc == true) return;
		
			// Show login dialog if user wants to create a second doc
			if (Hiro.sys.user.level == 0 && this.docs.length != 0) {
				Hiro.sys.user.upgrade(1,Hiro.folio.newdoc);
				return;
			}

			// Count how many docs a user is a owner of
			if (this.docs && Hiro.sys.user.level == 1 && this.docs.length >= 10) {
				// If user has more than 10 docs
				var own_counter = 0;
				for (i=0,l=this.active.length;i<l;i++) {
					if (this.active[i].role == 'owner') own_counter++;
				}
				if (own_counter > 10) {
					Hiro.sys.user.upgrade(2,Hiro.folio.newdoc,'Upgrade<em> now</em> for <b>unlimited notes</b><em> &amp; much more.</em>');
					return;	
				}				
			}

			// Check if the archive is open, otherwise switch view
			if (this.archiveOpen) this.openarchive();

			// All good to go
			this.creatingDoc = true;	

			// Start the bar
			Hiro.ui.hprogress.begin();								

			// Add a doc placeholder to the internal folio array
			var doc = {};
			doc.title = 'Untitled Note';
			doc.created = Hiro.util.now();
			doc.role = 'owner';
			doc.status = 'active';
			this.docs.splice(0,0,doc);

			// Render a placeholder until we get the OK from the server
			var el = document.createElement('div');
			el.className = 'document';	
			el.setAttribute('id','doc_creating');

			var ph = document.createElement('a');
			ph.setAttribute('href','#');	
			var pht = document.createElement('span');
			pht.className = 'doctitle';
			pht.innerHTML = 'Creating new note...';	
			var phs = document.createElement('small');
			phs.appendChild(document.createTextNode("Right now"))
			ph.appendChild(pht);
			ph.appendChild(phs);
			el.appendChild(ph);

			this.el_doclist.insertBefore(el,this.el_doclist.firstChild);

			// Create the doc on the canvas
			if (document.body.offsetWidth <= 900 && document.getElementById(Hiro.context.id).style.display == "block") Hiro.context.switchview();
			Hiro.canvas.newdoc();
			Hiro.ui.menuHide();

			// Get/Set ID of new document
			if ( Hiro.sys.user.level==0) {
				// Anon user doc gets stored locally
				var doc = document.getElementById('doc_creating');
				Hiro.sys.log('unknown user, setting up localstore ');

				// Set params for local doc
				Hiro.canvas.docid = 'localdoc';
				this.docs[0].id = 'localdoc';

				// Save document & cleanup
				doc.firstChild.firstChild.innerHTML = 'Untitled Note';
				doc.id = 'doc_localdoc';

				// Complete bar
				Hiro.ui.hprogress.done();					
			} else {
				// Request new document id
				var doc = document.getElementById('doc_creating');
				Hiro.sys.log('known user, setting up remote store ');

				// Clear sharing userlist if we had one
				if (Hiro.sharing.accesslist.users.length > 0) {
					Hiro.sharing.accesslist.users.length = 0;
					Hiro.sharing.accesslist.update();	
				}				

				// Submit timestamp for new doc id
				var file = {};				
				file.created = Hiro.util.now();				

				// Get doc id from server
				Hiro.comm.ajax({
					url: "/docs/",
	                type: "POST",
	                payload: JSON.stringify(file),
					success: function(req,data) {
	                    Hiro.sys.log("backend issued doc id ", data.doc_id);

						// Set params for local doc
						Hiro.canvas.docid = data.doc_id;

						// Set folio values
						Hiro.folio.docs[0].id = data.doc_id;	

						// Start sync
						Hiro.canvas.sync.begin('',req.getResponseHeader("collab-session-id"),req.getResponseHeader("channel-id"));                    								

						// Update folio
						Hiro.folio.update();		

						// Complete bar
						Hiro.ui.hprogress.done();																			                    
					}
				});				
			}

			// Get ready for the creation of new documents
			this.creatingDoc = false;
		},

		movetoremote: function() {
			// Moves a doc from localstorage to remote storage and clears localstorage
			// Doublecheck here for future safety
			if (Hiro.canvas.docid=='localdoc' && localStorage.getItem('WPCdoc')) {					
				// Strip id from file to get new one from backend
				var file = Hiro.canvas.builddoc();					
				file.id = '';
				file.text = Hiro.canvas.text;
				// Get doc id from server
				Hiro.comm.ajax({
					url: "/docs/",
	                type: "POST",
	                payload: JSON.stringify(file),
					success: function(req,data) {
	                    Hiro.sys.log("move local to backend with new id ", data);
	                    // Delete local item
	                    localStorage.removeItem('WPCdoc')

						// Start sync
						Hiro.canvas.sync.begin(Hiro.canvas.text,req.getResponseHeader("collab-session-id"),req.getResponseHeader("channel-id"));   		                    

						// Set new id for former local doc
						Hiro.canvas.docid = data.doc_id;

						// Get updated file list														
						Hiro.folio.loaddocs(true);                 																

						// Edge Case: User had a document moved to the backend and also accesstoken waiting
						if (Hiro.sharing.token) {
							Hiro.canvas.loaddoc();
						}							
					}
				});
			}
		},

		moveup: function(docid) {
			// moves a specific doc to the top of the list based on it's id
			// Find and remove item from list
			for (var i=0,l=this.docs.length;i<l;i++) {
				if (this.docs[i].id != docid) continue;
				this.docs.splice(i,1);
				break;					
			}

			// Sort array by last edit
			this.docs.sort(function(a,b) {return (a.updated > b.updated) ? -1 : ((b.updated > a.updated) ? 1 : 0);} );

			// Insert item at top of array and redraw list
			this.docs.unshift(this.lookup[docid]);	

			// Update display
			this.update();		
		},

		archive: function(docid) {
			// Move a current document to the archive, first abort if user has no account with archive
			if (Hiro.sys.user.level <= 1) {
				Hiro.sys.user.upgrade(2,'','<em>Upgrade now to </em><b>unlock the archive</b><em> &amp; much more.</em>');
				return;
			}	

			var newstatus = (this.lookup[docid].status == 'active') ? 'archived' : 'active';			

			// Set internal value
			this.lookup[docid].status = newstatus;

			// Render new list right away for snappiness
			this.update();	

			var payload = {'status': newstatus};
			Hiro.comm.ajax({
				url: "/docs/" + docid,
                type: "PATCH",
                payload: JSON.stringify(payload),
			});			
		},

		openarchive: function() {
			// Archive link
			// Show signup screen if user has no appropriate tier
			if (Hiro.sys.user.level < 2) {
				Hiro.sys.user.upgrade(2,'','<em>Upgrade now to </em><b>unlock the archive</b><em> &amp; much more.</em>');
				return;					
			};	

			if (this.el_doclist.style.display=='none') {
				this.el_doclist.style.display = 'block';
				this.el_archive.style.display = 'none';
				this.el_counter.innerHTML = 'Archive (' + this.archived + ')';
				this.archiveOpen = false;
			} else {
				this.el_doclist.style.display = 'none';
				this.el_archive.style.display = 'block';	
				this.el_counter.innerHTML = 'Close Archive';
				this.archiveOpen = true;					
			}				
		}
	},	

	// Canvas is the text page itself and all related functions
	canvas: {
		// DOM properties & visual stugg
		contentId: 'pageContent',	
		pageId: 'page',	
		pageTitle: 'pageTitle',
		defaultTitle: 'OK, let\'s do this', //Put 'Don\'t fear the blank paper', back in for registered users, find better one for new users
		titleTip: 'Give it a good title',
		canvasId: 'canvas',
		quoteId: 'nicequote',
		quoteShown: false,
		welcomeText: 'Just write',		

		// Internal doc values
		text: '',
		title: '',
		tempTitle: '',
		wordcount: 0,
		linecount: 0,
		typing: false,
		typingTimer: null,
		newChars: 0,
		newCharThreshhold: 100,
		newWords: 0,
		newWordThreshhold: 5,			
		selBeginning: null,
		caretPosition: 0,	
		saved: true,
		docid: '',
		created: 0,
		lastUpdated: 0,
		safariinit: true,
		preloaded: false,

		_init: function() {
			// Basic init on page load
			// Document events
			var el = document.getElementById(this.contentId);			
			var p = document.getElementById(this.canvasId);
			var t = document.getElementById(this.pageTitle);
			var c = document.getElementById(Hiro.context.id);	
			var f = Hiro.folio.el_folio;
			// See if a selection is performed and narrow search to selection
			Hiro.util.registerEvent(p,'mouseup',this.textclick);							
			Hiro.util.registerEvent(el,'keydown',this.keyhandler);	
			Hiro.util.registerEvent(el,'keyup',this.update);	

			// Remember last caret position on blur
			Hiro.util.registerEvent(el,'blur',function(){
				Hiro.canvas.caretPosition = Hiro.canvas._getposition()[0];
			});					

			// Resizing of textarea
			Hiro.util.registerEvent(el,'keyup',this._resize);
			Hiro.util.registerEvent(el,'cut',this._copynpaste);	
			Hiro.util.registerEvent(el,'paste',this._copynpaste);
			Hiro.util.registerEvent(el,'drop',this._copynpaste);

			// Title events	
			Hiro.util.registerEvent(t,'change',this.evaluatetitle);
			Hiro.util.registerEvent(t,'keydown',this.evaluatetitle);
			Hiro.util.registerEvent(t,'keyup',this.evaluatetitle);			
			Hiro.util.registerEvent(t,'mouseover', this._showtitletip);
			Hiro.util.registerEvent(t,'mouseout', this._hidetitletip);
			Hiro.util.registerEvent(t,'focus', this._clicktitletip);			
			Hiro.util.registerEvent(t,'select', this._clicktitletip);	
			Hiro.util.registerEvent(t,'click', this._clicktitletip);		

			// We save the new title in the folio array but need to update the clickhandler without duplicating them
			Hiro.util.registerEvent(t,'blur', Hiro.folio.update);	
			Hiro.util.registerEvent(t,'keyup', Hiro.folio.update);			

			if ('ontouchstart' in document.documentElement) {
				// Make sure the teaxtarea contents are scrollable on mobile devices
				el.addEventListener('touchstart',function(e){
					// Attach the swipe actions to canvas	
					var cb = (Hiro.ui.menuCurrPos != 0) ? null : Hiro.context.switchview;			
					Hiro.ui.swipe.init(cb,Hiro.ui.menuSwitch,e);					
				}, false);	
				c.addEventListener('touchstart',function(e){
					// Attach the swipe actions to context					
					Hiro.ui.swipe.init(null,Hiro.context.switchview,e);					
				}, false);	
				f.addEventListener('touchstart',function(e){
					// Attach the swipe actions to context					
					Hiro.ui.swipe.init(Hiro.ui.menuHide,null,e);					
				}, false);	
				f.addEventListener('touchstart',function(e){
					// Open menu when somebody touches the grea sidebar on the left on tablets etc					
					if (Hiro.ui.menuCurrPos == 0) Hiro.ui.menuSwitch();				
				}, false);				
				// Make UI more stable with event listeners			
				document.getElementById('page').addEventListener('touchmove',function(e){e.stopPropagation();},false);

				// Setting the viewport height has a lot of benefits regarding the bugs we dealt with 
				// (eg signup input field not scrolling into view, blocked input fields etc)
				var measure = 'height=' + window.innerHeight + 'device-height,width=device-width,initial-scale=1, maximum-scale=1, user-scalable=no';
				document.getElementById('viewport').setAttribute('content', measure);

				// Remove addressbar etc on mobile
				// window.scrollTo(0,1);	

				// Cancel safariinit after enough time passed to focus textarea fast after that
				if (this.safariinit) setTimeout( function() { Hiro.canvas.safariinit = false; },5000);	

				// Set defaulttitle to something more descriptive on touch devices
				this.defaultTitle = 'Title';			

			} else {
				// click on the page puts focus on textarea
				Hiro.util.registerEvent(p,'click',function(){
					if (!Hiro.sharing.visible) document.getElementById(Hiro.canvas.contentId).focus();
				});
			}				

			// Always set context sidebar icon to open on mobiles
			if (document.body.offsetWidth<=900) document.getElementById('switchview').innerHTML = '&#171;';						
		},	

        set_text: function(txt) {
        	// Set all internal values and visual updates in one go
			Hiro.canvas.text = document.getElementById(Hiro.canvas.contentId).value = txt;
            // Resize canvas
            Hiro.canvas._resize();               
        },

		builddoc: function() {
			// Collects doc properties from across the client lib and returns object
			// Build the JSON object from th evarious pieces
			var file = {};
			file.id = this.docid;
			file.title = this.title;
			file.created = this.created;
			file.last_updated = this.lastUpdated;
			file.cursor = this.caretPosition;
			file.hidecontext = !Hiro.context.show;
			file.links = {};
			file.links.sticky = Hiro.context.sticky;
			file.links.normal = Hiro.context.links;
			file.links.blacklist = Hiro.context.blacklist;
			return file;			
		},

		savedoc: function(force) {
			// force: Boolean if status indicator should be shown
			// Save the currently open document
			// For now we only say a doc is updated once it's saved		
			var status = document.getElementById('status');
			if (Hiro.context.overquota) force = true;
			if (force) status.innerHTML = 'Saving...';
			this.lastUpdated = Hiro.util.now();
			var file = this.builddoc();		

			// backend saving, locally or remote
			if (this.docid != 'localdoc' && Hiro.sys.user.level > 0) {
				// Save remotely, immediately indicate if this fails because we're offline
				Hiro.sys.log('saving remotely: ', file);	
				var u = "/docs/"+this.docid,
					doc = Hiro.folio.lookup[Hiro.canvas.docid];

				// Reset "by x" in folio if we have one
				if (doc && doc.last_doc_update) {
					doc.last_doc_update = undefined;
					Hiro.folio.update();
				}	

				Hiro.comm.ajax({					
					url: u,
	                type: "PATCH",
	                payload: JSON.stringify(file),
					success: function() {
	                    Hiro.sys.log('Doc saved!');
						Hiro.canvas.saved = true;	 
						if (force) status.innerHTML = 'Saved.';
					},
					error: function(req) {
						Hiro.sys.error('Savedoc PATCH returned error: ' + JSON.stringify(req));			
						// Move away from note if rights were revoked
						if (req.status == 404 || req.status == 404) {
	                        if (req.status == 404) Hiro.ui.statusflash('red','Note not found.',true);
							if (req.status == 403) Hiro.ui.statusflash('red','Access denied, sorry.',true);  
							Hiro.folio.loaddocs();								
						} 										
					}
				});											
			} else {
				// Store doc locally 
				file.status = 'active';
				
				// Add text to file object
				file.text = Hiro.canvas.text;

				Hiro.sys.log('saving locally: ', file);	
			    try { 
					localStorage.setItem("WPCdoc", JSON.stringify(file));
				} catch(e) {
			        alert('Please sign up to safely store long notes.');
			        Hiro.sys.user.upgrade(1);
			    }				
				Hiro.canvas.saved = true;	
				status.innerHTML = 'Saving...';	
				setTimeout(function(){document.getElementById('status').innerHTML = 'Saved.'},350);							
			}	

			// Check if user didn't navigate away from archive and set last updated
			Hiro.folio.lookup[Hiro.canvas.docid].updated = Hiro.util.now();
			Hiro.folio.update();					
		},	

		preload: function() {
			// If flask already gave us the title and text values
			this.preloaded = true;
			this._resize();			
		},


		loaddoc: function(docid, title, addnohistory) {
			// Load a specific document to the canvas
			var mobile = (document.body.offsetWidth<=900),
				header = {}, token = Hiro.sharing.token,
				urlid = window.location.pathname.split('/')[2], that = this;		

			// Final try to save doc, eg when connection wasn't available before				
			if (!this.saved) this.savedoc();

			// Redirect to loadlocal if id should be localdoc
			if (docid == 'localdoc' && !token) {
				var ld = localStorage.getItem('WPCdoc');
				if (ld) {
					this.loadlocal(JSON.parse(ld)); 
					Hiro.ui.menuHide();					
				}
				return;					
			}

			// Fall back to current docid if we didn't get one
			docid = docid || Hiro.canvas.docid;

			if (this.preloaded) {
				// Override document id with url id if Flask did set preloaded flag
				// Intentionally works only on /note/<note-id> URLs
				docid = urlid || docid;
			}

			// Move document we want to load to top of folio and rerender
			Hiro.folio.moveup(docid);		

			// If we have an active accesstoken, we override all previous setting
			if (token) {
				// Get docid from url (fallback to docid, this shouldn't happen) and set accesstoken header
				docid = urlid || docid;
				header.accesstoken = token;
				title = '';
				// Remove token right away so it can't wreak havoc
				Hiro.sharing.token = '';
			}

			Hiro.sys.log('loading doc id: ', [docid, header]);

			// Start progress bar or increment
			Hiro.ui.hprogress.begin();

			// If we already know the title, we shorten the waiting time
			if (title && !this.preloaded) document.getElementById(this.pageTitle).value = document.title = title;	
			document.getElementById(Hiro.context.statusId).value = 'Loading...';			
			if (mobile && document.getElementById(Hiro.context.id).style.display=='block') Hiro.context.switchview();


			// Load data onto canvas
			Hiro.comm.ajax({
				url: '/docs/'+docid,
				headers: header,
				success: function(req,data) {
					Hiro.canvas.docid = data.id;
					Hiro.canvas.created = data.created;
					Hiro.canvas.lastUpdated = data.updated;	

					// Check if the document had unseen updates		
					if (Hiro.folio.lookup[docid] && Hiro.folio.lookup[docid].unseen == true) {
						var el = document.getElementById('doc_' + docid);
						if (el) {
							var bubble = el.getElementsByClassName('bubble')[0];
							if (bubble) bubble.style.display = 'none';
						}
						Hiro.folio.lookup[docid].unseen = false;
						Hiro.folio.updateunseen(-1);
					}		

					// Reload folio if we had a token 
					if (token) Hiro.folio.loaddocs(true);			

					// Add object to history
					if (!addnohistory) Hiro.util.addhistory(data.id,data.title);				

					// Show data on canvas
					if (!mobile && data.hidecontext == Hiro.context.show) Hiro.context.switchview();									
					var content = document.getElementById(that.contentId);
					if (content.value != data.text) {
						content.value = data.text;					
						// Reset the canvas size to document contents in the next 2 steps
						content.style.height = 'auto';					
						Hiro.canvas._resize();
					}	

					// If the title changed in the meantime or wasn't passed to loaddoc at all
					if (!title || title != data.title) {
						document.getElementById(that.pageTitle).value = document.title = data.title || 'Untitled';
						if (title && Hiro.folio.lookup[docid]) {
							Hiro.folio.lookup[docid].title = data.title;
							Hiro.folio.update();
						}	
					}						

					// Set internal values, do not store 'null' as title string as it fucks up search
					that.text = data.text;
					that.title = (data.title) ? data.title : '';	
					that.preloaded = false;

					// Initiate syncing of file
					Hiro.canvas.sync.begin(data.text,req.getResponseHeader("collab-session-id"),req.getResponseHeader("channel-id"));                    

					// Set position, try to make this mroe realibale on mobiles
					that._setposition(data.cursor);					

					// If the document is shared then fetch the list of users who have access
					if (data.shared) Hiro.sharing.accesslist.fetch();

					// If body is empty show a quote
					if (!data.text || data.text.length == 0) {
						Hiro.ui.fade(document.getElementById(that.quoteId),+1,300);	
						Hiro.util.registerEvent(document.getElementById(Hiro.canvas.contentId),'keydown',Hiro.canvas._cleanwelcome);						
					} else {
						Hiro.canvas._removeblank();
					}	
						
					// Load links
					Hiro.context.wipe();	
					Hiro.context.clearresults();
					Hiro.context.sticky = data.links.sticky || [];
					Hiro.context.links = data.links.normal || [];
					Hiro.context.blacklist = data.links.blacklist || [];	
					if (data.links.normal.length != 0 || data.links.sticky.length != 0) {
						Hiro.context.renderresults();
					} 
					document.getElementById(Hiro.context.statusId).innerHTML = 'Ready.';	

					// Fetch collaborator list if we have collaborators
					if (data.shared) {
						Hiro.sharing.accesslist.fetch();
					} else {
						Hiro.sharing.accesslist.users = [];
						Hiro.sharing.accesslist.update();
					}	

					// Complete progress bar
					Hiro.ui.hprogress.done();					
				},
				error: function(req) {					
					// Complete progress bar
					Hiro.ui.hprogress.done(true);					
					Hiro.sys.error(req);
					// Show notifications and reset token if we had one
					if (req.status == 404) Hiro.ui.statusflash('red','Note not found.',true);
					if (req.status == 403 && token) Hiro.ui.statusflash('red','Access denied, sorry.',true);															
					// If the load fails because of access issues reset doclist
					if (req.status == 403 || req.status == 404) {
						// Release preloaded to enable loaddocs to load any doc
						Hiro.canvas.preloaded = false;
                    	// Reload docs                  								
                    	Hiro.folio.loaddocs();
                    }
				}
			});						
		},	

		loadlocal: function(data) {
			// Loading a local document on the canvas
			document.getElementById(this.pageTitle).value = document.title = data.title;	
			document.getElementById(this.contentId).value = data.text;
			if (data.text) {
				Hiro.canvas._removeblank();
			} else {
				Hiro.ui.fade(document.getElementById(this.quoteId),+1,300);	
				Hiro.util.registerEvent(document.getElementById(Hiro.canvas.contentId),'keydown',Hiro.canvas._cleanwelcome);
			}								
			this._setposition(data.cursor);

			// Show default title if none was saved	
			if (!data.title || data.title.length==0) {
				document.getElementById(this.pageTitle).value = document.title ='Untitled';
			}				

			// Load links
			Hiro.context.sticky = data.links.sticky || [];
			Hiro.context.links = data.links.normal || [];
			Hiro.context.blacklist = data.links.blacklist || [];	
			Hiro.context.renderresults();
			if (Hiro.context.show == data.hidecontext) Hiro.context.switchview();
			document.getElementById(Hiro.context.statusId).innerHTML = 'Welcome back!';							

			// Set internal values	
			this.text = data.text;	
			this.title = data.title;
			this.docid = data.id;
			this.created = data.created;
			this.lastUpdated = data.last_updated;	

			// Complete bar
			Hiro.ui.hprogress.done();									
		},

		newdoc: function() {
			// Create a new document (canvas part)
			// See if the current document was changed in any way (Should we even allow the creation of new documents of the current one is blank?)
			if (!this.saved) this.savedoc();	

			// Set up blank document	
			var title = document.getElementById(this.pageTitle);
			var content = document.getElementById(this.contentId);		
			title.value = this.defaultTitle;
			content.value = '';			
			document.getElementById(this.quoteId).style.display = 'block';
			Hiro.ui.fade(document.getElementById(this.quoteId),+1,300);			
			this.quoteShown = true;

			Hiro.context.clearresults();
			document.getElementById(Hiro.context.statusId).innerHTML = 'Ready.';
			this.created = Hiro.util.now();

			// Empty the link lists & internal values
			this.title = '';
			this.text = '';
			Hiro.context.wipe();	
			Hiro.context.clearresults();

			Hiro.util.registerEvent(content,'keydown',this._cleanwelcome);
			// If the landing page is loaded, don't pull the focus from it, bit expensive here, maybve add callback to newdoc later
			if (Hiro.sys.user.level==0 && document.getElementById('landing').style.display != 'none') {
				var el = document.getElementById('landing').contentDocument.getElementById('startwriting');
				if (el) el.focus();
			} else {
				document.getElementById(Hiro.canvas.contentId).focus();				
			} 

			// Complete bar
			Hiro.ui.hprogress.done();											
		},


		_titletiptimer: null,
		_showtitletip: function() {	
			// Show an encouraging title and indicitae that title can be changed here
			Hiro.canvas._titletiptimer = setTimeout(function(){
				var title = document.getElementById(Hiro.canvas.pageTitle);	
				var tip = ('ontouchstart' in document.documentElement) ? '' : Hiro.canvas.titleTip;
				Hiro.canvas.tempTitle = title.value;			
				if (!title.value || title.value.length == 0 || title.value == "Untitled" || title.value == Hiro.canvas.defaultTitle) title.value = tip;					
			},200);								
		},

		_hidetitletip: function() {
			// Revert title back to previous state
			clearInterval(Hiro.canvas._titletiptimer);
			Hiro.canvas._titletiptimer = null;
			var title = document.getElementById(Hiro.canvas.pageTitle);	
			var tip = Hiro.canvas.titleTip;	
			if (title.value==tip) {
				title.value = Hiro.canvas.tempTitle;
			}
		},

		_clicktitletip: function(event) {
			event.stopPropagation();
			var title = document.getElementById(Hiro.canvas.pageTitle);
			if (title.value == Hiro.canvas.titleTip || title.value == Hiro.canvas.defaultTitle) title.value = '';	
		},	

		evaluatetitle: function(event) {
			// When the title changes we update the folio and initiate save
			// If user presses enter or cursor-down automatically move to body	
			var k = event.keyCode;
		    if ( k == 13 || k == 40 ) {
				event.preventDefault();
		        Hiro.canvas._setposition(0);
		    }

			// Do not proceed to save if the shift,alt,strg or a navigational key is pressed	
			var keys = [16,17,18,33,34,35,36,37,38,39,40];	
			if (keys.indexOf(k) > -1) return;	

			// Update internal values and Browser title			
			Hiro.canvas.title = document.title = this.value;
			if (Hiro.folio.lookup[Hiro.canvas.docid]) Hiro.folio.lookup[Hiro.canvas.docid].title = this.value;
			if (!this.value) document.title = 'Untitled';

			// Visually update name in portfolio right away
			var el = document.getElementById('doc_'+Hiro.canvas.docid);			
			if (el) el.firstChild.firstChild.innerHTML = this.value;			

			// Initiate save & search
			Hiro.canvas._settypingtimer(true);
		},

		_cleanwelcome: function() {
			// Remove welcome teaser etc which was loaded if document was blank
			var el = document.getElementById(Hiro.canvas.contentId);		
			Hiro.ui.fade(document.getElementById('nicequote'),-1,500);
			Hiro.util.releaseEvent(el,'keydown',Hiro.canvas._cleanwelcome);
			Hiro.canvas.quoteShown = false;
		},

		_removeblank: function() {
			// Make sure we remove all blank stuff from the canvas
			this._cleanwelcome();
		},

		update: function(event) {
			// Do nothing if keypress is F1-12 key			
			var k = event.keyCode;
			if (k > 111 && k < 124) return;

			// Return if only the shift,alt,strg or a navigational key is pressed	
			var keys = [16,17,18,33,34,35,36,37,38,39,40];	
			if (keys.indexOf(k) > -1) return;

			// update function bound to page textarea, return to local canvas scope
			Hiro.canvas.evaluate();			
		},		

		_resize: function() {
			// Resize canvas textarea as doc grows
			// TODO: Consider cut/copy/paste, fix padding/margin glitches
			var w = document.body.offsetWidth,
				midi = (w > 480 && w <900) ? true : false,
		    	text = document.getElementById(Hiro.canvas.contentId);   
		    if (midi) {
		    	text.style.height = (text.scrollHeight-100)+'px';
		    } else {
		    	text.style.height = (text.scrollHeight-50)+'px';
		    }
		},

		_copynpaste: function() {
			// on copy and paste actions					
	        window.setTimeout(Hiro.canvas._resize, 0);

	        window.setTimeout(function(){
	        	// Some browser fire c&p events with delay, without this we would copy the old values
	        	var that = Hiro.canvas, newtext = document.getElementById(that.contentId).value;

	        	// See if there was newly added text
	        	if (that.sync.dmp && that.text != newtext) {
	        		// Send pasted text to link extraction
	        		var diff = that.sync.dmp.diff_main(that.text, newtext);
	        		diff = diff[1] || diff[0];
	        		if (diff && diff[0] == 1) Hiro.context.extractlinks(diff[1]);
	        	}

		        // Set internal variables
		        that.text = newtext;
		        that.title = document.getElementById(that.pageTitle).value;
				that.caretPosition = that._getposition()[1];		        

		        // Save Document        
                if (!Hiro.canvas.sync.inited) { that.savedoc() } else { Hiro.canvas.sync.addedit(false,'Saving...'); }
	        }, 10);
		},

		keyhandler: function(e) {
			// Various actions when keys are pressed
			var k = e.keyCode;

			// Tab key insert 5 whitespaces
			if (k==9) {
				Hiro.canvas._replacekey(e,'tab');
				e.preventDefault();
			}

			// Space and return triggers brief analysis, also sends an edit to the internal sync stack
			if (k==32||k==13||k==9) {
				Hiro.canvas._wordcount();	
				if (Hiro.sys.user.level > 0) Hiro.canvas.sync.addedit(false,'Saving...'); 
			}

			// See if user uses arrow-up and jump to title if cursor is at position 0
			if (k == 38) {
				var p = Hiro.canvas._getposition();
				if (p[0] == p[1] && p[0] == 0) {
					document.getElementById(Hiro.canvas.pageTitle).focus();
				}
			}	

			//					
		},

		_replacekey: function(e,key) {
			// Replace default key behavior with special actions
			var pos = this._getposition()[1];		
			var src = document.getElementById(Hiro.canvas.contentId); 				
			if (key == 'tab') {	
	            Hiro.util.stopEvent(e);				
	            src.value = Hiro.canvas.text = [src.value.slice(0, pos), '\t', src.value.slice(pos)].join('');
	            // We have to do this as some browser jump to the end of the textarea for some strange reason		
	            if (document.activeElement) document.activeElement.blur();
	            Hiro.canvas._setposition(pos+1);        
	        }        
		},

		evaluate: function() {
			// Quick analysis on every keystroke
			this.saved = false;
			this.typing = true;

			// set internal text string to current text 
			var txt = document.getElementById(this.contentId).value;	
			this.text = txt;

			// count chars and execute on n char changes
			this.newChars++;
			if (this.newChars>=this.newCharThreshhold) {
				Hiro.sys.log('new chars typed: ',this.newChars);
				// Hiro.sys.savetext(this.text);
				this.newChars = 0;
			};

			// Log caret position internally
			this.caretPosition = this._getposition()[1];

			// Initiate change timers to do x after n seconds
			this._settypingtimer();						
		},

		_wordcount: function() {
			// get the words and newlines in the text
			var t = this.text;
			this.linecount = t.split(/\r?\n/).length; 
			t = t.replace(/\r?\n/g," "); 
			t = t.replace(/\t/g," ");
			t = t.replace(/\s{2,}/g," ");
			// compare new wordcount with old one, set newwords and then update wordcount
			var cw = t.split(' ').length-1;
			if (cw != this.wordcount) this.newWords++;
			if (this.newWords>=this.newWordThreshhold) {
				Hiro.sys.log('new words');
				this.newWords = 0;	
			} 
			this.wordcount = cw;
		},

		_settypingtimer: function(save) {
			// set & clear timers for saving and context if user pauses
			if (this.typingTimer) clearTimeout(this.typingTimer);
			this.typingTimer = setTimeout(function() {	
				// Clean up (and remove potential previous editor from docs array)
				var doc = Hiro.folio.lookup[Hiro.canvas.docid],
					lvl = Hiro.sys.user.level;
				if (doc && doc.lastEditor) doc.lastEditor = null;
				Hiro.canvas._cleartypingtimer();				

				// Add edit if user is logged in or save locally if not
				if (Hiro.canvas.sync.inited) Hiro.canvas.sync.addedit(false,'Saving...');

				// Save rest of doc if flag is set or user not logged in yet
				if (save || lvl == 0) Hiro.canvas.savedoc();	

				// Show searchtips if user isn't signed in yet
				if (lvl == 0 && ((Hiro.context.sticky.length + Hiro.context.links.length) == 0)) {
					var msg = (Hiro.canvas.text.length > 500) ? 'Tip: You can also select a whole paragraph' : 'Select a word you typed to start a search';					
						el = document.getElementById(Hiro.context.wwwresultsId);
						el.innerHTML = '<div class="tip">' + msg + '</div>';
				} 				
			},1000);
		},	

		_cleartypingtimer: function() {
			clearTimeout(this.typingTimer);
			this.typing = false;			
			this.typingTimer = null;
		},	

		_logcontent: function() {
			// Debug logging of text, position etc
			var log = document.getElementById('log');
			var pos = this.caretPosition;
			Hiro.sys.log('Words: ' + this.wordcount + " Lines: " + this.linecount + " Pos: " + pos);			
		},

		textclick: function(event) {
			// when text is clicked
			var sel = Hiro.canvas._getposition(),
				target = event.target || event.srcElement;
			if (sel[0] != sel[1]) Hiro.context.search(Hiro.canvas.title,sel[2],true,true);
			if (target.id == Hiro.canvas.canvasId || target.id == Hiro.canvas.contentId) Hiro.ui.clearactions(null,true);
		},

		_getposition: function() {
			// The the current caret position in the source textarea, optionally get range
		    var el = document.getElementById(this.contentId);
		    var x, y, content;	    
		    if ('selectionStart' in el) {
		    	//Mozilla and DOM 3.0
		        x = el.selectionStart;
				y = el.selectionEnd;
				var l = el.selectionEnd - el.selectionStart;
				content = el.value.substr(el.selectionStart, l)
		    } else if (document.selection) {
		    	//IE
		        el.focus();
		        var r = document.selection.createRange();
		        var tr = el.createTextRange();
		        var tr2 = tr.duplicate();
		        tr2.moveToBookmark(r.getBookmark());
		        tr.setEndPoint('EndToStart',tr2);
		        if (r == null || tr == null) {
		        	x = el.value.length;
		        	y = el.value.length;
		        	content = '';
		        	return [x, y, content];
		        } 
		        var text_part = r.text.replace(/[\r\n]/g,'.'); //for some reason IE doesn't always count the \n and \r in the length
		        var text_whole = el.value.replace(/[\r\n]/g,'.');
		        x = text_whole.indexOf(text_part,tr.text.length);
		        y = x + text_part.length;
		        content = r.text;
		    }  
		    return [x, y, content];			    
		},	

		_setposition: function(pos,force,retry) {			
			// Set the cursor to a specified position
			var el = document.getElementById(Hiro.canvas.contentId),
				al = document.activeElement,
				touch = ('ontouchstart' in document.documentElement),
				contentfocus = (el && al && el.id == al.id);		
				
			// Set default position if we didn't provide one			
			if (!pos) pos = (this.caretPosition < this.text.length) ? this.caretPosition : 0;

			// Check of we do have a proper array, otherwise fall pack to scalar
			if (Object.prototype.toString.call(pos) == '[object Array]') {
				var pos1 = pos[0], pos2 = pos[1];				
			} else {
				var pos1 = pos2 = pos;				
			}				

			// Abort if focus is already on textarea
			if (!force && contentfocus) return;  

    		if (touch && (document.body.offsetWidth <= 480 || document.body.offsetHeight <= 480)) {
    			// Abort if doc is not empty or very short
    			if (Hiro.ui.menuCurrPos != 0 || (!force && el.value.length > 150)) return; 	
    			if (!force) {
	    			// Delay in this case because of quirky new iOS, where instant focus does not work for some reason    				
	    			setTimeout(function(){	    				
	    				Hiro.canvas._setposition(pos,true,true);
	    			},500);	
	    			return;
    			} else if (!retry && !contentfocus) {
    				return;
    			}		
    		};   

    		// Unfocus any existing elements or abort if user is in an input field
    		if (al && al.nodeName == "INPUT" && al.id != 'pageTitle') return;
    		if (!contentfocus && document.activeElement) document.activeElement.blur();
    		this._resize();   


    		// Set the position    		
    		if (el.setSelectionRange) {
				if (window.navigator.standalone && this.safariinit) {		
					// Mobile standalone safari needs the delay, because it puts the focus on the body shortly after window.onload
					// TODO Bruno findout why, it's not about something else setting the focus elsewhere						
					setTimeout( function(){						
						if (Hiro.ui.menuCurrPos!=0) return;
						Hiro.canvas.safariinit = false;						
						el.focus();							
						el.setSelectionRange(pos1,pos2);														
					},1000);								
				} else {
					el.focus();													
					el.setSelectionRange(pos1,pos2);																																		
				}     									
    		} else if (el.createTextRange) {
        		var range = el.createTextRange();
        		range.collapse(true);
        		range.moveEnd('character', pos1);
        		range.moveStart('character', pos2);
        		range.select();
    		} else {
    			el.focus();
    		}

    		// Store internal value
    		this.caretPosition = pos1;
		},

		sync: {
			// Differential syncronisation implementation https://neil.fraser.name/writing/sync/
			shadow: '',
			edits: [],
			localversion: 0,
			remoteversion: 0,
			enabled: false,
			sessionid: undefined,
			inited: false,
			latestcursor: 0,
			previouscursor: 0,
			keepalive: null,
			keepaliveinterval: 300000,			

			init: function(dmponly) {
				// Abort if sync was already inited
				if (this.inited) return;

				// Create new diff_match_patch instance once all js is loaded, retry of not
				if (!this.dmp && typeof diff_match_patch != 'function') {
					setTimeout(function(){
						Hiro.canvas.sync.init(dmponly);
					},100);
					return;
				}
				this.dmp = new diff_match_patch();

				// For anon users we only load the dmp
				if (dmponly) return;			

                // Set internal value
				this.enabled = true;	                
                this.inited = true;
            },

			begin: function(text,sessionid,token,resend) {
				// Reset state, load values from new doc and initiate websocket		
				this.reset();

				// Set internal values
				Hiro.comm.crap.channelToken = token;
                this.sessionid = sessionid;
                this.shadow = text;       

            	// Open new channel with token
            	Hiro.comm.crap.connect(token);                 

                // If we have set the resend flag
                if (resend) this.addedit(true,'Syncing...');

				// Initiate Keepalive
				clearTimeout(Hiro.canvas.sync.keepalive);				
				this.keepalive = null;
				this.keepalive = setTimeout(function(){
					Hiro.canvas.sync.addedit(true,'Syncing...');
				},this.keepaliveinterval);                
			},

			reset: function() {
				// Reset local sync state
				this.shadow = '';
				this.edits = [];
				this.localversion = this.remoteversion = 0;
			},


			addedit: function(force,reason,ownupdate) {
				// Add an edit to the edits array
				var c = Hiro.canvas.text, s = this.shadow, edit = {}; 				

				// If we're inflight then wait for callback
				if (this.inflight) {
					this.inflightcallback = Hiro.canvas.sync.addedit;
					return;
				}	

				// Abort if the string stayed the same or syncing is disabled
				if (!force && (!this.enabled || c == s)) return;

				if (Hiro.comm.online || this.edits.length == 0) {
					// Build edit object, if we are offline we only build one to send instead of clogging array with endless edits
					// Right now including Patch and simple diff string format, TODO Choose one
					edit.delta = this.delta(s,c); 
					edit.clientversion = this.localversion++;
					edit.serverversion = this.remoteversion;

	                // Update last edit timestamp & folio display if text was changed
	                if (c != s) {
	                	var doc = Hiro.folio.lookup[Hiro.canvas.docid];
						if (doc) doc.updated = Hiro.util.now();	
						Hiro.folio.update();
	                }				

					// Cursor handling
					this.previouscursor = this.latestcursor;
					edit.cursor = this.latestcursor = Hiro.canvas.caretPosition; 

					// Add edit to edits stack
					this.edits.push(edit);
					this.shadow = c;
				}

				// Initiate sending of stack
				this.sendedits(reason);

				// Cleanup and reset Keepalive
				clearTimeout(Hiro.canvas.sync.keepalive);				
				this.keepalive = null;
				this.keepalive = setTimeout(function(){
					Hiro.canvas.sync.addedit(true,'Syncing...');
				},this.keepaliveinterval);
			},

			inflight: false,
			inflightcallback: null,
			sendedits: function(reason) {
				// Post current edits stack to backend and clear stack on success
				var statusbar = document.getElementById(Hiro.context.statusId);
                if (this.edits.length == 0 || this.inflight || Hiro.canvas.docid == 'localdoc' || Hiro.sys.user.level == 0) {
                	// if we do not have any edits, are currently inflight or user is not logged in yet
                    return;
                }

                if (!Hiro.canvas.docid) {
                	// If we don't have a docid yet try again later
                	setTimeout( function(){
                		Hiro.canvas.sync.sendedits();
                	},500);
                	return;
                }

                // Set variable to prevent double sending
                this.inflight = true;
                Hiro.sys.log('Starting sync with data: ',JSON.stringify(this.edits));
                if (reason) statusbar.innerHTML = reason || 'Saving...';

                // Post editstack to backend
                Hiro.comm.ajax({
                    url: "/docs/"+Hiro.canvas.docid+"/sync",
                    type: "POST",
                    payload: JSON.stringify({"session_id": this.sessionid, "deltas": this.edits}),
                    timeout: 10000,
                    success: function(req,data) {
                        // Confirm
                		statusbar.innerHTML = 'Saved.';                       
                        Hiro.sys.log('Completed sync request successfully ',[JSON.stringify(data.deltas)]);

                        // process the edit-stack received from the server
                        Hiro.canvas.sync.process(data.deltas);

                        // Reset inflight variable
                        Hiro.canvas.sync.inflight = false;                        

                        // Do callback if we have one
                        if (Hiro.canvas.sync.inflightcallback) {
                        	Hiro.canvas.sync.inflightcallback();
                        	Hiro.canvas.sync.inflightcallback = null;
                        }	
                        	
                    },
                    error: function(req,data) {
                        // Reset inflight variable
                        Hiro.canvas.sync.inflight = false;					

                        // Retry if it was just a sync session timeout (20 mins)
                        if (req.status == 412) {
                        	var sv = data.text,
                        	    lv = Hiro.canvas.sync.shadow;

                        	// See if the client/server versions differ, build and apply patch if
                        	if (sv != lv) {
                        		// Build delta from 'old' local version and 'new' server version
                        		var delta = Hiro.canvas.sync.delta(lv,sv);
                        		Hiro.canvas.sync.patch(delta,true);
                        	}    

							Hiro.canvas.sync.begin(sv,req.getResponseHeader("collab-session-id"),req.getResponseHeader("channel-id"),true);
                        	return;
                        }

                        // Log error if it wasn't a reconnect (see above)
                        Hiro.sys.error('Completed sync request with error ' + JSON.stringify(req));                        

                        // Move away from note if rights were revoked
                        if (req.status == 404) Hiro.ui.statusflash('red','Note not found.',true);
						if (req.status == 403) Hiro.ui.statusflash('red','Access denied, sorry.',true);  
						
						// Try callback but navigate away once access is lost 
						if (req.status == 401 || req.status == 403 || req.status == 404) {
                        	// Prevent further sendedits
                        	Hiro.canvas.sync.inflight = true;    
                        	setTimeout(function(){ Hiro.canvas.sync.inflight = false; },2000);
                        	// Reload docs                  								
                        	Hiro.folio.loaddocs();
                        } else if (Hiro.canvas.sync.inflightcallback) {
                        	Hiro.canvas.sync.inflightcallback();
                        	Hiro.canvas.sync.inflightcallback = null;
                        }
                    }
                });				
			},
            
            process: function(stack) {
            	// Process one or multiple edit responses we get as response from the sync server
                var len = stack.length;
                for (var i=0; i<len; i++) {
                    var edit = stack[i];                   

                    if (edit.force === true) {
                        // Something went wrong on the server, thus we reset everything
                        Hiro.sys.log("server enforces resync, complying");
                        this.shadow = edit.delta;
                        this.localversion = edit.clientversion;
                        this.remoteversion = edit.serverversion;
                        this.edits = [];
                        Hiro.canvas.set_text(edit.delta);    
                        Hiro.canvas._setposition(this.previouscursor,true);  
                        Hiro.sys.error('Server forced resync ' + JSON.stringify(edit));                                                               
                        continue;
                    }

                    // Clean up local stack
                    if (this.edits) {
                    	for (i=0,l=this.edits.length;i<l;i++) {
                    		// Remove the old & ACK'd local edit(s) from the stack
                    		if (this.edits[i] && this.edits[i].clientversion <= edit.clientversion) {                      			
                    			this.edits.splice(i,1);
                    		}	                 			
                    	}                 	
                    }

                    // Handle edge cases
                    if (this.remoteversion < edit.serverversion) {
                        Hiro.sys.error("TODO: server version ahead of client -- resync");
                        continue;
                    } else if (this.remoteversion > edit.serverversion) {
                        //dupe
                        Hiro.sys.error("TODO: Sync dupe received");
                        continue;
                    } else if (edit.clientversion > this.localversion) {
                    	// Edge case: to be researched when this happens
                        Hiro.sys.error("TODO: client version mismatch -- resync: cv(server): " + edit.clientversion +" cv(client): " +this.localversion);
                        continue;
                    } 

                	// Apply the delta if we didn't abort above
                	this.patch(edit.delta);  

	            	// Iterate remote version
	            	this.remoteversion++;                 	                                        
                }
            }, 

            patch: function(delta,shadowonly) {
            	// Create and apply a patch from the delta we got
            	var diffs, patch, merged,
            		regex = /^=[0-9]+$/,
            		oldtext = Hiro.canvas.text,
            		oldcursor = Hiro.canvas._getposition(),
            		doc = Hiro.folio.lookup[Hiro.canvas.docid];              	                	           		

            	// If the delta is just a confirmation, do nothing
            	if (regex.test(delta)) {
            		Hiro.sys.log('No text changed');
            		return;
            	} 	

                // Update last edit timestamp & folio display
				if (doc) doc.updated = Hiro.util.now(); 
				Hiro.folio.update();	            	

            	// Build diffs from the server delta
            	try { diffs = this.dmp.diff_fromDelta(this.shadow, delta) } 
            	catch(e) {
            		Hiro.sys.error('Something went wrong during patching:' + JSON.stringify(e));
            	}	          	

            	// Build patch from diffs
            	patch = this.dmp.patch_make(this.shadow, diffs);

                if (diffs && (diffs.length != 1 || diffs[0][0] != DIFF_EQUAL)) { 
            		// Apply the patch & set new shadow
                    this.shadow = this.dmp.patch_apply(patch, this.shadow)[0];                    
                    merged      = this.dmp.patch_apply(patch, oldtext)[0];
	                Hiro.sys.log("Patches successfully merged, replacing text");

	                // Get current cursor position
	                oldcursor = Hiro.canvas._getposition();

	                // Set text
	                Hiro.canvas.set_text(merged); 

	                // Reset cursor   
	                this.resetcursor(diffs,oldcursor);                                 
                }            	
            },

            resetcursor: function(diffs,oldcursor) {
            	// Move cursor to new position
            	var newstart = this.dmp.diff_xIndex(diffs,oldcursor[0]),
            		newend, range;

            	if (oldcursor[0] == oldcursor[1]) {
            		// We had a single cursor
            		range = [newstart,newstart];
            	} else {
            		// We had a selection, preserving this
            		newend = this.dmp.diff_xIndex(diffs,oldcursor[1]);
            		range = [newstart,newend];
            	}         	

            	// Force-set new position, this also fires resize
            	Hiro.canvas._setposition(range,true);
            },           

			delta: function(o,n) {
				// Compare two versions and return standard diff format
				// Cleanup settings
				this.dmp.Diff_Timeout = 1;
				this.dmp.Diff_EditCost = 4;

				// Basic diff, cleanup and return standard delta string format
				var d = this.dmp.diff_main(o, n);
				if (d.length > 2) {
					// Cleanup semantics makes it more human readable
				    // this.dmp.diff_cleanupSemantic(d);
					this.dmp.diff_cleanupEfficiency(d);				    
				}				

				// Return patch and simple string format
				return this.dmp.diff_toDelta(d);
			}
		}
	},	

	sharing: {
		// Share a Note with other users
		id: 'sharing',
		visible: false,
		openTimeout: null,
		token: '',

		init: function() {
			// Bind basic events
			Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('input')[0],'keydown', function(){
				this.className = 'hiro';
				this.nextSibling.display = 'none';
			});			
			if ('ontouchstart' in document.documentElement) {
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('div')[0],'touchstart', function(event){
					if (Hiro.sharing.visible) return;
					Hiro.sharing.open(event,true);
				});
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[0],'touchstart', Hiro.sharing.close);				
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[1],'touchstart', Hiro.sharing.submit);				
			} else {
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('div')[0],'mouseover', function(event) {
					if (document.body.offsetWidth>480) Hiro.sharing.open(event);
				});
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('div')[0],'click', function(event){				
					if (Hiro.sharing.visible) return;
					Hiro.sharing.open(event,true);
				});
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[0],'click', Hiro.sharing.close);			
				Hiro.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[1],'click', Hiro.sharing.submit);
				// Register event that cancels the delayed opening of the options
				Hiro.util.registerEvent(document.getElementById(this.id),'mouseout', function() {
					var that = Hiro.sharing;
				    if (that.openTimeout && !that.visible) {
					    clearTimeout(that.openTimeout);
						that.openTimeout = null;
				    }		
				});	
			}						
		},		

		open: function(event,forceopen) {
			// Open the sharing snippet with a delayed timeout		
			var that = Hiro.sharing;			
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}	

			// See if this or any other action popins are already visible
			if (Hiro.ui.actionsvisible && !forceopen) return;

			// Get the latest list of people who have access
			that.accesslist.fetch();			


			if (forceopen) {
				Hiro.ui.clearactions();
			} else if (!that.openTimeout) {
				// Kick off timeout 				
				// Add a slight delay
				that.openTimeout = setTimeout(function(){								
					var that = Hiro.sharing;
					that.open();										
					that.openTimeout = null;
					clearTimeout(that.openTimeout);															
				},150);				
				return;
			}
			that.visible = Hiro.ui.actionsvisible = true;				
			var widget = document.getElementById('s_actions').parentNode;
			widget.style.display = 'block';

			// Set focus to input field
			var email = document.getElementById(Hiro.sharing.id).getElementsByTagName('input')[0];		
			if (email) email.focus();				
		},

		close: function(event) {
			// Close the sharing widget
			var that = Hiro.sharing,
				widget = document.getElementById('s_actions').parentNode,
				input = document.getElementById('s_actions').getElementsByTagName('input')[0],
				error = document.getElementById('s_actions').getElementsByTagName('div')[0];

			// Check if we have a timeout and remove & abort if so 			
			if (!that.visible) return;
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}				
			
			that.visible = Hiro.ui.actionsvisible = false;
			widget.style.display = 'none';

			// Set position or blur input
			if ('ontouchstart' in document.documentElement && document.activeElement) document.activeElement.blur();
			Hiro.canvas._setposition();

			// Remove error remains if we had one			
			if (error && error.style.display != 'none' && error.className == 'error') {
				input.className = 'hiro';
				input.value = '';
				error.style.display = 'none';
			}				
		},

		submit: function(event) {
			// Submit form
			var email = document.getElementById(Hiro.sharing.id).getElementsByTagName('input')[0],
				button = document.getElementById(Hiro.sharing.id).getElementsByTagName('a')[1];

			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}			
			if (Hiro.sys.user.level < 1) {
				Hiro.sys.user.upgrade(1);
				return;			
			}

			// Check for proper email
			var regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
			if (!regex.test(email.value)) {
				email.focus();
				email.nextSibling.innerHTML = "Sorry, not a valid email address.";
				email.nextSibling.style.display = 'block';				
				email.className = 'hiro error';
				button.innerHTML = "Try again";
				return;
			}

			// Add invite
			Hiro.sharing.accesslist.add(email.value);
		},

		applytoken: function(token) {
			// Applies a token for a shared doc
			// We handle loading the doc with token through the normal loaddoc
			this.token = token;		
			if (Hiro.sys.user.level == 0) {
				// Load signup dialog if user isn't logged in
				var frame = document.getElementById('dialog');
				frame.onload = function() {		
					// The if prevents the dialog from being loaded after login		
					if (Hiro.sys.user.level == 0) Hiro.ui.showDialog(null,'','s_signup','signup_mail');					
				}
			}
		},

		accesslist: {
			// Mostly visual functionality for the sharing widget on the current document
			users: [],
			el: document.getElementById('accesslist'),

			add: function(email) {
				// Add a user to the current editor list
				var url = '/docs/' + Hiro.canvas.docid + '/collaborators',
					payload = {'email': email.trim() },
					el = document.getElementById('s_actions'),
					input = el.getElementsByTagName('input')[0],
					button = el.getElementsByTagName('a')[0],
					d = document.createElement('div'),
					that = this, unshared = (that.users.length <= 1) ? true : false;

				// Retry later if we don't have a docid yet
				if (!Hiro.canvas.docid) {
					setTimeout(function() {
						Hiro.sharing.accesslist.add(email);
						return;
					},500);
				}	
				// Visual updates	
				d.className = 'user';
				d.innerHTML = 'Inviting ' + email.split('@')[0].substring(0,18) + '...';
				this.el.insertBefore(d,this.el.firstChild);
				input.nextSibling.style.display = 'none';				

                Hiro.comm.ajax({
                	// Post to backend
                    url: url,
                    type: "POST",
                    payload: JSON.stringify(payload),
                    success: function() {    
                    	// Set UI               	
                    	input.value = '';
                    	input.focus();
                    	button.innerHTML = 'Invite next';
                    	// Fetch list of collaborators
                    	that.fetch();
                    	// If note was unshared at beginning of this function add shared flag & update list view                   	
                    	if (unshared) {
							Hiro.folio.lookup[Hiro.canvas.docid].shared = true;  
							Hiro.folio.update();                  		
                    	}

                    	// Notify segment.io
		            	var payload2 = {};
		            	payload2.sharing = true;
		            	// Notify segment.io
		            	if (analytics) analytics.identify(Hiro.sys.user.id, payload2);                    	
                    },
                    error: function(req,data) {
                    	// Show error 
                    	input.nextSibling.innerHTML = data;
						input.nextSibling.style.display = 'block';	                    	
						input.className = 'hiro error';                    	                     	
                    	input.focus();           
                    	button.innerHTML = 'Invite';
                    	Hiro.sys.error(data);
                    	// Remove inviting placeholder
                    	d.parentNode.removeChild(d);
                    }
                });				
			},

			remove: function(event) {
				// Remove a user from the current editor list
				var target = event.target || event.srcElement,
					uid = target.parentNode.id.split('_').pop(),
					that = Hiro.sharing.accesslist,
					u = that.users, currentuser = (u[uid].email == Hiro.sys.user.email),
					url = '/docs/' + Hiro.canvas.docid + '/collaborators', payload = {};

				// Build payload with access id
				payload.access_id = u[uid].access_id;
				payload._delete = true;

				// Remove user from array right away
				u.splice(uid,1);
				that.update();

				Hiro.comm.ajax({
                	// Post to backend
                    url: url,
                    type: "POST",
                    payload: JSON.stringify(payload),
                    success: function() {  
                    	// Reload the doclist if user has removed herself
						if (currentuser) { Hiro.folio.loaddocs(); Hiro.ui.clearactions(); };
                    	// If there are no more users in the array anymore, reload folio list to remove sharing icon
                    	if (u.length <= 1) {
							Hiro.folio.lookup[Hiro.canvas.docid].shared = false;  
							Hiro.folio.update();                  		
                    	}					                  	
                    },
                    error: function() {
                    	// Reset list display 
						that.fetch();
                    }
                });	
			},

			update: function() {
				// Update list of users who currently have access
				// Empty current DOM element
				var l = this.users.length;
				this.el.innerHTML = '';

				if (l>0) {
					// Render list
					for (i=0;i<l;i++) {
						// Create and attach each link to the DOM
						this.el.appendChild(this.renderuser(this.users[i],i));
					} 
				} else {
					// Show ooooooonly yoooooouuuuuuu
					this.el.innerHTML = '<div class="user"><span class="name">Only you</span></div>';
				}

				// Update counter
				this.count();
			},

			renderuser: function(user,i) {			
				// Create a user DOM element and return it
				var d, r, n,
					currentuser = (user.email == Hiro.sys.user.email),
					namestring = (user.name) ? user.name + ' (' + user.email + ')' : user.email,					
					you = (this.users.length > 1) ? 'You' : 'Only you';

				d = document.createElement('div');
				d.id = 'user_' + i;
				d.className = 'user';
				if (!currentuser && user.status && user.status == 'invited') d.setAttribute('title', (user.status.charAt(0).toUpperCase() + user.status.slice(1)));

				if (user.role != "owner") {
					// Add remove link if user is not owner					
					r = document.createElement('a');
					r.className = 'remove';
					var rt = (currentuser) ? 'Revoke your own access' : 'Revoke access';
					r.setAttribute('title',rt);

					// Attach events
					if ('ontouchstart' in document.documentElement) {
						r.setAttribute('ontouchstart',"Hiro.sharing.accesslist.remove(event);");
					} else {
						r.setAttribute('onclick',"Hiro.sharing.accesslist.remove(event);");
					}

					d.appendChild(r);
				} else if (!currentuser) {
					d.setAttribute('title', 'Owner');
				}

				// Add user name span
				n = document.createElement('span');
				n.className = (user.status == 'invited') ? 'name invited' : 'name';
				n.innerHTML = (currentuser) ? you : namestring;
				d.appendChild(n)

				// Return object
				return d;
			},

			fetch: function() {
				// Fetch the list of users with access
				// Retry later if we don't have a docid yet
				if (!Hiro.canvas.docid) {
					setTimeout(function() {
						Hiro.sharing.accesslist.fetch();
						return;
					},500);
				}

				// Do not do this on localdoc
				if (Hiro.sys.user.level == 0) return;

				// Retrieve the list of people who have access, this is trigger by loaddoc and opening of the sharing widget
				var url = '/docs/' +  Hiro.canvas.docid + '/collaborators';
				Hiro.comm.ajax({
                    url: url,
                    contentType: "json",
                    success: function(req,data) {
                    	// Set internal values and update visual display
                    	var that = Hiro.sharing.accesslist;
                    	that.users = data;
                        that.update();
                    }
                });
			},

            count: function() {
            	// Update the # of collaborator counter next to the icon
            	var count = this.users.length,
            		el = document.getElementById('collabcounter');

            	if (count > 1) {
            		// Show the count
            		el.innerHTML = count;
            		el.style.display = 'block';                		
            	} else {
            		// Hide
            		el.style.display = 'none';                 		
            	}	
            }			
		}		

	},

	publish: {
		// Publishing functionality (publish a Note to an external service)
		id: 'publish',
		actionsId: 'p_actions',
		initTimeout: null,
		visible: false,
		openTimeout: null,
		actions: {
			mail: {
				id: 1,
				name: 'Email',
				level: 1,
				charlimit: 0
			},
			twitter: {
				id: 2,
				name: 'Twitter',
				level: 1,
				charlimit: 400
			},
			tumblr: {
				id: 3,
				name: 'Tumblr',
				level: 1,
				charlimit: 2000
			},			
			dbox: {
				id: 4,
				name: 'Dropbox',
				level: 1,
				fpservicename: 'DROPBOX'
			},			
			gdrive: {
				id: 5,
				name: 'Google Drive',
				level: 1,
				charlimit: 0,
				token: 'AIzaSyCVQSaEEnjvDmmr9gvXjNaeGDHr98IVf60',
				client_id: '212935062645.apps.googleusercontent.com',
				scope: 'https://www.googleapis.com/auth/drive',
				authed: false,
				callback: null,
				publishing: false,
				fpservicename: 'GOOGLE_DRIVE'
			},
			evernote: {
				id: 6,
				name: 'Evernote',
				level: 1,
				fpservicename: 'EVERNOTE'
			}				
		}, 

		auth: {
			// Authorize external API calls
			gdrive: function() {
				// Authorize Google Drive
				var def = Hiro.publish.actions.gdrive;
				if (def.authed) return;	
				// TODO: This callback triggers a non-click-event-stack popup -> Not seen the first		
		        gapi.auth.authorize({'client_id': def.client_id, 'scope': def.scope, 'immediate': false},Hiro.lib.collectResponse.google);				
			}
		},

		init: function() {
			// if we hover over the publish icon, the event handlers are attached via canvas init
			// show list of actions after n msec
			var icon = document.getElementById(this.id).getElementsByTagName('div')[0];


			// Bind basic events		
			if ('ontouchstart' in document.documentElement) {
				Hiro.util.registerEvent(icon,'touchstart',function(event){
					if (Hiro.publish.visible) { Hiro.publish.close(); return; } else { Hiro.publish.open(event,true); }
				});				
			} else {
				Hiro.util.registerEvent(icon,'mouseover',Hiro.publish.open);
				Hiro.util.registerEvent(icon,'click',function(event){
					if (Hiro.publish.visible) { Hiro.publish.close(); return; } else { Hiro.publish.open(event,true); }
				});									
				// Register event that cancels the delayed opening of the options
				Hiro.util.registerEvent(icon,'mouseout', function() {
					var that = Hiro.publish;
				    if (that.openTimeout && !that.visible) {
					    clearTimeout(that.openTimeout);
						that.openTimeout = null;
				    }		
				});	
			}


		},

		list: function() {
			// Create a list of available actions
			var actions = Hiro.publish.actions;
			var container = document.getElementById(Hiro.publish.actionsId);
			var level = Hiro.sys.user.level;

			// Empty current list
			container.innerHTML = '';
			for (var action in actions) {
			   if (actions.hasOwnProperty(action)) {
			   		// Create link for each action
					var a = document.createElement('a');
					a.className = 'action '+action;
					a.innerHTML = actions[action].name;

					// Check necessary level and attach corresponding action	
					if (level >= actions[action].level) {
						if ('ontouchstart' in document.documentElement) {
							a.setAttribute('ontouchstart',"Hiro.publish.execute(event,'"+action+"');");
						} else {
							a.setAttribute('onclick',"Hiro.publish.execute(event,'"+action+"');");
						}
					} else {
						if (level == 0) {
							a.setAttribute('title','Signup to publish');								
							a.setAttribute('onclick',"Hiro.sys.user.upgrade(1);return false;");														
						} else {
							a.setAttribute('title','Upgrade');
							a.setAttribute('onclick',"Hiro.sys.user.forceupgrade(2,'<em>Upgrade now for </em><b>basic publishing</b>.');");					
						}
					}

					// Handle mail edge case here as we can't do it onclick
					if (action == 'mail') {
						// We reset the clickactions in this case:
						if (!('ontouchstart' in document.documentElement) && level != 0) {
							a.setAttribute('onclick',"");
						} else {
							a.setAttribute('ontouchstart','');
						}
						var sel = Hiro.canvas._getposition();
						var text = (sel[2].length > 0) ? sel[2] : document.getElementById(Hiro.canvas.contentId).value;
						text = text.trim();					
						a.setAttribute('href','mailto:?subject='+encodeURIComponent(document.getElementById(Hiro.canvas.pageTitle).value)+'&body='+encodeURIComponent(text));
					}

					// Add to container
					container.appendChild(a);
			   }
			}
		},

		open: function(event,forceopen) {
			// Show the publish dialog
			// Open the sharing snippet with a delayed timeout		
			var that = Hiro.publish;			
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}			

			// See if this or any other action popins are already visible
			if (Hiro.ui.actionsvisible && !forceopen) return;

			// List services
			that.list();		

			// Close other actions
			if (forceopen) {
				Hiro.ui.clearactions();
			} else if (!that.openTimeout) {			
				// Kick off timeout 
				// Add a slight delay
				that.openTimeout = setTimeout(function(){								
					var that = Hiro.publish;
					that.open();										
					that.openTimeout = null;
					clearTimeout(that.openTimeout);															
				},150);
				// Get the latest list of people who have access				
				return;
			}
			that.visible = Hiro.ui.actionsvisible = true;				
			var widget = document.getElementById('p_actions').parentNode;
			widget.style.display = 'block';	
		},

		close: function(event) {
			// Hide the publish dialog
			var that = Hiro.publish;
			// Check if we have a timeout and remove & abort if so 
			if (!that.visible) return;
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}				
			
			var widget = document.getElementById('p_actions').parentNode;
			that.visible = Hiro.ui.actionsvisible = false;
			widget.style.display = 'none';
			Hiro.canvas._setposition();			
		},

		execute: function(event,type) {
			// Click on a publishing action
			// Prevent the selection from losing focus
			if (event) {
				event.preventDefault();
				event.stopPropagation();
				Hiro.util.stopEvent(event);
				var target = event.target || event.srcElement;				
			}			

			// Collect title and text, see if we have an active selection
			var title = document.getElementById(Hiro.canvas.pageTitle).value;
			var sel = Hiro.canvas._getposition();
			var text = (sel[2].length > 0) ? sel[2] : document.getElementById(Hiro.canvas.contentId).value;
			text = text.trim();

			// Execute publishing depending on selected type
			switch(type) {
				case 'mail':
					// This is only used on touch devices ( see mail exception in list() above)
					if (target) target.className = 'action done';
					var s = 'mailto:?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(text);
					window.location.href = s;
					break;
				case 'twitter':			
					if (event && target) target.className = 'action done';				
					var s = 'https://twitter.com/intent/tweet?text=';
					// Choose either title or (selected) text
					text = (text.length == 0) ? title : text;
					s = s + encodeURIComponent(text.substring(0,400));
					// Open twitter window or redirect to twitter
					if (window.navigator.standalone) {
						window.location.href = s;
					} else {
						window.open(s,'twitter','height=282,width=600');
					} 
					break;
				case 'tumblr':			
					if (event && target) target.className = 'action done';				
					var s = 'http://www.tumblr.com/share/quote?quote=';
					// Choose either title or (selected) text
					text = (text.length == 0) ? title : text;
					s = s + encodeURIComponent(text.substring(0,1900));
					// Open twitter window or redirect to twitter
					if (window.navigator.standalone) {
						window.location.href = s;
					} else {
						window.open(s,'tumblr','height=550,width=550');
					} 
					break;						
				case 'gdrive':
				case 'dbox':
				case 'evernote':
					this.filepickerupload(event,type,title,text);				
					break;												
			}
		},

		filepickerupload: function(event,service,title,text) {
			// Push the text onto filepicker

			// Find the right element where the click happened, show whats going on
			var pos = Hiro.publish.actions[service].id - 1;
			var target = event.target || event.srcElement;
			var el = (target) ? target : document.getElementById(Hiro.publish.id).getElementsByTagName('a')[pos];
			el.className = 'action doing';
			el.innerHTML = 'Publishing';					

			// Prevent double clicks etc
			Hiro.publish.actions[service].publishing = true;

			// Filepicker.io flow									
			var options = {filename: title+'.txt',mimetype: 'text/plain'};			
			title = (title) ? title : 'Untitled';					
			filepicker.store(text,options,function(data){
				// We succesfully stored the file, next upload it to various services
				// Clear and load dialog into frame
				var frame = document.getElementById('dialog').contentDocument;
				if (frame) {
					frame.body.innerHTML = '';
					Hiro.ui.showDialog();					
				}				
				var payload = {openTo: Hiro.publish.actions[service].fpservicename};
				payload.services = ['DROPBOX','GOOGLE_DRIVE','BOX','SKYDRIVE','EVERNOTE'];	
				payload.suggestedFilename = title;
				payload.container = 'dialog';
				if (document.body.offsetWidth<=480) {
					payload.mobile = true;
				}										
				filepicker.exportFile(data.url,payload,function(data){
					// Yay, completed & successful
					Hiro.ui.hideDialog();
			    	Hiro.ui.statusflash('green','Published on your '+Hiro.publish.actions[service].name+'.',true); 
					Hiro.publish.actions[service].publishing = false;
					var el = (target) ? target : document.getElementById(Hiro.publish.id).getElementsByTagName('a')[pos];	
					el.className = 'action done';		
					el.innerHTML = Hiro.publish.actions[service].name;	
				},function(data){
					// Some error occured while creating the file
					Hiro.publish.actions[service].publishing = false;						
					// Hiro.sys.error(data);	
				});						
			},function(data){
				// Some error occured while creating the file
				Hiro.publish.actions[service].publishing = false;						
				Hiro.sys.error(data);	
			});				
		}
	},

	// Context is the link bar on the right
	context: {
		sticky: [],
		stickylookup: {},
		links: [],
		blacklist: [],
		show: true,
		id: 'context',
		resultsId: 'results',
		wwwresultsId: 'wwwresults',
		synresultsId: 'synresults',
		msgresultsId: 'msgresults',		
		statusId: 'status',
		signupButtonId: 'signupButton', 
		synKey: 'c80cda88ad86ccd854a68090a4dfba7c',
		replacementrange: [],
		replacementword: '',
		overquota: false,

		switchview: function() {
			// show / hide searchbar
			var c = document.getElementById(Hiro.context.id);
			var can = document.getElementById(Hiro.canvas.canvasId);
			var sw = document.getElementById('switchview');
			var mobile = (document.body.offsetWidth<=480);
			var midi = (document.body.offsetWidth<=900);
			var menu = Hiro.ui.menuCurrPos * -1;
			// Check if the context is supposed to be open (always start with closed context on mobile and never save changes)
			if (mobile && document.activeElement) document.activeElement.blur();
			if ((!midi&&Hiro.context.show)||(midi&&c.style.display=='block')) {
				c.style.display = 'none';
				can.className += " full";								
				sw.innerHTML = '&#171;';
				sw.className = ''
				if (!mobile||!midi) Hiro.context.show = false;
			} else {
				c.style.display = 'block';
				can.className = "canvas";			
				sw.innerHTML = '&#187;';
				sw.className = 'open'
				if (!mobile||!midi) {
					Hiro.context.show = true;
					c.style.left = 'auto';
				}	
			}
		},

		wipe: function() {
			// reset the context sidebar contents
			this.links.length = 0;
			this.sticky.length = 0;
			this.blacklist.length = 0;

		},

		quotareached: function() {
			this.overquota = true;
			var msg = document.getElementById(this.msgresultsId);
            document.getElementById(this.statusId).innerHTML = 'Search quota reached.';			
			if (msg.innerHTML == '') {	
				// If we don't have a message yet, empty the normal links		
				document.getElementById(this.synresultsId).innerHTML = '';

				// Clear normal results
				this.links.length = 0;
				this.renderresults();

				var txt = (Hiro.sys.user.level == 1) ?
					'<a href="#" class="msg" onclick="Hiro.sys.user.forceupgrade(2,\'<em>Upgrade now to enjoy </em><b>unlimited searches</b><em> and much more.</em>\'); return false;"><em>Upgrade now</em> for unlimited searches & more.</a>' :
					'<a href="#" class="msg" onclick="Hiro.sys.user.upgrade(1); return false;"><em>Sign up now</em> for more searches.</a>';
				document.getElementById(this.msgresultsId).innerHTML = txt;
			}
		},

		extractlinks: function(text) {
			// Extracts URLs from a provided text string
			var regex = /((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/g;
			if (regex.test(text)) {
				this.attachlinks(text.match(regex));			
			}
		},

		attachlinks: function(links) {
			// Adds links in an array to the sticky list, if they are not there yet or blacklisted
			var counter = 0;
			for (i=0,l=links.length;i<l;i++) {
				// Remove trailing slash
				url = links[i].replace(/\/$/, "");

				// Check of URL is already blacklisted	
				if (this.blacklist && this.blacklist.indexOf(url) > -1) continue;

				// Check if link is already sticky
				if (this.sticky && this.sticky.filter(function(obj){ return obj.url === links[i]})[0]) continue;

				// Build object
				var link = {};			
				link.url = links[i];
				link.title = 'Verifying...';
				link.description = 'We quickly check this link for you.';
				link.verifying = true;

				// Iterate counter
				counter++;

				// Add at end of array
				this.sticky.push(link);					
			}

			// Update DOM and send links to verification backend, if we had any new links
			if (counter > 0 ) {
				this.renderresults();
				this.verifylinks(links);
			}						
		},

		verifylinks: function(links) {
			// Send links to server for verification
            Hiro.comm.ajax({
                url: "/relevant/verify",
                type: "POST",
                payload: JSON.stringify({ links:links }),
                success: function(req,data) {
                	Hiro.sys.log('Verfified links: ',data);

                	// Build a lookup object from our stickies
					var stickies = Hiro.context.sticky, lookup = {};
					for (var i = 0, l = stickies.length; i < l; i++) {
					    lookup[stickies[i].url] = stickies[i];			    
					}   

                    // Update the links we found more info about
                    for (i=0,l=data.links.length;i<l;i++) {
                    	var u = data.links[i].url;
                    	if (!lookup[u]) continue;
                    	lookup[u].verifying = false;
                    	if (data.links[i].statuscode) {
                    		// If google fetch was unable to obtain details
                    		// Get last part of URL, replace - and uppercase
                    		var f = u.split('/');                    		
                    		f = f[f.length-1];
                    		if (f) {
                    			f = f.replace(/-/g," ")
                    			f = f.replace(/\w\S*/g, function(str){return str.charAt(0).toUpperCase() + str.substr(1).toLowerCase();});
                    		} else { f = 'Untitled'}
                    		lookup[u].title = f;
                    		// Add error specific details
	                    	if (data.links[i].statuscode == 404) lookup[u].description = 'No description available (page not found).';                    		
                    	} else {
                    		// If we found details via fetch backend
	                    	lookup[u].title = data.links[i].title;
	                    	lookup[u].description = data.links[i].description;
                    	}
                    }

                    // Update display and save doc
					Hiro.context.clearunverified();	                    
					Hiro.canvas.savedoc();                    
                },
                error: function() {
                	// Notifiy user
					Hiro.ui.statusflash('red',"Couldn't verify the links.",false);   
					             	
                	// Remove all placeholder links
                	Hiro.context.clearunverified();
                }
            });
		},

		clearunverified: function() {
			// Remove unverified links from sticky list and update DOM
			for (i=this.sticky.length-1; i>=0; i--) {
			    if (this.sticky[i].verifying == true) this.sticky.splice(i,1);
			}			

			// Refresh display
			this.renderresults();	
		},

		analyze: function(string, chunktype) {
			// Send text to server for analysis, returning text chunks
			// Not in use, for testing only
			string = string || (Hiro.canvas.title + ', ' + Hiro.canvas.text);
			document.getElementById(this.statusId).innerHTML = 'Analyzing...';
			Hiro.comm.ajax({
				url: '/analyze', 
				payload: JSON.stringify({"content":string}), 
				success: function(req,data) {
		            Hiro.context.chunksearch(data,chunktype);
		        }
		    });
		},		

		chunksearch: function(data,chunktype) {
			// Search with specific chunks returned from analyzer above
			// Not in use, for testing only
			document.getElementById(this.statusId).innerHTML = 'Searching...';			
			var data = data.chunktype || data.textrank_chunks;
            var terms = [];

			// collect search terms from JSON object
			for (var item in data) {
			  if (data.hasOwnProperty(item)) {
			  	if (chunktype=='proper_chunks') {
                    terms.push(data[item].head);
			  	} else {
                    terms.push(data[item]);
			  	}
			  }
			};

			// Post data if we have a proper terms
			if (terms.length > 0) {
				var postData = {terms: terms, use_shortening: true};
				var that = this;						
                Hiro.comm.ajax({
                    url: "/relevant",
                    type: "POST",
                    payload: JSON.stringify(postData),
                    success: function(req,data) {
                        Hiro.context.storeresults(data.results);
                        Hiro.context.renderresults();		             
                        document.getElementById(that.statusId).innerHTML = 'Ready.';
                    }
                });				
			} else {
					document.getElementById(this.statusId).innerHTML = 'Nothing interesting found.';
			}
		},


		search: function(title,text,textonly,showtip) {
			// Chunk extraction and search in one step in the backend
			if (this.overquota) {
				// Clean up all results exit
				this.quotareached();
				return;
			}	
			if (title=='null' || title==null) title = '';			
			var string = (textonly) ? text : title + ' ' + text;		
			var payload = {text: string};
			var that = this;
			var saved = Hiro.canvas.saved;
			var level = Hiro.sys.user.level;
			document.getElementById(this.statusId).innerHTML = 'Searching...';				

			// Handle short strings for synonym search, first find out how many words we have and clean up string
			var ss = string.replace(/\r?\n/g," "); 
			ss = ss.replace(/\t/g," ");
			ss = ss.replace(/,/g," ");			
			ss = ss.replace(/\s{2,}/g," ");
			ss = ss.trim();
			if (ss.length > 0 && ss.split(' ').length == 1) {
				// Search synonyms for single words
				Hiro.comm.ajax({
				    url: 'https://words.bighugelabs.com/api/2/' + that.synKey + '/' + ss + '/json',
				    type: 'GET',
				    dataType: "jsonp",
				    success: function(req,data) {
				    	if (!Hiro.context.overquota) Hiro.context.rendersynonyms(data,ss);				    	
				    },
				    error: function() {
				    	// Prevent error tracking by Sentry Raven
				    }
				});
				// Set the range of the documents to be replace to selection, or full document if it's only one word
				var sel = Hiro.canvas._getposition();
				this.replacementrange = (sel[0] == sel[1]) ? [0,Hiro.canvas.text.length,Hiro.canvas.text] : sel;
				this.replacementword = ss;
			} else {
				this.replacementrange = [];
				document.getElementById(this.synresultsId).innerHTML = '';
			}

			// Find context links from Yahoo BOSS						
            Hiro.comm.ajax({
                url: "/relevant",
                type: "POST",
                payload: JSON.stringify(payload),
                error: function(req) {
                	switch (req.status) {
                		case 402: 
                			Hiro.context.quotareached();
                			break;
                		default:
                			Hiro.sys.error(req.response);	
                	}
                },           
                success: function(req,data) {
                    Hiro.context.storeresults(data.results);
                    Hiro.context.renderresults(showtip);		             
                    document.getElementById(that.statusId).innerHTML = 'Ready.';                   
                }
            });				
		},

		storeresults: function(data) {
			// Store a set of fresh results locally	
			// clear our existing array
			this.links.length = 0;

			// build a list of URLs to ignore
			// TODO: CHeck if an 'if' statement helps performance
			var urls = '';
			for (i=0,l=this.sticky.length;i<l;i++) {
				urls = urls + this.sticky[i].url + ' ';
			}
			for (i=0,l=this.blacklist.length;i<l;i++) {
				urls = urls + this.blacklist[i] + ' ';
			}				

			// Go through the new results
			for (i=0,l=data.length;i<l;i++) {
				// ignore urls that are either part of the sticky or blacklist
				if (urls.indexOf(data[i].url)>=0) continue;
				this.links.push(data[i]);
			}
		},

		rendersynonyms: function(data) {
			// render the synonym resultlist if we got one from the API
			var results = document.getElementById(this.synresultsId);
			var newresults = results.cloneNode();
			newresults.innerHTML = '';
			Hiro.sys.log('Synonyms: ',data);

			for (var synonyms in data) {
				// create a generic element holding all data and add header	
				var obj = data[synonyms];
				var group = document.createElement('div');			   
				group.className = 'group';

				var header = document.createElement('div');
				header.className = 'header';
				header.innerHTML = this.replacementword + ' <em>' + synonyms + '</em>';
				group.appendChild(header);

				var words = document.createElement('div');
				words.className = 'words';
				for (var subgroup in obj) {
					// Get various subgroups of API (synonyms, antonyms, etc)
					if(obj.hasOwnProperty(subgroup)) {	
						if (subgroup == 'sim' || subgroup == 'rel') continue;

						var sg = document.createElement('div');
						sg.className = 'subgroup';					
						sg.innerHTML = (subgroup == 'syn') ? '' : 'Antonym: '; 

						var wordlist = obj[subgroup], i = 0;
						for (var word in wordlist) {
							var l = document.createElement('a');							
							l.innerHTML = wordlist[word];
							l.setAttribute('href','#');	
							var s = (wordlist.length-1 == i) ? document.createTextNode('.') : document.createTextNode(', ');						
							sg.appendChild(l);
							sg.appendChild(s)	
							i++;						
						}

						words.appendChild(sg);
					}
			   }
			   group.appendChild(words);

			   newresults.appendChild(group);
			}
			results.parentNode.replaceChild(newresults, results);
		},

		replacewithsynonym: function(event) {
			// This replaces the current (or last) text selection on the canvas with the respective synonym
			event.preventDefault();
			// Abort if user clicks anywhere else but a link
			var target = event.target || event.srcElement;
			if (!target || target.nodeName != 'A') return;
			var source = Hiro.canvas.text;
			var oldpos = this.replacementrange;
			var oldword = this.replacementword;
			var newword = target.innerHTML;

			// replace internal and visual selection with new string
			Hiro.canvas.set_text(source.slice(0,oldpos[0]) + oldpos[2].replace(oldword,newword) + source.slice(oldpos[1]));
			
			// update the replacementrange values		
			this.replacementrange[1] = oldpos[1] + (newword.length - oldword.length);
			this.replacementrange[2] = oldpos[2].replace(oldword,newword);

			// Update selection
			var newselection = [oldpos[0],this.replacementrange[1]];
			Hiro.canvas._setposition(newselection);

			// update inetrnal value to new word
			this.replacementword = newword;

			// Save updated document
			Hiro.canvas.savedoc(true);			
		},

		renderresults: function(showtip) {
			// Show results in DOM		
			var results = document.getElementById(this.wwwresultsId);
			var newresults = results.cloneNode();
			var sticky = this.sticky;
			newresults.innerHTML = '';
			if (sticky) {
				// Add sticky links to DOM object
				for (var i=0,l=sticky.length;i<l;i++) {											
					newresults.appendChild(this._buildresult(sticky[i], true));
				}
			}
			var links = this.links;			
			for (var i=0,l=links.length;i<l;i++) {	
				// Add normal links to DOM object
				newresults.appendChild(this._buildresult(links[i], false));
			}	
			if (this.links.length == 0 && showtip) {
				var tip = document.createElement('div'), msg, l = Hiro.canvas.text.length;
				if (l<100) msg = 'Nothing found';
				if (l>99) msg = 'Try to select a different part.';
				tip.className = 'tip';
				tip.innerHTML = msg;
				newresults.appendChild(tip);
			}		
			results.parentNode.replaceChild(newresults, results);			    
		},

		clearresults: function() {
			//empty all result lists
			document.getElementById(this.wwwresultsId).innerHTML = '';
			document.getElementById(this.synresultsId).innerHTML = '';
		},

		_buildresult: function(data, sticky) {
			var e = document.createElement('div');
			var l = (Hiro.sys.user.level < 2);
			e.className = (sticky) ? 'result sticky' : 'result';

			if (!sticky) {
				var del = document.createElement('a');
				del.className = 'delete action';
				del.setAttribute('href','#');
				if (l) del.setAttribute('title','Delete (do not show this link again for this document)');				
				del.setAttribute('onclick','Hiro.context.blacklistLink(this); return false;');	
				e.appendChild(del);	

				var st = document.createElement('a');
				st.className = 'stick action';
				st.setAttribute('href','#');
				if (l) st.setAttribute('title','Pin (save link with document)');				
				st.setAttribute('onclick','Hiro.context.makesticky(this); return false;');					
				e.appendChild(st);							
			}	

			if (sticky) {
				var us = document.createElement('a');
				us.className = 'unstick action';
				us.setAttribute('href','#');
				if (l) us.setAttribute('title','Unpin (stop saving this link with this document)');					
				us.setAttribute('onclick','Hiro.context.unstick(this); return false;');				
				e.appendChild(us);												
			}						

			var r = document.createElement('a');
			r.className = 'link';
			r.setAttribute('href',data.url);
			r.setAttribute('target','_blank');			

			var t = document.createElement('span');
			t.className = 'title';
			t.innerHTML = data.title;
			r.appendChild(t);

			var li = document.createElement('span');
			li.className = 'url';
			li.appendChild(document.createTextNode(data.url))
			r.appendChild(li);

			if (!sticky || sticky) {
				var b = document.createElement('span');
				b.className = 'blurb';
				b.innerHTML = data.description;			
				r.appendChild(b);
			}
					
			e.appendChild(r);
			// Avoid full window wobbling & layout messup on touch devices
			if ('ontouchstart' in document.documentElement) {
				// If user level = 0 we have overflow: hidden anyway
				if (Hiro.sys.user.level!=0) e.addEventListener('touchmove',function(event){event.stopPropagation()},false);
				// Attach seperate class to avoid switch to have styles when finger flicks over
				e.className += ' touch';				
			}				
			return e;
		},

		blacklistLink: function(el) {
			// Blacklist the current result
			var link = el.parentNode;

			// Find the URL, this is a bit suboptimal as it breaks with dom changes
			var url = link.getElementsByTagName("a")[2].getAttribute("href");
			this.blacklist.push(url);

			// We do not need to render the links again in this case, just pop the node
			link.parentNode.removeChild(link);

			// Remove the link from links array
			for (i=this.links.length-1; i>=0; i--) {
			    if (this.links[i].url == url) this.links.splice(i,1);
			}				

			// Save document
			Hiro.canvas.savedoc();			
		},

		makesticky: function(el) {
			// Make a link sticky
			var result = el.parentNode;
			// Hiro.ui.fade(result,-1,300);

			// Find URL and retrieve Link from linklist, remove and add to sticky array
			var u = result.getElementsByTagName("a")[2].getAttribute("href");
			for (i=0,l=this.links.length;i<l;i++) {
				if (this.links[i] && this.links[i].url==u) {
					this.sticky.push(this.links[i]);			
					this.links.splice(i,1);		
					this.renderresults();
				}
			}

			// Save document
			Hiro.canvas.savedoc();
		},

		unstick: function(el) {
			// Move a link back to the normal results
			var result = el.parentNode;

			// Find URL and retrieve Link from linklist, remove and add to sticky array
			var u = result.getElementsByTagName("a")[1].getAttribute("href");
			for (i=0,l=this.sticky.length;i<l;i++) {
				if (this.sticky[i] && this.sticky[i].url==u) {
					// reinserting link at first position per default, should we save the initial sticky position here?
					this.links.splice(0,0,this.sticky[i]);		

					// remove from sticky list	
					this.sticky.splice(i,1);					
					this.renderresults();
				}
			}

			// Save document
			Hiro.canvas.savedoc();						
		}
	},

	// External libraries & extensions
	lib: {
		inited: false,
		deferinited: false,
		user: null,

		// Stash list of auth responses here
		facebookResponse: null,

		// API Keys
		externalkeys: null,
		filepickerKey: 'AET013tWeSnujBckVPeLqz',		

		init: function(obj) {
			if (this.inited) return;

			// kick off segment.io sequence, only on our domain 
			if (Hiro.sys.production) {
				// Add raven ignore options so that our sentry error logger is not swamped with broken plugins
				window.ravenOptions = {
				    ignoreErrors: [
				      // Random plugins/extensions
				      'top.GLOBALS',
				      // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error. html
				      'originalCreateNotification',
				      'canvas.contentDocument',
				      'MyApp_RemoveAllHighlights',
				      'http://tt.epicplay.com',
				      'Can\'t find variable: ZiteReader',
				      'jigsaw is not defined',
				      'ComboSearch is not defined',
				      'http://loading.retry.widdit.com/',
				      'atomicFindClose',
				      // Facebook borked
				      // 'fb_xd_fragment',
				      // ISP "optimizing" proxy - `Cache-Control: no-transform` seems to reduce this. (thanks @acdha)
				      // See http://stackoverflow.com/questions/4113268/how-to-stop-javascript-injection-from-vodafone-proxy
				      'bmi_SafeAddOnload',
				      'EBCallBackMessageReceived',
				      // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
				      'conduitPage',
				      // Trashy zoom plugin
				      'nonjdcjchghhkdoolnlbekcfllmednbl'
				    ],
				    ignoreUrls: [
				      // Facebook flakiness
				      // /graph\.facebook\.com/i,
				      // Facebook blocked
				      // /connect\.facebook\.net\/en_US\/all\.js/i,
				      // Woopra flakiness
				      // /eatdifferent\.com\.woopra-ns\.com/i,
				      // /static\.woopra\.com\/js\/woopra\.js/i,
				      // Chrome extensions
				      // /extensions\//i,
				      // /^chrome:\/\//i,
				      // Other plugins
				      // /127\.0\.0\.1:4001\/isrunning/i,  // Cacaoweb
				      // /webappstoolbarba\.texthelp\.com\//i,
				      // /metrics\.itunes\.apple\.com\.edgesuite\.net\//i
				    ]
				};	
			}	

			// Load Googles Diff Match Patch
			(function(d, s, id){
				var js, fjs = d.getElementsByTagName(s)[0];
				if (d.getElementById(id)) {return;}
				js = d.createElement(s); js.id = id;
				js.src = "/static/js/diff_match_patch.js";
				fjs.parentNode.insertBefore(js, fjs);
			}(document, 'script', 'diff_match_patch'));				

			// Add trim to prototype
			if (!String.prototype.trim) {
			  String.prototype.trim = function () {
			    return this.replace(/^\s+|\s+$/g, '');
			  };
			}										

			this.inited = true;
		},

		defer: function(obj) {
			// Deferred loading of non essential scripts
			if (this.deferinited) return;

			// Store keys from Flask
			this.externalkeys = obj;

			// Load Channel API
			this.loadscript('/_ah/channel/jsapi','channel_api',null,true,100);		

			// Load Analytics
			setTimeout(function(){
				window.analytics.methods=["identify","track","trackLink","trackForm","trackClick","trackSubmit","page","pageview","ab","alias","ready","group","on","once","off"],window.analytics.factory=function(t){return function(){var a=Array.prototype.slice.call(arguments);return a.unshift(t),window.analytics.push(a),window.analytics}};for(var i=0;i<window.analytics.methods.length;i++){var method=window.analytics.methods[i];window.analytics[method]=window.analytics.factory(method)}window.analytics.load=function(t){var a=document.createElement("script");a.type="text/javascript",a.async=!0,a.src=("https:"===document.location.protocol?"https://":"http://")+"d2dq2ahtl5zl1z.cloudfront.net/analytics.js/v1/"+t+"/analytics.min.js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(a,n)},window.analytics.SNIPPET_VERSION="2.0.8",
				window.analytics.load("64nqb1cgw1");
				window.analytics.page();
				// Identify user if user data is already loaded (eg Hiro loaded authed) 
				if (Hiro.lib.user && Hiro.sys.production) {
					analytics.identify(Hiro.sys.user.id,Hiro.lib.user);
				};	
			},1000);

			// Load facebook
			this.loadscript('https://connect.facebook.net/en_US/all.js','facebook-jssdk',function(){
				window.fbAsyncInit = function() {	FB.init({appId : Hiro.lib.externalkeys.facebook,status : true, xfbml : true}); };
			},true);

			// Load Stripe
			this.loadscript('https://js.stripe.com/v2/',undefined,function(){
				Stripe.setPublishableKey(Hiro.lib.externalkeys.stripe);
			},true,3000);		

			// Load filepicker.io
			this.loadscript('https://api.filepicker.io/v1/filepicker.js',undefined,function(){
				filepicker.setKey(Hiro.lib.filepickerKey);
			},true,2000);						

			// Prevent double loading
			this.deferinited = true;					
		},

		loadscript: function(url,id,callback,defer,delay) {
			// Generic script loader
			var delay = delay || 1000;

			// Abort if we have no url
			if (!url) return;	

			setTimeout(function(){
				var d = document, t = 'script',
					o = d.createElement(t),
					s = d.getElementsByTagName(t)[0];

				// Set DOM node params	
				o.type="text/javascript"
				o.src = url;
				o.async = true;
				if (defer) o.defer = true;
				if (id) o.id = id;
				// Attach callback
				if (callback) { o.addEventListener('load', function (e) {
					try { callback(null, e); } 
					catch (e) {
						// Sometimes the clalback executes before the script is ready
						setTimeout( function(e) {
							callback(null, e); 
						},300);	
					}
				}, false); }

				// Insert into DOM
				s.parentNode.insertBefore(o, s);
			},delay);					
		},

		loguser: function(id,obj) {
			// Log user and set internal variables

			// Extend user object
			if (window.navigator.standalone) obj.mobileappinstalled = true;
			if ('ontouchstart' in document.documentElement) obj.touchdevice = true;
			if (Hiro.sys.user.doccount > 0) obj.doccount = Hiro.sys.user.doccount;

			// Set internal vars
			if (obj.name) Hiro.sys.user.name = obj.name;
			if (obj.email) Hiro.sys.user.email = obj.email;
			if (id) Hiro.sys.user.id = id;

			// See if user is logged in via facebook and get name
			// TODO: Remove after a few weeks
			if (!obj.name) Hiro.sys.user.getfirstname();	

			// Identify user if loguser is called after everything is loaded (eg logging in after initial load) 
			if (analytics.identify && typeof analytics.identify == 'function' && Hiro.sys.production) analytics.identify(Hiro.sys.user.id, obj);							

			// Set user object
			this.user = obj;
		}
	},

	// All system related vars & functions
	sys: {
		version: '',
		status: 'normal',
		production: (window.location.href.indexOf('hiroapp') >= 0),
		language: 'en-us',
		saved: true,
		settingsUrl: '/settings/',
		settingsSection: '',		

		// Bootstrapping
		initCalled: false,
		setupDone: false,
		setupTasks: [],
		setupTimer: null,

		init: function(tier) {
			// allow this only once			
			if (this.initCalled) return;
			Hiro.ui.resolveAnimFrameAPI();

			// Set internal values
			this.user.setStage(tier);	

			// Add startup event listeners for old & modern browser
			if (document.addEventListener) {
				document.addEventListener( 'DOMContentLoaded', this._DOMContentLoadedCallback, false );
				document.addEventListener( 'load', this._loadCallback, false );
			}
			else if (document.attachEvent) {
				document.attachEvent( 'onreadystatechange', this._onreadystatechangeCallback);
				document.attachEvent( 'onload', this._loadCallback, false );
			}

			// Kick off tab or window active / background check
			Hiro.util.windowfocus();		

			// Add cross browser history event listener to enable back button
			if (window.onpopstate) {
				window.onpopstate = function(e) { Hiro.util.goback(e); };			
			} else {
				Hiro.util.registerEvent(window,'popstate', function(e) { Hiro.util.goback(e); });			
			}			


			// Add events that should be called when DOM is ready to the setupTask queue
			this.onstartup( function() {
				// Init non critical elements
				Hiro.publish.init();
				Hiro.sharing.init();				
				Hiro.canvas._init();
				// Cehck if localStorage is supported
				Hiro.store.local = (window.localStorage) ? true : false;				
				// Load settings into dialog
				Hiro.ui.loadDialog(Hiro.sys.settingsUrl); 

			});		

			// Check for any hashed parameters
			var string = window.location.hash.substring(1);
			if (string.length > 1) {
				var p = string.split(/=|&/);
				if (p.indexOf('reset') > -1) {
					Hiro.sys.user.showreset(p[p.indexOf('reset') + 1]);
				}
				if (p.indexOf('token') > -1) {
					Hiro.sharing.applytoken(p[p.indexOf('token') + 1]);
				}				
			} 

			// Add keyboard shortcuts
			Hiro.util.registerEvent(document,'keydown', Hiro.ui.keyboardshortcut);

			// Setup hgrogress bar
			Hiro.ui.hprogress.init();

			// Init remaining parts
			Hiro.folio.init();
			this.initCalled=true;
		},

		_DOMContentLoadedCallback: function() {
			document.removeEventListener( 'DOMContentLoaded', this._DOMContentLoadedCallback, false);
			document.removeEventListener( 'load', this._loadCallback, false);
			Hiro.sys._setup();
		},
		_onreadystatechangeCallback: function() {
			// IE<9
			if (document.readyState=='complete') {
				document.detachEvent('onreadystatechange',  this._DOMContentLoadedCallback);
				document.detachEvent( 'load', this._loadCallback);
				this.setupTimer=window.setTimeout( function() { Hiro.sys._setup(); }, 250 );
			}
			else {
				return;
			}
		},
		_loadCallback: function() {	
			if (document.addEventListener) {
				document.removeEventListener( 'DOMContentLoaded', this._DOMContentLoadedCallback, false);
				document.removeEventListener( 'load', this._loadCallback, false);
			}
			else {
				document.detachEvent('onreadystatechange',  this._DOMContentLoadedCallback);
				document.detachEvent( 'load', this._loadCallback);
			}
			Hiro.sys._setup();
		},	
		_setup: function() {
			if (this.setupTimer) {
				window.clearTimeout(this.setupTimer);
				this.setupTimer=null;
			}
			if (this.setupDone) return;
			while (this.setupTasks.length) {
				var task=this.setupTasks.shift();
				if (typeof task == 'function') task();
			}
			this.setupDone = true;
		},
		
		onstartup: function(callback) {
			// public start up methods ("documentReady")
			if (typeof callback == 'function') {
				if (!this.setupDone) {
					this.setupTasks.push(callback);
				}
				else {
					callback();
				}
			}
		},

		error: function(data) {
			// Pipe errors into Sentry
			var err = new Error();
			var stacktrace = err.stack || arguments.callee.caller.toString();
			if ('Raven' in window) Raven.captureMessage('General Error for version ' + Hiro.sys.version + ': ' + JSON.stringify(data) + ', ' + stacktrace);
			Hiro.sys.log('Dang, something went wrong: ',data);
		},

		log: function(msg,payload) {
			// Log console if we're not on a production system
			if (!Hiro.sys.production) {
				console.log(msg,payload);
			}
		},

		upgradeavailable: function(newversion) {
			// This is triggered via loaddocs if the server starts serving a new major version number.
			// Right now this is only because weekold open tabs are annoying (eg Sentry errorlogging clogged),
			// but in the future we might break stuff for mroe users if we should switch formats, syntax etc
			var ov = this.version.split('-');
			var nv = newversion.split('-');

			// Remove minor version numbers
			nv.pop(); ov.pop();

			if (nv.toString() != ov.toString()) {
				// If major version numbers diverge
				// Check if the user is typing and try again a little later to not freak them out
				// Also make sure we do this only when everythings OK (eg offline users/servers do not reload with unsaved data)
				if (Hiro.canvas.typing || Hiro.sys.status != 'normal') {
					setTimeout(function(){Hiro.sys.upgradeavailable(newversion)},15000);
					return;
				}	

				// If the doc isn't saved yet, rather save one time too often
				if (!Hiro.canvas.saved) Hiro.canvas.savedoc(true);

				// Trigger popup with location.reload button
				Hiro.ui.showDialog(null,'','s_upgrade');		

				// Log to check how often this is used
				Hiro.sys.error('Forced upgrade triggered: ' + ov.toString() + ' to '+ nv.toString());		
			};
		},

		user: {
			id: '',
			email: '',
			name: '',
			// levels: 0 = anon, 1 = free, 2 = paid
			level: 0,
			dialog: document.getElementById('dialog').contentDocument,
			signinCallback: null,
			upgradeCallback: null,
			justloggedin: false,
			authactive: false,
			doccount: 0,

			register: function(event) { 
				// Register a new user (or log in if credentials are from know user)
				var button = document.getElementById('dialog').contentDocument.getElementById('signupbutton');
				var val = document.getElementById('dialog').contentDocument.getElementById('signupform').getElementsByTagName('input');
				var error = document.getElementById('dialog').contentDocument.getElementById('signuperror');
				var payload = {
					email: val[0].value.toLowerCase().trim(),
					password: val[1].value
				};

				// Prevent default event if we have one
				if (event) event.preventDefault();				

				// Preparation
				if (this.authactive) return;
				this.authactive = true;				
				button.innerHTML ="Signing Up...";

				// Remove focus on mobiles
				if ('ontouchstart' in document.documentElement && document.activeElement) document.activeElement.blur();				

				// Clear any old error messages
				val[0].nextSibling.innerHTML = '';
				val[1].nextSibling.innerHTML = '';				
				error.innerHTML = '';

				// Send request to backend
				Hiro.comm.ajax({
					url: "/register",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                payload: payload,
					success: function(req,data) {
						Hiro.sys.user.authed('register',data,'Email');												                    
					},
					error: function(req,data) {
	                    button.innerHTML = "Create Account";
	                    Hiro.sys.user.authactive = false;						
						if (req.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							if (Raven) Raven.captureMessage('Signup error for: '+ payload.email);							
							return;
						}
	                    if (data.email) {
	                    	val[0].className += ' error';
	                    	val[0].nextSibling.innerHTML = data.email;
	                    }	
	                    if (data.password) {
	                    	val[1].className += ' error';	                    	
	                    	val[1].nextSibling.innerHTML = data.password;  
	                    }	                 		                    						                    
					}										
				});	
				return false;
			},

			login: function(event) { 
				// Register a new user (or log in if credentials are from know user)
				var button = document.getElementById('dialog').contentDocument.getElementById('loginbutton');
				var val = document.getElementById('dialog').contentDocument.getElementById('loginform').getElementsByTagName('input');
				var error = document.getElementById('dialog').contentDocument.getElementById('loginerror');
				var payload = {
					email: val[0].value.toLowerCase().trim(),
					password: val[1].value
				};

				// prevent default submission event if we have one
				if (event) event.preventDefault();

				// Preparing everything
				if (Hiro.sys.user.authactive) return;
				Hiro.sys.user.authactive = true;				
				button.innerHTML ="Logging in...";

				// Remove focus on mobiles
				if ('ontouchstart' in document.documentElement && document.activeElement) document.activeElement.blur();

				// Clear any old error messages
				val[0].nextSibling.innerHTML = '';
				val[1].nextSibling.innerHTML = '';				
				error.innerHTML = '';					
				// Send request to backend		
				Hiro.comm.ajax({
					url: "/login",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                payload: payload,
					success: function(req,data) {
						Hiro.sys.user.authed('login',data);						                    
					},
					error: function(req,data) { 												
	                    button.innerHTML = "Log-In";
	                    Hiro.sys.user.authactive = false;						
						if (req.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							if (Raven) Raven.captureMessage('Signup error for: '+ payload.email);							
							return;
						} 
	                    if (data.email) {
	                    	val[0].className += ' error';
	                    	val[0].nextSibling.innerHTML = data.email[0];
	                    }	
	                    if (data.password) {
	                    	val[1].className += ' error';	                    	
	                    	val[1].nextSibling.innerHTML = data.password;  
	                    }	               		                                    
					}										
				});	
				return false;
			},

			facebooklogin: function() {
				var msg = 'Sign-In With <b>Facebook</b>',
					frame = document.getElementById('dialog').contentDocument,
					buttons = frame.getElementsByClassName('fb');

				FB.getLoginStatus(function(response) {	
				  if (response.status === 'connected') {
					Hiro.comm.ajax({
						url: "/_cb/facebook",
		                type: "POST",
		                payload: JSON.stringify(response.authResponse),
						success: function(req,data) {
		                    // All that needs to be done at this point
		                    Hiro.sys.user.authed('login',data);									                    
						},
						error: function(req) {
							Hiro.sys.error(req);									
						}
					});				    
				  } else if (response.status === 'not_authorized') {
				    if (window.navigator.standalone) {
				    	// On mobile devices with potentially no popups we do a classic flow
				    	window.location = '/connect/facebook?next=/';
				    } else {
						FB.login(function(response) {
						   if (response.authResponse) {
								Hiro.comm.ajax({
									url: "/_cb/facebook",
					                type: "POST",
					                payload: JSON.stringify(response.authResponse),
									success: function(req,data) {
					                    // All that needs to be done at this point
					                    Hiro.sys.user.authed('register',data,'Facebook');									                    
									},
									error: function(req) {
										Hiro.sys.error(req);									
									}
								});
						   } else {
						   	// FB auth process aborted by user
						    fbbuttons[0].innerHTML = fbbuttons[1].innerHTML = (WPFBbuttonHTML);
							Hiro.sys.error('Aborted FB login (Logged into Facebook)');					     
						   }
						},{scope: 'email'});
					}	
				  } else {
				  	// User not signed in to Facebook, so on touch devices we use redirect the window and otehrwise open a popup
				    if (window.navigator.standalone) {
				    	// On mobile devices with potentially no popups we do a classic flow
				    	window.location = '/connect/facebook?next=/';
				    } else {
						FB.login(function(response) {
						   if (response.authResponse) {
								Hiro.comm.ajax({
									url: "/_cb/facebook",
					                type: "POST",
					                payload: JSON.stringify(response.authResponse),
									success: function(req,data) {
					                    // All that needs to be done at this point
					                    Hiro.sys.user.authed('login',data);
									},
									error: function(req) {
										Hiro.sys.error(req);									
									}
								});
						   } else {
						   	 // FB auth process aborted by user
						     fbbuttons[0].innerHTML = fbbuttons[1].innerHTML = WPFBbuttonHTML;
							Hiro.sys.error('Aborted FB login (Not logged into Facebook)');						     
						   }
						},{scope: 'email'});
					}			
				  }
				});
			},			

			authed: function(type, user, method) {
				// On successfull backend auth the returned user-data 
				// from the various endpoints and finishes up auth process
            	Hiro.sys.user.setStage(user.tier);
            	this.justloggedin = true;   

            	// If we should still have the landingpage visible at this point
				var landing = document.getElementById('landing');
				if (landing) Hiro.ui.fade(landing,-1,150);

            	if (Hiro.canvas.docid=='localdoc' && !localStorage.getItem('WPCdoc')) {
            		// Remove empty document if user signs up / in right away            		
            		Hiro.folio.docs.length = 0;
            	}

                // Check for and move any saved local docs to backend
                if (Hiro.canvas.docid=='localdoc' && localStorage.getItem('WPCdoc')) {
                	Hiro.folio.movetoremote();
                } else {
	                // Always load external docs as register endpoint can be used for existing login
					Hiro.folio.loaddocs();	
                }	

                // Render results to attach new scroll event handlers on mobile devices
                if ('ontouchstart' in document.documentElement) {
                	Hiro.context.renderresults();
                }

                // See if we have a callback waiting
                if (this.signinCallback) Hiro.util.docallback(this.signinCallback);			

                // Suggest upgrade after initial registration or just hide dialog
                if (user.tier==1 && type=='register') {
                	Hiro.ui.statusflash('green','Welcome, great to have you!',true);
                	this.forceupgrade(2,'Unlock <b>more features</b><em> right away</em>?');
                } else {
                	Hiro.ui.hideDialog();	
                }

                // Track signup (only on register, we also only pass the method variable then)
                if (analytics) {
                	if (type=='register') {
                		// Submit the referring url of the registration session 
                		// (hackish timeout to make sure we get proper user token from settings template, but works fine atm)
                		var logreferrer = setTimeout(function(){
                			analytics.identify(Hiro.sys.user.id, {referrer: document.referrer});
                		},2000);
                	}
	                if (type=='register' && method) {
	                	analytics.track('Registers',{method:method});
	                } else if (type == 'login' || type == 'reset') {
	                	analytics.track('Logs back in');
	                }	                	
                }              

                // Housekeeping, switch authactive off
                Hiro.sys.user.authactive = false;
			},

			getfirstname: function() {
				// Quick hack to get FB name (if we don't have one yet) of users that already signed in
				if (Hiro.sys.user.name) return;
				setTimeout(function(){
					// TODO: This strangely sometimes returns "FB is undefined" in Chrome 32, maybe blocker plugin
					if (!FB) {
						Hiro.sys.user.getfirstname();
						return;
					}					
					FB.api('/me', function(response) {
			            if (response.first_name && !Hiro.sys.user.name) {
			            	// Fetch name & build payload
			            	Hiro.sys.user.name = response.first_name;
			            	var payload = {};
			            	payload.name = response.first_name;
			            	// Notify segment.io
			            	if (analytics) analytics.identify(Hiro.sys.user.id, payload);
			            	// Send to backend
			            	Hiro.sys.user.namesave(null,response.first_name)
			            }
			        });
				},10000);	
			},	

			nametype: function(event) {
				// Onkeydown handler for Username input field in settings dialog
				var target = event.target || event.srcElement;
				if (target.value.length > 0 && target.value != Hiro.sys.user.name) {
					target.nextSibling.style.display = 'block';
				} else {
					target.nextSibling.style.display = 'none';					
				}			
			},

			namesave: function(event,name) {
				// Submit new name to backend
				var payload = {}, frame = document.getElementById('dialog').contentDocument,
					form = frame.getElementById('accountform'),
					input = form.getElementsByTagName('input')[0],
					button = form.getElementsByTagName('a')[0];

				// In case this was triggered by UI click
				if (event) {
					event.preventDefault();
					var name = input.value;										
				}	

				// Make sure we have a new value
				if (!name) return;					

				// Submit to backend
				payload.name = name;				
				Hiro.comm.ajax({
					url: "/me",
	                type: "POST",
	                payload: JSON.stringify(payload),
					success: function() {
						button.innerHTML = 'Saved!';
						Hiro.sys.user.name = name;	
		            	var payload2 = {};
		            	payload2.name = name;
		            	// Notify segment.io
		            	if (analytics) analytics.identify(Hiro.sys.user.id, payload2);						                    
					},
					error: function() {				
						input.focus();
						button.innerHTML = 'Try again';	              		                    						                    
					}										
				});					

			},			

			requestreset: function(event) {
				// Checks if there is a valid mail address and sends a password request for it
				var email = document.getElementById('dialog').contentDocument.getElementById('loginform').getElementsByTagName('input')[0];
				var error = document.getElementById('dialog').contentDocument.getElementById('loginerror');

				// Check if there's any input at all
				if (email.value.length<=5) {
					email.className += ' error';
					if ('ontouchstart' in document.documentElement && document.activeElement) { document.activeElement.blur(); } else { email.focus(); }
					error.innerHTML = 'Please enter your email address and click "Lost Password?" again.';
					return;
				}

				// Prevent event from firing
				if (event) event.preventDefault();

				// Prepare posting
				error.innerHTML = '';
				var payload = { email: email.value.toLowerCase().trim() };

				// Send request to backend
				Hiro.comm.ajax({
					url: "/reset_password",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                payload: payload,
					success: function() {
						error.innerHTML = 'Reset instructions sent, please check your email inbox.';	                    
					},
					error: function(req) {				
						if (req.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							return;
						}
						if (req.status==404) {
							email.className += ' error';							
							email.nextSibling.innerHTML = req.responseText;
							return;
						}
						error.innerHTML = "Old account, please <a href='mailto:hello@hiroapp.com?subject=Lost%20Password&body=Please%20send%20me%20a%20link%20to%20reset%20it.' target='_blank'>request a reset</a>.";						 
						if (Raven) Raven.captureMessage('Password reset gone wrong');	              		                    						                    
					}										
				});	
				return false;
			},

			showreset: function(hash) {
				// Perform basic checks and open reset menu
				if (this.level != 0) {
			    	Hiro.ui.statusflash('green','Please log out to reset your password.',true); 	
			    	return;				
				}

				// Store token
				this.resetToken = hash;

				// Perform iframe actions
				var frame = document.getElementById('dialog');
				frame.onload = function() {	
					// The if prevents the dialog from being loaded after login		
					if (Hiro.sys.user.level == 0) Hiro.ui.showDialog(null,'','s_reset','new_password');
				}
			},			

			redoTokenRequest: false,
			resetToken: '',
			resetpwd: function() {
				// Perform basic checks and submit request
				var frame = document.getElementById('dialog').contentDocument;
				var inputs = frame.getElementById('resetform').getElementsByTagName('input');
				var button = frame.getElementById('resetbutton');
				var error = frame.getElementById('reseterror');
				var pwd1 = inputs[0]; 
				var pwd2 = inputs[1];

				if (this.redoTokenRequest) {
					// If previous token submit got an error, switch view to requesting new token via mail and abort
					Hiro.ui.switchView(frame.getElementById('s_signin'));
					frame.getElementById('signup_mail').focus();					
					return;
				}

				if (pwd1.value.length == 0) {
					// Check if password is provided
					pwd1.className += ' error';
					pwd1.nextSibling.innerHTML = 'Please enter a new password';
					return;
				}				

				if (pwd1.value != pwd2.value) {
					// Check if passwords match and abort otherwise
					pwd2.className += ' error';
					pwd2.nextSibling.innerHTML = 'Passwords do not match';
					pwd2.value = '';
					return;
				}

				// Post to backend
				button.innerHTML = 'Resetting...';
				var payload = { password: pwd1.value };
				var url = '/reset/'+this.resetToken;
				Hiro.comm.ajax({
					url: url,
	                type: "POST",
	                payload: JSON.stringify(payload),
					success: function(req,data) {
						Hiro.sys.user.authed('reset',data);	                    
					},
					error: function(req) {               		                    
						if (req.status = 404) {
							Hiro.sys.user.redoTokenRequest = true;
							button.innerHTML = 'Request New Reset';
							pwd1.disabled = true;
							pwd2.disabled = true;
							error.innerHTML = 'Your reset link expired, please request a new one.';
						}	                  	  
					}										
				});				
			},

			logio: function() {
				if (this.level==0) Hiro.folio.showSettings('s_signin','signin_mail');				
				else this.logout();
			},	

			logout: function() {
				// Simply log out user and reload window
				Hiro.ui.fade(document.body,-1,400);
				Hiro.comm.ajax({
					url: "/logout",
	                type: "POST",
					success: function() {
	                    window.location.href = '/';							                    
					}									
				});				

			},	

			setStage: function(level) {
				// Show / hide features based on user level, it's OK if some of that can be tweaked via js for now
				level = level || this.level;
				var results = document.getElementById(Hiro.context.resultsId),
					signupButton = document.getElementById(Hiro.context.signupButtonId),
					publish = document.getElementById(Hiro.publish.id);

				switch(level) {
					case 0:
						signupButton.style.display = 'block';					
						this.level = 0;					
						break;
					case 1:		
						this.level = 1;		
						break;
					case 2:
						this.level = 2;					
						break;		
					case 3:
						this.level = 3;						
						break;							
				}

				// generic styles & functions for logged in users
				switch(level) {
					case 0:
						// Init dmp library for link adding capabilities
						if (!Hiro.canvas.sync.inited) Hiro.canvas.sync.init(true);	
						break;				
					case 1:
					case 2:	
					case 3:				
						results.style.overflowY = 'auto';
						results.style.bottom = 0;
						results.style.marginRight = '1px';
						results.style.paddingRight = '2px';						
						signupButton.style.display = 'none';
						Hiro.folio.el_logio.className = 'logio logout';
						Hiro.folio.el_logio.getElementsByTagName('a')[0].title = 'Logout';
						Hiro.folio.el_logio.getElementsByTagName('span')[0].innerHTML = 'Logout';	

						// Init sync capabilities
						if (!Hiro.canvas.sync.inited) Hiro.canvas.sync.init();	

						// Set plans dialog
						Hiro.ui.setplans(level);

						break;	
				}				
			},

			upgrade: function(level,callback,reason,event) {
				if (this.level==0) {
					// If user is not loggedin yet we show the regsitration first
					// TODO Refactor dialog & login flow to enable callback without going spaghetti
					if (!event) event = null;
					this.signinCallback = callback;
					Hiro.ui.showDialog(event,'','s_signup','signup_mail');
					return;
				}
				if (this.level<level) this.forceupgrade(level,reason);
			},

			forceupgrade: function(level,reason,event) {
				// Show an upgrade to paid dialog and do callback

				// Change default header to reason for upgrade				
				var plan = document.getElementById('dialog').contentDocument.getElementById('s_plan').getElementsByTagName('div');
				var checkout = document.getElementById('dialog').contentDocument.getElementById('s_checkout').getElementsByTagName('div');
				plan[0].innerHTML = checkout[0].innerHTML = '<span class="reason">' + reason + '</span>';
				plan[0].style.display = checkout[0].style.display = 'block';
				plan[1].style.display = checkout[1].style.display = 'none';

				// Make sure the parent node is set to block, bit redundant but working fine
				if (!event) event = null;				
				Hiro.ui.showDialog(event,'','s_settings');	
				Hiro.ui.showDialog(event,'','s_plan');

				// Do the intended action that triggered upgrade, this confuses most users atm
				// if (this.upgradeCallback) Hiro.util.docallback(this.upgradeCallback);				
			},

			checkoutActive: false,
			upgradeto: '',
			checkout: function() {
				if (analytics) analytics.track('Initiates Checkout');				
				// handles the complete checkout flow from stripe and our backend
				var frame = document.getElementById('dialog').contentDocument;
				if (this.checkoutActive) return;

				// Preparation 
				this.checkoutActive = true;
				var checkoutbutton = frame.getElementById('checkoutbutton');
				checkoutbutton.innerHTML = 'Verifying...';

				// TODO Bruno: add LUHN checks etc

				// Get plan
				var subscription = {};
				subscription.plan = this.upgradeto;

				// See if we already have all data in the backend or else get a new token
				if (!document.getElementById('dialog').contentWindow.usehirostripecard) {
					// Get Stripe token & send to our backend
					var form = frame.getElementById('checkoutform');
					Stripe.createToken(form, function(status,response) {					
						if (response.error) {
							// Our IDs are named alongside the stripe naming conventions
							if (response.error.param) frame.getElementById('cc_'+response.error.param).className += " error";
							if (response.error.param == 'number') {
								var el = frame.getElementById('cc_'+response.error.param).nextSibling;
								el.innerHTML = response.error.message;	
								el.className += ' error';						
							} else {
								frame.getElementById('checkout_error').innerHTML = response.error.message;
							}
							Hiro.sys.user.checkoutActive = false;
							checkoutbutton.innerHTML = "Try again";
							if (Raven) Raven.captureMessage ('CC check gone wrong: '+JSON.stringify(response));							
							return;
						} else {
							// add new stripe data to subscription object
							subscription.stripeToken = response.id;		
							Hiro.sys.user._completecheckout(subscription);							
						}				
					});					
				} else {
					this._completecheckout(subscription);
				}
			},

			_completecheckout: function(subscription) {
				// Get the data from the checkout above and post data to backend / cleanup ui 
				var tier = (subscription.plan == "starter") ? 2 : 3;				
				if (analytics) analytics.track('Upgraded (Paid Tier)',{oldTier:Hiro.sys.user.level,newTier:tier});				
				Hiro.comm.ajax({
					url: "/settings/plan",
	                type: "POST",
	                payload: JSON.stringify(subscription),
					success: function(req,data) {
						document.getElementById('dialog').contentDocument.getElementById('checkoutbutton').innerHTML = "Upgrade";
	                    Hiro.sys.user.setStage(data.tier);	
	                    Hiro.sys.user.checkoutActive = false;	
						if (document.activeElement) document.activeElement.blur();
	                    Hiro.ui.hideDialog();				                    
	                    Hiro.ui.statusflash('green','Sucessfully upgraded, thanks!',true);						                    
					},
	                error: function(req) {
						if (Raven) Raven.captureMessage ('Checkout gone wrong: '+JSON.stringify(req));		                	
	                }					
				});					
			},

			downgradeActive: false,
			downgrade: function(targetplan) {
				// downgrade to targetplan
				if (this.downgradeActive) return;				
				var boxes = document.getElementById('dialog').contentDocument.getElementById('s_planboxes');
				var box = (targetplan=="free") ? 0 : 1;
				var button = boxes.getElementsByClassName('box')[box].getElementsByClassName('red')[0];
				button.innerHTML = "Downgrading...";
				if (analytics) analytics.track('Downgrades',{oldTier:Hiro.sys.user.level,newTier:box});				

				// All styled, getting ready to downgrade
				var payload = {plan:targetplan};
				this.downgradeActive = true;
				Hiro.comm.ajax({
					url: "/settings/plan",
	                type: "POST",
	                payload: JSON.stringify(payload),
					success: function(req,data) {
	                    Hiro.sys.user.setStage(data.tier);	
	                    Hiro.sys.user.downgradeActive = false;	
	                    Hiro.ui.hideDialog();	                    
	                    Hiro.ui.statusflash('green','Downgraded, sorry to see you go.',true);					                    
					}
				});					
			}
		},
	},

	// Data absctraction layer for on/offline access
	store: {
		// Setup variables
		local: undefined,
		settypes: ['POST','PATCH'],

		handle: function(obj) {
			// Get & set data
			if (Hiro.comm.online) {
				// Set flag that tells ajax to send data back to us so we can update the localstore
				obj.updatelocal = true;
				// All good, pass on to ajax
				Hiro.comm.ajax(obj);
			} else {
				// Use localstorage
				if (!obj.url) return;

				// Make key that works with localStorage
				obj.url = this.makekey(obj.url);

				if (obj.type && this.settypes.indexOf(obj.type) > -1) {
					// We have to store something
					this.setlocal(obj);
				} else {
					// We have to retrieve something
					this.getlocal(obj);
				}
			}
		},

		makekey: function(url) {
			// Convert URL to save localStore key 
			var key = url;
			if (key.indexOf('/') > -1) key = key.replace(/\//g,".");
			key = key.split('?')[0];
			key = 'hiro' + key;	
			if (key.charAt(key.length - 1) == '.') key = key.slice(0,-1);
			return key;		
		},

		setlocal: function(obj) {
			// Store value in localstore
			var key = obj.url,
				value = obj.payload,
				r = {};

			// Prepare data
			if (typeof value != 'string') value = JSON.stringify(value);

			// Save locally	& execute callback	
			Hiro.sys.log('Saving in localstore: ',key,value);
			try {
				// Save
				localStorage.setItem(key,value);

				// Fill response object
				if (obj.success) {
					r.status = 200;
					r.response = obj.payload;

					// Return response obj
					if (obj.success) obj.succes(r,obj.payload);
				}
			} catch(e) {
				r.status = 500;
				r.response = e;

				// Return error object
				if (obj.error) obj.error(r,e);				
				Hiro.sys.error(e);
			}

			// Execute callback			
		},

		updatelocal: function(url,value) {
			// Save data returned from xhr call to localstorage to keep it up to date
			key = this.makekey(url);	

			// Update item			
			try { localStorage.setItem(key,value); } catch(e) {	Hiro.sys.error(e); };	
			Hiro.sys.log('Updating localstore: ',key,value);								
		},

		getlocal: function(obj) {
			// Get value from localstore
			var key = obj.url,
				r = {};

			// Get data
			try {
				var value = localStorage.getItem(key);
				Hiro.sys.log('Retrieved from localstore: ',key,value);				
			} catch (e) {
				Hiro.sys.error(e);	
				r.status = 500;
				r.response = e;
				if (obj.error) obj.error(r,e);	
				return;		
			}

			// Build response object & execute callback		
			if (value) {
				r.response = value;					
				r.status = 200;
				if (obj.success) obj.success(r,JSON.parse(value))
			} else {
				r.status = 404;
				if (obj.error) obj.error(r,undefined)
			}		

		}
	},

	// generic communication with backend
	comm: {
		// Global stuff
		online: true,

		// xhr specific stettings
		successcodes: [200,201,204],
		msXMLHttpServices: ['Msxml2.XMLHTTP','Microsoft.XMLHTTP'],
		msXMLHttpService: '',

		// Dis- & reconnect
		reconnecttimer: null,
		reconnectinterval: 1000,
		statusIcon: document.getElementById('switchview'),
		normalStatus: document.getElementById('status'),
		errorStatus: document.getElementById('errorstatus'),

		crap: {
			// Aka Appengine Channel API, to be deprecated once we have dedicated sync server
			connected: false,
			channel: null,
			channelToken: undefined,
			socket: undefined,

            connect: function(token) {
            	// Called externally to start Channel session
            	// Make sure to properly kill any old channel
            	if (this.socket) {
            		this.socket.close();
     				setTimeout(function(){
						Hiro.comm.crap.connect(token);
						return;
					},500);       		
            	}

            	// Open channel
            	this.openchannel(token);
            },

			openchannel: function(token) {
				// Open Appengine Channel or Diff match patch wasn't loaded yet
				if (!goog || !goog.appengine.Channel || !Hiro.canvas.sync.dmp) {
					// Retry if channel API isn't loaded yet
					setTimeout(function(){
						Hiro.comm.crap.openchannel(token);
						return;
					},500);
				}

				if (token) {
					// Store token if we should need it later					
					this.channelToken = token;
				} else {
					// Try to recover with last known token if we don't have one
					token = this.channelToken;
					if (!this.channelToken) Hiro.sys.error('Tried to connect but no channel token available');
				}

				// Do not try to create multiple sockets
				if (this.socket) return;

				// Create new instance of channel object
                this.channel = new goog.appengine.Channel(token),
                this.socket = this.channel.open();
                this.socket.onopen = function() {
                    Hiro.sys.log("connected to channel api");
                    Hiro.comm.crap.connected = true;
                }
                this.socket.onmessage = function(data) {
                    Hiro.comm.crap.on_channel_message(JSON.parse(data.data));
                }                
                this.socket.onerror = function(data) {
                    Hiro.sys.error("ERROR connecting to channel api" + JSON.stringify(data));                	
					if (data.code == 0 || data.code == -1) {
                    	// Damn, we or Channel API just went offline, verify by sending a sync to server
                    	Hiro.sys.log('Channel API offline');
                    	Hiro.canvas.sync.addedit(true,'Syncing...');
                    }                           	
                }
                this.socket.onclose = function(data) {
                    Hiro.sys.log("Channel closed.",data);
					Hiro.comm.crap.channel = Hiro.comm.crap.socket = null;
					Hiro.comm.crap.connected = false;	                                    
                }			
			},		

            on_channel_message: function(data) {
            	// Receive and process notification of document update
            	var el = Hiro.folio.lookup[data.doc_id], 
            		ui = Hiro.ui,
            		ownupdate = (data.origin.session_id == Hiro.canvas.sync.sessionid),
            		ownuser = (data.origin.email == Hiro.sys.user.email),
            		name = data.origin.name || data.origin.email;

            	// If the update was from our current session (same window)	
            	if (ownupdate) {
					if (el.last_doc_update) {
						el.last_doc_update = undefined; 
                		Hiro.folio.update();						 
					}	            		
            		return;	
            	}	


            	// Nice trick: If we can't find the docid, the message is for a doc we don't know (yet), so we update the list
            	if (!el) {
            		Hiro.folio.loaddocs(true);
            		return;
            	}         		

            	// Update internal timestamp & last editor values	
            	if (ownuser) {
            		el.updated = Hiro.util.now(); 
					if (el.last_doc_update) el.last_doc_update = undefined;            		 
            	} else {
            		if (!el.last_doc_update) el.last_doc_update = {};
            		el.last_doc_update.updated = Hiro.util.now();
            		el.last_doc_update.name = data.origin.name;  
            		el.last_doc_update.email = data.origin.email;            		          		
            	}              	

                if (data.doc_id == Hiro.canvas.docid) {
                	// If the update is for the current document
                	// As we don't have a "send/request blank" yet, we trigger a then blank diff
                	// TODO: Think of a better way
                    Hiro.canvas.sync.addedit(true,'Syncing...');
                    if (!ui.windowfocused && !ui.audioblurplayed && !ownuser) {
                    	// Play sound
                    	ui.playaudio('unseen',0.7);
                    	ui.audioblurplayed = true;
                    	// Add update message to notification function
                    	var title = Hiro.canvas.title || 'Untitled';
                    	ui.tabnotify('Updated!');
                    }
                } else if (!ownuser && el && el.status == 'active') {
                	// If the update is for an active (not archived) doc in folio thats not currently open
                	// Update internal values and update display
                	el.unseen = true;
                	// Add message to notification function, sound is only triggered once by folio update
                    var title = el.title || 'Untitled';                	
                    if (!ui.windowfocused) ui.tabnotify(el.title + ' updated!');                	
                }

                // Display the updates in the DOM
                Hiro.folio.update();                
            }
		},					

		goneoffline: function() {
			// Abort any progress bar
			if (Hiro.ui.hprogress.active) Hiro.ui.hprogress.done(true);

			// Stop here if we're already offline
			if (!this.online) return;

			this.online = false;
			Hiro.sys.status = 'offline';
			var reason = (navigator.onLine) ? 'Not connected.' : 'No internet connection.',
				es = this.errorStatus,
				si = this.statusIcon;

			// Visual updates
			this.normalStatus.style.display = 'none';
			es.style.display = 'block';
			es.innerHTML = reason;
			si.className = 'error';
			si.innerHTML = '!';

			// Log error (to be switched off again, just to see how often this happens)
			Hiro.sys.log('Gone offline, ' + reason);

			// Try reconnecting
			this.tryreconnect();
		},

		tryreconnect: function() {
			// Pings the doc API and checks if current document is latest and no newer version on the server
			var that = Hiro.comm, t = that.reconnectinterval;
			if (!Hiro.ui.windowfocused) {
				// If the window is not focused break recursive check and resume as soon as window is focused again
				Hiro.util._focuscallback = that.tryreconnect;
				return;
			}

			// Abort if we already have a timer
			if (that.reconnecttimer) return;

			// Repeat the check periodically
			that.reconnecttimer = setTimeout(function(){
				clearTimeout(that.reconnecttimer);
				that.reconnecttimer = null;
				that.tryreconnect();
			},t);

			// Increase reconnectinterval to up to one minute
			that.reconnectinterval = (t > 60000) ? 60000 : t * 2;	

			// Try reconnecting
			if (Hiro.sys.user.level == 0) {

			} else {
				Hiro.canvas.sync.addedit(true,'Reconnecting...');	
			}						

			// Log
			Hiro.sys.log('Offline, attempting to reconnect', that.reconnecttimer)					
		},		

		backonline: function() {
			// Switch state back to online and update UI			
			if (this.online) return;
			this.online = true;
			Hiro.sys.status = 'normal';
			var mo = Hiro.context.show,
				es = this.errorStatus,
				si = this.statusIcon;			

			// Visual updates
			this.normalStatus.style.display = 'block';
			es.style.display = 'none';
			si.className = (mo) ? 'open' : '';			
			si.innerHTML = (mo) ? '&#187;' : '&#171;';	

			// Reset reconnecttimer
			clearTimeout(this.reconnecttimer);
			this.reconnecttimer = null;
			this.reconnectinterval = 1000;

			// Make sure we get the latest version from the server and reset the Channel API			
			Hiro.canvas.sync.addedit(true,'Reconnecting...');		
		},		

		ajax: function(obj) {
			// Generic AJAX request handler
			// Supports:
			// Method: GET, POST, PATCH
			// URL: Target URL
			// Headers: HTTP Headers to be included
			// Success: Success callback function
			// Error: Error callback function
			if (!obj) return;

			var method = obj.type || 'GET',
				async = obj.async || true,
				contentType = obj.contentType || 'application/json; charset=UTF-8'
				payload = obj.payload || '';	

			// Build proper URL encoded string
			if (obj.payload && contentType == 'application/x-www-form-urlencoded') {
				// TODO: Move this into util once it's tested
				var str = [];
				for(var p in obj.payload) {
					if (obj.payload.hasOwnProperty(p)) {
						str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj.payload[p]));
					}
				}
				payload = str.join("&");				
			}		

			// Non Patch supporting devices, move to array check once we have more
			// TODO find out which ones exactly
			if (method == 'PATCH' && navigator.appVersion.indexOf('BB10') > -1) method = 'POST';

			// Spawn new request object
			var req = this.getreq();	

			try {				
				// Set basic data
				req.open(method, obj.url, async);
				req.timeout = obj.timeout || 20000;	
				
				// Pass on state changes and attach event handlers
				if (async) {
					// This should work in all relevant browsers
					req.onreadystatechange = function() { Hiro.comm.responsehandler(this,obj); };

					// Here we have to get browser specific
					if (typeof req.ontimeout != 'undefined') {						
						req.ontimeout = function() { 
							Hiro.comm.errorhandler(req,obj);
						};
					} else {
						// TODO: timeout fallback
					}	
					if (typeof req.onerror != 'undefined') {												
						req.onerror = function() {						 
							Hiro.comm.errorhandler(req,obj); 
						};	
					} else {
						req.addEventListener("error", function() { 						
							Hiro.comm.errorhandler(req,obj);
						}, false);						
					}										
				}	

				// Set headers
				req.setRequestHeader("Content-Type", contentType);
				if (obj.headers) {
					for (var key in obj.headers) {
						// Cycle through header object
						req.setRequestHeader(key, obj.headers[key]);
					}
				}

				// And off we go
				req.send(payload);

			} catch(e) {
				// Proper cleanup and logging
				Hiro.sys.error(['AJAX Error: ',e]);
			}

		},

		responsehandler: function(req,obj) {
			// Handle response, for now we only handle complete requests
			if (req.readyState != 4) return;

			// Handle coming back online
			if (!this.online && req.status && req.status >= 100 && req.status != 500) this.backonline();		

			// Execute callbacks	
			if (Hiro.comm.successcodes.indexOf(req.status) > -1) {
				// Success callback	
				var callback = obj.success;
				try { var data = (req.response) ? JSON.parse(req.response) : undefined; } catch (e) { };			
				if (callback && !obj.called) callback(req,data);

				// Send data back to localstore as well
				if (obj.updatelocal) {
					Hiro.store.updatelocal(obj.url,req.response);
				}

				// Make sure we don't call anything else anymore
				obj.called = true;
				req.abort();
				req = obj = null;					
			} else {				
				this.errorhandler(req,obj);
			}					

			// Mark request for Garbage collection
			req = null;	
		},

		errorhandler: function(req,obj) {
			// Deal with an error and kill the request
			// Set system status offline
			if (this.online && req.status < 100) this.goneoffline();	

			// Abort if we have no callback or already called it		
			if (!obj.error || obj.called) return;	
			obj.called = true;	

			// Callback
			var callback = obj.error;
			try { var data = (req.response) ? JSON.parse(req.response) : undefined; } catch(e) { };
			callback(req,data);

			// Clean up
			req.abort();
			req = obj = null;
		},

		getreq: function() {
			// Determines and returns proper cross browser xhr method
			var req=null;
			if (window.XMLHttpRequest) {
				// Most browsers
				try { req = new XMLHttpRequest(); }	catch(e) { Hiro.sys.error(e) }
			} else if (window.ActiveXObject) {
				// MS ftw
				if (this.msXMLHttpService) {	
					// See if we already have determined the available MS service
					try { req = new ActiveXObject(this.msXMLHttpService); }
					catch(e) { Hiro.sys.error(e) }
				} else {
					// Find it if not
					for (var i=0, l=this.msXMLHttpServices.length; i<l; i++) {
						try { 
							req = new ActiveXObject(this.msXMLHttpServices[i]);
							if (req) {
								this.msXMLHttpService=this.msXMLHttpServices[i];
								break;
							}
						}
						catch(e) {
							Hiro.sys.error(e)
						}
					}
				}
			}

			// Return request object
			return req;
		}


	},

	// Generic utilities
	util: {

		previousdoc: '',
		addhistory: function(docid,title) {
			// Adds a state to the History API stack
			var oldid = this.previousdoc,
				url = '/note/'+docid, payload = {};					

			// Abort if we try to load the same document twice
			if (docid == oldid) return;

			// Set previous on first load
			if (!oldid) this.previousdoc = docid;

			// Build payload
			payload.id = docid;
			if (title) payload.title = title;

			// Add to browser stack	
			if (history && 'pushState' in history) {
				history.pushState(JSON.stringify(payload), null, url);
				this.previousdoc = docid;
			}	
		},

		goback: function(event) {
			// Triggered if user presses back button (popstate event)
			var data = JSON.parse(event.state);

			// Test if we have an id & supported history in the first place
			if (history && 'pushState' in history && data && data.id) {
				Hiro.canvas.loaddoc(data.id,data.title,true);
			}	
		},

		getStyle: function(el,styleProp) {
			if (el.currentStyle)
				var y = el.currentStyle[styleProp];
			else if (window.getComputedStyle)
				var y = document.defaultView.getComputedStyle(el,null).getPropertyValue(styleProp);
			return y;
		},

		// Takes a unix timestamp and turns it into mins/days/weeks/months
		// 86400 = 1 day
		// 604800 = 1 week 
		// 2592000 = 30 days
		// 31536000 = 1 year		
		humanizeTimestamp: function(timestamp) {
			var r = '';
			var now = this.now();
			var t = now - timestamp;
			if (t<60) return "Moments";
			if (t<90) return Math.round(t/60) + " minute";			
			if (t<3600) return Math.round(t/60) + " minutes";
			// if less than 1 hour ago			
			if (t<5200) return Math.round(t/3600) + " hour";			
			// if less than 36 hours ago			
			if (t<129600) return Math.round(t/3600) + " hours";					
			// if less than 14 days ago
			if (t<1209600) return Math.round(t/86400) + " days";
			// if less than 8 weeks ago
			if (t<4838400) return Math.round(t/604800) + " weeks";	
			// if less a year ago
			if (t<31536000) return Math.round(t/2592000) + " months";
			// if less two years ago
			if (t<63072000) return "More than a year";			
			return Math.round(t/31536000) + " years";					
		},

		now: function() {
			// returns UTC UNIX timestamp
			var now = new Date();
			now = now.toUTCString();
			now = Math.round(new Date(now).getTime() / 1000);
			return now;
		},
	

		// Cross browser event handlers
		registerEvent: function(obj, eventType, handler) {
			if (obj.addEventListener) {
				obj.addEventListener(eventType.toLowerCase(), handler, false);
			}
			else if (obj.attachEvent) {
				obj.attachEvent('on'+eventType.toLowerCase(), handler);
			}
			else {
				var et=eventType.toUpperCase();
				if ((obj.Event) && (obj.Event[et]) && (obj.captureEvents)) obj.captureEvents(Event[et]);
				obj['on'+eventType.toLowerCase()]=handler;
			}
		},
		releaseEvent: function(obj, eventType, handler) {
			if (obj.removeEventListener) {
				obj.removeEventListener(eventType.toLowerCase(), handler, false);
			}
			else if (obj.detachEvent) {
				try {
	   				obj.detachEvent('on'+eventType.toLowerCase(), handler);
				}
				catch(e) {
					Hiro.sys.log('',e);
				}
			}
			else {
				var et=eventType.toUpperCase();
				if ((obj.Event) && (obj.Event[et]) && (obj.releaseEvents)) obj.releaseEvents(Event[et]);
				et='on'+eventType.toLowerCase();
				if ((obj[et]) && (obj[et]==handler)) obj.et=null;
			}
		},
		stopEvent: function(e) {
			if (!e) return;
			if (e.preventDefault) {
				e.preventDefault();
			} else {
				e.returnValue = false;
			}
			if (e.stopPropagation) {
				e.stopPropagation();
			} 
			e.cancelBubble = true;
		},

		windowfocus: function() {
		    var hidden = "hidden";
		    var that = Hiro.util;

		    // Standards:
		    if ('focus' in window && 'blur' in window) {
				Hiro.util.registerEvent(window, 'focus', that._focuschanged);	 
				Hiro.util.registerEvent(window, 'blur', that._focuschanged);				   	
		    }
		    else if (hidden in document)
		        document.addEventListener("visibilitychange", that._focuschanged);
		    else if ((hidden = "mozHidden") in document)
		        document.addEventListener("mozvisibilitychange", that._focuschanged);
		    else if ((hidden = "webkitHidden") in document)
		        document.addEventListener("webkitvisibilitychange",  that._focuschanged);
		    else if ((hidden = "msHidden") in document)
		        document.addEventListener("msvisibilitychange",  that._focuschanged);
		    // IE 9 and lower:
		    else if ('onfocusin' in document)
		        document.onfocusin = document.onfocusout =  that._focuschanged;
		    // All others:
		    else
		        window.onpageshow = window.onpagehide = window.onfocus = window.onblur =  that._focuschanged;
		},	

		_focuscallback: null,
		_focuschanged: function(e) {
	        var v = true, h = false, eMap = {focus:v, focusin:v, pageshow:v, blur:h, focusout:h, pagehide:h};
	        e = e || window.event;
	        var focus = Hiro.ui.windowfocused = (e.type in eMap) ? eMap[e.type] : ((Hiro.ui.windowfocused) ? false : true); 
	        if (focus && Hiro.util._focuscallback) {
	        	// If we added a focuscallback, run and clear it if we regain focus
	        	Hiro.util._focuscallback();
	        	Hiro.util._focuscallback = null;	        	
	        }
	        // Do things on change
	        if (focus) {
	        	// If the window gets focused
	        	// Reset values
	        	Hiro.ui.audioblurplayed = false;

	        	// Clean up stuff that happens while we where blurred
	        	Hiro.ui.tabnotify();
	        	setTimeout(function(){
					// Don't do this for unregistered users
					if (Hiro.sys.user.level == 0) return;  
					    		
	        		// Some browser erratically block the title setting, so we make sure this happens here
		        	document.title = ' ';
					document.title = Hiro.canvas.title || 'Untitled';	
	        	},500); 

	        	// Hack: Send edits in refocus to consider changes in old tab
				Hiro.canvas.sync.addedit(true);	
				        	       	
	        } else {
	        	// If the window blurs
	        }
		},

		docallback: function(callback) {
			// Execute a callback
			if (typeof callback == 'function') {
				callback();
			}
			else if (typeof callback == 'string') {
				eval(callback);
			} 			
		}
	},

	// Everything UI / visually relevant
	ui: {
		// Menu (folio) specific properties	
		menuContextRight: 0,
		menuSlideSpan: 301,
		menuSlideDuration: 200,
		menuCurrPos: 0,
		menuSlideCurrDirection: 0,
		menuSlideTimer: 0,
		menuHideTimer: 0,	
		// Dialog (modal popup)
		modalShieldId: 'modalShield',
		dialogWrapperId: 'dialogWrapper',
		dialogDefaultWidth: 750,
		dialogDefaultHeight: 480,
		dialogTimer: null,
		dialogOpen: false,
		// Is the window currently focused? Set by event handlers
		windowfocused: true,
		// Audio settings
		audiosupport: undefined,
		audioblurplayed: false,
		// Current state of the favicon
		faviconstate: 'normal',
		// Are any actions (the small card menus next to the headline) visible?
		actionsvisible: false,
		// Generic wastebin for elements that are only briefly needed and the destroyed again (audio, divs not inserted)
		wastebinid: 'wastebin',	
		// Prefix for current browser	
		vendorprefix: undefined,
		
		playaudio: function(filename, volume) {
			// Plays a sound in /static/filename
			var url = '/static/sounds/' + filename + '.wav'; 
			volume = volume || 1;

			// Check if audio is supported
			if (typeof this.audiosupport === 'undefined') {
				var test = document.createElement('audio');
				this.audiosupport = (test.play) ? true : false;
			}

			// Play sound
			if (this.audiosupport) {
				// HTML5 audio play
				var audio;
				audio = document.createElement('audio');
				audio.setAttribute('preload', 'auto');
				audio.setAttribute('autobuffer', 'autobuffer');
				audio.setAttribute('src', url);
				audio.volume = volume;
				audio.play();				
			} else {
				// In old browsers we do it via embed
				document.getElementById(this.wastebinid).innerHTML = '<embed src="' + url + '" hidden="true" autostart="true" loop="false" />';
			}
		}, 	

		hprogress: {
			// Simple top loading bar lib
			active: false,
			renderstyle: undefined,	
			bar: document.getElementById('hprogress').getElementsByTagName('div')[0],	
			progress: 0,	

			// How long until we start hiding the text and minimum visibility time
			slowtreshhold: 800,
			slowduration: 800,

			init: function() {
			    // Determine proper render style
			    var s = document.body.style,
			    	v = Hiro.ui.vendorprefix = ('WebkitTransform' in s) ? 'Webkit' :
	                    ('MozTransform' in s) ? 'Moz' :
	                    ('msTransform' in s) ? 'ms' :
	                    ('OTransform' in s) ? 'O' : '';

			    if (v + 'Perspective' in s) {
					// Modern browsers with 3D support, e.g. Webkit, IE10
					this.renderstyle = 'translate3d';
			    } else if (v + 'Transform' in s) {
					// Browsers without 3D support, e.g. IE9
					this.renderstyle = 'translate';
			    } else {
					// Browsers without translate() support, e.g. IE7-8
					this.renderstyle = 'margin';
			    }

				// Start loading bar on init
				Hiro.ui.hprogress.begin();			    
			},

			begin: function() {
				// Start new bar (and clear old)
				if (this.active) {
					this.inc(0.2);
					return;
				} 
				this.active = true;

				// Fade in
				Hiro.ui.hprogress.bar.style.display = 'block';
				Hiro.ui.hprogress.bar.style.opacity = 1;							

				// Set initial treshhold
				this.progress = 0.15;
				this._setbarcss(0.15);

				// Kick off autoinc
				this.autoinc();
			},

			autoinc: function() {
				// Progresses the bar by 1/10th of the remaining progress every n msec
				if (!this.active) return;

				// Calculate & execute, abort if too little left
				var diff = (1 - this.progress) / 10;
				if (diff < 0.001) return;
				this.inc(diff);

				// Repeat
				setTimeout(function(){
					Hiro.ui.hprogress.autoinc();
				},300);
			},

			inc: function(inc) {
				// Increment n inc
				if (!this.active) return;	

				// Return if we'd increment beyond 1	
				if (this.progress + inc > 1) return;

				this.progress = this.progress + inc;
				this._setbarcss(this.progress);				
			},

			done: function(error) {
				// Complete bar and fade out
				if (!this.active) return;				
				this.progress = 1;
				this._setbarcss(1);
				setTimeout(function(){
					Hiro.ui.hprogress.bar.style.opacity = 0.15;				
				},300);						

				// if we had an error we change the color to red and fade out later
				if (error) this.bar.style.background = '#D61818';											

				// Renove remains and get ready again
				setTimeout(function(){
					Hiro.ui.hprogress.bar.style.display = 'none';
					if (error) Hiro.ui.hprogress.bar.style.background = '#3c6198';						
					Hiro.ui.hprogress.active = false;					
				},500);					
			},

			_setbarcss: function(pos) {
				// Sets the CSS of the progress bar
				var pos = (-1 + pos) * 100,
					s = this.renderstyle,
					vendor = Hiro.ui.vendorprefix.toLowerCase(),
					v, tf = (vendor) ? vendor + 'Transform' : 'transform';

				// Complete vendor prefix string
				if (vendor) vendor = '-' + vendor + '-'; 	

				// Determine & set the css transition value
				if (s == 'translate3d') {
					v = 'translate3d(' + pos + '%,0,0)';
					this.bar.style[tf] = v;
				} else if (s == 'translate') {
					v = 'translate(' + pos + '%,0)';
					this.bar.style[tf] = v;					
				} else {
					this.bar.style.marginRight = (pos * -1) + '%'; 
				}	
			}
		},

		tabnotifyOn: false,
		tabnotifyMessages: [],
		tabnotifyTimeout: null,
		tabnotify: function(msg) {
			// Cycles a que of notifictaions if tab is not focused and changes favicon
			var ui = Hiro.ui, pool = ui.tabnotifyMessages;

			// This can only happen for registered users
			if (Hiro.sys.user.level == 0) return;

			if (ui.windowfocused) {
				// Cancel all actions and reset state								
				clearTimeout(ui.tabnotifyTimeout);
				ui.tabnotifyTimeout = null;
				document.title = Hiro.canvas.title || 'Untitled';					
				ui.setfavicon('normal');	
				ui.tabnotifyMessages = [];	
				ui.tabnotifyOn = false;		
				return;
			}		

			// Turn on internal notify value
			if (!ui.tabnotifyOn) ui.tabnotifyOn = true;

			if (msg) {
				// Add another message to the array if we haven't yet
				if (pool.indexOf(msg) == -1) pool.push(msg);
			}

			// Do cycling, find out next message first
			var pos = pool.indexOf(msg),
				nextpos = (pos + 1 == pool.length) ? 0 : ++pos,
				next = pool[nextpos],
				updates = Hiro.folio.unseenupdates;
			if (pool.length == 1) {
				// If we only have one message, we cycle title between doc title and message
				document.title = (document.title == next) ? Hiro.canvas.title || 'Untitled' : next;
			} else {
				// If we have multiple we cycle between them, and change the single Updated to proper title
				if (next == 'Updated!') pool[nextpos] = ( Hiro.canvas.title || 'Untitled' ) + ' updated!';
				document.title = ( updates != 0) ? '(' + updates + ') ' + next : next;				
			}

			// Switch favicon
			var state = (this.faviconstate == 'normal') ? 'unseen' : 'normal';
			ui.setfavicon(state);

			// Repeat cycle
			ui.tabnotifyTimeout = setTimeout(function(){ 
				// We send the current msg to the function so it can easily pick the next from the array
				clearTimeout(ui.tabnotifyTimeout);
				ui.tabnotifyTimeout = null;				
				Hiro.ui.tabnotify(next);
			},1000);

		},

		setfavicon: function(state) {
			// Change the favicon to a certain state
			var h = document.head || document.getElementsByTagName('head')[0],
				el = document.createElement('link'),
				old = document.getElementById('dynacon'),
				src;

			// pick right path & file
			switch (state) {
				case 'normal':
					src = '/static/img/favicon.png';
					break;
				case 'unseen':
					src = '/static/img/faviconred.png';	
					break;
			}

			// Build link	
			el.id = 'dynacon';
			el.rel = 'shortcut icon';
			el.href = src;

			// Set internal value
			this.faviconstate = state;

			// Remove previous favicon from head if we have one
			if (old) {
				h.removeChild(old);
			}

			// Add favicon link to DOM
			h.appendChild(el);	
		},

		keyboardshortcut: function(e) {
			// Simple event listener for keyboard shortcuts	
			var k = e.keyCode, that = Hiro.ui;		
			if ( e.ctrlKey || e.metaKey ) {
				if (k == 83) {
					// Ctrl+s
					Hiro.canvas.sync.addedit(false,'Saving...');					
					Hiro.canvas.savedoc(true);
		    		e.preventDefault();											
				}
				if (k == 78) {
					// Ctrl + N, this doesn't work in Chrome as chrome does not allow access to ctrl+n 
					Hiro.folio.newdoc();	
		    		e.preventDefault();									
				}					
		    }

		    // Close dialog on escape
		    if (k == 27 && that.dialogOpen) that.hideDialog();
		},

		clearactions: function(event,textclick) {
			// Hides the action tabs (next to tile, right side) if any are open						
			if (Hiro.sharing.visible) Hiro.sharing.close();
			if (Hiro.publish.visible) Hiro.publish.close();			
		},

		loadDialog: function(url) {
			// (pre)load a special URL into our settings iframe
			var d = document.getElementById(this.dialogWrapperId);
			var frame = d.getElementsByTagName('iframe')[0];
			frame.src = url;
		},

		scrollhandlers: false,
		showDialog: function(event,url,section,field,width,height) {
			// Show a modal popup 
			var s = document.getElementById(this.modalShieldId),
				d = document.getElementById(this.dialogWrapperId),
				frame = document.getElementById('dialog').contentDocument;			
			if (event) Hiro.util.stopEvent(event);

			// Close menu if left open
			if (this.menuCurrPos!=0) this.menuHide();			

			// spawn shield
			s.style.display = 'block';

			// spawn dialogwrapper
			d.style.display = 'block';
			if (width) d.style.width = (width) + 'px';
			if (height) d.style.height = (height) + 'px';
			this._centerDialog();

			// load url into iframe, only if we need a special URL, otherwise it's preloaded on init
			if (url) this.loadDialog(url);

			// show a specific section and / or focus on a specific field
			if (section) {
				var el = frame.getElementById(section);
				Hiro.ui.switchView(el);
				// Supports either a field id or finds the first input if boolean is provided	
				if (field) {
					if (document.activeElement) document.activeElement.blur();
					// On some mobile browser the input field is frozen if we don't focus the iframe first	
					// iOS 7 input fields freeze if they are autofocused & then touched, thus no autofocus on touch devices for now 			 
					// if ('ontouchstart' in document.documentElement) document.getElementById('dialog').contentWindow.focus();								
					if (typeof field == 'boolean') el = el.getElementsByTagName('input')[0];													
					if (typeof field == 'string') el = frame.getElementById(field);
					if (el && !('ontouchstart' in document.documentElement)) el.focus();																
				}					
			}	

			// Recenter on window size changes
			Hiro.util.registerEvent(window, 'resize', this._centerDialog);
			if(!('ontouchstart' in document.documentElement)) this.dialogTimer = window.setInterval(this._centerDialog, 200);

			// Attach clean error styling (red border) on all inputs, only if we load settings
			var inputs = frame.getElementsByTagName('input'), inputtypes = ['email','password','text'];
			for (i=0,l=inputs.length;i<l;i++) {
				if (inputtypes.indexOf(inputs[i].type) > -1) Hiro.util.registerEvent(inputs[i], 'keyup', Hiro.ui.inputhandler);			
			}		

			// Attach events to signup input fields on very small browser, this is the only way to handle browser quirks
			// That prevent users from signing up
			/*)
			if (('ontouchstart' in document.documentElement) && frame.body.offsetHeight < 600 && !this.scrollhandlers) {
				var su_f = frame.getElementById('signupform'),
					su_s = frame.getElementById('signuperror'),
					si_f = frame.getElementById('loginform'),					
					si_s = frame.getElementById('loginerror');

				// Abort if user is signed in and thus fields do not exist /settings HTML
				if (!su_f || !si_f) return;

				// If on a very small browser the client didn't scroll down to the form 
				// we fall back to force scroll the error div at the end into view
				Hiro.util.registerEvent(su_f, 'touchend', function() { setTimeout(function() {
					if (frame.body.scrollTop == 0) {
						if (navigator.appVersion.indexOf('CriOS') > -1) {						
							su_s.scrollIntoView();
						} else {
							var el = frame.activeElement;							
							if (el) el.scrollIntoView();
						}
					}
				},300);});				
				Hiro.util.registerEvent(si_f, 'touchend', function() { setTimeout(function() {							
					if (frame.body.scrollTop == 0) {						
						if (navigator.appVersion.indexOf('CriOS') > -1) {
							si_s.scrollIntoView();
						} else {
							var el = frame.activeElement;							
							if (el) el.scrollIntoView();
						}
					} 					
				},300);});					

				// Prevent setting this twice, someday we should clean this up and deal with eventhandlers in consistent manner				
				this.scrollhandlers = true;
			}	*/		

			// Set internal value
			this.dialogOpen = true;
		},

		inputhandler: function(event) {
			// remove the CSS class error from object
			if (this.className) this.className = this.className.replace(' error', '');

			// Submit form on enter
		    if (event.keyCode == 13) {
		        this.parentNode.getElementsByClassName('pseudobutton')[0].click();
		    }

		    // Remove any errors if we're in the input forms
		    if (this.parentNode.id == 'signupform' || this.parentNode.id == 'loginform') this.nextSibling.innerHTML = '';

		    // Copy signup values
		    if (this.id == 'signin_mail') document.getElementById('dialog').contentDocument.getElementById('signup_mail').value = this.value;
		    if (this.id == 'signup_mail') document.getElementById('dialog').contentDocument.getElementById('signin_mail').value = this.value;
		},		

		hideDialog: function() {
			// Hide the current dialog
			var s = document.getElementById(this.modalShieldId),
				d = document.getElementById(this.dialogWrapperId),
				frame = document.getElementById('dialog');

			// remove resize clickhandler & timer
			if (this.dialogTimer) {
				window.clearInterval(this.dialogTimer);
				this.dialogTimer=null;
				Hiro.util.releaseEvent(window, 'resize', this._centerDialog);				
			}

			// Hide shield & dialog
			if ('ontouchstart' in document.documentElement) {
				if (document.activeElement) document.activeElement.blur();
			}			
			s.style.display = 'none';
			d.style.display = 'none';


			// Put focus back on document 
			if (!('ontouchstart' in document.documentElement)) Hiro.canvas._setposition();

			// If we do not have the settings dialog, load this one back in and abort ebfore doing settings specific stuff
			try {
				if (!document.getElementById('dialog').contentDocument || document.getElementById('dialog').contentDocument.location.href.split('/')[3] != 'settings') {
					frame.src = '/settings/';
					return;
				}
			} catch(e) {
				// On some browsers we can't access the document when it's from filepicker or others, so we reload anyway
				frame.src = '/settings/';
				return;				
			}	

			// Remove input field handlers
			var inputs = frame.contentDocument.getElementsByTagName('input'), inputtypes = ['email','password','text'];
			for (i=0,l=inputs.length;i<l;i++) {
				if (inputtypes.indexOf(inputs[i].type) > -1) Hiro.util.releaseEvent(inputs[i], 'keyup', Hiro.ui.inputhandler);					
			}					

			// reset the frame
			if (Hiro.sys.user.justloggedin) {
				frame.src = frame.src;
				Hiro.sys.user.justloggedin = false;
			} else {
				// Depending on user level switch to register or account overview
				if (Hiro.sys.user.level==0) {
					this.switchView(frame.contentDocument.getElementById('s_login'));
					this.switchView(frame.contentDocument.getElementById('s_signup'));				
				} else {
					this.switchView(frame.contentDocument.getElementById('s_settings'));
					this.switchView(frame.contentDocument.getElementById('s_account'));	
				}
			}

			// See if we had a forced upgrade header
			var plan = frame.contentDocument.getElementById('s_plan');
			if (plan) {
				var head = plan.getElementsByTagName('div');				
				if (head[0].style.display=='block') {
					var checkout = frame.contentDocument.getElementById('s_checkout').getElementsByTagName('div');
					head[0].style.display = checkout[0].style.display = 'none';
					head[1].style.display = checkout[1].style.display = 'block';
				}
			}

			// Set internal value
			this.dialogOpen = false;			
		},

		upgradeboxclick: function(obj) {
			// clicks the currently active button
			var el = obj.getElementsByTagName('a');
			for (i=0,l=el.length;i<l;i++) {
				if (el[i].style.display != 'none') el[i].click();
			}
		},

		setplans: function(level) {
			// Set the up/downgrade buttons on the plan selection screen according to the current level
			var container = document.getElementById('dialog').contentDocument.getElementById('s_planboxes');
			if (!container) {
				// We do not have a reliable settings dialog onload on all browsers (yet) so we retry until it's there
				setTimeout(function(){
					Hiro.ui.setplans(level);
				},500);
				return;				
			}
			var boxes = container.getElementsByClassName('box');

			// Set all buttons to display none & reset content first
			var buttons = container.getElementsByTagName('a');
			for (i=0,l=buttons.length;i<l;i++) {
				if (buttons[i].className.indexOf('red') > -1) buttons[i].innerHTML = "Downgrade";		
				buttons[i].style.display = 'none';			
			}
			switch (level) {
				case 0:
				case 1:				
					boxes[0].getElementsByClassName('grey')[0].style.display = 
					boxes[1].getElementsByClassName('green')[0].style.display = 
					boxes[2].getElementsByClassName('green')[0].style.display = 'block';
					break;
				case 2:
					boxes[0].getElementsByClassName('red')[0].style.display = 
					boxes[1].getElementsByClassName('grey')[0].style.display = 
					boxes[2].getElementsByClassName('green')[0].style.display = 'block';
				 	break;
				case 3:
					boxes[0].getElementsByClassName('red')[0].style.display = 
					boxes[1].getElementsByClassName('red')[0].style.display = 
					boxes[2].getElementsByClassName('grey')[0].style.display = 'block';
					break;
			}
		},

		facebookshare: function() {
			if (!FB) return;
	        var obj = {
	            method: 'feed',
	            link: 'https://www.hiroapp.com',
	            name: 'Hiro. Notes With Friends.',
	            caption: 'https://www.hiroapp.com',
	            description: "From ideas for your business to party preparations: Hiro is the easiest way to stay organized throughout the day.",
	            actions: {
	                name: 'Start a note',
	                link: 'https://www.hiroapp.com/connect/facebook',
	            }
	        };
	        FB.ui(obj,function(response) {
	        	if (response && analytics) window.parent.analytics.track('Shares App',{channel:'Facebook'});
	        });
		},

		fillcheckout: function(plan) {
			// Get the checkout form ready for checkout and switch view
			var frame = document.getElementById('dialog').contentDocument;
			var checkoutbutton = frame.getElementById('checkoutbutton');
			var startdesc = "Advanced Plan: $ 9";
			var prodesc = (document.body.offsetWidth>480) ? "Pro Plan: $ 29 ($ 9 Advance until it's available)" : "Pro Plan: $ 29";
			var cc_num = frame.getElementById('cc_number'); 
			// Not optimal, as this dependend on the HTML not changing
			var forced = (frame.getElementById('s_checkout').getElementsByClassName('header')[1].style.display=="none") ? true : false;
			Hiro.sys.user.upgradeto = plan;			
			if (plan == 'starter') {
				frame.getElementById('cc_desc').value = startdesc;
				frame.getElementById('cc_desc').setAttribute('title','');				
				checkoutbutton.innerHTML = 'Upgrade';
			}
			if (plan == 'pro') {
				frame.getElementById('cc_desc').value = prodesc;
				frame.getElementById('cc_desc').setAttribute('title','Be among the very first to be switched over, automatically!');				
				checkoutbutton.innerHTML = 'Preorder';				
			}							
			this.switchView(frame.getElementById('s_checkout'));
			if (cc_num.value.length==0) {
				cc_num.focus();
			} 
            if (analytics) analytics.track('Chooses Plan',{Plan:plan,Forced:forced});
		},

		_centerDialog: function() {
			var s = document.getElementById(Hiro.ui.modalShieldId);
			var d = document.getElementById(Hiro.ui.dialogWrapperId);
			d.style.left= Math.floor((s.offsetWidth - d.offsetWidth)/2-10) +'px';
			d.style.top= Math.floor((s.offsetHeight - d.offsetHeight)/2-10) +'px';
		},

		menuSwitch: function() {	
			// Handler for elements acting as open and close trigger
			var mp = Hiro.ui.menuCurrPos;

			if (mp==0) {
				// Menu is completely to the left, so we open it
				// On touch devices we also remove the keyboard
				if ('ontouchstart' in document.documentElement) {
					if (document.activeElement) document.activeElement.blur();
				}	

				// Open left folio menu
				Hiro.ui.menuSlide(1);
			}	
			if (mp!=0) {
				// Close left folio menu
				Hiro.ui.menuSlide(-1);
			}	
		},

		delayedtimeout: null,
		menuSlide: function(direction, callback, delayed) {
			// Catch cases where sliding makes no sense
			if (direction == -1 && this.menuCurrPos == 0) return;
			if (direction == 1 && this.menuCurrPos > 100) return;

			if (delayed && !this.delayedtimeout && this.menuCurrPos == 0 ) {
				// Add a slight delay
				this.delayedtimeout = setTimeout(function(){					
					var that = Hiro.ui;
					that.delayedtimeout = null;
					that.menuSlide(direction,'',false);					
				},55);
				return;
			}

			// Abort if menu is currently moving
			if (Hiro.ui.menuSlideCurrDirection != 0) return;	

			// Hide sharing dialog
			if (direction == 1) Hiro.ui.clearactions();				

			var startTime, duration, x0, x1, dx, ref;
			var canvas = document.getElementById('canvas');
			var context = document.getElementById('context');
			var switcher = document.getElementById('switchview');		
			var title = document.getElementById('pageTitle');		
			var publish = document.getElementById(Hiro.publish.id);	
			var sharing = document.getElementById(Hiro.sharing.id);					
			var screenwidth = document.body.offsetWidth;
			var distance = ((screenwidth-50)<this.menuSlideSpan) ? (screenwidth-50) : this.menuSlideSpan;
			
			/**
			 * Easing equation function for a quadratic (t^2) easing in/out: acceleration until halfway, then deceleration.
			 *
			 * @param t		Current time (in frames).
			 * @param b		Starting value.
			 * @param c		Change needed in value.
			 * @param d		Expected easing duration (in frames).
			 * @return		The correct value.
			 */
			function easeInOutQuad(t, b, c, d) {
				if ((t/=d/2) < 1) return c/2*t*t + b;
				return -c/2 * ((--t)*(t-2) - 1) + b;
			}
			function step() {

				var dt=new Date().getTime()-startTime, done;
				if (dt>=duration) {
					dt=duration;
					done=true;
				}
				else {
					done=false;
				}
				var v=ref.menuCurrPos=x0+Math.round(easeInOutQuad(dt, 0, dx, duration));
				// do some ...
				canvas.style.left=v+'px';
				canvas.style.right=(v*-1)+'px';
				context.style.right=(v*-1)+'px';
				if (screenwidth<480) {
					context.style.left=v+'px';						
					title.style.left=v+'px';	
					title.style.right=(v*-1)+'px';
					publish.style.right=(v*-1)+'px';
					sharing.style.right=(v*-1)+'px';																													
				} else {
					context.style.left='auto';					
				}	
				switcher.style.right=(v*-1)+'px';												
				if (done) {
					if (typeof callback=='function') callback();
					ref.menuSlideCurrDirection=0;
					this.menuSlideTimer=0;
				}
				else if (window.requestAnimationFrame) {
					this.menuSlideTimer=requestAnimationFrame(step);
				}
				else {
					this.menuSlideTimer=setTimeout(step, 20);
				}
			}
			direction=(direction<0)? -1:1;
			if ((this.menuSlideCurrDirection==direction) ||
				(this.menuCurrPos==0 && direction<0) ||
				(this.menuCurrPos==distance && direction>0)) return;
			x0=this.menuCurrPos;
			x1=(direction<0)? 0:distance;
			dx=x1-x0;
			duration=this.menuSlideDuration/distance*Math.abs(dx);
			startTime=new Date().getTime();
			ref=this;
			this.menuSlideCurrDirection=direction;
			step();			
		},

		menuHide: function(event) {
			var that = Hiro.ui;			
			if (that.delayedtimeout) {
				clearInterval(that.delayedtimeout);
				that.delayedtimeout = null;
			}	
			if (('ontouchstart' in document.documentElement) && Hiro.ui.menuCurrPos != 0) {
				// Prevent delayed dragging of menu or setting focus
				if (event) event.preventDefault();
			}			
			if (this.menuHideTimer) {
				clearTimeout(this.menuHideTimer);				
			}

			// Fired delayed menuhide
			this.menuHideTimer = setTimeout(function(){that.menuSlide(-1);},1);			
		},

		swipe: {
			start_x: 0,
			start_y: 0,
			active: false,
			callback_left: null,
			callback_right: null, 

			init: function(left,right,e) {
				if (Hiro.ui.menuCurrPos > 0 && Hiro.ui.menuCurrPos < 200) return;		
	    		if (e.touches.length == 1) {
	    			var that = Hiro.ui.swipe, el = e.target;
	    			that.callback_left = left;	
	    			that.callback_right = right;		    			    			
	    			that.start_x = e.touches[0].pageX;
	    			that.start_y = e.touches[0].pageY;
	    			that.active = true;
					el.addEventListener('touchmove', Hiro.ui.swipe.move, false);
	    			setTimeout(function(){
	    				that.active = false;
						that.callback_left = null;
						that.callback_right = null;		    				
	    				that.cancel(el);
	    			},100);
	    		}
			},
			move: function(e) {
				var that = Hiro.ui.swipe;
	    		if (that.active) {   			
		    	 	var x = e.touches[0].pageX;
		    		var y = e.touches[0].pageY;
		    		var dx = that.start_x - x;
		    		var dy = that.start_y - y;
		    		if (Math.abs(dx) >= (45 * window.devicePixelRatio)) {		    			
		    			that.cancel(e.target);
		    			if (Math.abs(dy) > Math.abs(dx*0.5)) return;
		    			if(dx > 0) {
		    				if (that.callback_left) that.callback_left();
		    				e.preventDefault();
		    			}
		    			else {
		    				if (that.callback_right) that.callback_right();
		    				e.preventDefault();		    				
		    			}
		    		}
	    		}
			},

			cancel: function(el) {
				var that = Hiro.ui.swipe;
				if (!that.start_x) return;
				el.removeEventListener('touchmove', Hiro.ui.swipe.move);
				that.start_x = null;
				that.active = false;			
			}
		},

		switchView: function(elementOrId, display, userCallback) {
			// Switch to an element on the same DOM level and hide all others
			var el, n;
			el = (typeof elementOrId != 'object')? document.getElementById(elementOrId):elementOrId;
			if (!display || typeof display != 'string') display='block';
			if (el && el.style) {
				el.style.display=display;
				n=el.previousSibling;
				while (n) {
					if (n.style) n.style.display='none';
					 n=n.previousSibling;
				}
				n=el.nextSibling;
				while (n) {
					if (n.style) n.style.display='none';
					 n=n.nextSibling;
				}
			}
			if (typeof userCallback == 'function') {
				userCallback();
			}
			else if (typeof userCallback == 'string') {
				eval(userCallback);
			}

			// Always blur mobile inputs if focus is not on canvas
			if ('ontouchstart' in document.documentElement && document.activeElement && document.activeElement.id != Hiro.canvas.contentId) {
				if (document.activeElement) document.activeElement.blur();
			} 
		},

		statusflash: function(color,text,touchalert) {
			// briefly flash the status in a given color or show alert on mobile
			if (touchalert && 'ontouchstart' in document.documentElement) {
				// As the sidebar is mostly hidden on mobiles we show an alert, but give the menu a bit to adapt
				setTimeout(function(){
					alert(text);				
				},250);				
				return;
			}
			var status = document.getElementById('status');
			status.innerHTML = text;
			if (color=='green') color = '#055a0b';
			if (color=='red') color = '#D50000';			
			status.style.color = color;
			setTimeout(function(){
				status.style.color = '#999';				
			},5000);
		},

		fade: function(element, direction, duration, callback) {
			// Generic function to fade in or out elements
			var startTime, duration, ref=this;
			function step() {
				var dt=new Date().getTime()-startTime, done;
				if (dt>=duration) {
					dt=duration;
					done=true;
				}
				else {
					done=false;
				}
				element.style[ref.cssOpacityProperty]=a0+da*dt/duration;
				if (done) {
					if (typeof callback=='function') callback();
					if (element._fadeDirection<0) element.style.display = 'none';					
					element._fadeDirection=0;
					delete element._fadeTimer;
					delete element._fadeDirection;
				}
				else if (window.requestAnimationFrame) {
					element._fadeTimer=requestAnimationFrame(step);
				}
				else {
					element._fadeTimer=setTimeout(step, 20);
				}
			}
			direction=(direction<0)? -1:1;		
			var a0=this.getCurrentOpacity(element);
			if (a0===undefined || a0==='') {
				a0=(direction<0)? 1:0;
			}
			else {
				a0=parseFloat(a0);
			}			
			if ((element._fadeDirection==direction) ||
				(a0==0 && direction<0) ||
				(a0==1 && direction>0)) return;
			var a1=(direction<0)? 0:1;
			var da=a1-a0;			
			if (!duration) duration = 1000;
			duration=duration*Math.abs(da);
			startTime=new Date().getTime();
			element._fadeDirection=direction;
			if (direction>0) {
				element.style.display='block';
				if (!a0) element.style[ref.cssOpacityProperty]=0;
			} 
			step();			
		},

		cssOpacityProperty: '',
		resolveCSSProperties: function() {
			var vendors=['webkit','moz','o','ms'];
			var el=document.createElement('div');
			var st=el.style;
			if (st.opacity!==undefined) {
				this.cssOpacityProperty='opacity';
			}
			else {
				for (var i=0, l=vendors.length; i<l; i++) {
					var v=vendors[i]+'Opacity';
					if (st[v]!==undefined) {
						this.cssOpacityProperty=v;
						break;
					}
				}
			}
		},
		getCurrentOpacity: function(element) {
			if (!this.cssOpacityProperty) this.resolveCSSProperties();
			if (this.cssOpacityProperty && element.style[this.cssOpacityProperty]!==undefined) {
				return element.style[this.cssOpacityProperty];
			}
			// todo currentStyle bzw computedStyle
			return undefined;
		},

		resolveAnimFrameAPI: function() {
			// resolve vendor-specific animationFrame API
			if (!window.requestAnimationFrame) {
				var vendors = ['moz', 'webkit', 'ms', 'o'];
				for (var i=0; i<vendors.length; i++) {
					var vend=vendors[i];
					var r=window[vend+'RequestAnimationFrame'];
					if (r) {
						window.requestAnimationFrame=r;
						window.cancelAnimationFrame=
							window[vend+'CancelAnimationFrame'] ||
							window[vend+'CancelRequestAnimationFrame'];
						return;
					}
				}
			}
		}
	}
};
