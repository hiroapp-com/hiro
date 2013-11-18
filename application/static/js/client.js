var WPCLib = {
	version: '0.0.1',

	// Folio is the nav piece on the left, holding all file management pieces
	folio: {
		folioId: 'folio',
		logioId: 'logio',
		consistencychecktimer: 30000,	

		init: function() {
			// Basic Folio Setup

			// Load list of documents from server or create localdoc if user is unknown			
			if (WPCLib.sys.user.level==0) {
				// See if we can find a local doc
				var ld = localStorage.getItem('WPCdoc');
				if (ld) {
					this.docs.loadlocal(ld);
				} else {
					document.getElementById(this.docs.doclistId).innerHTML='';
					this.docs.newdoc();
				}
			} else {
				this.docs.loaddocs();
			}

			// Register "close folio" events to rest of the page
			WPCLib.util.registerEvent(document.getElementById(WPCLib.canvas.canvasId),'mouseover', WPCLib.ui.menuHide);
			WPCLib.util.registerEvent(document.getElementById(WPCLib.canvas.contentId),'touchstart', WPCLib.ui.menuHide);			
			WPCLib.util.registerEvent(document.getElementById(WPCLib.context.id),'mouseover', WPCLib.ui.menuHide);	

			// Register event that cancels the delayed opening of the menu if cursor leaves browser
			WPCLib.util.registerEvent(document,'mouseout', function(e) {
			    e = e ? e : window.event;
			    var from = e.relatedTarget || e.toElement;
			    if (!from || from.nodeName == "HTML") {
			    	if (WPCLib.ui.delayedtimeout) {
			    		clearTimeout(WPCLib.ui.delayedtimeout);
			    		WPCLib.ui.delayedtimeout = null;
			    	}
			    }			
			});				
		},

		checkconsistency: function() {
			// Pings the doc API and checks if current document is latest and no newer version on the server
			if (!WPCLib.ui.windowfocused) {
				// If the window is not focused break recursive check and resume as soon as window is focused again
				WPCLib.util._focuscallback = WPCLib.folio.checkconsistency;
				return;
			}

			// Repeat the check periodically
			setTimeout(function(){
				WPCLib.folio.checkconsistency();
			},this.consistencychecktimer);

			// If we didn't get the doclist yet, wait until next cycle
			var local = WPCLib.folio.docs;
			if (!local.active[0] && !local.archived[0]) return;

			// Get latest docs
			WPCLib.folio.docs.loaddocs(true);					
		},

		docs: {
			// All Document List interactions in seperate namespace
			doclistId: 'doclist',
			active: [],
			archived: [],
			a_counterId: 'a_counter',
			a_count: 0,
			archiveId: 'archivelist',
			archiveOpen: false,
			// Generic lookup object to easily change object properties in active/archive arrays
			lookup: {},
			unseenupdates: 0,

			loaddocs: function(folioonly) {
				// Get the list of documents from the server
				var f = WPCLib.folio.docs;	
				var a = document.getElementById(this.a_counterId);	

				$.ajax({
				    dataType: "json",
				    url: '/docs/?group_by=status',
				    timeout: 5000,
				    success: function(data) {
						// See if we have any docs and load to internal model, otherwise create a new one
						if (!data.active && !data.archived) {
							f.newdoc();
							return;
						}	
						if (data.active) f.active = data.active;
						if (data.archived) f.archived = data.archived;						
						f.update();

						// load top doc if not already on canvas (or on first load when the doc is preloaded and we have no internal values yet) 
						// also handling egde case: if a user logs in when sitting in front of an empty document
						var doc = data.active[0];
						if (data.archived && doc.updated < data.archived[0].updated) doc = data.archived[0];
						if (!folioonly && data.active && doc.id != WPCLib.canvas.docid) {
							WPCLib.canvas.loaddoc(doc.id,doc.title);
						}

						// Update the document counter
					    if (WPCLib.sys.user.level > 0) WPCLib.ui.documentcounter();	

					    // Portfolio archive counter
					    if (data.archived) {
					    	var ac = WPCLib.folio.docs.a_count = data.archived.length;
					    	a.innerHTML = 'Archive (' + ac + ')';
					    }	

						// Check our Hiroversion and initiate upgradepopup if we have a newer one
						if (!WPCLib.sys.version) { WPCLib.sys.version = data.hiroversion; }
						else if (WPCLib.sys.version != data.hiroversion) WPCLib.sys.upgradeavailable(data.hiroversion);				    

					    // Check of were offline and switch back to normal state
					    if (WPCLib.sys.status != 'normal') WPCLib.sys.backonline();
				    },
					error: function(xhr,textStatus) {
						WPCLib.sys.error(xhr);	
						if (textStatus == 'timeout') WPCLib.sys.goneoffline();					
					}
				});						
			},

			loadlocal: function(localdoc) {	
				// Load locally saved document
				var ld = JSON.parse(localdoc);					
				WPCLib.sys.log('Localstorage doc found, loading ', ld);						
				document.getElementById('landing').style.display = 'none';

				// Render doc in folio
				this.active.push(ld);
				// Fix for different namings in frontend/backend
				this.active[0].updated = ld.last_updated;
				this.update();

				// Render doc on canvas
				WPCLib.canvas.loadlocal(ld);
			},

			update: function() {
				// update the document list from the active / archive arrays
				// We use absolute pointers as this can also be called as event handler
				var that = WPCLib.folio.docs,
					act = that.active,
					docs = document.getElementById(that.doclistId),				
					arc = that.archived,
					archive = document.getElementById(that.archiveId),
					bubble = document.getElementById('updatebubble');		

				// Update our lookup object
				that.updatelookup();

				// Reset all contents and handlers
				if (docs) docs.innerHTML = '';
				if (archive) archive.innerHTML = '';
				this.unseenupdates = 0;	

				// Render all links
				for (i=0,l=act.length;i<l;i++) {		
					that.renderlink(i,'active',act[i]);	
					// iterate unseen doc counter
					if (act[i].unseen) this.unseenupdates++;					    
				}
				if (arc) {
					for (i=0,l=arc.length;i<l;i++) {		
						that.renderlink(i,'archive',arc[i]);						    
					}					
				}

				// Show bubble if we have unseen updates
				if (this.unseenupdates > 0) {
					bubble.innerHTML = this.unseenupdates;
					bubble.style.display = 'block';
				} else {
					bubble.style.display = 'none';
				}

				// Recursively call this to update the last edit times every minute
				setTimeout(WPCLib.folio.docs.update,60000);
			},

			updatelookup: function() {
				// Takes the two document arrays (active/archive) and creates a simple lookup reference object
				// Usage: WPCLib.folio.docs.lookup['79asjdkl3'].title = 'Foo'
				var docs = this.active.concat(this.archived);
				this.lookup = {};
				for (var i = 0, l = docs.length; i < l; i++) {
				    this.lookup[docs[i].id] = docs[i];			    
				}
			},

			updateunseen: function(increment) {
				// Updates the small visible counter (red bubble next to showmenu icon) and internal values
				// A negative value substracts one from the counter, a positive resets counter to value
				var i = this.unseenupdates = (increment < 0) ? this.unseenupdates + increment : increment;
				var b = document.getElementById('updatebubble');
				if (i = 0) {
					b.style.display = 'none';
					return;
				}
				if (i > 1) {
					b.innerHTML = i;
					b.style.display = 'block';
				}
			},

			renderlink: function(i,type,data) {
				// Render active and archived document link
				var item = (type=='active') ? this.active : this.archived,
					lvl = WPCLib.sys.user.level,
					docid = item[i].id,
					active = (type == 'active') ? true : false;

				var d = document.createElement('div');
				d.className = 'document shared';
				d.setAttribute('id','doc_'+docid);

				var link = document.createElement('a');
				link.setAttribute('onclick','return false;');
				link.setAttribute('href','/docs/'+docid);	

				var t = document.createElement('span');
				t.className = 'doctitle';
				t.innerHTML = item[i].title || 'Untitled Note';

				var stats = document.createElement('small');
				if (item[i].updated) {
					var statline = WPCLib.util.humanizeTimestamp(item[i].updated) + " ago";
					if (data.lastEditor) statline = statline + ' by ' + data.lastEditor;
					stats.appendChild(document.createTextNode(statline));
				} else {
					stats.appendChild(document.createTextNode('Not saved yet'))							
				}			

				link.appendChild(t);
				link.appendChild(stats);

				if (data.shared) {
					// Add sharing icon to document
					var s = document.createElement('div');
					s.className = 'sharing';
					var tooltip = 'Shared with others';	
					if (data.unseen) {
						// Show that document has unseen updates
						var sn = document.createElement('div');
						sn.className = "bubble red";
						sn.innerHTML = '*';
						s.appendChild(sn);
						tooltip = tooltip + ', just updated';					
					}			
					s.setAttribute('title',tooltip);	
					link.appendChild(s);
				}


				d.appendChild(link);	

				if (('ontouchstart' in document.documentElement)&&l >= 1) {
					d.addEventListener('touchmove',function(event){event.stopPropagation()},false);				
				} else {
					// Add archive link, only on non touch devices
					if (lvl>=1) {
						var a = document.createElement('div');
						a.className = 'archive';
						if (active) {
							WPCLib.util.registerEvent(a,'click', function(e) {WPCLib.folio.docs.archive(e,true);});	
							if (lvl==1) a.title = "Move to archive";
						} else {
							WPCLib.util.registerEvent(a,'click', function(e) {WPCLib.folio.docs.archive(e,false);});												
						}								
						d.appendChild(a);
					}
				}


				if (active) {
					// Add folio item to DOM, insert current document in beginning
					var list = document.getElementById(WPCLib.folio.docs.doclistId);
					if (docid == WPCLib.canvas.docid && list.firstChild) {
						list.insertBefore(d, list.firstChild);
					} else { list.appendChild(d); };		
				} else {	
					var list = document.getElementById(WPCLib.folio.docs.archiveId);			
					if (docid == WPCLib.canvas.docid && list.firstChild) {
						list.insertBefore(d, list.firstChild);
					} else { list.appendChild(d); };					
				}	

				var title = item[i].title || 'Untitled';			
				WPCLib.folio.docs._events(docid,title,active);				
			},

			_events: function(docid,title,active) {
				// Attach events to doc links
				WPCLib.util.registerEvent(document.getElementById('doc_'+docid).firstChild,'click', function() {
					WPCLib.folio.docs.moveup(docid,active);
					WPCLib.canvas.loaddoc(docid, title);											
				});				
			},

			creatingDoc: false,
			newdoc: function() {
				// Initiate the creation of a new document
				// Avoid creating multiple docs at once and check for user level
				if (this.creatingDoc == true) return;

				// TODO Bruno get up to speed with callback scoping & call(), in the meantime a quickfix for edge case			
				if (typeof this.active === 'undefined') return;				

				if (WPCLib.sys.user.level == 0 && this.active.length!=0) {
					WPCLib.sys.user.upgrade(1,WPCLib.folio.docs.newdoc);
					return;
				}
				if (this.active && WPCLib.sys.user.level == 1 && this.active.length >= 10) {
					WPCLib.sys.user.upgrade(2,WPCLib.folio.docs.newdoc,'Upgrade<em> now</em> for <b>unlimited notes</b><em> &amp; much more.</em>');
					return;					
				}

				// Check if the archive is open, otherwise switch view
				if (this.archiveOpen) this.openarchive();

				// All good to go
				this.creatingDoc = true;				

				// Add a doc placeholder to the internal folio array
				var doc = {};
				doc.title = 'Untitled';
				doc.created = WPCLib.util.now();
				this.active.splice(0,0,doc);

				// Render a placeholder until we get the OK from the server
				var el = document.createElement('div');
				el.className = 'document';	
				el.setAttribute('id','doc_creating');

				var ph = document.createElement('a');
				ph.setAttribute('href','#');	
				ph.setAttribute('onclick','return false;');	
				var pht = document.createElement('span');
				pht.className = 'doctitle';
				pht.innerHTML = 'Creating new note...';	
				var phs = document.createElement('small');
				phs.appendChild(document.createTextNode("Right now"))
				ph.appendChild(pht);
				ph.appendChild(phs);
				el.appendChild(ph);

				document.getElementById(this.doclistId).insertBefore(el,document.getElementById(this.doclistId).firstChild);

				// Create the doc on the canvas
				if (document.body.offsetWidth <= 900 && document.getElementById(WPCLib.context.id).style.display == "block") WPCLib.context.switchview();
				WPCLib.canvas.newdoc();
				WPCLib.ui.menuHide();

				// Get/Set ID of new document
				if ( WPCLib.sys.user.level==0) {
					// Anon user doc gets stored locally
					var doc = document.getElementById('doc_creating');
					WPCLib.sys.log('unknown user, setting up localstore ');

					// Set params for local doc
					WPCLib.canvas.docid = 'localdoc';
					WPCLib.folio.docs.active[0].id = 'localdoc';

					// Save document & cleanup
					doc.firstChild.firstChild.innerHTML = 'Untitled Note';
					doc.id = 'doc_localdoc';
				} else {
					// Request new document id
					var doc = document.getElementById('doc_creating');
					WPCLib.sys.log('known user, setting up remote store ');

					// Submit timestamp for new doc id
					var file = {};				
					file.created = WPCLib.util.now();				

					// Get doc id from server
					$.ajax({
						url: "/docs/",
		                type: "POST",
		                contentType: "application/json; charset=UTF-8",
		                data: JSON.stringify(file),
						success: function(data, status, xhr) {
		                    WPCLib.sys.log("backend issued doc id ", data);

							// Set params for local doc
							WPCLib.canvas.docid = data.doc_id;

							// Set folio values
							doc.firstChild.firstChild.innerHTML = 'Untitled Note';
							doc.id = 'doc_'+data;
							WPCLib.folio.docs.active[0].id = data;	

							// Start sync
							WPCLib.canvas.sync.begin(data.text,xhr.getResponseHeader("collab-session-id"),xhr.getResponseHeader("channel-id"));                    								

							// Update the document counter
							WPCLib.ui.documentcounter();														                    
						}
					});				
				}

				// Get ready for the creation of new documents
				this.creatingDoc = false;
			},

			movetoremote: function() {
				// Moves a doc from localstorage to remote storage and clears localstorage
				// Doublecheck here for future safety
				if (WPCLib.canvas.docid=='localdoc' && localStorage.getItem('WPCdoc')) {					
					// Strip id from file to get new one from backend
					var file = WPCLib.canvas.builddoc();					
					file.id = '';
					// Get doc id from server
					$.ajax({
						url: "/docs/",
		                type: "POST",
		                contentType: "application/json; charset=UTF-8",
		                data: JSON.stringify(file),
						success: function(data) {
		                    WPCLib.sys.log("move local to backend with new id ", data);
		                    // Delete local item
		                    localStorage.removeItem('WPCdoc')

							// Set new id for former local doc
							WPCLib.canvas.docid = data.doc_id;

							// Get updated file list
							WPCLib.folio.docs.loaddocs();								                    
						}
					});
				}
			},

			moveup: function(docid,active) {
				// moves a specific doc to the top of the list based on it's id

				// Find and remove itenm from list
				var act = WPCLib.folio.docs.active;
				var arc = WPCLib.folio.docs.archived;
				var obj = {};
				var bucket = (active) ? act : arc;
				for (var i=0,l=bucket.length;i<l;i++) {
					if (bucket[i].id != docid) continue;
					obj = bucket[i];
					bucket.splice(i,1);
					break;					
				}

				// Sort array by last edit
				bucket.sort(function(a,b) {return (a.updated > b.updated) ? -1 : ((b.updated > a.updated) ? 1 : 0);} );

				// Insert item at top of array and redraw list
				bucket.unshift(obj);			
			},

			archive: function(e,toarchive) {
				// Move a current document to the archive, first abort if user has no account with archive
				if (WPCLib.sys.user.level <= 1) {
					WPCLib.sys.user.upgrade(2,'','<em>Upgrade now to </em><b>unlock the archive</b><em> &amp; much more.</em>');
					return;
				}	

				var that = WPCLib.folio.docs;				
				var a_id = e.target.parentNode.id.substr(4);
				var act = that.active;	
				var arc = that.archived;
				var obj = {};
				var source = (toarchive) ? act : arc;
				var target = (toarchive) ? arc : act;				

				for (var i=0,l=source.length;i<l;i++) {
					// Iterate through active docs and remove the one to be archived
					if (source[i].id != a_id) continue;
					obj = source[i];					
					source.splice(i,1);
					break;					
				}

				// Insert in archive and sort by updated. Should we sort by date archived here?
				target.unshift(obj);						
				target.sort(function(a,b) {return (a.updated > b.updated) ? -1 : ((b.updated > a.updated) ? 1 : 0);} );

				// Render new list right away for snappiness
				that.update();	
				that.a_count++;
				if (toarchive) document.getElementById(that.a_counterId).innerHTML = 'Archive (' + that.a_count + ')';

				var payload = (toarchive) ? {'status':'archived'} : {'status':'active'};
				$.ajax({
					url: "/docs/"+a_id,
	                type: "PATCH",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(payload),
					success: function(data) {						
						that.update();					                   
					}
				});			
			},

			openarchive: function() {
				// Archive link
				// Show signup screen if user has no appropriate tier
				if (WPCLib.sys.user.level < 2) {
					WPCLib.sys.user.upgrade(2,'','<em>Upgrade now to </em><b>unlock the archive</b><em> &amp; much more.</em>');
					return;					
				};	

				var act = document.getElementById(this.doclistId);
				var arc = document.getElementById(this.archiveId);
				var but = document.getElementById(this.a_counterId);
				if (act.style.display=='none') {
					act.style.display = 'block';
					arc.style.display = 'none';
					but.innerHTML = 'Archive (' + this.a_count + ')';
					this.archiveOpen = false;
				} else {
					act.style.display = 'none';
					arc.style.display = 'block';	
					but.innerHTML = 'Close Archive';
					this.archiveOpen = true;					
				}				
			}
		},

		showSettings: function(section,field,event) {
			// Show settings dialog
			if (WPCLib.sys.user.level==0) {
				if (!field) {
					field = 'signup_mail';
					section = 's_signup';
				}
				if (analytics) analytics.track('Sees Signup/Sign Screen');
			} 
			WPCLib.ui.showDialog(event,'',section,field);
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
			var c = document.getElementById(WPCLib.context.id);	
			var f = document.getElementById(WPCLib.folio.folioId);
			// See if a selection is performed and narrow search to selection
			WPCLib.util.registerEvent(p,'mouseup',this.textclick);							
			WPCLib.util.registerEvent(el,'keydown',this.keyhandler);	
			WPCLib.util.registerEvent(el,'keyup',this.update);	

			// Remember last caret position on blur
			WPCLib.util.registerEvent(el,'blur',function(){
				WPCLib.canvas.caretPosition = WPCLib.canvas._getposition()[0];
			});					

			// Resizing of textarea
			WPCLib.util.registerEvent(el,'keyup',this._resize);
			WPCLib.util.registerEvent(el,'cut',this._copynpaste);	
			WPCLib.util.registerEvent(el,'paste',this._copynpaste);
			WPCLib.util.registerEvent(el,'drop',this._copynpaste);

			// Title events	
			WPCLib.util.registerEvent(t,'change',this.evaluatetitle);
			WPCLib.util.registerEvent(t,'keydown',this.evaluatetitle);
			WPCLib.util.registerEvent(t,'keyup',this.evaluatetitle);			
			WPCLib.util.registerEvent(t,'mouseover', this._showtitletip);
			WPCLib.util.registerEvent(t,'mouseout', this._hidetitletip);
			WPCLib.util.registerEvent(t,'focus', this._clicktitletip);			
			WPCLib.util.registerEvent(t,'select', this._clicktitletip);	
			WPCLib.util.registerEvent(t,'click', this._clicktitletip);		

			// We save the new title in the folio array but need to update the clickhandler without duplicating them
			WPCLib.util.registerEvent(t,'blur', WPCLib.folio.docs.update);	
			WPCLib.util.registerEvent(t,'keyup', WPCLib.folio.docs.update);			

			if ('ontouchstart' in document.documentElement) {
				// Make sure the teaxtarea contents are scrollable on mobile devices
				el.addEventListener('touchstart',function(e){
					// Attach the swipe actions to canvas	
					var cb = (WPCLib.ui.menuCurrPos != 0) ? null : WPCLib.context.switchview;			
					WPCLib.ui.swipe.init(cb,WPCLib.ui.menuSwitch,e);					
				}, false);	
				c.addEventListener('touchstart',function(e){
					// Attach the swipe actions to context					
					WPCLib.ui.swipe.init(null,WPCLib.context.switchview,e);					
				}, false);	
				f.addEventListener('touchstart',function(e){
					// Attach the swipe actions to context					
					WPCLib.ui.swipe.init(WPCLib.ui.menuHide,null,e);					
				}, false);	
				f.addEventListener('touchstart',function(e){
					// Open menu when somebody touches the grea sidebar on the left on tablets etc					
					if (WPCLib.ui.menuCurrPos == 0) WPCLib.ui.menuSwitch();				
				}, false);				
				// Make UI more stable with event listeners			
				document.getElementById('page').addEventListener('touchmove',function(e){e.stopPropagation();},false);

				// Cancel safariinit after enough time passed to focus textarea fast after that
				if (this.safariinit) setTimeout( function() { WPCLib.canvas.safariinit = false; },5000);				

			} else {
				// click on the page puts focus on textarea
				WPCLib.util.registerEvent(p,'click',function(){
					if (!WPCLib.sharing.visible) document.getElementById(WPCLib.canvas.contentId).focus();
				});
			}				

			// Always set context sidebar icon to open on mobiles
			if (document.body.offsetWidth<=900) document.getElementById('switchview').innerHTML = '&#171;';						
		},	

        set_text: function(txt) {
        	// Set all internal values and visual updates in one go
			WPCLib.canvas.text = document.getElementById(WPCLib.canvas.contentId).value = txt;
            // Resize canvas
            WPCLib.canvas._resize();               
        },

		preload: function(title,text) {
			// If flask already gave us the title and text values
			this.preloaded = true;
			this._resize();
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
			file.hidecontext = !WPCLib.context.show;
			file.links = {};
			file.links.sticky = WPCLib.context.sticky;
			file.links.normal = WPCLib.context.links;
			file.links.blacklist = WPCLib.context.blacklist;
			return file;			
		},

		savedoc: function(force) {
			// force: Boolean if status indicator should be shown
			// Save the currently open document
			// For now we only say a doc is updated once it's saved		
			var status = document.getElementById('status');
			if (WPCLib.context.overquota) force = true;
			if (force) status.innerHTML = 'Saving...';
			this.lastUpdated = WPCLib.util.now();
			var file = this.builddoc();		

			// backend saving, locally or remote
			if (this.docid != 'localdoc' && WPCLib.sys.user.level > 0) {
				// Save remotely, immediately indicate if this fails because we're offline
				if ('onLine' in navigator && !navigator.onLine) WPCLib.sys.goneoffline();
				WPCLib.sys.log('saving remotely: ', file);	
				var u = "/docs/"+this.docid, ct = "application/json; charset=UTF-8";


				// Jquery doesn't support patch requests in plenty of mobile browsers, TODO findout which ones exactly
				if ( navigator.appVersion.indexOf('BB10') == -1 ) {
					$.ajax({					
						url: u,
		                type: "PATCH",
		                contentType: ct,
		                data: JSON.stringify(file),
						success: function(data) {
		                    WPCLib.sys.log('Saved! ',data);
							WPCLib.canvas.saved = true;	 
							if (force) status.innerHTML = 'Saved!';
							if (WPCLib.sys.status != 'normal') WPCLib.sys.backonline();
						},
						error: function(xhr,textStatus) {
							WPCLib.sys.error('Savedoc PATCH returned error: ' + JSON.stringify(xhr));	
							if (textStatus == 'timeout') WPCLib.sys.goneoffline();					
						}
					});
				} else if ($.ajax) {
					$.ajax({					
						url: u,
		                type: "POST",
		                contentType: ct,
		                data: JSON.stringify(file),
						success: function(data) {
		                    WPCLib.sys.log('Saved! ',data);
							WPCLib.canvas.saved = true;	 
							if (force) status.innerHTML = 'Saved!';
							if (WPCLib.sys.status != 'normal') WPCLib.sys.backonline();							
						},
						error: function(xhr,textStatus) {
							WPCLib.sys.error('Savedoc POST returned error: ' + JSON.stringify(xhr));
							if (textStatus == 'timeout') WPCLib.sys.goneoffline();													
						}
					});					
				} else {
					var x = new XMLHttpRequest();
					x.open("PATCH", u);
					x.setRequestHeader("Content-type",ct);
					x.send(JSON.stringify(file));
				}											
			} else {
				// Store doc locally 
				
				// Add text to file object
				file.text = WPCLib.canvas.text;

				WPCLib.sys.log('saving locally: ', file);	
			    try { 
					localStorage.setItem("WPCdoc", JSON.stringify(file));
				} catch(e) {
			        alert('Please sign up to safely store long notes.');
			        WPCLib.sys.user.upgrade(1);
			    }				
				WPCLib.canvas.saved = true;	
				if (force) status.innerHTML = 'Saved!';								
			}	
			// Update last edited counter in folio
			var docs = WPCLib.folio.docs;
			var bucket = (docs.archived[0] && WPCLib.folio.docs.archiveOpen) ? docs.archived[0] : docs.active[0];	

			// Check if user didn't navigate away from archive and set last updated
			if (file.id == bucket.id) bucket.updated = WPCLib.util.now();
			WPCLib.folio.docs.update();					
		},		

		loaddoc: function(docid, title) {
			// Load a specific document to the canvas
			if (!this.saved) this.savedoc();			
			WPCLib.sys.log('loading doc id: ', docid);
			var mobile = (document.body.offsetWidth<=900);	

			// If we already know the title, we shorten the waiting time
			if (title && !this.preloaded) document.getElementById(this.pageTitle).value = document.title = title;	
			document.getElementById(WPCLib.context.statusId).value = 'Loading...';			
			WPCLib.ui.menuHide();
			if (mobile && document.getElementById(WPCLib.context.id).style.display=='block') WPCLib.context.switchview();


			// Load data onto canvas
			var file = 'docs/'+docid;
			var that = this;
			$.ajax({
				dataType: "json",
				url: file,
				success: function(data, textStatus, xhr) {
					WPCLib.canvas.docid = data.id;
					WPCLib.canvas.created = data.created;
					WPCLib.canvas.lastUpdated = data.updated;	

					// Check if the document had unseen updates		
					if (WPCLib.folio.docs.lookup[docid] && WPCLib.folio.docs.lookup[docid].unseen == true) {
						var el = document.getElementById('doc_' + docid);
						if (el) {
							var bubble = el.getElementsByClassName('bubble')[0];
							if (bubble) bubble.style.display = 'none';
						}
						WPCLib.folio.docs.lookup[docid].unseen = false;
						WPCLib.folio.docs.updateunseen(-1);
					}					

					// Update document list
					WPCLib.folio.docs.update();					

					// Change null value to '' if document header is empty		

					// Show data on canvas
					if (!mobile && data.hidecontext == WPCLib.context.show) WPCLib.context.switchview();									
					if (!title) document.getElementById(that.pageTitle).value = document.title = data.title || 'Untitled';
					var content = document.getElementById(that.contentId);
					if (!that.preloaded) {
						content.value = data.text;					
						// Reset the canvas size to document contents in the next 2 steps
						content.style.height = 'auto';					
						WPCLib.canvas._resize();
					}	
					that._setposition(data.cursor);

					// Set internal values, do not store 'null' as title string as it fucks up search
					that.text = data.text;
					that.title = (data.title) ? data.title : '';	
					that.preloaded = false;

					// Initiate syncing of file
					WPCLib.canvas.sync.begin(data.text,xhr.getResponseHeader("collab-session-id"),xhr.getResponseHeader("channel-id"));                    

					// If the document is shared then fetch the list of users who have access
					if (data.shared) WPCLib.sharing.accesslist.fetch();

					// If body is empty show a quote
					if (!data.text || data.text.length == 0) {
						WPCLib.ui.fade(document.getElementById(that.quoteId),+1,300);	
						WPCLib.util.registerEvent(document.getElementById(WPCLib.canvas.contentId),'keydown',WPCLib.canvas._cleanwelcome);						
					} else {
						WPCLib.canvas._removeblank();
					}	

					// Show default title if none was saved	
					if (!data.title || data.title.length==0) {
						document.getElementById(that.pageTitle).value = 'Untitled';
					}
						
					// Load links
					WPCLib.context.wipe();	
					WPCLib.context.clearresults();
					WPCLib.context.sticky = data.links.sticky || [];
					WPCLib.context.links = data.links.normal || [];
					WPCLib.context.blacklist = data.links.blacklist || [];	
					if (data.links.normal.length!=0) {
						WPCLib.context.renderresults();
					} else {
						WPCLib.context.search(WPCLib.canvas.title,WPCLib.canvas.text);
					}
					document.getElementById(WPCLib.context.statusId).innerHTML = 'Ready.';	
					if (WPCLib.sys.status != 'normal') WPCLib.sys.backonline();
				},
				error: function(xhr,textStatus) {
					WPCLib.sys.error(xhr);	
					if (textStatus == 'timeout') WPCLib.sys.goneoffline();						
				}
			});						
		},	

		loadlocal: function(data) {
			// Loading a local document on the canvas
			document.getElementById(this.pageTitle).value = document.title = data.title;	
			document.getElementById(this.contentId).value = data.text;
			if (data.text) {
				WPCLib.canvas._removeblank();
			} else {
				WPCLib.ui.fade(document.getElementById(this.quoteId),+1,300);	
				WPCLib.util.registerEvent(document.getElementById(WPCLib.canvas.contentId),'keydown',WPCLib.canvas._cleanwelcome);
			}								
			this._setposition(data.cursor);

			// Show default title if none was saved	
			if (!data.title || data.title.length==0) {
				document.getElementById(this.pageTitle).value = document.title ='Untitled';
			}				

			// Load links
			WPCLib.context.sticky = data.links.sticky || [];
			WPCLib.context.links = data.links.normal || [];
			WPCLib.context.blacklist = data.links.blacklist || [];	
			WPCLib.context.renderresults();
			if (WPCLib.context.show == data.hidecontext) WPCLib.context.switchview();
			document.getElementById(WPCLib.context.statusId).innerHTML = 'Welcome back!';							

			// Set internal values	
			this.text = data.text;	
			this.title = data.title;
			this.docid = data.id;
			this.created = data.created;
			this.lastUpdated = data.last_updated;						
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
			WPCLib.ui.fade(document.getElementById(this.quoteId),+1,300);			
			this.quoteShown = true;

			WPCLib.context.clearresults();
			document.getElementById(WPCLib.context.statusId).innerHTML = 'Ready to inspire.';
			this.created = WPCLib.util.now();

			// Empty the link lists & internal values
			this.title = '';
			this.text = '';
			WPCLib.context.wipe();	
			WPCLib.context.clearresults();

			WPCLib.util.registerEvent(content,'keydown',this._cleanwelcome);
			// If the landing page is loaded, don't pull the focus from it, bit expensive here, maybve add callback to newdoc later
			if (WPCLib.sys.user.level==0 && document.getElementById('landing').style.display != 'none') {
				var el = document.getElementById('landing').contentDocument.getElementById('startwriting');
				if (el) el.focus();
			} else {
				document.getElementById(WPCLib.canvas.contentId).focus();				
			} 							
		},


		_titletiptimer: null,
		_showtitletip: function() {	
			// Show an encouraging title and indicitae that title can be changed here
			WPCLib.canvas._titletiptimer = setTimeout(function(){
				var title = document.getElementById(WPCLib.canvas.pageTitle);	
				var tip = ('ontouchstart' in document.documentElement) ? '' : WPCLib.canvas.titleTip;
				WPCLib.canvas.tempTitle = title.value;			
				if (!title.value || title.value.length == 0 || title.value == "Untitled" || title.value == WPCLib.canvas.defaultTitle) title.value = tip;					
			},200);								
		},

		_hidetitletip: function() {
			// Revert title back to previous state
			clearInterval(WPCLib.canvas._titletiptimer);
			WPCLib.canvas._titletiptimer = null;
			var title = document.getElementById(WPCLib.canvas.pageTitle);	
			var tip = WPCLib.canvas.titleTip;	
			if (title.value==tip) {
				title.value = WPCLib.canvas.tempTitle;
			}
		},

		_clicktitletip: function(event) {
			event.stopPropagation();
			var title = document.getElementById(WPCLib.canvas.pageTitle);
			if (title.value==WPCLib.canvas.titleTip) title.value = '';	
		},	

		evaluatetitle: function(event) {
			// When the title changes we update the folio and initiate save
			// If user presses enter or cursor-down automatically move to body	
			var k = event.keyCode;
		    if ( k == 13 || k == 40 ) {
				event.preventDefault();
		        WPCLib.canvas._setposition(0);
		    }

			// Do not proceed to save if the shift,alt,strg or a navigational key is pressed	
			var keys = [16,17,18,33,34,35,36,37,38,39,40];	
			if (keys.indexOf(k) > -1) return;	

			// Update internal values and Browser title			
			WPCLib.canvas.title = WPCLib.folio.docs.lookup[WPCLib.canvas.docid].title = document.title = this.value;
			if (!this.value) document.title = 'Untitled';

			// Visually update name in portfolio right away
			var el = document.getElementById('doc_'+WPCLib.canvas.docid);			
			if (el) el.firstChild.firstChild.innerHTML = this.value;			

			// Initiate save & search
			WPCLib.canvas._settypingtimer();

		},

		_cleanwelcome: function() {
			// Remove welcome teaser etc which was loaded if document was blank
			var el = document.getElementById(WPCLib.canvas.contentId);		
			WPCLib.ui.fade(document.getElementById('nicequote'),-1,500);
			WPCLib.util.releaseEvent(el,'keydown',WPCLib.canvas._cleanwelcome);
			WPCLib.canvas.quoteShown = false;
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
			WPCLib.canvas.evaluate();			
		},		

		_resize: function() {
			// Resize canvas textarea as doc grows
			// TODO: Consider cut/copy/paste, fix padding/margin glitches
			var w = document.body.offsetWidth
			var midi = (w > 480 && w <900) ? true : false;
		    var text = document.getElementById(WPCLib.canvas.contentId);   
		    if (midi) {
		    	text.style.height = (text.scrollHeight-100)+'px';
		    } else {
		    	text.style.height = (text.scrollHeight-50)+'px';
		    }
		},

		_copynpaste: function() {
			// on copy and paste actions					
	        window.setTimeout(WPCLib.canvas._resize, 0);

	        window.setTimeout(function(){
	        	// Some browser fire c&p events with delay, without this we would copy the old values
	        	var that = WPCLib.canvas;
		        // Set internal variables
		        that.text = document.getElementById(that.contentId).value;
		        that.title = document.getElementById(that.pageTitle).value;
				that.caretPosition = that._getposition()[1];		        

		        // Save Document
				WPCLib.context.search(that.title,that.text);	        
                if (!WPCLib.canvas.sync.inited) { that.savedoc() } else { WPCLib.canvas.sync.addedit(); }
	        }, 100);
		},

		keyhandler: function(e) {
			// Various actions when keys are pressed
			var k = e.keyCode;

			// Tab key insert 5 whitespaces
			if (k==9) WPCLib.canvas._replacekey(e,'tab');

			// Space and return triggers brief analysis, also sends an edit to the internal sync stack
			if (k==32||k==13||k==9) {
				WPCLib.canvas._wordcount();	
                if (!WPCLib.canvas.sync.inited) { WPCLib.canvas.savedoc() } else { WPCLib.canvas.sync.addedit(); }
			}

			// See if user uses arrow-up and jump to title if cursor is at position 0
			if (k == 38) {
				var p = WPCLib.canvas._getposition();
				if (p[0] == p[1] && p[0] == 0) {
					document.getElementById(WPCLib.canvas.pageTitle).focus();
				}
			}	

			//					
		},

		_replacekey: function(e,key) {
			// Replace default key behavior with special actions
			var pos = this._getposition()[1];		
			var src = document.getElementById(WPCLib.canvas.contentId); 				
			if (key == 'tab') {	
	            WPCLib.util.stopEvent(e);				
	            src.value = WPCLib.canvas.text = [src.value.slice(0, pos), '\t', src.value.slice(pos)].join('');
	            // We have to do this as some browser jump to the end of the textarea for some strange reason		
	            document.activeElement.blur();
	            WPCLib.canvas._setposition(pos+1);        
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
				WPCLib.sys.log('new chars typed: ',this.newChars);
				// WPCLib.sys.savetext(this.text);
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
				WPCLib.sys.log('new words');
				this.newWords = 0;	
			} 
			this.wordcount = cw;
		},

		_settypingtimer: function() {
			// set & clear timers for saving and context if user pauses
			if (this.typingTimer) clearTimeout(this.typingTimer);
			this.typingTimer = setTimeout(function() {				
				WPCLib.context.search(WPCLib.canvas.title,WPCLib.canvas.text);					
				WPCLib.canvas._cleartypingtimer();

				// Add edit if user is logged in
				if (WPCLib.canvas.sync.inited) WPCLib.canvas.sync.addedit();
				// Save doc without text (as this is now done by sync)
				WPCLib.canvas.savedoc();				
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
			WPCLib.sys.log('Words: ' + this.wordcount + " Lines: " + this.linecount + " Pos: " + pos);			
		},

		textclick: function() {
			// when text is clicked
			var sel = WPCLib.canvas._getposition();
			if (sel[0] != sel[1]) WPCLib.context.search(WPCLib.canvas.title,sel[2],true);
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

		_setposition: function(pos) {
			// Set the cursor to a specified position	
			if (!pos) pos = (this.caretPosition < this.text.length) ? this.caretPosition : 0;

			// Check of we do have a proper array, otherwise fall pack to scalar
			if (Object.prototype.toString.call(pos) == '[object Array]') {
				var pos1 = pos[0], pos2 = pos[1];				
			} else {
				var pos1 = pos2 = pos;				
			}	

			var el = document.getElementById(WPCLib.canvas.contentId);	

			// Abort if focus is already on textarea
			if (el && el.id == document.activeElement.id) return;  			

    		// Abort if device is mobile (body or landscape) and menu not fully closed yet or text length is larger than visible area   		
    		if ('ontouchstart' in document.documentElement && (document.body.offsetWidth <= 480 || document.body.offsetHeight <= 480)) {
    			if (WPCLib.ui.menuCurrPos!=0 || el.value.length > 150) return;   			
    		};   		

    		// Unfocus any existing elements
    		document.activeElement.blur();
    		this._resize();

    		// Set the position
    		if (el.setSelectionRange) {
				if (window.navigator.standalone && this.safariinit) {		
					// Mobile standalone safari needs the delay, because it puts the focus on the body shortly after window.onload
					// TODO Bruno findout why, it's not about something else setting the focus elsewhere						
					setTimeout( function(){
						if (WPCLib.ui.menuCurrPos!=0) return;
						el.focus();							
						el.setSelectionRange(pos1,pos2);	
						WPCLib.canvas.safariinit = false;										
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
		},

		sync: {
			// Differential syncronisation implementation https://neil.fraser.name/writing/sync/
			shadow: '',
			edits: [],
			localversion: 0,
			remoteversion: 0,
			enabled: false,
			sessionid: undefined,
			connected: false,
			channel: null,
			channelToken: undefined,
			socket: undefined,
			inited: false,

			init: function() {
				// Abort if we're on the production system or sync was already inited
				if (WPCLib.sys.production || this.inited) {
					return;
				}

				// Create new diff_match_patch instance once all js is loaded, retry of not
				if (!this.dmp && typeof diff_match_patch != 'function') {
					setTimeout(function(){
						WPCLib.canvas.sync.init();
					},100);
					return;
				}
				this.dmp = new diff_match_patch();			

                // Set internal value
				this.enabled = true;	                
                this.inited = true;
            },

			begin: function(text,sessionid,token) {
				// Reset state, load values from new doc and initiate websocket		
				this.reset();

				// Set internal values
				this.channelToken = token;
                this.shadow = text;
                this.sessionid = sessionid;


                if (this.connected) { 
                	// This will trigger a reconnect with the new token we set above
                	this.socket.close();
                } else { 
                	// First time we just open the channel
                	this.openchannel(token) 
                };
			},

			reset: function() {
				// Reset sync state
				this.shadow = '';
				this.edits = [];
				this.localversion = 0;
				this.remoteversion = 0;
			},

			addedit: function(force) {
				// Add an edit to the edits array
				var c = WPCLib.canvas.text, s = this.shadow, edit = {};

				// If we'Re inflight then wait for callback
				if (this.inflight) {
					this.inflightcallback = WPCLib.canvas.sync.addedit;
					return;
				}	

				// Abort if the string stayed the same or syncing is disabled
				if (!force && (!this.enabled || c == s)) return;

				// Build edit object, right now including Patch and simple diff string format, TODO Choose one
				edit.delta = this.delta(s,c); 
				edit.clientversion = this.localversion++;
				edit.serverversion = this.remoteversion;

				// Add edit to edits stack
				this.edits.push(edit);
				this.shadow = c;

				// Initiate sending of stack
				this.sendedits();
			},

			inflight: false,
			inflightcallback: null,
			sendedits: function() {
				// Post current edits stack to backend and clear stack on success
                if (this.edits.length == 0 || this.inflight) {
                	// if we do not have any edits
                    return;
                }

                if (!WPCLib.canvas.docid) {
                	// If we don't have a docid yet try again later
                	setTimeout( function(){
                		WPCLib.canvas.sync.sendedits();
                	},500);
                	return;
                }

                // See if we're connected to Channel API and try to recover if not (precaution, case not seen yet)
                if (!this.connected && this.channelToken) this.openchannel(this.channelToken);

                // Set variable to prevent double sending
                this.inflight = true;
                WPCLib.sys.log('Starting sync with data: ',JSON.stringify(this.edits));

                // Post editstack to backend
                $.ajax({
                    url: "/docs/"+WPCLib.canvas.docid+"/sync",
                    type: "POST",
                    contentType: "application/json",
                    data: JSON.stringify({"session_id": this.sessionid, "deltas": this.edits}),
                    success: function(data) {
                        if (data.session_id != WPCLib.canvas.sync.sessionid) {
                            WPCLib.sys.log("TODO: session-id mismatch, what to do?");
                            return;
                        }

                        WPCLib.sys.log('Completed sync request successfully ',JSON.stringify(data.deltas));

                        // process the edit-stack received from the server
                        WPCLib.canvas.sync.process(data.deltas);
                        // Reset inflight variable
                        WPCLib.canvas.sync.inflight = false;
                        if (WPCLib.canvas.sync.inflightcallback) {
                        	WPCLib.canvas.sync.inflightcallback();
                        	WPCLib.canvas.sync.inflightcallback = null;
                        }		
                    },
                    error: function(data) {
                        WPCLib.sys.log('Completed sync request with error ',data);
                        // Reset inflight variable
                        WPCLib.canvas.sync.inflight = false;  
                        if (WPCLib.canvas.sync.inflightcallback)  {
                        	WPCLib.canvas.sync.inflightcallback();
                        	WPCLib.canvas.sync.inflightcallback = null;
                        }		

                    }
                });				
			},
            
            process: function(stack) {
            	// Process one or multiple edit responses we get as response from the sync server
                var len = stack.length;
                for (var i=0; i<len; i++) {
                    var edit = stack[i];

                    // clear server-ACK'd edits from client stack
                    if (this.edits) {
                        this.edits = $.grep(this.edits, function(x, idx) { return (x.clientversion > edit.serverversion)})
                    }                    

                    if (edit.force === true) {
                        // resync of document enforced by server, complying
                        // TODO: test encaps needed?
                        // *untested*
                        WPCLib.sys.log("server enforces resync, complying");
                        this.shadow = edit.delta;
                        this.localversion = edit.clientversion;
                        this.remoteversion = edit.serverversion;
                        this.edits = [];
                        WPCLib.canvas.set_text(edit.delta);                     
                        continue;
                    }
                    if (edit.clientversion > this.localversion) {
                        WPCLib.sys.log("TODO: client version mismatch -- resync");
                        WPCLib.sys.log("cv(server): " + edit.clientversion +" cv(client): " +this.localversion);
                        continue;
                    } 
                    else if (this.remoteversion < edit.serverversion) {
                        WPCLib.sys.log("TODO: server version ahead of client -- resync");
                        continue;
                    }
                    else if (this.remoteversion > edit.serverversion) {
                        //dupe
                        WPCLib.sys.log("dupe received");
                        continue;
                    }
                    var diffs;
                    try {
                        diffs = this.dmp.diff_fromDelta(this.shadow, edit.delta);
                        this.remoteversion++;
                        WPCLib.sys.log("Diffs applied successfully");
                        WPCLib.sys.log("serverversion(client): " + this.remoteversion);
                    } catch(ex) {
                        WPCLib.sys.log("TODO: cannot merge received delta into shadow -- resync");
                        continue;
                    }
                    if (diffs && (diffs.length != 1 || diffs[0][0] != DIFF_EQUAL)) {
                        var patch = this.dmp.patch_make(this.shadow, diffs);
                        this.shadow = this.dmp.patch_apply(patch, this.shadow)[0];
                        var old = WPCLib.canvas.text;
                        var merged = this.dmp.patch_apply(patch, old);
                        if (old != merged[0]) {
                            WPCLib.sys.log("patches merged, replacing text");
                            WPCLib.canvas.set_text(merged[0]);                            
                        }
                        else{
                            WPCLib.sys.log("no changes merged, nothing happened");
                        }
                    }
                }
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
			},

			openchannel: function(token) {
				// Open Appengine Channel or Diff match patch wasn't loaded yet
				if (!goog.appengine.Channel || !this.dmp) {
					// Retry if channel API isn't loaded yet
					setTimeout(function(){
						WPCLib.canvas.sync.openchannel(token);
						return;
					},200);
				}

				if (this.connected) {
					// If we already have a proper connection then kill it
					this.socket.close();
					return;
				}

				if (token) {
					// Store token if we should need it later					
					this.channelToken = token;
				} else {
					// Try to recover with last known token if we don't have one
					token = this.channelToken;
					if (!this.channelToken) WPCLib.sys.error('Tried to connect but no channel token available');
				}

				// Create new instance of channel object
                this.channel = new goog.appengine.Channel(token),
                this.socket = this.channel.open();
                this.socket.onopen = function() {
                    WPCLib.sys.log("connected to channel api");
                    WPCLib.canvas.sync.connected = true;
                }
                this.socket.onmessage = function(data) {
                    WPCLib.canvas.sync.on_channel_message(JSON.parse(data.data));
                }                
                this.socket.onerror = function() {
                    WPCLib.sys.log("ERROR connecting to channel api");
                }
                this.socket.onclose = function() {
                    WPCLib.sys.log("Channel closed.");
					WPCLib.canvas.sync.channel = WPCLib.canvas.sync.socket = null;
					WPCLib.canvas.sync.connected = false;	                    
                    WPCLib.canvas.sync.reconnect(WPCLib.canvas.sync.channelToken);                  
                }			
			},		

            on_channel_message: function(data) {
            	// Receive and process notification of document update
            	var el = WPCLib.folio.docs.lookup[data.doc_id];              	
            	el.updated = WPCLib.util.now();  
                el.lastEditor = data.user; 

                if (data.doc_id == WPCLib.canvas.docid) {
                	// If the update is for the current document
                	// As we don't have a "send/request blank" yet, we trigger a then blank diff
                	// TODO: Think of a better way
                    WPCLib.canvas.sync.addedit(true);
                } else {
                	// If the update is for a doc in folio thats not currently open
                	// Update internal values and update display
                	el.unseen = true;
                }

                // Display the updates in the DOM
                WPCLib.folio.docs.update(true);                
            },			

			reconnect: function(token) {
				// If the connection dropped or the user loaded a new document we start a new one
				WPCLib.sys.log('Reconnecting to Channel backend with token: ',token);

				// Create new connection
				this.openchannel(token);			
			}
		}
	},	

	sharing: {
		// Share a Note with other users
		id: 'sharing',
		visible: false,
		openTimeout: null,

		init: function() {
			// Bind basic events
			if ('ontouchstart' in document.documentElement) {
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('div')[0],'touchstart', WPCLib.sharing.open);
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[0],'touchstart', WPCLib.sharing.close);				
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[1],'touchstart', WPCLib.sharing.submit);				
			} else {
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('div')[0],'mouseover', WPCLib.sharing.open);
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[0],'click', WPCLib.sharing.close);			
				WPCLib.util.registerEvent(document.getElementById(this.id).getElementsByTagName('a')[1],'click', WPCLib.sharing.submit);
				// Register event that cancels the delayed opening of the options
				WPCLib.util.registerEvent(document.getElementById(this.id),'mouseout', function() {
					var that = WPCLib.sharing;
				    if (that.openTimeout && !that.visible) {
					    clearTimeout(that.openTimeout);
						that.openTimeout = null;
				    }		
				});	
			}						
		},

		open: function(event) {
			// Open the sharing snippet with a delayed timeout		
			var that = WPCLib.sharing;			
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}	
			if (that.visible) return;

			// Kick off timeout 
			if (!that.openTimeout) {
				// Add a slight delay
				that.openTimeout = setTimeout(function(){								
					var that = WPCLib.sharing;
					that.open();										
					that.openTimeout = null;
					clearTimeout(that.openTimeout);															
				},150);
				// Get the latest list of people who have access
				that.accesslist.fetch();				
				return;
			}
			that.visible = true;				
			var widget = document.getElementById('s_actions').parentNode;
			widget.style.display = 'block';

			// Set focus to input field
			var email = document.getElementById(WPCLib.sharing.id).getElementsByTagName('input')[0];		
			if (email) email.focus();				
		},

		close: function(event) {
			// Close the sharing widget
			var that = WPCLib.sharing;
			// Check if we have a timeout and remove & abort if so 
			if (!that.visible) return;
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}				
			
			var widget = document.getElementById('s_actions').parentNode;
			that.visible = false;
			widget.style.display = 'none';
			WPCLib.canvas._setposition();			
		},

		submit: function(event) {
			// Submit form
			var email = document.getElementById(WPCLib.sharing.id).getElementsByTagName('input')[0];
			var button = document.getElementById(WPCLib.sharing.id).getElementsByTagName('a')[1];
			if (event) {
				event.preventDefault();
				event.stopPropagation();
			}			
			if (WPCLib.sys.user.level < 1) {
				WPCLib.sys.user.upgrade(1);
				return;			
			}

			// Check for proper email
			var regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
			if (!regex.test(email.value)) {
				email.focus();
				email.nextSibling.innerHTML = "Invalid address";
				email.style.border = '1px solid rgba(209, 11, 11, 0.7)';
				button.innerHTML = "Try again";
				return;
			}

			if (WPCLib.sys.production) {
				email.parentNode.parentNode.innerHTML ="<div class='title light'>Sorry, at the moment this feature is only available to a few users. We'll notify you as soon as it's ready. Sorry again & won't be long!</div>"
				if (analytics && WPCLib.sys.user.level > 0) analytics.identify(WPCLib.sys.user.id, {sharingNotes:'true'});
				var msg = ('Wants to invite: ' +  email.value);
				WPCLib.sys.error(msg);
			} else {
				WPCLib.sharing.accesslist.add(email.value);
			}
		},

		accesslist: {
			// Mostly visual functionality for the sharing widget on the current document
			users: [],
			el: document.getElementById('accesslist'),

			add: function(email) {
				// Add a user to the current editor list
				var url = '/docs/' + WPCLib.canvas.docid + '/perms',
					payload = {'email': email },
					el = document.getElementById('s_actions'),
					input = el.getElementsByTagName('input')[0],
					button = el.getElementsByTagName('a')[0],
					d = document.createElement('div'),
					that = this;

				// Retry later if we don't have a docid yet
				if (!WPCLib.canvas.docid) {
					setTimeout(function() {
						WPCLib.sharing.accesslist.add(email);
						return;
					},500);
				}	

				// Visual updates	
				d.className = 'user';
				d.innerHTML = 'Inviting ' + email.split('@')[0].substring(0,18) + '...';
				this.el.insertBefore(d,this.el.firstChild);

                $.ajax({
                	// Post to backend
                    url: url,
                    type: "POST",
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify(payload),
                    success: function(data) {                    	
                    	input.value = '';
                    	input.focus();
                    	button.innerHTML = 'Invite next';
                    	// that.fetch();
                    },
                    error: function(data) {
                    	input.focus();           
                    	button.innerHTML = 'Invite';
                    	WPCLib.sys.error(data);
                    	input.nextSibling.innerHTML('')
                    }
                });				
			},

			remove: function(event) {
				// Remove a user from the current editor list
				var target = event.target || event.srcElement,
					uid = target.parentNode.id.split('_').pop(),
					currentuser = (uid == WPCLib.sys.user.id),
					that = WPCLib.sharing.accesslist,
					u = that.users;

				for (i=0,l=u.length;i<l;i++) {
					// Iterate through user list array in remove user object if found
					if (u[i].id != uid) continue;
					u.splice(i, 1);
					that.update();
					if (currentuser) WPCLib.folio.docs.loaddocs();
					break;
				}	

				// TODO Coordinate with flo how to post this to backend, do anew fetch on successfull post
			},

			update: function() {
				// Update list of users who currently have access
				// Empty current DOM element
				this.el.innerHTML = '';

				for (i=0,l=this.users.length;i<l;i++) {
					// Create and attach each link to the DOM
					this.el.appendChild(this.renderuser(this.users[i]));
				}
			},

			renderuser: function(user) {
				// Create a user DOM element and return it
				var d, r, n,
					currentuser = (user.id == WPCLib.sys.user.id),
					lastaccess = (user.last_edit >= 0) ? 'Last seen ' + WPCLib.util.humanizeTimestamp(user.last_edit) + " ago" : 'Invited';

				d = document.createElement('div');
				d.id = 'user_' + user.id;
				d.className = 'user';
				if (!currentuser) d.setAttribute('title', lastaccess);

				if (!user.owner) {
					// Add remove link if user is not owner					
					r = document.createElement('a');
					r.className = 'remove';
					var rt = (currentuser) ? 'Revoke your own access' : 'Revoke access';
					r.setAttribute('title',rt);

					// Attach events
					if ('ontouchstart' in document.documentElement) {
						r.setAttribute('ontouchstart',"WPCLib.sharing.accesslist.remove(event);");
					} else {
						r.setAttribute('onclick',"WPCLib.sharing.accesslist.remove(event);");
					}

					d.appendChild(r);
				}

				// Add user name span
				n = document.createElement('span');
				n.className = 'name';
				n.innerHTML = (currentuser) ? 'You' : user.email;
				d.appendChild(n)

				// Return object
				return d;
			},

			fetch: function() {
				if (WPCLib.sys.production) return;

				// Retry later if we don't have a docid yet
				if (!WPCLib.canvas.docid) {
					setTimeout(function() {
						WPCLib.sharing.accesslist.fetch();
						return;
					},500);
				}

				// Retrieve the list of people who have access, this is trigger by loaddoc and opening of the sharing widget
				var url = '/docs/' +  WPCLib.canvas.docid + '/perms';
				$.ajax({
                    url: url,
                    contentType: "json",
                    success: function(data) {
                    	// Set internal values and update visual display
                    	var that = WPCLib.sharing.accesslist;
                    	that.users = data.users;
                        that.update();
                    }
                });
			}
		}		

	},

	publish: {
		// Publishing functionality (publish a Note to an external service)
		id: 'publish',
		actionsId: 'p_actions',
		initTimeout: null,
		listvisible: false,
		showListTimeout: null,
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
				var def = WPCLib.publish.actions.gdrive;
				if (def.authed) return;	
				// TODO: This callback triggers a non-click-event-stack popup -> Not seen the first		
		        gapi.auth.authorize({'client_id': def.client_id, 'scope': def.scope, 'immediate': false},WPCLib.lib.collectResponse.google);				
			}
		},

		init: function() {
			// if we hover over the publish icon, the event handlers are attached via canvas init
			// show list of actions after n msec
			var icon = document.getElementById(this.id).getElementsByTagName('div')[0];
			if ('ontouchstart' in document.documentElement) {
				WPCLib.util.registerEvent(icon,'touchstart',WPCLib.publish.list);
			} else {
				WPCLib.util.registerEvent(icon,'mouseover',WPCLib.publish.list);				
			}
		},

		list: function() {
			// Create a list of available actions
			var actions = WPCLib.publish.actions;
			var container = document.getElementById(WPCLib.publish.actionsId);
			var level = WPCLib.sys.user.level;

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
							a.setAttribute('ontouchstart',"WPCLib.publish.execute(event,'"+action+"');");
						} else {
							a.setAttribute('onclick',"WPCLib.publish.execute(event,'"+action+"');");
						}
					} else {
						if (level == 0) {
							a.setAttribute('title','Signup to publish');								
							a.setAttribute('onclick',"WPCLib.sys.user.upgrade(1);return false;");														
						} else {
							a.setAttribute('title','Upgrade');
							a.setAttribute('onclick',"WPCLib.sys.user.forceupgrade(2,'<em>Upgrade now for </em><b>basic publishing</b>.');");					
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
						var sel = WPCLib.canvas._getposition();
						var text = (sel[2].length > 0) ? sel[2] : document.getElementById(WPCLib.canvas.contentId).value;
						text = text.trim();					
						a.setAttribute('href','mailto:?subject='+encodeURIComponent(document.getElementById(WPCLib.canvas.pageTitle).value)+'&body='+encodeURIComponent(text));
					}

					// Add to container
					container.appendChild(a);
			   }
			}
		},

		show: function() {
			if ((event.relatedTarget || event.toElement) == this.parentNode) clearinfo();
		},

		execute: function(event,type) {
			// Click on a publishing action
			// Prevent the selection from losing focus
			if (event) {
				event.preventDefault();
				event.stopPropagation();
				WPCLib.util.stopEvent(event);
				var target = event.target || event.srcElement;				
			}			

			// Collect title and text, see if we have an active selection
			var title = document.getElementById(WPCLib.canvas.pageTitle).value;
			var sel = WPCLib.canvas._getposition();
			var text = (sel[2].length > 0) ? sel[2] : document.getElementById(WPCLib.canvas.contentId).value;
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
			var pos = WPCLib.publish.actions[service].id - 1;
			var target = event.target || event.srcElement;
			var el = (target) ? target : document.getElementById(WPCLib.publish.id).getElementsByTagName('a')[pos];
			el.className = 'action doing';
			el.innerHTML = 'Publishing';					

			// Prevent double clicks etc
			WPCLib.publish.actions[service].publishing = true;

			// Filepicker.io flow									
			var options = {filename: title+'.txt',mimetype: 'text/plain'};			
			title = (title) ? title : 'Untitled';					
			filepicker.store(text,options,function(data){
				// We succesfully stored the file, next upload it to various services
				// Clear and load dialog into frame
				var frame = document.getElementById('dialog').contentDocument;
				if (frame) {
					frame.body.innerHTML = '';
					WPCLib.ui.showDialog();					
				}				
				var payload = {openTo: WPCLib.publish.actions[service].fpservicename};
				payload.services = ['DROPBOX','GOOGLE_DRIVE','BOX','SKYDRIVE','EVERNOTE'];	
				payload.suggestedFilename = title;
				payload.container = 'dialog';
				if (document.body.offsetWidth<=480) {
					payload.mobile = true;
				}										
				filepicker.exportFile(data.url,payload,function(data){
					// Yay, completed & successful
					WPCLib.ui.hideDialog();
			    	WPCLib.ui.statusflash('green','Published on your '+WPCLib.publish.actions[service].name+'.'); 
					WPCLib.publish.actions[service].publishing = false;
					var el = (target) ? target : document.getElementById(WPCLib.publish.id).getElementsByTagName('a')[pos];	
					el.className = 'action done';		
					el.innerHTML = WPCLib.publish.actions[service].name;	
				},function(data){
					// Some error occured while creating the file
					WPCLib.publish.actions[service].publishing = false;						
					// WPCLib.sys.error(data);	
				});						
			},function(data){
				// Some error occured while creating the file
				WPCLib.publish.actions[service].publishing = false;						
				WPCLib.sys.error(data);	
			});				
		}
	},

	// Context is the link bar on the right
	context: {
		sticky: [],
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
			var c = document.getElementById(WPCLib.context.id);
			var can = document.getElementById(WPCLib.canvas.canvasId);
			var sw = document.getElementById('switchview');
			var mobile = (document.body.offsetWidth<=480);
			var midi = (document.body.offsetWidth<=900);
			var menu = WPCLib.ui.menuCurrPos * -1;
			// Check if the context is supposed to be open (always start with closed context on mobile and never save changes)
			if (mobile) document.activeElement.blur();
			if ((!midi&&WPCLib.context.show)||(midi&&c.style.display=='block')) {
				c.style.display = 'none';
				can.className += " full";								
				sw.innerHTML = '&#171;';
				sw.className = ''
				if (!mobile||!midi) WPCLib.context.show = false;
			} else {
				c.style.display = 'block';
				can.className = "canvas";			
				sw.innerHTML = '&#187;';
				sw.className = 'open'
				if (!mobile||!midi) {
					WPCLib.context.show = true;
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
            document.getElementById(this.statusId).innerHTML = 'Saved, but search quota reached.';			
			if (msg.innerHTML == '') {				
				document.getElementById(this.wwwresultsId).innerHTML = document.getElementById(this.synresultsId).innerHTML = '';
				var txt = (WPCLib.sys.user.level == 1) ?
					'<a href="#" class="msg" onclick="WPCLib.sys.user.forceupgrade(2,\'<em>Upgrade now to enjoy </em><b>unlimited searches</b><em> and much more.</em>\'); return false;"><em>Upgrade now</em> for unlimited searches & more.</a>' :
					'<a href="#" class="msg" onclick="WPCLib.sys.user.upgrade(1); return false;"><em>Sign up now</em> for more searches.</a>';
				document.getElementById(this.msgresultsId).innerHTML = txt;
			}
		},

		analyze: function(string, chunktype) {
			// Send text to server for analysis, returning text chunks
			string = string || (WPCLib.canvas.title + ', ' + WPCLib.canvas.text);
			document.getElementById(this.statusId).innerHTML = 'Saving & Analyzing...';
			$.post('/analyze', {content: string}, 
			function(data){
	            WPCLib.context.chunksearch(data,chunktype);
	        });
		},		

		chunksearch: function(data,chunktype) {
			// Search with specific chunks returned from analyzer above
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
                $.ajax({
                    url: "/relevant",
                    type: "POST",
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify(postData),
                    success: function(data) {
                        WPCLib.context.storeresults(data.results);
                        WPCLib.context.renderresults();		             
                        document.getElementById(that.statusId).innerHTML = 'Ready.';
                    }
                });				
			} else {
					document.getElementById(this.statusId).innerHTML = 'Nothing interesting found.';
			}
		},


		search: function(title,text,textonly) {
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
			var saved = WPCLib.canvas.saved;
			var level = WPCLib.sys.user.level;
			document.getElementById(this.statusId).innerHTML = (!saved || level == 0) ? 'Saving & Searching...' : 'Searching...';				

			// Handle short strings for synonym search, first find out how many words we have and clean up string
			var ss = string.replace(/\r?\n/g," "); 
			ss = ss.replace(/\t/g," ");
			ss = ss.replace(/,/g," ");			
			ss = ss.replace(/\s{2,}/g," ");
			ss = ss.trim();
			if (ss.length > 0 && ss.split(' ').length == 1) {
				// Search synonyms for single words
				$.ajax({
				    url: 'https://words.bighugelabs.com/api/2/' + that.synKey + '/' + ss + '/json',
				    type: 'GET',
				    dataType: "jsonp",
				    success: function(data) {
				    	if (!WPCLib.context.overquota) WPCLib.context.rendersynonyms(data,ss);				    	
				    }
				});
				// Set the range of the documents to be replace to selection, or full document if it's only one word
				var sel = WPCLib.canvas._getposition();
				this.replacementrange = (sel[0] == sel[1]) ? [0,WPCLib.canvas.text.length,WPCLib.canvas.text] : sel;
				this.replacementword = ss;
			} else {
				this.replacementrange = [];
				document.getElementById(this.synresultsId).innerHTML = '';
			}

			// Find context links from Yahoo BOSS						
            $.ajax({
                url: "/relevant",
                type: "POST",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(payload),
                error: function(data) {
                	switch (data.status) {
                		case 402: 
                			WPCLib.context.quotareached();
                			break;
                		default:
                			WPCLib.sys.error(data);	
                	}
                },           
                success: function(data) {
                    WPCLib.context.storeresults(data.results);
                    WPCLib.context.renderresults();		             
                    document.getElementById(that.statusId).innerHTML = (saved && level > 0) ? 'Ready.' : 'Saved.';                   
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
			WPCLib.sys.log('Synonyms: ',data);

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
			var source = WPCLib.canvas.text;
			var oldpos = this.replacementrange;
			var oldword = this.replacementword;
			var newword = target.innerHTML;

			// replace internal and visual selection with new string
			WPCLib.canvas.set_text(source.slice(0,oldpos[0]) + oldpos[2].replace(oldword,newword) + source.slice(oldpos[1]));
			
			// update the replacementrange values		
			this.replacementrange[1] = oldpos[1] + (newword.length - oldword.length);
			this.replacementrange[2] = oldpos[2].replace(oldword,newword);

			// Update selection
			var newselection = [oldpos[0],this.replacementrange[1]];
			WPCLib.canvas._setposition(newselection);

			// update inetrnal value to new word
			this.replacementword = newword;

			// Save updated document
			WPCLib.canvas.savedoc(true);			
		},

		renderresults: function() {
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
			if (this.links.length == 0 && WPCLib.sys.user.level <= 1) {
				var tip = document.createElement('div');
				tip.className = 'tip';
				tip.innerHTML = 'Tip: Select a single word or just a part of your text to narrow your search.';
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
			var l = (WPCLib.sys.user.level < 2);
			e.className = (sticky) ? 'result sticky' : 'result';

			if (!sticky) {
				var del = document.createElement('a');
				del.className = 'delete action';
				del.setAttribute('href','#');
				if (l) del.setAttribute('title','Delete (do not show this link again for this document)');				
				del.setAttribute('onclick','WPCLib.context.blacklistLink(this); return false;');	
				e.appendChild(del);	

				var st = document.createElement('a');
				st.className = 'stick action';
				st.setAttribute('href','#');
				if (l) st.setAttribute('title','Pin (save link with document)');				
				st.setAttribute('onclick','WPCLib.context.makesticky(this); return false;');					
				e.appendChild(st);							
			}	

			if (sticky) {
				var us = document.createElement('a');
				us.className = 'unstick action';
				us.setAttribute('href','#');
				if (l) us.setAttribute('title','Unpin (stop saving this link with this document)');					
				us.setAttribute('onclick','WPCLib.context.unstick(this); return false;');				
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
				if (WPCLib.sys.user.level!=0) e.addEventListener('touchmove',function(event){event.stopPropagation()},false);
				// Attach seperate class to avoid switch to have styles when finger flicks over
				e.className += ' touch';				
			}				
			return e;
		},

		blacklistLink: function(el) {
			// Blacklist the current result
			var link = el.parentNode;

			// FInd the URL, this is a bit suboptimal as it breaks with dom changes
			var url = link.getElementsByTagName("a")[2].getAttribute("href");
			this.blacklist.push(url);

			// We do not need to render the links again in this case, just pop the node
			link.parentNode.removeChild(link);

			// Save document
			WPCLib.canvas.savedoc();			
		},

		makesticky: function(el) {
			// Make a link sticky
			var result = el.parentNode;
			// WPCLib.ui.fade(result,-1,300);

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
			WPCLib.canvas.savedoc();
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
			WPCLib.canvas.savedoc();						
		}
	},

	// External libraries & extensions
	lib: {
		inited: false,
		// Stash list of auth responses here
		googleResponse: null,
		facebookResponse: null,
		// API Keys
		filepickerKey: 'AET013tWeSnujBckVPeLqz',		

		collectResponse: {
			google: function(response) {
				// Didn't figure out how to do callbacks with initial response
				WPCLib.lib.googleResponse = response;	
				// Let publishing actions know where good to go
				if (response && !response.error) {
					var gd = WPCLib.publish.actions.gdrive;
					gd.authed = true;
					// See if we have any callback waiting
					if (gd.callback) gd.callback();
					// Manually fire the upload, TODO Bruno: Switch that to proper callbacks
					WPCLib.publish.execute(null,'gdrive');
				}
			}
		},

		init: function() {
			if (this.inited) return;
			// kick off segment.io sequence, only on our domain 
			if (WPCLib.sys.production) {
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

				// Load all libs handeled by segment.io (Intercom, Google Analytics, Sentry)	
				analytics.load("64nqb1cgw1");
			}	

			// Mount & init facebook
			(function(d, s, id){
			 var js, fjs = d.getElementsByTagName(s)[0];
			 if (d.getElementById(id)) {return;}
			 js = d.createElement(s); js.id = id;
			 js.src = "https://connect.facebook.net/en_US/all.js";
			 fjs.parentNode.insertBefore(js, fjs);
			}(document, 'script', 'facebook-jssdk'));	

			// Init Google APIs
			//  (function() {
			//    var gd = document.createElement('script'); gd.type = 'text/javascript'; gd.async = true;
			//    gd.src = 'https://apis.google.com/js/client.js?onload=handleClientLoad';
			//    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(gd, s);
			//  })();		

			// Load filepicker.io
			(function(a){if(window.filepicker){return}var b=a.createElement("script");b.type="text/javascript";b.async=!0;b.src=("https:"===a.location.protocol?"https:":"http:")+"//api.filepicker.io/v1/filepicker.js";var c=a.getElementsByTagName("script")[0];c.parentNode.insertBefore(b,c);var d={};d._queue=[];var e="pick,pickMultiple,pickAndStore,read,write,writeUrl,export,convert,store,storeUrl,remove,stat,setKey,constructWidget,makeDropPane".split(",");var f=function(a,b){return function(){b.push([a,arguments])}};for(var g=0;g<e.length;g++){d[e[g]]=f(e[g],d._queue)}window.filepicker=d})(document); 
			filepicker.setKey(this.filepickerKey);

			// Add trim to prototype
			if (!String.prototype.trim) {
			  String.prototype.trim = function () {
			    return this.replace(/^\s+|\s+$/g, '');
			  };
			}	

			// Load Googles Diff Match Patch and Channel API
			if (!WPCLib.sys.production) {
				(function(d, s, id){
					var js, fjs = d.getElementsByTagName(s)[0];
					if (d.getElementById(id)) {return;}
					js = d.createElement(s); js.id = id;
					js.src = "/static/js/diff_match_patch.js";
					fjs.parentNode.insertBefore(js, fjs);
				}(document, 'script', 'diff_match_patch'));	

				(function(d, s, id){
					var js, fjs = d.getElementsByTagName(s)[0];
					if (d.getElementById(id)) {return;}
					js = d.createElement(s); js.id = id;
					js.src = "/_ah/channel/jsapi";
					fjs.parentNode.insertBefore(js, fjs);
				}(document, 'script', 'channel_api'));					
			}					

			this.inited = true;
		}
	},

	// All system related vars & functions
	sys: {
		version: '',
		online: true,
		status: 'normal',
		production: (window.location.href.indexOf('hiroapp') >= 0),
		language: 'en-us',
		saved: true,
		settingsUrl: '/settings/',
		settingsSection: '',
		statusIcon: document.getElementById('switchview'),
		normalStatus: document.getElementById('status'),
		errorStatus: document.getElementById('errorstatus'),			

		// Bootstrapping
		initCalled: false,
		setupDone: false,
		setupTasks: [],
		setupTimer: null,

		init: function() {
			// allow this only once			
			if (this.initCalled) return;
			WPCLib.ui.resolveAnimFrameAPI();

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
			WPCLib.util.windowfocus();			

			// Prevent browser window elasticity onotuch devices
			if ('ontouchstart' in document.documentElement) {
				document.addEventListener('touchmove',function(e) {e.preventDefault();},false);			
			}

			// Add events that should be called when DOM is ready to the setupTask queue
			this.onstartup( function() {
				WPCLib.canvas._init();
				// Remove address bar on mobile browsers
				window.scrollTo(0,1);
				// Load settings into dialog
				WPCLib.ui.loadDialog(WPCLib.sys.settingsUrl);  										  							
			});		

			// Check for any hashed parameters
			var string = window.location.hash.substring(1);
			if (string.length > 1) {
				var p = string.split(/=|&/);
				if (p.indexOf('reset') > -1) {
					WPCLib.sys.user.showreset(p[p.indexOf('reset') + 1]);
				}
			} 

			// Add keyboard shortcuts
			WPCLib.util.registerEvent(document,'keydown', WPCLib.ui.keyboardshortcut);

			// Init remaining parts
			WPCLib.folio.init();
			WPCLib.publish.init();
			WPCLib.sharing.init();
			this.initCalled=true;
		},

		_DOMContentLoadedCallback: function() {
			document.removeEventListener( 'DOMContentLoaded', this._DOMContentLoadedCallback, false);
			document.removeEventListener( 'load', this._loadCallback, false);
			WPCLib.sys._setup();
		},
		_onreadystatechangeCallback: function() {
			// IE<9
			if (document.readyState=='complete') {
				document.detachEvent('onreadystatechange',  this._DOMContentLoadedCallback);
				document.detachEvent( 'load', this._loadCallback);
				this.setupTimer=window.setTimeout( function() { WPCLib.sys._setup(); }, 250 );
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
			WPCLib.sys._setup();
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

		goneoffline: function() {
			// Triggered if an AJAX requests return textStatus == timeout
			if ('onLine' in navigator && !navigator.onLine) this.online = false;
			this.status = 'offline';
			var reason = (this.online) ? 'Server not available' : 'No internet connection',
				es = this.errorStatus,
				si = this.statusIcon;

			// Visual updates
			this.normalStatus.style.display = 'none';
			es.style.display = 'block';
			es.innerHTML = reason;
			si.className = 'error';
			si.innerHTML = '!';

			// Log error (to be switched off again, just to see how often this happens)
			this.error('Gone offline, ' + reason);
		},

		backonline: function() {
			// Swicth state back to online and update UI
			if ('onLine' in navigator && navigator.onLine) this.online = true;			
			if (this.status == 'normal') return;
			this.status = 'normal';
			var mo = WPCLib.context.show,
				es = this.errorStatus,
				si = this.statusIcon;			

			// Visual updates
			this.normalStatus.style.display = 'block';
			es.style.display = 'none';
			si.className = (mo) ? 'open' : '';			
			si.innerHTML = (mo) ? '&#187;' : '&#171;';			
		},

		error: function(data) {
			// Pipe errors into Sentry
			if ('Raven' in window) Raven.captureMessage('General Error: ' + JSON.stringify(data) + ', ' + arguments.callee.caller.toString());
			WPCLib.sys.log('Dang, something went wrong: ',data);
		},

		log: function(msg,payload) {
			// Log console if we're not on a production system
			if (!WPCLib.sys.production) {
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
				if (WPCLib.canvas.typing || WPCLib.sys.status != 'normal') {
					setTimeout(function(){WPCLib.sys.upgradeavailable(newversion)},15000);
					return;
				}	

				// If the doc isn't saved yet, rather save one time too often
				if (!WPCLib.canvas.saved) WPCLib.canvas.savedoc(true);

				// Trigger popup with location.reload button
				WPCLib.ui.showDialog(null,'','s_upgrade');		

				// Log to check how often this is used
				WPCLib.sys.error('Forced upgrade triggered: ' + ov.toString() + ' to '+ nv.toString());		
			};
		},

		user: {
			id: '',
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

				// Clear any old error messages
				val[0].nextSibling.innerHTML = '';
				val[1].nextSibling.innerHTML = '';				
				error.innerHTML = '';

				// Send request to backend
				$.ajax({
					url: "/register",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                data: payload,
					success: function(data) {
						WPCLib.sys.user.authed('register',data,'Email');												                    
					},
					error: function(xhr) {
	                    button.innerHTML = "Create Account";
	                    WPCLib.sys.user.authactive = false;						
						if (xhr.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							if (Raven) Raven.captureMessage('Signup error for: '+ payload.email);							
							return;
						}
						var et = JSON.parse(xhr.responseText); 
	                    if (et.email) {
	                    	val[0].className += ' error';
	                    	val[0].nextSibling.innerHTML = et.email;
	                    }	
	                    if (et.password) {
	                    	val[1].className += ' error';	                    	
	                    	val[1].nextSibling.innerHTML = et.password;  
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
				if (WPCLib.sys.user.authactive) return;
				WPCLib.sys.user.authactive = true;				
				button.innerHTML ="Logging in...";

				// Clear any old error messages
				val[0].nextSibling.innerHTML = '';
				val[1].nextSibling.innerHTML = '';				
				error.innerHTML = '';					
				// Send request to backend		
				$.ajax({
					url: "/login",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                data: payload,
					success: function(data) {
						WPCLib.sys.user.authed('login',data);						                    
					},
					error: function(xhr) { 												
	                    button.innerHTML = "Log-In";
	                    WPCLib.sys.user.authactive = false;						
						if (xhr.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							if (Raven) Raven.captureMessage('Signup error for: '+ payload.email);							
							return;
						}
						var et = JSON.parse(xhr.responseText); 
	                    if (et.email) {
	                    	val[0].className += ' error';
	                    	val[0].nextSibling.innerHTML = et.email[0];
	                    }	
	                    if (et.password) {
	                    	val[1].className += ' error';	                    	
	                    	val[1].nextSibling.innerHTML = et.password;  
	                    }	               		                                    
					}										
				});	
				return false;
			},

			authed: function(type, user, method) {
				// On successfull backend auth the returned user-data 
				// from the various endpoints and finishes up auth process
            	WPCLib.sys.user.setStage(user.tier);
            	this.justloggedin = true;           	

            	if (WPCLib.canvas.docid=='localdoc' && !localStorage.getItem('WPCdoc')) {
            		// Remove empty document if user signs up / in right away            		
            		WPCLib.folio.docs.active.length = 0;
            	}

                // Check for and move any saved local docs to backend
                if (WPCLib.canvas.docid=='localdoc' && localStorage.getItem('WPCdoc')) {
                	WPCLib.folio.docs.movetoremote();
                } else {
	                // Always load external docs as register endpoint can be used for existing login
					WPCLib.folio.docs.loaddocs();	
                }	

                // Render results to attach new scroll event handlers on mobile devices
                if ('ontouchstart' in document.documentElement) {
                	WPCLib.context.renderresults();
                }

                // See if we have a callback waitin
                if (this.signinCallback) WPCLib.util.docallback(this.signinCallback);			

                // Suggest upgrade after initial registration or just hide dialog
                if (user.tier==1&&type=='register') {
                	WPCLib.ui.statusflash('green','Welcome, great to have you!');
                	this.forceupgrade(2,'Unlock <b>more features</b><em> right away</em>?');
                } else {
                	WPCLib.ui.hideDialog();	
                }

                // Track signup (only on register, we also only pass the method variable then)
                if (analytics) {
                	if (type=='register') {
                		// Submit the referring url of the registration session 
                		// (hackish timeout to make sure we get proper user token from settings template, but works fine atm)
                		var logreferrer = setTimeout(function(){
                			analytics.identify(WPCLib.sys.user.id, {referrer: document.referrer});
                		},2000);
                	}
	                if (type=='register' && method) {
	                	analytics.track('Registers',{method:method});
	                } else if (type == 'login' || type == 'reset') {
	                	analytics.track('Logs back in');
	                }	                	
                }

                // Update document counter
				WPCLib.ui.documentcounter();                

                // Housekeeping, switch authactive off
                WPCLib.sys.user.authactive = false;
			},	


			requestreset: function(event) {
				// Checks if there is a valid mail address and sends a password request for it
				var email = document.getElementById('dialog').contentDocument.getElementById('loginform').getElementsByTagName('input')[0];
				var error = document.getElementById('dialog').contentDocument.getElementById('loginerror');

				// Check if there's any input at all
				if (email.value.length<=5) {
					email.className += ' error';
					email.focus();
					error.innerHTML = 'Please enter your email address and click "Lost Password?" again.';
					return;
				}

				// Prevent event from firing
				if (event) event.preventDefault();

				// Prepare posting
				error.innerHTML = '';
				var payload = { email: email.value.toLowerCase().trim() };

				// Send request to backend
				$.ajax({
					url: "/reset_password",
	                type: "POST",
	                contentType: "application/x-www-form-urlencoded",
	                data: payload,
					success: function() {
						error.innerHTML = 'Reset instructions sent, please check your email inbox.';	                    
					},
					error: function(xhr) {				
						if (xhr.status==500) {
							error.innerHTML = "Something went wrong, please try again.";
							return;
						}
						if (xhr.status==404) {
							email.className += ' error';							
							email.nextSibling.innerHTML = xhr.responseText;
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
			    	WPCLib.ui.statusflash('green','Please log out to reset your password.'); 	
			    	return;				
				}

				// Store token
				this.resetToken = hash;

				// Perform iframe actions
				var frame = document.getElementById('dialog');
				frame.onload = function() {
					var landing = document.getElementById('landing');
					if (landing) WPCLib.ui.fade(landing,-1,150);					
					WPCLib.ui.showDialog(null,'','s_reset','new_password');
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
					WPCLib.ui.switchView(frame.getElementById('s_signin'));
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
				$.ajax({
					url: url,
	                type: "POST",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(payload),
					success: function(data) {
						WPCLib.sys.user.authed('reset',data);	                    
					},
					error: function(data) {               		                    
						if (data.status = 404) {
							WPCLib.sys.user.redoTokenRequest = true;
							button.innerHTML = 'Request New Reset';
							pwd1.disabled = true;
							pwd2.disabled = true;
							error.innerHTML = 'Your reset link expired, please request a new one.';
						}	                  	  
					}										
				});				
			},

			logio: function() {
				if (this.level==0) WPCLib.folio.showSettings('s_signin','signin_mail');				
				else this.logout();
			},	

			logout: function() {
				// Simply log out user and reload window
				WPCLib.ui.fade(document.body,-1,400);
				$.ajax({
					url: "/logout",
	                type: "POST",
					success: function(data) {
	                    window.location.href = '/';							                    
					}									
				});				

			},	

			setStage: function(level) {
				// Show / hide features based on user level, it's OK if some of that can be tweaked via js for now
				level = level || this.level;

				var results = document.getElementById(WPCLib.context.resultsId);
				var signupButton = document.getElementById(WPCLib.context.signupButtonId);
				var logio = document.getElementById(WPCLib.folio.logioId);
				var publish = document.getElementById(WPCLib.publish.id);
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
					case 1:
					case 2:	
					case 3:				
						results.style.overflowY = 'auto';
						results.style.bottom = 0;
						results.style.marginRight = '1px';
						results.style.paddingRight = '2px';						
						signupButton.style.display = 'none';
						logio.className = 'logio logout';
						logio.getElementsByTagName('a')[0].title = 'Logout';
						logio.getElementsByTagName('span')[0].innerHTML = 'Logout';	
						WPCLib.canvas.preloaded = false;

						// Init sync capabilities
						if (!WPCLib.canvas.sync.inited) WPCLib.canvas.sync.init();	

						// Kick of consitency checker 
                        // XXX(flo): disabled b/c weird gae-500
						//WPCLib.folio.checkconsistency();				
						break;	
				}	

				// Show correct upgrade/downgrade buttons
				WPCLib.ui.setplans(level);			
			},

			upgrade: function(level,callback,reason,event) {
				if (this.level==0) {
					// If user is not loggedin yet we show the regsitration first
					// TODO Refactor dialog & login flow to enable callback without going spaghetti
					if (!event) event = null;
					this.signinCallback = callback;
					WPCLib.ui.showDialog(event,'','s_signup','signup_mail');
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
				WPCLib.ui.showDialog(event,'','s_settings');	
				WPCLib.ui.showDialog(event,'','s_plan');

				// Do the intended action that triggered upgrade, this confuses most users atm
				// if (this.upgradeCallback) WPCLib.util.docallback(this.upgradeCallback);				
			},

			checkoutActive: false,
			upgradeto: '',
			checkout: function() {
				if (analytics) analytics.track('Initiates Checkout');				
				// handles the complete checkout flow from stripe and our backend
				var frame = document.getElementById('dialog').contentDocument;
				var Stripe = document.getElementById('dialog').contentWindow.Stripe;
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
							WPCLib.sys.user.checkoutActive = false;
							checkoutbutton.innerHTML = "Try again";
							if (Raven) Raven.captureMessage ('CC check gone wrong: '+JSON.stringify(response));							
							return;
						} else {
							// add new stripe data to subscription object
							subscription.stripeToken = response.id;		
							WPCLib.sys.user._completecheckout(subscription);							
						}				
					});					
				} else {
					this._completecheckout(subscription);
				}
			},

			_completecheckout: function(subscription) {
				// Get the data from the checkout above and post data to backend / cleanup ui 
				var tier = (subscription.plan == "starter") ? 2 : 3;				
				if (analytics) analytics.track('Upgraded (Paid Tier)',{oldTier:WPCLib.sys.user.level,newTier:tier});				
				$.ajax({
					url: "/settings/plan",
	                type: "POST",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(subscription),
					success: function(data) {
						document.getElementById('dialog').contentDocument.getElementById('checkoutbutton').innerHTML = "Upgrade";
	                    WPCLib.sys.user.setStage(data.tier);	
	                    WPCLib.sys.user.checkoutActive = false;	
						document.activeElement.blur();
	                    WPCLib.ui.hideDialog();				                    
	                    WPCLib.ui.statusflash('green','Sucessfully upgraded, thanks!');						                    
					},
	                error: function(data) {
						if (Raven) Raven.captureMessage ('Checkout gone wrong: '+JSON.stringify(data));		                	
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
				if (analytics) analytics.track('Downgrades',{oldTier:WPCLib.sys.user.level,newTier:box});				

				// All styled, getting ready to downgrade
				var payload = {plan:targetplan};
				this.downgradeActive = true;
				$.ajax({
					url: "/settings/plan",
	                type: "POST",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(payload),
					success: function(data) {
	                    WPCLib.sys.user.setStage(data.tier);	
	                    WPCLib.sys.user.downgradeActive = false;	
	                    WPCLib.ui.hideDialog();	                    
	                    WPCLib.ui.statusflash('green','Downgraded, sorry to see you go.');					                    
					}
				});					
			}
		},
	},

	// generic communication with backend
	comm: {},

	// Generic utilities
	util: {

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
					WPCLib.sys.log('',e);
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
			}
			if (e.stopPropagation) {
				e.stopPropagation();
			}
			e.returnValue = false;
			e.cancelBubble = true;
		},

		windowfocus: function() {
		    var hidden = "hidden";
		    var that = WPCLib.util;

		    // Standards:
		    if (hidden in document)
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
	        var focus = WPCLib.ui.windowfocused = (e.type in eMap) ? eMap[e.type] : ((WPCLib.ui.windowfocused) ? false : true); 
	        if (focus && WPCLib.util._focuscallback) {
	        	WPCLib.util._focuscallback();
	        	WPCLib.util._focuscallback = null;	        	
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
		menuContextRight: 0,
		menuSlideSpan: 301,
		menuSlideDuration: 200,
		menuCurrPos: 0,
		menuSlideCurrDirection: 0,
		menuSlideTimer: 0,
		menuHideTimer: 0,	
		modalShieldId: 'modalShield',
		dialogWrapperId: 'dialogWrapper',
		dialogDefaultWidth: 750,
		dialogDefaultHeight: 480,
		dialogTimer: null,
		dialogOpen: false,
		windowfocused: true,

		keyboardshortcut: function(e) {
			// Simple event listener for keyboard shortcuts	
			var k = e.keyCode, that = WPCLib.ui;		
			if ( e.ctrlKey || e.metaKey ) {
				if (k == 83) {
					// Ctrl+s
					WPCLib.canvas.savedoc(true);
		    		e.preventDefault();											
				}
				if (k == 78) {
					// Ctrl + N, this doesn't work in Chrome as chrome does not allow access to ctrl+n 
					WPCLib.folio.docs.newdoc();	
		    		e.preventDefault();									
				}					
		    }

		    // Close dialog on escape
		    if (k == 27 && that.dialogOpen) that.hideDialog();
		},

		loadDialog: function(url) {
			// (pre)load a special URL into our settings iframe
			var d = document.getElementById(this.dialogWrapperId);
			var frame = d.getElementsByTagName('iframe')[0];
			frame.src = url;
		},

		showDialog: function(event,url,section,field,width,height) {
			// Show a modal popup 
			var s = document.getElementById(this.modalShieldId);
			var d = document.getElementById(this.dialogWrapperId);
			var frame = document.getElementById('dialog').contentDocument;			
			if (event) WPCLib.util.stopEvent(event);

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
				WPCLib.ui.switchView(el);
				// Supports either a field id or finds the first input if boolean is provided	
				if (field) {
					document.activeElement.blur();
					// On some mobile browser the input field is frozen if we don't focus the iframe first	
					// iOS 7 input fields freeze if they are autofocused & then touched, thus no autofocus on touch devices for now 			 
					// if ('ontouchstart' in document.documentElement) document.getElementById('dialog').contentWindow.focus();								
					if (typeof field == 'boolean') el = el.getElementsByTagName('input')[0];													
					if (typeof field == 'string') el = frame.getElementById(field);
					if (el && !('ontouchstart' in document.documentElement)) el.focus();																
				}					
			}	

			// Recenter on window size changes
			WPCLib.util.registerEvent(window, 'resize', this._centerDialog);
			if(!('ontouchstart' in document.documentElement)) this.dialogTimer = window.setInterval(this._centerDialog, 200);

			// Attach clean error styling (red border) on all inputs, only if we load settings
			var inputs = frame.getElementsByTagName('input');
			for (i=0,l=inputs.length;i<l;i++) {
				WPCLib.util.registerEvent(inputs[i], 'keydown', this.cleanerror);
				WPCLib.util.registerEvent(inputs[i], 'keydown', this.autoconfirm);				
			}

			// Set internal value
			this.dialogOpen = true;
		},

		autoconfirm: function(event) {
		    if (event.keyCode == 13) {
		        this.parentNode.getElementsByClassName('pseudobutton')[0].click();
		    }			
		},		

		hideDialog: function() {
			// Hide the current dialog
			var s = document.getElementById(this.modalShieldId);
			var d = document.getElementById(this.dialogWrapperId);
			var frame = d.getElementsByTagName('iframe')[0];

			// remove resize clickhandler & timer
			if (this.dialogTimer) {
				window.clearInterval(this.dialogTimer);
				this.dialogTimer=null;
				WPCLib.util.releaseEvent(window, 'resize', this._centerDialog);				
			}

			// Hide shield & dialog
			if ('ontouchstart' in document.documentElement) {
				document.activeElement.blur();
			}			
			s.style.display = 'none';
			d.style.display = 'none';


			// Put focus back on document 
			if (!('ontouchstart' in document.documentElement)) WPCLib.canvas._setposition();

			// If we do not have the settings dialog, load this one back in and abort ebfore doing settings specific stuff
			if (!document.getElementById('dialog').contentDocument || document.getElementById('dialog').contentDocument.location.href.split('/')[3] != 'settings') {
				frame.src = '/settings/';
				return;
			}		

			// Remove input field handlers
			var inputs = document.getElementById(frame.id).contentDocument.getElementsByTagName('input');
			for (i=0,l=inputs.length;i<l;i++) {
				WPCLib.util.releaseEvent(inputs[i], 'keydown', this.cleanerror);
				WPCLib.util.releaseEvent(inputs[i], 'keydown', this.autoconfirm);					
			}			

			// reset the frame
			if (WPCLib.sys.user.justloggedin) {
				frame.src = frame.src;
				WPCLib.sys.user.justloggedin = false;
			} else {
				// Depending on user level switch to register or account overview
				if (WPCLib.sys.user.level==0) {
					this.switchView(document.getElementById('dialog').contentDocument.getElementById('s_login'));
					this.switchView(document.getElementById('dialog').contentDocument.getElementById('s_signup'));				
				} else {
					this.switchView(document.getElementById('dialog').contentDocument.getElementById('s_settings'));
					this.switchView(document.getElementById('dialog').contentDocument.getElementById('s_account'));	
				}
			}

			// See if we had a forced upgrade header
			var plan = document.getElementById('dialog').contentDocument.getElementById('s_plan');
			if (plan) {
				var head = plan.getElementsByTagName('div');				
				if (head[0].style.display=='block') {
					var checkout = document.getElementById('dialog').contentDocument.getElementById('s_checkout').getElementsByTagName('div');
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
					WPCLib.ui.setplans(level);
				},250);
				return;				
			}
			var boxes = container.getElementsByClassName('box');
			if (!level) level = WPCLib.sys.user.level;

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
	            name: 'Hiro.',
	            caption: 'https://www.hiroapp.com',
	            description: "Hiro is a safe place to write down your ideas: It's extremely fast, beautifully designed and works on all your devices.",
	            actions: {
	                name: 'Start writing',
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
			WPCLib.sys.user.upgradeto = plan;			
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
			var s = document.getElementById(WPCLib.ui.modalShieldId);
			var d = document.getElementById(WPCLib.ui.dialogWrapperId);
			d.style.left= Math.floor((s.offsetWidth - d.offsetWidth)/2-10) +'px';
			d.style.top= Math.floor((s.offsetHeight - d.offsetHeight)/2-10) +'px';
		},

		menuSwitch: function() {	
			// Handler for elements acting as open and close trigger
			var mp = WPCLib.ui.menuCurrPos;

			// On touch devices we also remove the keyboard
			if ('ontouchstart' in document.documentElement) {
				if (document.activeElement.id == WPCLib.canvas.contentId && mp == 0) document.activeElement.blur();
			}

			if (mp==0) {
				// Open left folio menu
				WPCLib.ui.menuSlide(1);
				// Hide sharing dialog on mobile devices
				if (WPCLib.sharing.visible && (document.body.offsetWidth<480)) WPCLib.sharing.close();
			}	
			if (mp!=0) {
				// Close left folio menu
				WPCLib.ui.menuSlide(-1);
			}	
		},

		delayedtimeout: null,
		menuSlide: function(direction, callback, delayed) {
			if (delayed && !this.delayedtimeout && this.menuCurrPos == 0 ) {
				// Add a slight delay
				this.delayedtimeout = setTimeout(function(){					
					var that = WPCLib.ui;
					that.delayedtimeout = null;
					that.menuSlide(direction,'',false);					
				},55);
				return;
			}
			var startTime, duration, x0, x1, dx, ref;
			var canvas = document.getElementById('canvas');
			var context = document.getElementById('context');
			var switcher = document.getElementById('switchview');		
			var title = document.getElementById('pageTitle');		
			var publish = document.getElementById(WPCLib.publish.id);	
			var sharing = document.getElementById(WPCLib.sharing.id);					
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

		menuHide: function() {
			var that = WPCLib.ui;			
			if (that.delayedtimeout) {
				clearInterval(that.delayedtimeout);
				that.delayedtimeout = null;
			}	
			if (('ontouchstart' in document.documentElement) && WPCLib.ui.menuCurrPos != 0) {
				// Prevent delayed dragging of menu or setting focus
				if (event) event.preventDefault();
			}			
			if (this.menuHideTimer) {
				clearTimeout(this.menuHideTimer);				
			}
			this.menuHideTimer = setTimeout(function(){that.menuSlide(-1);},1);			
		},

		swipe: {
			start_x: 0,
			start_y: 0,
			active: false,
			callback_left: null,
			callback_right: null, 

			init: function(left,right,e) {
				if (WPCLib.ui.menuCurrPos > 0 && WPCLib.ui.menuCurrPos < 200) return;		
	    		if (e.touches.length == 1) {
	    			var that = WPCLib.ui.swipe, el = e.target;
	    			that.callback_left = left;	
	    			that.callback_right = right;		    			    			
	    			that.start_x = e.touches[0].pageX;
	    			that.start_y = e.touches[0].pageY;
	    			that.active = true;
					el.addEventListener('touchmove', WPCLib.ui.swipe.move, false);
	    			setTimeout(function(){
	    				that.active = false;
						that.callback_left = null;
						that.callback_right = null;		    				
	    				that.cancel(el);
	    			},100);
	    		}
			},
			move: function(e) {
				var that = WPCLib.ui.swipe;
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
				var that = WPCLib.ui.swipe;
				if (!that.start_x) return;
				el.removeEventListener('touchmove', WPCLib.ui.swipe.move);
				that.start_x = null;
				that.active = false;			
			}
		},

		switchView: function(elementOrId, display, userCallback) {
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
		},

		cleanerror: function() {
			// remove the CSS class error from object
			if (this.className) this.className = this.className.replace(' error', '');
		},

		statusflash: function(color,text) {
			// briefly flash the status in a given color or show alert on mobile
			if ('ontouchstart' in document.documentElement) {
				// As the sidebar is mostly hidden on mobiles we show an alert, but give the menu a bit to adapt
				setTimeout(function(){
					alert(text);				
				},250);				
				return;
			}
			var status = document.getElementById('status');
			status.innerHTML = text;
			if (color=='green') color = '#055a0b';
			status.style.color = color;
			setTimeout(function(){
				status.style.color = '#999';				
			},5000);
		},

		documentcounter: function() {
			// Updates the field in the settings with the current plan & document count
			var val, level = WPCLib.sys.user.level, upgradelink; 
			var target = (document.getElementById('dialog').contentDocument) ? document.getElementById('dialog').contentDocument.getElementById('s_account') : null;
			var doccount = WPCLib.sys.user.doccount = (WPCLib.folio.docs.archived.length > 0) ? WPCLib.folio.docs.archived.length + WPCLib.folio.docs.active.length : WPCLib.folio.docs.active.length;
			
			if (!target) {
				// If the settings dialog is not loaded yet try again later 
				setTimeout(function(){
					WPCLib.ui.documentcounter();			
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
				if (WPCLib.folio.docs.active) val = val + doccount;

				// See if we have plan limits or mobile device
				if (level < 2) val = val + ' of 10';
				
				target.getElementsByTagName('input')[2].value = val + ' notes';
			}
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
