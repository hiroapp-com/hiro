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

			// Make sure the scrollbar is also visible on small devices
			if (document.body.offsetWidth<=350) document.getElementById(this.docs.doclistId).style.width = (document.body.offsetWidth-107)+'px';	
		},

		checkconsistency: function() {
			// Pings the doc API and checks if current document is latest and no newer version on the server
			var latest = {};
			var latestlocal = {};
			var current = WPCLib.canvas.docid;
			var currentremote = {};
			var local = WPCLib.folio.docs;
			if (!WPCLib.ui.windowfocused) {
				// If the window is not focused break recursive check and resume as soon as window is focused again
				WPCLib.util._focuscallback = WPCLib.folio.checkconsistency;
				return;
			}

			// Repeat the check periodically
			setTimeout(function(){
				WPCLib.folio.checkconsistency();
			},this.consistencychecktimer);

			// Get latest doc
			$.getJSON('/docs/?group_by=status', function(data) {
				// Find the current doc in the returned data
				var docs = data.active;
				for (var key in docs) {
					if (docs.hasOwnProperty(key)) {
						if (docs[key].id == current) currentremote = docs[key];
					}
				}	

				// Prepare all other data for comparison
				if (WPCLib.sys.user.level > 1 && data.archived) {
					// Make sure the current document is not in the archive
					var docs = data.archived;
					for (var key in docs) {
						if (docs.hasOwnProperty(key)) {
							if (docs[key].id == current) currentremote = docs[key];
						}
					}					
					// check if an active or archived doc is the latest edited
					latest = (data.archived[0].updated > data.active[0].updated) ? data.archived[0] : data.active[0];
					latestlocal = (local.archived[0].updated > local.active[0].updated) ? local.archived[0] : local.active[0];
				} else {
					latest = data.active[0];
					latestlocal = local.active[0];
				}			

				if (currentremote.id == WPCLib.canvas.docid && currentremote.updated > WPCLib.canvas.lastUpdated) {
					// If there's a newer version of the current document
					console.log('Newer version on server detected, loading now');
					WPCLib.canvas.loaddoc(latest.id,latest.title);					
					WPCLib.folio.docs.loaddocs(true);
				}					

				// There is a more recent document in the collection, but we only update the folio then				
				if (latest.updated > latestlocal.updated) {
					WPCLib.folio.docs.loaddocs(true);					
				}				
			});
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

			loaddocs: function(folioonly) {
				// Get the list of documents from the server
				var f = WPCLib.folio.docs;	
				var a = document.getElementById(this.a_counterId);			
				$.getJSON('/docs/?group_by=status', function(data) {

					// See if we have any docs and load to internal model, otherwise create a new one
					if (!data.active && !data.archived) f.newdoc();
					if (data.active) f.active = data.active;
					if (data.archived) f.archived = data.archived;						
					f.update();

					// load top doc if not already on canvas, currently this should only be the 
					// case if a user logs in when sitting in front of an empty document
					if (!folioonly && data.active && data.active[0].id != WPCLib.canvas.docid) {
						WPCLib.canvas.loaddoc(data.active[0].id,data.active[0].title);
					}

					// Update the document counter
				    if (WPCLib.sys.user.level > 0) WPCLib.ui.documentcounter();	

				    // 
				    if (data.archived) {
				    	var ac = WPCLib.folio.docs.a_count = data.archived.length;
				    	a.innerHTML = 'Archive (' + ac + ')';
				    }	
				});
			},

			loadlocal: function(localdoc) {	
				// Load locally saved document
				console.log(localdoc);
				var ld = JSON.parse(localdoc);					
				console.log('Localstorage doc found, loading ', ld);						
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
				var that = WPCLib.folio.docs;
				var act = that.active;
				var docs = document.getElementById(that.doclistId);				
				var arc = that.archived;
				var archive = document.getElementById(that.archiveId);					

				// Reset all contents and handlers
				docs.innerHTML = archive.innerHTML = '';	

				// Render all links
				for (i=0,l=act.length;i<l;i++) {		
					that.renderlink(i,'active');						    
				}
				if (arc) {
					for (i=0,l=arc.length;i<l;i++) {		
						that.renderlink(i,'archive');						    
					}					
				}

				// Recursively call this to update the last edit times every minute
				setTimeout(WPCLib.folio.docs.update,60000);
			},

			renderlink: function(i,type) {
				// Render active and archived document link
				var item = (type=='active') ? this.active : this.archived;
				var lvl = WPCLib.sys.user.level;
				var docid = item[i].id;
				var title = item[i].title || 'Untitled';
				var active = (type == 'active') ? true : false;

				var d = document.createElement('div');
				d.className = 'document';
				d.setAttribute('id','doc_'+docid);

				var link = document.createElement('a');
				link.setAttribute('onclick','return false;');
				link.setAttribute('href','/docs/'+docid);	

				var t = document.createElement('span');
				t.className = 'doctitle';
				t.innerHTML = title;

				var stats = document.createElement('small');
				if (item[i].updated) {
					stats.appendChild(document.createTextNode(WPCLib.util.humanizeTimestamp(item[i].updated) + " ago"))
				} else {
					stats.appendChild(document.createTextNode('Not saved yet'))							
				}			

				link.appendChild(t);
				link.appendChild(stats);
				d.appendChild(link);	

				if (('ontouchstart' in document.documentElement)&&l>1) {
					d.addEventListener('touchmove',function(event){event.stopPropagation()},false);				
				} else {
					// Add archive link, only on non touch devices
					if (lvl>1) {
						var a = document.createElement('div');
						a.className = 'archive';
						if (active) {
							WPCLib.util.registerEvent(a,'click', function(e) {WPCLib.folio.docs.archive(e,true);});	
						} else {
							WPCLib.util.registerEvent(a,'click', function(e) {WPCLib.folio.docs.archive(e,false);});					
						}								
						d.appendChild(a);
					}
				}

				if (active) {
					document.getElementById(WPCLib.folio.docs.doclistId).appendChild(d);		
				} else {				
					document.getElementById(WPCLib.folio.docs.archiveId).appendChild(d);					
				}				
				WPCLib.folio.docs._events(docid,title,active);				
			},

			_events: function(docid,title,active) {
				// Attach events to doc links
				WPCLib.util.registerEvent(document.getElementById('doc_'+docid).firstChild,'click', function() {
					WPCLib.canvas.loaddoc(docid, title);
					WPCLib.folio.docs.moveup(docid,active);
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
					WPCLib.sys.user.upgrade(2,WPCLib.folio.docs.newdoc,'Upgrade now for unlimited documents &amp; much more.');
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
				pht.innerHTML = 'Creating new document...';	
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
					console.log('unknown user, setting up localstore ');

					// Set params for local doc
					WPCLib.canvas.docid = 'localdoc';
					WPCLib.folio.docs.active[0].id = 'localdoc';

					// Save document & cleanup
					doc.firstChild.firstChild.innerHTML = 'New Document';
					doc.id = 'doc_localdoc';
				} else {
					// Request new document id
					var doc = document.getElementById('doc_creating');
					console.log('known user, setting up remote store ');

					// Submit timestamp for new doc id
					var file = {};				
					file.created = WPCLib.util.now();				

					// Get doc id from server
					$.ajax({
						url: "/docs/",
		                type: "POST",
		                contentType: "application/json; charset=UTF-8",
		                data: JSON.stringify(file),
						success: function(data) {
		                    console.log("backend issued doc id ", data);

							// Set params for local doc
							WPCLib.canvas.docid = data;

							// Save document & cleanup
							doc.firstChild.firstChild.innerHTML = 'New Document';
							doc.id = 'doc_'+data;
							WPCLib.folio.docs.active[0].id = data;		

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
		                    console.log("move local to backend with new id ", data);
		                    // Delete local item
		                    localStorage.removeItem('WPCdoc')

							// Set new id for former local doc
							WPCLib.canvas.docid = data;

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
				WPCLib.folio.docs.update();				
			},

			archive: function(e,toarchive) {
				// Move a current document to the archive
				var that = WPCLib.folio.docs;				
				var a_id = e.srcElement.parentNode.id.substr(4);
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
					WPCLib.sys.user.upgrade(2,'','Upgrade now to unlock the archive &amp; much more.');
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

		contentId: 'pageContent',	
		pageId: 'page',	
		pageTitle: 'pageTitle',
		defaultTitle: 'OK, let\'s do this', //Put 'Don\'t fear the blank paper', back in for registered users, find better one for new users
		titleTip: 'Give it a good title',
		canvasId: 'canvas',
		quoteId: 'nicequote',
		quoteShown: false,
		text: '',
		title: '',
		tempTitle: '',
		wordcount: 0,
		linecount: 0,
		welcomeText: 'Just write',
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
			// See if a selection is performed and narrow search to selection
			WPCLib.util.registerEvent(p,'mouseup',this.textclick);							
			WPCLib.util.registerEvent(el,'keydown',this.keyhandler);	
			WPCLib.util.registerEvent(el,'keyup',this.update);			

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
				// Make sure the teaxtare contents are scrollable on mobile devices
				el.addEventListener('touchstart',function(e){
					// Attach the swipe actions to canvas					
					WPCLib.ui.swipe.init(WPCLib.context.switchview,WPCLib.ui.menuSwitch,e);					
				}, false);	
				c.addEventListener('touchstart',function(e){
					// Attach the swipe actions to canvas					
					WPCLib.ui.swipe.init(null,WPCLib.context.switchview,e);					
				}, false);	
				// Make UI more stable with event listeners			
				document.getElementById('page').addEventListener('touchmove',function(e){e.stopPropagation();},false);													
			} else {
				// click on the page puts focus on textarea
				WPCLib.util.registerEvent(p,'click',function(){document.getElementById(WPCLib.canvas.contentId).focus()});
			}				

			// Always set context sidebar icon to open on mobiles
			if (document.body.offsetWidth<=900) document.getElementById('switchview').innerHTML = '&#171;';				
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
			file.text = this.text;
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
			if (force) status.innerHTML = 'Saving...';
			this.lastUpdated = WPCLib.util.now();
			var file = this.builddoc();		

			// backend saving, locally or remote
			if (this.docid!='localdoc' && WPCLib.sys.user.level > 0) {
				console.log('saving remotely: ', file);				
				$.ajax({
					url: "/docs/"+this.docid,
	                type: "PATCH",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(file),
					success: function(data) {
	                    window.console.log("Saved!");
						WPCLib.canvas.saved = true;	 
						if (force) status.innerHTML = 'Saved!';                   
					}
				});
			} else {
				console.log('saving locally: ', file);					
				localStorage.setItem("WPCdoc", JSON.stringify(file));
				WPCLib.canvas.saved = true;	
				if (force) status.innerHTML = 'Saved!';								
			}	
			// Update last edited counter in folio
			var docs = WPCLib.folio.docs;
			var bucket = (WPCLib.folio.docs.archiveOpen) ? docs.archived[0] : docs.active[0];	

			// Check if user didn't navigate away from archive and set last updated
			if (file.id == bucket.id) bucket.updated = WPCLib.util.now();
			WPCLib.folio.docs.update();					
		},		

		loaddoc: function(docid, title) {
			// Load a specific document to the canvas
			if (!this.saved) this.savedoc();			
			console.log('loading doc id: ', docid);
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
				success: function(data) {
					WPCLib.canvas.docid = data.id;
					WPCLib.canvas.created = data.created;
					WPCLib.canvas.lastUpdated = data.updated;			

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

					// Set internal values
					that.text = data.text;
					that.title = data.title;	
					that.preloaded = false;

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
					WPCLib.context.sticky = data.links.sticky || [];
					WPCLib.context.links = data.links.normal || [];
					WPCLib.context.blacklist = data.links.blacklist || [];	
					if (data.links.normal.length!=0) {
						WPCLib.context.renderresults();
					} else {
						WPCLib.context.search(WPCLib.canvas.title + ', ' + WPCLib.canvas.text);
					}
					document.getElementById(WPCLib.context.statusId).innerHTML = 'All loaded, keep going.';						
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

			document.getElementById(WPCLib.context.resultsId).innerHTML = '';
			document.getElementById(WPCLib.context.statusId).innerHTML = 'Ready to inspire';
			this.created = WPCLib.util.now();

			// Empty the link lists & internal values
			this.title = '';
			this.text = '';
			WPCLib.context.wipe();	

			WPCLib.util.registerEvent(content,'keydown',this._cleanwelcome);
			// If the landing page is loaded, don't pull the focus from it, bit expensive here, maybve add callback to newdoc later
			if (WPCLib.sys.user.level==0 && document.getElementById('landing').style.display != 'none') {
				var el = document.getElementById('landing').contentDocument.getElementById('startwriting');
				if (el) el.focus();
			} else {
				document.getElementById(WPCLib.canvas.contentId).focus();				
			} 							
		},

		_showtitletip: function() {									
			var title = document.getElementById(WPCLib.canvas.pageTitle);	
			var tip = WPCLib.canvas.titleTip;
			WPCLib.canvas.tempTitle = title.value;			
			if (!title.value || title.value.length == 0 || title.value == "Untitled" || title.value == WPCLib.canvas.defaultTitle) title.value = tip;					
		},

		_hidetitletip: function() {
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
			var docs = WPCLib.folio.docs;
			var bucket = (WPCLib.folio.docs.archiveOpen) ? docs.archived[0] : docs.active[0];
			bucket.title = this.value;

			// Visual updates
			var el = document.getElementById('doc_'+WPCLib.canvas.docid);			
			WPCLib.canvas.title = el.firstChild.innerHTML = document.title = this.value;
			if (!this.value) document.title = 'Untitled';

			// Initiate save & search
			WPCLib.canvas._settypingtimer();

			// If user presses enter automatically move to body	
		    if (event.keyCode == 13) {
				event.preventDefault();
		        WPCLib.canvas._setposition(0);
		    }			
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
			// Abort if keypress is F1-12 key
			if (event.keyCode > 111 && event.keyCode < 124) return;			
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

	        // Save Document
	        WPCLib.canvas.savedoc();
		},

		keyhandler: function(e) {
			// Various actions when keys are pressed
			var k = e.keyCode;
			// Tab key insert 5 whitespaces
			if (k==9) WPCLib.canvas._replacekey(e,'tab');

			// Space and return triggers brief analysis
			if (k==32||k==13||k==9) {
				WPCLib.canvas._wordcount();	
				// WPCLib.canvas._logcontent();	
			}
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
				console.log(this.newChars + ' new chars typed');
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
				console.log('new words');
				this.newWords = 0;	
			} 
			this.wordcount = cw;
		},

		_settypingtimer: function() {
			// set & clear timers for saving and context if user pauses
			if (this.typingTimer) clearTimeout(this.typingTimer);
			this.typingTimer = setTimeout(function() {
				WPCLib.canvas.savedoc();
				WPCLib.context.search(WPCLib.canvas.title + ', ' + WPCLib.canvas.text);					
				WPCLib.canvas._cleartypingtimer();
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
			console.log('Words: ' + this.wordcount + " Lines: " + this.linecount + " Pos: " + pos);			
		},

		textclick: function() {
			// when text is clicked
			var sel = WPCLib.canvas._getposition();
			if (sel[0] != sel[1]) WPCLib.context.search(sel[2]);
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
			if (!pos) var pos = 0;
			var el = document.getElementById(this.contentId);	

			// Abort if focus is already on textarea
			if (el.id == document.activeElement.id) return;  			

    		// Abort if device is mobile and menu not fully closed yet or text length is larger than visible area   		
    		if ('ontouchstart' in document.documentElement && document.body.offsetWidth<=480) {
    			if (WPCLib.ui.menuCurrPos!=0 || el.value.length > 150) return;   			
    		};   		

    		// Unfocus any existing elements
    		document.activeElement.blur();
    		this._resize();
    		if (el.setSelectionRange) {
				if (window.navigator.standalone&&this.safariinit) {		
					// Mobile standalone safari needs the delay, because it puts the focus on the body shortly after window.onload
					// TODO Bruno findout why, it's not about something else setting the focus elsewhere						
					setTimeout( function(){
						if (WPCLib.ui.menuCurrPos!=0) return;
						el.focus();							
						el.setSelectionRange(pos,pos);	
						WPCLib.canvas.safariinit = false;										
					},1000);								
				} else {	
					el.focus();							
					el.setSelectionRange(pos,pos);															
				}     									
    		} else if (el.createTextRange) {
        		var range = el.createTextRange();
        		range.collapse(true);
        		range.moveEnd('character', pos);
        		range.moveStart('character', pos);
        		range.select();
    		} else {
    			el.focus();
    		}
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
		statusId: 'status',
		signupButtonId: 'signupButton', 

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

		analyze: function(string, chunktype) {
			// Send text to server for analysis, returning text chunks
			string = string || (WPCLib.canvas.title + ', ' + WPCLib.canvas.text);
			document.getElementById(this.statusId).innerHTML = 'Saving & Analyzing...';
			$.post('/analyze', {content: string}, 
			function(data){	
				console.log(data);
	            WPCLib.context.chuncksearch(data,chunktype);
	        });
		},		

		chuncksearch: function(data,chunktype) {
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
				console.log('searching for: ',postData);
				var that = this;						
                $.ajax({
                    url: "/relevant",
                    type: "POST",
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify(postData),
                    success: function(data) {
                        WPCLib.context.storeresults(data.results);
                        WPCLib.context.renderresults();		             
                        document.getElementById(that.statusId).innerHTML = 'Ready for more?';
                    }
                });				
			} else {
					document.getElementById(this.statusId).innerHTML = 'Nothing interesting found.';
			}
		},


		search: function(string) {
			// Chunk extraction and search in one step in the backend
			document.getElementById(this.statusId).innerHTML = 'Saving & Searching...';			
			var payload = {text: string};
			var that = this;						
            $.ajax({
                url: "/relevant",
                type: "POST",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(payload),
                success: function(data) {
                    WPCLib.context.storeresults(data.results);
                    WPCLib.context.renderresults();		             
                    document.getElementById(that.statusId).innerHTML = 'Ready for more?';
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

		renderresults: function() {
			// Show results in DOM		
			var results = document.getElementById(this.resultsId);
			var newresults = results.cloneNode();
			var sticky = this.sticky;
			if (sticky) {
				for (var i=0,l=sticky.length;i<l;i++) {											
					newresults.appendChild(this._buildresult(sticky[i], true));
				}
			}
			var links = this.links;			
			for (var i=0,l=links.length;i<l;i++) {						
				newresults.appendChild(this._buildresult(links[i], false));
			}				
			results.parentNode.replaceChild(newresults, results);			    
		},

		_buildresult: function(data, sticky) {
			var e = document.createElement('div');
			var l = (WPCLib.sys.user.level < 2);
			e.className = (sticky) ? 'result sticky' : 'result';

			if (!sticky) {
				var del = document.createElement('a');
				del.className = 'delete action';
				del.setAttribute('href','#');
				if (l) del.setAttribute('title','Delete');				
				del.setAttribute('onclick','WPCLib.context.blacklistLink(this); return false;');	
				e.appendChild(del);	

				var st = document.createElement('a');
				st.className = 'stick action';
				st.setAttribute('href','#');
				if (l) st.setAttribute('title','Pin');				
				st.setAttribute('onclick','WPCLib.context.makesticky(this); return false;');					
				e.appendChild(st);							
			}	

			if (sticky) {
				var us = document.createElement('a');
				us.className = 'unstick action';
				us.setAttribute('href','#');
				if (l) us.setAttribute('title','Unpin');					
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

	// External libraries
	lib: {
		inited: false,

		init: function() {
			if (this.inited) return;
			// kick off segment.io sequence, only on our domain 
			if (window.location.hostname.indexOf('hiroapp.com')>=0) analytics.load("64nqb1cgw1");

			// Mount & init facebook
			(function(d, s, id){
			 var js, fjs = d.getElementsByTagName(s)[0];
			 if (d.getElementById(id)) {return;}
			 js = d.createElement(s); js.id = id;
			 js.src = "https://connect.facebook.net/en_US/all.js";
			 fjs.parentNode.insertBefore(js, fjs);
			}(document, 'script', 'facebook-jssdk'));	

			this.inited = true;
		}
	},

	// All system related vars & functions
	sys: {

		online: true,
		status: 'ok',
		language: 'en-us',
		saved: true,
		settingsUrl: '/settings/',
		settingsSection: '',			

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

			// Add keyboard shortcuts
			WPCLib.util.registerEvent(document,'keydown', WPCLib.ui.keyboardshortcut);

			WPCLib.folio.init();
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

		user: {
			id: '',
			// levels: 0 = anon, 1 = free, 2 = paid
			level: 0,
			dialog: document.getElementById('dialog').contentDocument,
			signinCallback: null,
			upgradeCallback: null,
			justloggedin: false,
			authactive: false,

			register: function() { 
				// Register a new user (or log in if credentials are from know user)
				var button = document.getElementById('dialog').contentDocument.getElementById('signupbutton');
				var val = document.getElementById('dialog').contentDocument.getElementById('signupform').getElementsByTagName('input');
				var error = document.getElementById('dialog').contentDocument.getElementById('signuperror');
				var payload = {
					email: val[0].value.toLowerCase(),
					password: val[1].value
				};

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
			},

			login: function() { 
				// Register a new user (or log in if credentials are from know user)
				var button = document.getElementById('dialog').contentDocument.getElementById('loginbutton');
				var val = document.getElementById('dialog').contentDocument.getElementById('loginform').getElementsByTagName('input');
				var error = document.getElementById('dialog').contentDocument.getElementById('loginerror');
				var payload = {
					email: val[0].value.toLowerCase(),
					password: val[1].value
				};

				// Preparing everything
				if (this.authactive) return;
				this.authactive = true;				
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
                	this.forceupgrade(2,'Unlock more features right away?');
                } else {
                	WPCLib.ui.hideDialog();	
                }

                // Track signup (only on register, we also only pass the mathod variable then)
                if (analytics) {
	                if (type=='register' && method) {
	                	analytics.track('Registers',{method:method});
	                } else if (type == 'login') {
	                	analytics.track('Logs back in');
	                }	                	
                }


                // Housekeeping, switch authactive off
                WPCLib.sys.user.authactive = false;
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

				// generic styles & functions
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

						// Kick of consitency checker 
						WPCLib.folio.checkconsistency();				
						break;	
				}	

				// Show correct upgrade/downgrade buttons
				WPCLib.ui.setplans(level);			
			},

			upgrade: function(level,callback,reason,event) {
				if (this.level==0) {
					// If user is not loggedin yet we show the regsitration first
					// TODO Refactor dialog & login flow to enable callback without going spaghetti
					this.signinCallback = callback;
					WPCLib.ui.showDialog(event,'','s_signup','signup_mail');
					return;
				}
				if (this.level<level) this.forceupgrade(level,reason);
			},

			forceupgrade: function(level,reason) {
				// Show an upgrade to paid dialog and do callback

				// Change default header to reason for upgrade				
				var plan = document.getElementById('dialog').contentDocument.getElementById('s_plan').getElementsByTagName('div');
				var checkout = document.getElementById('dialog').contentDocument.getElementById('s_checkout').getElementsByTagName('div');
				plan[0].innerHTML = checkout[0].innerHTML = '<span class="reason">' + reason + '</span>';
				plan[0].style.display = checkout[0].style.display = 'block';
				plan[1].style.display = checkout[1].style.display = 'none';

				// Make sure the parent node is set to block, bit redundant but working fine
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
							frame.getElementById('cc_'+response.error.param).className += " error";
							if (response.error.param == 'number') {
								var el = frame.getElementById('cc_'+response.error.param).nextSibling;
								el.innerHTML = response.error.message;	
								el.className += ' error';						
							} else {
								frame.getElementById('checkout_error').innerHTML = response.error.message;
							}
							WPCLib.sys.user.checkoutActive = false;
							checkoutbutton.innerHTML = "Try again"
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
					console.log(e);
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
		windowfocused: true,

		keyboardshortcut: function(event) {
			// Simple event listener for keyboard shortcuts			
			if (event.ctrlKey) {
				if (event.keyCode == 83) {
					// Ctrl+s
					WPCLib.canvas.savedoc(true);
		        	event.preventDefault();					
				}
				if (event.keyCode == 78) {
					// Ctrl + N, this doesn't work in Chrome as chrome does not allow access to ctrl+n 
					WPCLib.folio.docs.newdoc();
		        	event.preventDefault();					
				}		
		    }
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
			WPCLib.util.stopEvent(event);

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
					// On some mobiel browser the input field is frozen if we don't focus the iframe first				 
					if ('ontouchstart' in document.documentElement) document.getElementById('dialog').contentWindow.focus();								
					if (typeof field == 'boolean') el = el.getElementsByTagName('input')[0];													
					if (typeof field == 'string') el = frame.getElementById(field);
					if (el) el.focus();																
				}					
			}	

			// Recenter on window size changes
			WPCLib.util.registerEvent(window, 'resize', this._centerDialog);
			if(!('ontouchstart' in document.documentElement)) this.dialogTimer = window.setInterval(this._centerDialog, 200);

			// Attach clean error styling (red border) on all input
			var inputs = frame.getElementsByTagName('input');
			for (i=0,l=inputs.length;i<l;i++) {
				WPCLib.util.registerEvent(inputs[i], 'keydown', this.cleanerror);
				WPCLib.util.registerEvent(inputs[i], 'keydown', this.autoconfirm);				
			}
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
				var inputs = document.getElementById(frame.id).contentDocument.getElementsByTagName('input');
				for (i=0,l=inputs.length;i<l;i++) {
					WPCLib.util.releaseEvent(inputs[i], 'keydown', this.cleanerror);
					WPCLib.util.releaseEvent(inputs[i], 'keydown', this.autoconfirm);					
				}				
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

			// Hide shield & dialog
			if ('ontouchstart' in document.documentElement) {
				document.activeElement.blur();
			}			
			s.style.display = 'none';
			d.style.display = 'none';


			// Put focus back on document 
			if (!('ontouchstart' in document.documentElement)) WPCLib.canvas._setposition();
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

		fillcheckout: function(plan) {
			// Get the checkout form ready for checkout and switch view
			var frame = document.getElementById('dialog').contentDocument;
			var startdesc = "Starter Plan: USD 9";
			var prodesc = "Pro Plan: USD 29";
			var cc_num = frame.getElementById('cc_number'); 
			// Not optimal, as this dependend on the HTML not changing
			var forced = (frame.getElementById('s_checkout').getElementsByClassName('header')[1].style.display=="none") ? true : false;
			WPCLib.sys.user.upgradeto = plan;			
			if (plan == 'starter') {
				frame.getElementById('cc_desc').value = startdesc;
			}
			if (plan == 'pro') {
				frame.getElementById('cc_desc').value = prodesc;
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
				if (document.activeElement.id==WPCLib.canvas.contentId&&mp==0) document.activeElement.blur();
			}			
			if (mp==0) WPCLib.ui.menuSlide(1);
			if (mp!=0) WPCLib.ui.menuSlide(-1);
		},

		menuSlide: function(direction, callback) {
			var startTime, duration, x0, x1, dx, ref;
			var canvas = document.getElementById('canvas');
			var context = document.getElementById('context');
			var switcher = document.getElementById('switchview');		
			var title = document.getElementById('pageTitle');					
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
			if (('ontouchstart' in document.documentElement) && WPCLib.ui.menuCurrPos != 0) {
				// Prevent delayed dragging of menu or setting focus
				event.preventDefault();
			}			
			if (this.menuHideTimer) {
				clearTimeout(this.menuHideTimer);				
			}
			var that = WPCLib.ui;
			this.menuHideTimer = setTimeout(function(){that.menuSlide(-1);},1);			
		},

		swipe: {
			start_x: 0,
			start_y: 0,
			active: false,
			callback_left: null,
			callback_right: null, 

			init: function(left,right,e) {	
				if (WPCLib.ui.menuCurrPos!=0) return;			
	    		if (e.touches.length == 1) {
	    			var that = WPCLib.ui.swipe;
	    			that.callback_left = left;	
	    			that.callback_right = right;		    			    			
	    			that.start_x = e.touches[0].pageX;
	    			that.start_y = e.touches[0].pageY;
	    			that.active = true;
					e.srcElement.addEventListener('touchmove', WPCLib.ui.swipe.move, false);
	    			setTimeout(function(e){
	    				that.active = false;
						that.callback_left = null;
						that.callback_right = null;		    				
	    				that.swipe.cancel(e);
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
		    			that.cancel(e);
		    			if (Math.abs(dy) > Math.abs(dx*0.5)) return;
		    			if(dx > 0) {
		    				that.callback_left();
		    				e.preventDefault();
		    			}
		    			else {
		    				that.callback_right();
		    				e.preventDefault();		    				
		    			}
		    		}
	    		}
			},

			cancel: function(e) {
				e.srcElement.removeEventListener('touchmove', WPCLib.ui.swipe.move);
				WPCLib.ui.swipe.start_x = null;
				WPCLib.ui.swipe.active = false;			
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
			var val, level = WPCLib.sys.user.level, target = document.getElementById('dialog').contentDocument.getElementById('s_account'), upgradelink;
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
						val = 'Free';
						upgradelink.style.display = 'block';
						break;
					case 2:
						val = 'Starter';
						upgradelink.style.display = 'block';					
						break;
					case 3:
						val = 'Pro';
						upgradelink.style.display = 'none';					
						break;		
				}
				val = val + ' plan: ';
				if (WPCLib.folio.docs.active) val = val + WPCLib.folio.docs.active.length;

				// See if we have plan limits or mobile device
				if (level < 2) val = val + ' of 10'
				val = val + ((document.body.offsetWidth>480) ? ' documents' : ' docs');
				
				target.getElementsByTagName('input')[2].value = val;
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