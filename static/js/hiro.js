/*

	Hiro client lib

	Hiro.folio: Manages the document list and the left hand folio sidebar

	Hiro.canvas: The currently loaded document
	Hiro.canvas.cache: A collection of values and references that allow fast updates
	Hiro.canvas.overlay: Rendering links, peer carets etc
	Hiro.canvas.context: Search and right hand sidebar related functions

	Hiro.user: User management incl login logout etc
	Hiro.user.contacts: Contacts including lookup object etc
	Hiro.user.checkout: Stripe & Flask related checkout stuff

	Hiro.apps: Generic plugin setup 
	Hiro.apps.sharing: Sharing plugin
	Hiro.apps.publish: Publish selections to various external services

	Hiro.data: Core datamodel incl setter & getter & eventhandler
	Hiro.data.set/get:
		store: unique store id, also seperate localstorage JSON string
		key: supports direct access to all object levels, eg foo.bar.baz
		value: arbitrary js objects
		source: Where the update is coming from (client/server)

	Hiro.sync: Data synchronization with local and remote APIs
	Hiro.sync.ws: Websocket client
	Hiro.sync.lp: Longpolling fallback 
	Hiro.sync.ajax: Generic AJAX stuff

	Hiro.ui: Basic UI related functions like showing/hiding dialogs, sliding menu etc
	Hiro.ui.tabby: Add an id who's title will flash in the document.title if unfocused
	Hiro.ui.fastbutton: Button event handlers that fire instantly on touch devices
	Hiro.ui.touchy: Trigger events on hover/touchstart with an optional delay
	Hiro.ui.swipe: Custom swipe functionality for touch devices
	Hiro.ui.hprogress: Thin progress bar on very top of page
	Hiro.ui.statsy: A small helper that shows status messages in the upper right corner

	Hiro.sys: Core functionality like setup, logging etc

	Hiro.lib: External libraries like Facebook or analytics	

	Hiro.util: Utilities like event attachment, humanized timestamps etc

*/

/*
	Candidates for webWorkers:
	- complete diffing flow
	- longpolling, although most worker browsers support sockets
	- paint preparations (renderlinks)
	- localstorage writer/reader
	- diff match patch (tricky to weave completed merges / diffs back into flow)
*/

/* TODO Optimizations:

	- Reduce peer and contact diffs to longer frequency or work with internal _haschanged flags 

*/


var Hiro = {
	version: '1.10.3',

	// Sidebar and internal data structure
	folio: {
		// States
		open: false,
		archiveopen: false,

		// DOM IDs
		el_root: document.getElementById('folio'),
		el_notelist: document.getElementById('notelist'),
		el_archivelist: document.getElementById('archivelist'),
		el_showmenu: document.getElementById('showmenu'),
		el_archivelink: document.getElementById('archivelink'),		

		// Internal values
		archivecount: 0,
		unseencount: 0,
		owncount: 0,

		// Use lookup[id] to lookup folio element by id (note: this isn't the note itself, just the folio entry)
		lookup: {},

		// Init folio
		init: function() {
			// Event setup
			Hiro.ui.fastbutton.attach(this.el_root,Hiro.folio.folioclick);	
			Hiro.ui.fastbutton.attach(this.el_showmenu,Hiro.folio.folioclick);

			// Open the folio if a user hovers		
			Hiro.ui.touchy.attach(this.el_root,Hiro.folio.foliotouch,55);	
			Hiro.ui.touchy.attach(this.el_showmenu,Hiro.folio.foliotouch,55);								
		},

		// If the user clicked somewhere in the folio
		folioclick: function(id,type,target) {	
			var tier = Hiro.data.get('profile','c.tier'); 	

			// Clicks on the main elements, fired immediately on touchstart/mousedown
			if (type == 'half') {				
				switch (id) {					
					case 'archivelink':				
						if (tier > 1) Hiro.folio.archiveswitch();
						break;
					case 'showmenu':					
						var d = (!Hiro.folio.open || Hiro.ui.slidedirection == -1) ? 1 : -1;
						Hiro.ui.slidefolio(d,150);
						break;						
				}
			} else if (type == 'full') {
				// Deconstruct note id	
				if (id.indexOf('note_') == 0) {
					var noteid = id.substring(5);
					id = 'note';	
				}	
				// Go through cases
				switch (id) {
					case 'signin':
						Hiro.ui.dialog.show('d_logio','s_signup',Hiro.user.el_register.getElementsByTagName('input')[0]);
						break;										
					case 'newnote':
						Hiro.folio.newnote();
						break;
					case 'archivelink':				
						if (!tier || tier < 2) Hiro.ui.dialog.suggestupgrade('<em>Upgrade now to </em><b>unlock the archive</b><em> &amp; more</em>');
						break;							
					case 'settings':
						Hiro.ui.dialog.show('d_settings','s_account','',true);
						break;						
					case 'note':
						// If the click was on an archive icon
						if (target.className == 'archive') {
							// Abort if user doesn't have archive yet
							if (tier < 2) {
								Hiro.ui.dialog.suggestupgrade('<em>Upgrade now to </em><b>archive notes</b><em> &amp; more</em>');	
								return;							
							}
							// Directly set status
							Hiro.folio.lookup[noteid].status = (Hiro.folio.lookup[noteid].status == 'active') ? 'archived' : 'active';
							// Getset hack to kick off persistence / sync
							Hiro.data.set('folio','',Hiro.data.get('folio'));
							return;
						}	

						// Move entry to top of list and load note
						Hiro.canvas.load(noteid);												
				}				
			}
		},

		// If the user hovered over the folio with mouse/finger
		foliotouch: function(event) {
			var target = event.target || event.srcElement;

			// Open the folio
			if (!Hiro.folio.open) {
				Hiro.ui.slidefolio(1,170);
			}		
		},

		// Rerender data
		paint: function(forced) {
			// Abort if it's neither visible nor forced
			if (!Hiro.folio.open && !forced) return;

			// that scope because it's called by timeout as well
			var that = Hiro.folio, i, l, data, 
				f0 = document.createElement('div'), f1, link;

			// Kick off regular updates, only once
			if (!that.updatetimeout) that.updatetimeout = setInterval( function(){ Hiro.folio.paint(true) },61000);

			// Get data from store			
			data = Hiro.data.get('folio','c');
			if (!data) return;

			// Reset archivecount
			that.archivecount = that.unseencount = that.owncount = 0;

			// Cycle through notes
			for (i=0,l=data.length;i<l;i++) {
				// Attach note entries to fragments
				if (data[i].status == 'active') {
					link = that.renderlink(data[i]);
					if (link) f0.appendChild(link);
				// If we didn't have an archived Note yet create the fragment	
				} else if (data[i].status == 'archived') {
					if (!f1) f1 = document.createElement('div');
					link = that.renderlink(data[i]);
					if (link) f1.appendChild(link);
				} else {
					Hiro.sys.error('Tried to paint Note with invalid status',data[i]);
				}

				// Update lookup object
				that.lookup[data[i].nid] = data[i];			
			}

			// Switch folio DOM contents with fragments
			Hiro.ui.render(function(){
				// Update bubble
				that.el_showmenu.firstChild.innerHTML = that.unseencount;
				that.el_showmenu.firstChild.style.display = (that.unseencount) ? 'block' : 'none';

				// Copy innerHTML
				that.el_notelist.innerHTML = (f0) ? f0.innerHTML : '';
				that.el_archivelist.innerHTML = (f1) ? f1.innerHTML : '';

				// Update text contents of archivelink
				if (!that.archiveopen) that.el_archivelink.innerHTML = (that.archivecount > 0) ? 'Archive  (' + that.archivecount.toString() + ')' : 'Archive';
			})
		},	

		renderlink: function(folioentry) {
			// Abort if we do not have all data loaded yet
			if (!Hiro.data.stores.folio) return;

			// Render active and archived document link
			var d = document.createElement('div'),
				id = folioentry.nid,
				note = Hiro.data.get('note_' + id),
				link, t, stats, a, time, tooltip, s, sn, title, user;

			// Abort if we try to render a link for which we don't have any data
			if (!note) {
				Hiro.sys.error('Tried to paint a link for note ' + id + ' but no data is available',note);
				return;
			}

			title = note.c.title || note.c.text.trim().replace(/[\t\n]/g,' ').substring(0,50) || 'Untitled';			

			// Set note root node properties	
			d.className = 'note';
			d.setAttribute('id','note_' + note.id);

			// Insert Link, Title and stats
			link = document.createElement('a');
			link.setAttribute('href','/note/' + note.id);	

			t = document.createElement('span');
			t.className = 'notetitle';
			t.innerText = title;

			stats = document.createElement('small');	

			// If we have a signed up user
			if (Hiro.data.get('profile','c.tier') > 0) {
				// Build archive link
				a = document.createElement('div');
				a.className = 'archive';

				// Prepare archive link and iterate counter
				if (folioentry.status == 'active') {
					// Add tooltip
					a.setAttribute('title','Move to archive...')
				} else if (folioentry.status == 'archived') {
					// Add tooltip
					a.setAttribute('title','Move back to current notes...')				
					// Iterate counter
					this.archivecount++;
				} else {
					Hiro.sys.error('Folio contains document with unknown status',[folioentry,note])
				}					
			}

			// Get basic time string
			time = (note._lastedit) ? Hiro.util.humantime(note._lastedit) + ' ago': 'Not saved yet';

			// Attach elements to root node
			link.appendChild(t);
			link.appendChild(stats);			

			// If we have two users or more, or if the only user has no uid now (meaning we are absent from peers & everything happened offline)
			if (note.c.peers.length > 1 || (note.c.peers.length == 1 && !note.c.peers[0].user.uid)) {
				// Check if we are the owner
				if (note._owner == Hiro.data.get('profile','c.uid')) this.owncount++;

				// Add sharing icon to document and change class to shared
				s = document.createElement('div');
				s.className = 'sharing';

				// Add sharing hover tooltip
				// TODO Bruno: This doesn'T count properly between offline (no own peer) and online created notes, pls fix
				tooltip = 'Shared with ' + (note.c.peers.length - 1 || 1) + ' other';	
				if (note.c.peers.length > 2) tooltip = tooltip + 's';
				s.setAttribute('title',tooltip);	
				link.appendChild(s);		
				
				// Change classname
				d.className = 'note shared';					

				// Add bubble if changes weren't seen yet
				if (note._unseen && id != Hiro.canvas.currentnote) {
					// Show that document has unseen updates
					sn = document.createElement('div');
					sn.className = "bubble red";
					sn.innerText = '*';
					link.appendChild(sn);
					tooltip = tooltip + ', just updated';		

					// Iterate counter for our bubble
					if (folioentry.status == 'active') this.unseencount++;								
				}	

				// Append time indicator if someone else did the last update
				if (note._lasteditor && note._lasteditor != Hiro.data.get('profile','c.uid')) {
					// Lookup last user, we do not touch the peers here as iterating through them as well would be most likely too slow
					// All known users who we can get updates from should be in to contact anyway
					user = Hiro.user.contacts.lookup[note._lasteditor];

					// Complete string
					time = time + ' by ' + ((user) ? user.name || user.email || user.phone || 'Anonymous' : 'Anonymous');	
				}					
			} else {
				// Iterate owncounter
				this.owncount++;
			}

			// Append stats with time indicator
			stats.appendChild(document.createTextNode(time));

			// Attach link & archive to element
			d.appendChild(link);				
			if (a) d.appendChild(a);			

			return d;			
		},

		// Move folio entry to top and resort rest of folio for both, local client and server versions
		// TODO Bruno: Add sort by last own edit when we have it
		sort: function(totop) {
			var fc = Hiro.data.get('folio','c'), i, l, as, bs;

			// Sort array by last edit
			fc.sort( function(a,b) { 
				// Create shorthands
				as = Hiro.data.stores['note_' + a.nid]; bs = Hiro.data.stores['note_' + b.nid];
				// Check if stores exist, this is not the case if we lost a note
				if (!as || !bs) return -1;
				// Comparison function
				return bs._ownedit - as._ownedit;
			});		

			// Update client array, remove 
			// TODO Bruno: Figure out how to use the sort above to achive this in one loop, too tired to understand it 
			for (i=0,l=fc.length;i<l;i++) {
				if (totop && fc[i].nid == totop && i > 0) {
					// Remove item from array and insert at beginning
					fc.unshift(fc.splice(i,1)[0]);				
					break;	
				} 
			}	

			// Save changes and trigger repaint		
			Hiro.data.set('folio','c',fc);
		},

		// Add a new note to folio and notes array, then open it 
		// Note: Passing id/note as parameters means newnote was triggered by the server
		newnote: function(id,status) {
			var f = Hiro.data.get('folio') || {},
				id = id || Math.random().toString(36).substring(2,6),
				i, l, folioc = { nid: id, status: status || 'active' }, folios, load,
				user = Hiro.data.get('profile'),
				note = {
					c: { text: '', title: '', peers: [] },
					s: { text: '', title: '', peers: [] },	
					id: id,						
					sv: 0, cv: 0,
					kind: 'note',
					_lasteditor: user.c.uid,
					_lastedit: Hiro.util.now(),
					_ownedit: Hiro.util.now()				
				};	

			// If the user itself created the note but doesn't have the necessary tier yet
			if (f.c.length >= 10 && (!user.c || !user.c.tier || user.c.tier< 2)) {
				Hiro.ui.dialog.suggestupgrade('<em>Upgrade now for </em><b>unlimited notes</b><em> &amp; more</em>');
				return;
			}	

			// Add new item to beginning of array
			if (!f.c) f.c = [];
			f.c.unshift(folioc);	

			// Server requested the creation of a new note					
			if (id.length > 4) {
				// Also add folio entry to shadow if newnote was triggered by server
				folios = {	nid: id, status: status	};

				// Also add new note to shadow
				f.s.unshift(folios);		

				// set to unseen
				note._unseen = true;
			}			

			// Save kick off setter flows						
			Hiro.data.set('note_' + id,'',note);
			Hiro.data.set('folio','',f);

			// Showit!
			if (id.length == 4) Hiro.canvas.load(id);

			// Return the id of the we just created
			return id;
		},

		// Switch documentlist between active / archived 
		archiveswitch: function() {
			var c = (this.archivecount > 0) ? '(' + this.archivecount.toString() + ')' : '';				

			// Set CSS properties and Text string
			if (this.archiveopen) {
				this.el_notelist.style.display = 'block';
				this.el_archivelist.style.display = 'none';
				this.el_archivelink.innerText = 'Archive  ' + c;
				this.archiveopen = false;
			} else {
				this.el_notelist.style.display = 'none';
				this.el_archivelist.style.display = 'block';
				this.el_archivelink.innerText = 'Close Archive'
				this.archiveopen = true;
			}	
		}			
	},

	// The white page, including the all elements like apps and the sidebar
	canvas: {
		// Internal values
		currentnote: undefined,
		quoteshown: false,
		textheight: 0,

		// DOM IDs
		el_root: document.getElementById('canvas'),
		el_title: document.getElementById('title'),
		el_text: document.getElementById('content'),	
		el_quote: document.getElementById('nicequote'),

		// Key maps
		keys_noset: [16,17,18,20,33,34,35,36,37,38,39,40],

		// Cache of current values and writelock (storing the cache, not writing in it)
		cache: {},
		writelock: null,
		delay: 250,

		// Init canvas
		init: function() {
			// Event setup
			Hiro.util.registerEvent(this.el_root,'keyup',Hiro.canvas.keystream);
			Hiro.util.registerEvent(this.el_root,'keydown',Hiro.canvas.keystream);		
			Hiro.util.registerEvent(this.el_root,'keypress',Hiro.canvas.keystream);	
			Hiro.util.registerEvent(this.el_root,'input',Hiro.canvas.keystream);		
			Hiro.util.registerEvent(this.el_root,'cut',Hiro.canvas.keystream);		
			Hiro.util.registerEvent(this.el_root,'paste',Hiro.canvas.keystream);									
			Hiro.util.registerEvent(this.el_title,'focus',Hiro.canvas.titlefocus);			

			// When a user touches the white canvas area
			Hiro.ui.touchy.attach(this.el_root,Hiro.canvas.canvastouch,55);	

			// Do a first resize to set property
			this.resize();		
		},

		// Poor man FRP stream
		keystream: function(event) {
			var t = event.target || event.srcElement; cache = Hiro.canvas.cache, lock = Hiro.canvas.writelock, id = t.id;			

			// Only listen to title & content
			if (id != 'title' && id != 'content') return;

			// Route specific keyhandlers
			if (Hiro.canvas[id + event.type]) Hiro.canvas[id + event.type](event,t);			

			// Check cache if values changed
			if (cache[id] != t.value) {
				// (Re)set cache values
				cache[id] = t.value;
				cache._changed = true;
				cache._id = Hiro.canvas.currentnote;

				// Reset document title
				document.title = cache.title || ( (cache.content) ? cache.content.trim().substring(0,30) || 'New Note' : 'New Note' );

				// Reset overlay if it's a text update
				if (id == 'content') Hiro.canvas.overlay.paint(t.value);

				// Resize canvas if we changed
				if (Hiro.canvas.overlay.el_root.scrollHeight != Hiro.canvas.cache._height) Hiro.canvas.resize();									

				// Kick off write if it't isn't locked
				if (!lock) {
					// Set lock
					Hiro.canvas.writelock = window.setTimeout(function(){
						// Release lock
						Hiro.canvas.writelock = null;

						// Save cache
						if (cache._changed) Hiro.canvas.save();
					},Hiro.canvas.delay);

					// Save cache data
					Hiro.canvas.save();					
				}
			}				
		},

		// Save cached note data to local model, thus triggering localStorage save & kick off sync
		save: function(force) {
			var note, that = Hiro.canvas, id = 'note_' +  that.cache._id, me = that.cache._me;
		
			// Check if cache is even still the current doc
			if (force || that.cache._id && that.cache._id == Hiro.canvas.currentnote) {
				// Get note
				note = Hiro.data.get(id);

				// Set latest value
				note._lastedit = note._ownedit = Hiro.util.now();
				note._lasteditor = Hiro.data.get('profile','c.uid');
				note._cursor = that.getcursor()[1];

				// Set own peer entry data via .me reference
				if (me) {
					me.last_seen = me.last_edit = note._ownedit;
					me.cursor_pos = note._cursor;
				}

				// Set text & title
				if (that.cache.content != note.c.text) Hiro.data.set(id,'c.text', ( that.cache.content || '') );
				if (that.cache.title != note.c.title) Hiro.data.set(id,'c.title',( that.cache.title || ''));			

				// Reset changed flag
				that.cache._changed = false;		
			}
		},			

		// When a user presses a key, handle important low latency stuff like keyboard shortcuts here
		contentkeydown: function(event,el) {	
			var c;

			// The dreaded tab key (makes think jump jump to next field) and return (is painted )
			if (event.keyCode == 9) {
				// First, we have to kill all the tabbbbbsss
				if (event.type == 'keydown') Hiro.util.stopEvent(event);

				// Determine current cursor position & proper char
				c = Hiro.canvas.getcursor();

				// Set internal data and display
				el.value = el.value.substr(0, c[0]) + '\t' + el.value.substr(c[1]);

				// Reposition cursor
				Hiro.canvas.setcursor(c[1] + 1);
				
			// If the user presses Arrowup or Pageup at position 0				
			} else if (event.keyCode == 38 || event.keyCode == 33) {
				c = Hiro.canvas.getcursor();
				if (c[0] == c[1] && c[0] == 0) {
					// Focus Title
					Hiro.canvas.el_title.focus();
					// If we're running the mini UI, also scroll the textarea to the top
					if (Hiro.canvas.el_text.scrollTop != 0) Hiro.canvas.el_text.scrollTop = 0;
				}	
			} 						
		},		

		// When a user releases a key, this includes actions like delete or ctrl+v etc
		contentkeyup: function(event,el) {
			var d; 

			// Switch quote on/off based on user actions
			if ((el.value.length > 0 && Hiro.canvas.quoteshown) || (el.value.length == 0 && !Hiro.canvas.quoteshown)) {
				d = (Hiro.canvas.quoteshown) ? -1 : 1;
				Hiro.ui.fade(Hiro.canvas.el_quote,d,450);
				Hiro.canvas.quoteshown = !Hiro.canvas.quoteshown;				
			} 								
		},		

		// When a key is released in the title field
		titlekeyup: function(event,el) {
			// Jump to text if user presses return, pagedown or arrowdown
			if (event.keyCode == 40 || event.keyCode == 13 || event.keyCode == 34) Hiro.canvas.setcursor(0);										
		},

		// Title key pressed
		titlekeydown: function(event,el) {
			// MAke sure the shortcuts defined above happy without the cursor jumping
			if (event.keyCode == 40 || event.keyCode == 13 || event.keyCode == 34) Hiro.util.stopEvent(event);
		},

		// When the user clicks into the title field
		titlefocus: function(event) {
			var note = Hiro.data.get('note_' + Hiro.canvas.currentnote);

			// Empty field if Note has no title yet
			if (this.value && !note.c.title) this.value = '';
		},

		// If the user hovers over the canvas
		canvastouch: function(event) {
			// Close the folio if it should be open
			if (Hiro.folio.open) {
				Hiro.ui.slidefolio(-1);

				// Kill the event here to make UI more stable on mobiles	
				if (Hiro.ui.touch && event.type == 'touchstart') Hiro.util.stopEvent(event);		
			}	
		},

		// Emits a current seen event to the server
		seen: function(noteid) {
			// Fetch peer object
			var uid = Hiro.data.get('profile','c.uid'), peer;

			// Do nothing if we don't have a uid (yet)
			if (!uid) return;

			// Fallback noteid
			noteid = noteid || this.currentnote;

			// Fetch peer, check for abort & change timestamp
			peer = Hiro.apps.sharing.getpeer({ user: { uid: uid} },noteid);
			if (!peer) return;
			peer.last_seen = Hiro.util.now();		

			// Briefly block statsy
			Hiro.ui.statsy.shutup(100);				

			// Set flag & kick off commit
			Hiro.data.set('note_' + noteid,'_peerchange',true);
		},

		// Load a note onto the canvas
		load: function(id,preventhistory) {		
			// If we call load without id we just pick the doc on top of the folio
			var	id = id || Hiro.data.get('folio').c[0].nid,
				note = Hiro.data.get('note_' + id);	

			// Sort	folio
			Hiro.folio.sort(id);			

			// Check if we have an unseen flag and remove if so
			if (note._unseen) Hiro.data.set('note_' + id,'_unseen',false);				

			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);	

			// Abort if we try to load the same note again	
			if (id == this.currentnote) return;		

			// Check if cache of previous note was saved
			if (this.cache._changed) this.save();			

			// Start hprogress bar, desktop only as mobiles are too slow
			Hiro.ui.hprogress.begin();	

			// Set internal values
			this.currentnote = id;	

			// Reset cache
			this.cache = {
				title: note.c.title,
				content: note.c.text
			};

			// Mount me reference
			this.cache._me = Hiro.apps.sharing.getpeer( { user: { uid: Hiro.data.get('profile','c.uid') }});				

			// Visual update
			this.paint(true);

			// Update sharing stuff
			Hiro.apps.sharing.update();		

			// Show ready
			Hiro.ui.statsy.add('ready',0,'Ready.','info',300);
			
			// Emit seen ts
			this.seen(id);

			// End hprogress
			Hiro.ui.hprogress.done();

			// Add note to history API (change browser URL etc)
			if (!preventhistory) Hiro.ui.history.add(id);			

			// Log
			Hiro.sys.log('Loaded note onto canvas:',note);
		},

		// Paint canvas
		paint: function(setcursor) {
			// Make sure we have a current note
			this.currentnote = this.currentnote || Hiro.data.get('folio').c[0].nid;

			var n = Hiro.data.get('note_' + this.currentnote), text = n.c.text, title = n.c.title, 
				pos = (this.cache._me) ? this.cache._me.cursor : n._cursor || 0;					

			// Render overlay
			this.overlay.paint(text);

			Hiro.ui.render(function(){
				// Set title & text
				if (!title || Hiro.canvas.el_title.value != n.c.title) {
					document.title = title || text.substring(0,30) || 'New Note';
					Hiro.canvas.el_title.value = title || 'Title';
				}
						
				// Set text		
				if (Hiro.canvas.el_text.value != text) Hiro.canvas.el_text.value = text;	

				// Set cursor (this should not fire as it's called from a new requestanimationframe stack)
				if (setcursor) Hiro.canvas.setcursor();										
			});	

			// Resize textarea
			Hiro.canvas.resize();				

			// 	Switch quote on or off for programmatic text changes
			if ((text.length > 0 && this.quoteshown) || (text.length == 0 && !this.quoteshown)) {
				var d = (this.quoteshown) ? -1 : 1;
				Hiro.ui.fade(this.el_quote,d,150);
				this.quoteshown = !this.quoteshown;				
			} 			
		},

		// Resize textarea to proper height
		resize: function() {
			var h;

			// Do not resize on mobile devices
			if (Hiro.ui.mini()) return;

			// With the next available frame
			Hiro.ui.render(function(){
				// Set values
				Hiro.canvas.cache._height = Hiro.canvas.overlay.el_root.scrollHeight;
				Hiro.canvas.el_text.style.height = (Hiro.canvas.cache._height + 50).toString() + 'px';
			})
		},

		// Get cursor position, returns array of selection start and end. These numbers are equal if no selection.
		getcursor: function() {
		    var el = this.el_text, x, y, content, l, part, full;	

		    if ('selectionStart' in el) {
		    	//Mozilla and DOM 3.0
		        x = el.selectionStart;
				y = el.selectionEnd;
				l = el.selectionEnd - el.selectionStart;
				content = el.value.substr(el.selectionStart, l)
		    } else if (document.selection) {
		    	//IE
		        el.focus();
		        var r = document.selection.createRange(),
		        	tr = el.createTextRange(),
		        	tr2 = tr.duplicate();
		        tr2.moveToBookmark(r.getBookmark());
		        tr.setEndPoint('EndToStart',tr2);
		        if (r == null || tr == null) {
		        	x = el.value.length;
		        	y = el.value.length;
		        	content = '';
		        	return [x, y, content];
		        } 
		        part = r.text.replace(/[\r\n]/g,'.'); //for some reason IE doesn't always count the \n and \r in the length
		        full = el.value.replace(/[\r\n]/g,'.');
		        x = whole.indexOf(part,tr.text.length);
		        y = x + part.length;
		        content = r.text;
		    }  
		    return [x, y, content];	
		},

		// Set cursor position, accepts either number or array of two numbers representing selection start & end
		setcursor: function(pos) {
			var el = this.el_text;

			// Never set focus in moving or open folio on touch devices (pulls up keyboard)
			if (Hiro.ui.touch && (Hiro.folio.open || Hiro.ui.slidedirection == 1)) return;			

			// Set default value
			pos = pos || Hiro.data.get('note_' + this.currentnote,'_cursor') || 0;

			// Create array if we only got a number
			if (typeof pos == 'number') pos = [pos,pos];

    		// Set the position    		
    		if (el.setSelectionRange) {
				el.focus();													
				el.setSelectionRange(pos[0],pos[1]);																																		   									
    		} else if (el.createTextRange) {
        		var range = el.createTextRange();
        		range.collapse(true);
        		range.moveEnd('character', pos[0]);
        		range.moveStart('character', pos[1]);
        		range.select();
    		} else {
    			el.focus();
    		}	
		},

		// Overlay (clickable URLs, peer carets etc) 
		overlay: {
			// DOM Nodes
			el_root: document.getElementById('overlay'),				

			// Geerate new overlay
			paint: function(string) {
				var el = this.el_root;
				Hiro.ui.render(function(){
					el.innerText = string + ' ';
				});
			},

			// Insert string at pos x
			insert: function() {

			}

		},

		// Context sidebar
		context: {
			el_root: document.getElementById('context')
		} 	
	},

	// All user related stuff
	user: {
		// DOM Nodes
		el_login: document.getElementById('s_signin'),
		el_register: document.getElementById('s_signup'),
		el_reset: document.getElementById('s_reset'),		

		// Internals
		authinprogress: false,	

		// Grab registration form data, submit via XHR and process success / error
		// The Login and Register screens and flows are pretty much the same, 
		// we only have to decide which DOM branch we use in the first line
		logio: function(event,login) {
			var branch = (login) ? Hiro.user.el_login : Hiro.user.el_register, 
				url = (login) ? '/tokens/login' : '/tokens/signup', 
				b = branch.getElementsByClassName('hirobutton')[1],
				v = branch.getElementsByTagName('input'),							
				e = branch.getElementsByClassName('mainerror')[0],
				payload = {	
					password: v[1].value
				},
				parse = Hiro.util.mailorphone(v[0].value),
				sid = Hiro.data.get('profile','c.sid');

			// Prevent default event if we have one from firing submit
			if (event) Hiro.util.stopEvent(event);				

			// Preparation
			if (this.authinprogress) return;

			// Check for proper values
			if (!parse || !v[1].value) {
				// Bit redundant but cleaner UX this way
				if (!v[1].value) {
                	v[1].className += ' error';
                	v[1].nextSibling.innerText = "Your password";
                	v[1].focus();					
				}	
				if (!parse) {
                	v[0].className += ' error';
                	v[0].nextSibling.innerText = "Your Email or Phone #";
                	v[0].focus();					
				}				
				// Abort here
				return;			
			}

			// Add data to payload
			payload[parse[0]] = parse[1];
			if (sid) payload.sid = sid;

			// Letttsssss gooo
			this.authinprogress = true;				
			b.innerText = (login) ? 'Logging in...' : 'Signing Up...';

			// Remove focus on mobiles
			if (Hiro.ui.touch && document.activeElement) document.activeElement.blur();				

			// Clear any old error messages
			v[0].nextSibling.innerHTML = v[1].nextSibling.innerHTML = e.innerHTML = '';			
 
			// Send request to backend
			Hiro.sync.ajax.send({
				url: url,
	            type: "POST",
	            payload: JSON.stringify(payload),
				success: function(req,data) {
					// Reset DOM & flag	
	                b.innerText = (login) ? 'Log-In' : 'Create Account';
	                Hiro.user.authinprogress = false;

	                // Process login					
					Hiro.user.logiocomplete(data,login);										                    
				},
				error: function(req,data) {		
					// Reset DOM & flag	
	                b.innerText = (login) ? 'Log-In' : 'Create Account';
	                Hiro.user.authinprogress = false;

	                // Show error						
					if (req.status==500) {
						e.innerText = "Something went wrong, please try again.";
						Hiro.sys.error('Auth server error for ' + payload.email,req);							
						return;
					}
	                if (data.email) {
	                	v[0].className += ' error';
	                	v[0].nextSibling.innerText = data.email;
	                	v[0].focus();
	                }	
	                if (data.password) {
	                	v[1].className += ' error';	                    	
	                	v[1].nextSibling.innerText = data.password;  
	                	v[1].focus();	                	
	                }	                 		                    						                    
				}										
			});	
		},

		// Handle Fb Signups / Logins
		fbauth: function(target,login) {
			var branch = (login) ? Hiro.user.el_login : Hiro.user.el_register, 	
				button = branch.getElementsByClassName('fb')[0],						
				e = branch.getElementsByClassName('mainerror')[0], fbtokens, reason;

			// Only do one at a time
			this.authinprogress = true;

			// Set UI
			button.innerText = 'Connecting...';

			// Send action to FB
			// TODO Bruno: See if new all.js supports mobiles better or if we still have to redirect to window.location = '/connect/facebook?next=/';
			Hiro.lib.facebook.pipe({
				todo: function(obj) {
					// First try to get status
					FB.getLoginStatus(function(response) {
						// Logged into FB & Hiro authed
						if (response.status === 'connected') {
							// Create ref
							fbtokens = response.authResponse;
						// Not logged into FB or Hiro not authed	
						} else { 
							// Set reason for prompting login
							reason = (response.status === 'not_authorized') ? 'auth' : 'login';

							// Ask user to login and or auth Hiro on FB
							FB.login(function(response) {
								// Yay, user granted perms
								if (response.authResponse) {
									// Create ref
									fbtokens = response.authResponse;
								} 
							// Add scope here
							},{scope: 'email'});
						}

						// If we have got tokens
						if (fbtokens) {
							// Request token from backend
							Hiro.sync.ajax.send({
								url: "/_cb/facebook",
				                type: "POST",
				                payload: JSON.stringify(fbtokens),
								success: function(req,data) {
									obj.success(data);
								},
								error: function(req,data) {
									obj.error('backend',data)
								}
							});							
						} else {
							// FB login or hiro auth process aborted by user
							if (obj && obj.error) obj.error('abort' + reason)
						}
					});	
				},
				// If the TODO was successfully completed
				success: function(data) {
					// Forward to handler
					Hiro.user.logiocomplete(data,login);
					// Allow next try	
					Hiro.user.authinprogress = false;						
				},
				// If something hapenned along the way
				error: function(reason,data) {
					// We screwed up
					if (reason == 'backend') {
						e.innerText = 'Hiro not available, please try again later.';	
						button.innerText = 'Try again';	
						Hiro.sys.error('Facebook login failed on our side',data);
					// FB not available or user offline										
					} else if (reason == 'sourceoffline') {
						e.innerText = 'Facebook not available, please try later.';	
						button.innerText = 'Try again';	
					// User aborted											
					} else {
						button.innerHTML = ((login) ? 'Log-In' : 'Sign-Up') + ' with <b>Facebook</b>';	
					}
					// Allow next try	
					Hiro.user.authinprogress = false;					
				}
			});
		},

		// Post successfull auth stuff
		logiocomplete: function(data,login) {	
			// Close dialog
			Hiro.ui.dialog.hide();

			// Begin loading bar
			Hiro.ui.hprogress.begin();			

			// USe token to request new session
			Hiro.sync.createsession(data.token);	
		},

		// Send logout command to server, fade out page, wipe localstore and refresh page on success
		logout: function() {
			// Wipe local data immediately 
			Hiro.data.local.wipe();

			// Log
			Hiro.sys.log('Local data wiped, reloading page');

			// Make sure other tabs refresh as well
			Hiro.sync.tabtx('window.location.href = "/"');						                    		

			// Start fading out body, reload our own window after that
			Hiro.ui.fade(document.body,-1,400,function(){ window.location.href = "/" });			
		},	

		// Request password reset
		requestpwdreset: function() {

		},	

		// Hello. Is it them you're looking for?
		contacts: {
			// Lookup object by ID
			lookup: {},

			// Internals
			maxsearchlength: 2000,

			// Iterate through peers and update lookup above
			update: function() {
				var c = Hiro.data.get('profile','c.contacts'), i, l;

				// Abort if we have no contacts yet
				if (!c) return;

				// Build lookup object
				for (i = 0, l = c.length; i < l; i++) {
					this.lookup[c[i].uid] = c[i];
				}
			},

			// Search all relevant contact properties and return array of matches
			search: function(string,max) {
				var contacts = Hiro.data.get('profile','c.contacts'),
					results = [], c, i, l = contacts.length, max = max || 20;

				// Return if no search provided
				if (!string) return;

				// Make sure we have the right string	
				if (typeof string == "string") string.toLowerCase();
				else if (typeof string == "number") string.toString();	
				else return;

				// Impose length limits
				if ( (l > 100 && string.length == 1) || (l > 500 && string.length == 2) ) return;			

				// Iterate through contacts
				for (i = 0; i < l ; i++) {	
					c = contacts[i];				
					// Rules to be observed
					// IndexOf on strings should be our fastest option here
					// TODO Bruno: Sort the continue statements from most to least likely
					if 	((!c.name || c.name.toLowerCase().indexOf(string) == -1) &&
						(!c.email || c.email.toLowerCase().indexOf(string) == -1) &&	
						(!c.phone || c.phone.indexOf(string) == -1)) continue;

					// Add all who made it until
					results.push(c);

					// Stop after n results
					if (results.length == max) return;

					// Don't let large phonebooks hold us down
					if (i == this.maxsearchlength) return;
				}

				// Return list of result references
				return results;
			},

			// Add a user to our contacts list
			add: function(obj,source) {
				var contacts = Hiro.data.get('profile','c.contacts') || [], shadow = Hiro.data.get('profile','s.contacts') || [],
					prop, i, l;

				// Check for duplicates, uid should never be used for adding contacts in the client
				for (prop in obj) {
					if (obj.hasOwnProperty(prop) && prop != 'uid') {
						// See if we already have a user with that property
						for ( i = 0, l = contacts.length; i < l; i++ ) {
							// Ignore irrelevant properties
							if (prop != 'uid' && prop != 'email' && prop != 'phone') continue;
							// 
							if (contacts[i][prop] == obj[prop]) {
								// Log
								Hiro.sys.log('Already have contact with ' + prop + ' ' + obj[prop] + ', aborting add',obj);

								// End here
								return;
							}
						}					
					}
				}

				// Add contact to array
				contacts.push(obj);

				// Add copy to shadow if server created it
				if (source == 's') shadow.push(JSON.parse(JSON.stringify(obj)));

				// Update lookup
				this.update();

				// Save data
				Hiro.data.set('profile','c.contacts',contacts,source);
			},

			// Remove a user form the contacts list
			remove: function(obj,source) {
				var contacts = Hiro.data.get('profile','c.contacts'), shadow = Hiro.data.get('profile','s.contacts'),
					i, l, prop, type;

				// Abort if we don not have contacts yet but for some reason managed to call this
				if (!contacts) return;	

				// Remove from shadow if user obj has a uid
				if (obj.uid) {
					for ( i = 0, l = shadow.length; i < l; i++ ) {
						if (shadow[i].uid && shadow[i].uid == obj.uid) {
							// Remove from array, this means it has to be in contacts as well so we save below
							shadow.splice(i,1);
							break;
						}	
					}
				}

				// If we have multiple properties
				for (prop in obj) {
					if (obj.hasOwnProperty(prop)) {
						// See if we can find what we're looking for		
						for ( i = 0, l = contacts.length; i < l; i++ ) {
							if (contacts[i][prop] == obj[prop]) {
								// Remove contact from array
								contacts.splice(i,1);

								// Write back array
								Hiro.data.set('profile','c.contacts',contacts,source);

								// Update lookup
								this.update();									

								// End here
								return;
							}
						}
					}
				}											
			}
		},

		// Checkout
		checkout: {
			// Internals
			targettier: 0,
			active: false,

			// Prepare checkout form
			show: function(tt) {
				var ct = Hiro.data.get('profile','c.tier') || 0,
					root = document.getElementById('s_checkout'),
					fields = root.getElementsByTagName('input'),
					d, tip, action;

				// Set local vars
				this.targettier = tt;	

				// User chooses current plan
				if (ct == tt) {
					// Depending if we tease an upgrade
					if (Hiro.ui.dialog.upgradeteaser) Hiro.ui.dialog.hide();
					else Hiro.ui.switchview(document.getElementById('s_account'));

				// User wants to upgrade
				} else if (tt > ct) {
					// Check if Stripe is already loaded or do so otherwise
					if (!window.Stripe) Hiro.lib.stripe.load();
									
					// Set values for upgrade / preorder smoke test					
					if (tt == 2) {
						d = 'Advanced Plan: $ 9';
						tip = '';
						action = 'Upgrade';
					} else if (tt == 3) {
						d = (Hiro.ui.mini()) ? 'Pro Plan: $ 29' : "Pro Plan: $ 29 ($ 9 Advance until it's available)";
						tip = 'Be among the very first to be switched over, automatically!';
						action: 'Preorder';
					}

					// Set description
					root.getElementsByTagName('input')[0].value = d;
					root.getElementsByTagName('input')[0].setAttribute('title',tip);

					// Set button description
					root.getElementsByClassName('hirobutton').innerText = action;

					// Switch view
					Hiro.ui.switchview(document.getElementById('s_checkout'));

					// Focus CC
					fields[1].focus();
				// User wants to downgrade	
				} else if (tt < ct) {
					this.downgrade(tt);
				}
			},

			// Validate form and send to stripe if ok
			validate: function() {
				var root = document.getElementById('s_checkout'),
					form, fields, ccfields, el, me, button, subscription, plans = [0,1,'Advanced','Pro'];

				// Fatal!
				if (!window.Stripe) Hiro.sys.error('User tried to checkout with no stripe loaded',root);					

				// One try at a time
				if (this.active || !root || !window.Stripe) return;

				// set lock flag
				this.active = true;

				// Grab form and other elements
				form = root.getElementsByTagName('form')[0];
				button = root.getElementsByClassName('hirobutton')[0];
				fields = root.getElementsByTagName('input');
				me = form.getElementsByClassName('mainerror')[0];

				// Show user whats going on
				button.innerText = 'Validating...';

				// Build subscription object
				subscription = {};
				subscription.plan = plans[this.targettier];

				console.log('checkpouts!',subscription,button);				

				// Ping Stripe for token
				Stripe.createToken(form, function(status,response) {					
					if (response.error) {
						// Form field list to Stripe field name mapping and add error class
						ccfields = [0,'number','exp_month','exp_year','cvc'];
						if (ccfields.indexOf(response.error.param) > 0) {
							el = fields[ccfields.indexOf(response.error.param)];
							el.className += ' error';	
							// FOcus on problematic field
							el.focus();
						}											

						// Add error message for number
						if (response.error.param == 'number') {							
							fields[1].nextSibling.innerText = response.error.message;
							fields[1].nextSibling.className += ' error';

						// Or all other errors to generic field											
						} else if (me) {
							me.innerText = response.error.message;							
						}

						// Reset
						Hiro.user.checkout.active = false;
						button.innerText = "Try again";

						// Log & return
						Hiro.sys.error('CC check gone wrong, Stripe sez:',response);							
						return;

					} else {
						// add new stripe data to subscription object
						subscription.token = response.id;	

						// Send token to backend
						Hiro.sync.ajax.send({
							url: "/settings/plan",
			                type: "POST",
			                payload: JSON.stringify(subscription),
							success: function(req,data) {
								// w00p w00p, set stage and everything
			                    Hiro.ui.setstage(data.tier);	
			                    Hiro.user.checkout.active = false;	
			                    Hiro.ui.dialog.hide();	
								// Clean up form 
								button.innerText = 'Upgrade';			                    		                    						                    
							},
			                error: function(req,data) {
			                	// Log
			                	Hiro.sys.error('Checkout went wrong on our side: ', data);		
			                	// Reset and show
			                    Hiro.user.checkout.active = false;
			                    me.innerText = "Hiro wasn't available, please try again a little bit later";
								button.innerText = "Try again";			                    				                	                	
			                }					
						});														
					}								
				});								
			},

			// Sniiieff, so loooneeesssoooommmmeee tonight
			downgrade: function(tier) {
				var root = document.getElementById('s_plan'), button;

				// check & set flag
				if (this.active || !root) return;
				this.active = true;

				// Get box & render button content
				button = root.getElementsByClassName(tier)[0].getElementsByClassName('light')[0];
				button.innerText = 'Downgrading...';

				// Post to server, bitterly
				Hiro.sync.ajax.send({
					url: "/settings/plan",
	                type: "POST",
	                payload: JSON.stringify({plan:tier}),
					success: function(req,data) {
	                    Hiro.ui.setstage(data.tier);	
	                    Hiro.user.checkout.active = false;	
		                Hiro.ui.dialog.hide();	                    
	                    Hiro.ui.statusflash('green','Downgraded, sorry to see you go.',true);					                    
					}
				});					
			}
		}
	},

	// Everybodies needs them! Less about Hiro itself than a pattern learning ground
	apps: {
		// List of apps
		installed: {
			sharing: {
				id: 'sharing'
			}
		},

		// Nodes
		el_root: document.getElementById('apps'),

		// Vals
		open: [],

		init: function() {
			// Go through all available apps
			for (var app in this.installed) {
				var el = document.getElementById('app_' + app);

				// Attach touch and click handlers
				Hiro.ui.touchy.attach(el,Hiro.apps.touchhandler,100);
				Hiro.ui.fastbutton.attach(el,Hiro.apps.clickhandler);		
				Hiro.util.registerEvent(el,'keyup',Hiro.apps[app].keyhandler);	
			}	
		},

		// Touchy handler thats fired for each app on hover or touchstart
		touchhandler: function(event,element) {
			var that = Hiro.apps;
			// If this app is already open for some reason, do nothing
			if (that.open.indexOf(element.id.substring(4)) > -1) return;

			// Close all others if they should be open
			if (that.open.length > 0) that.closeall();

			// Open widget
			that.show(element);		
		},

		// Fires on touch or click within an app, delegate to respective app
		clickhandler: function(id,type,target,branch,event) {
			var appid = branch.id.split('_');

			// If we got a non-app branch
			if (appid[0] != 'app') return;

			// Call app clickhandler
			Hiro.apps[appid[1]].clickhandler(id,type,target,branch,event)
		},

		// Open app widget
		show: function(el_app) {
			// Add ID to open list
			this.open.push(el_app.id.substring(4));

			// Update & display app			
			Hiro.ui.render(function(){
				Hiro.apps.sharing.update();
				el_app.getElementsByClassName('widget')[0].style.display = 'block';
				el_app.getElementsByTagName('input')[0].focus();
			});
		},

		close: function(app) {
			// Abort if no apps open
			if (this.open.length == 0) return;

			// If no app is given, we close all of them
			for (var i = this.open.length; i > 0; i--) {
				document.getElementById('app_' + this.open[i - 1]).getElementsByClassName('widget')[0].style.display = 'none';
				this.open.pop();
			}

			// Set focus back on current doc
			Hiro.canvas.setcursor();
		},

		// OK, fuck it, no time to rewrite vue/angular
		sharing: {
			// DOM Nodes
			el_root: document.getElementById('app_sharing'),

			// Internals
			inviting: false,

			// Default keyhandler
			keyhandler: function(event) {
				// Forward keyup event to validate
				if (event.type != 'keydown') Hiro.apps.sharing.validate(event); 
			},

			// Default clickhandler
			clickhandler: function(id,type,target,branch,event) {
				var peer, contact, el, url, note, title, text;

				// Split id
				id = id.split(':');

				// Execute respective action
				if (type == 'full') {
					switch (id[0]) {
						case 'close':
							Hiro.apps.close(branch.id);
							break;
						// Fired by keyboard handler on invite input and fastbutton submit	
						case 'invite':
							this.validate(event,true);	
							break;
						// Tap on typeahead link
						case 'ta':
							this.validate(event,true,id[1]);
							break;						
						// Exisitng peer list click/tap	
						case 'peer':
							if (target.className == 'remove') {
								// Build object of peer to remove
								peer = { user: {} };
								peer.user[id[1]] = id[2];

								// Remove peer from peers
								this.removepeer(peer);

								// If we also got a temporary user, remove it from contacts too
								if (id[1] != 'uid') {
									contact = {};
									contact[id[1]] = id[2];
									Hiro.user.contacts.remove(contact);
								}								
							}	
							break;
						// Switch between modes
						case 'switch':
							// Switch to desired part
							Hiro.ui.switchview('widget:' + id[1]);
							// Select input field contents
							if (id[1] == 'share') document.getElementById('widget:share').getElementsByTagName('input')[0].select();
							break;
						// Teh shares! Teh shares!
						case 'share':
							// Get URL & current note with details
							url = document.getElementById('widget:share').getElementsByTagName('input')[0].value;
							note = Hiro.data.get('note_' + Hiro.canvas.currentnote,'c');
							text = note.text.substring(0,500) || 'Hiro is the easiest way to share notes with friends.';
							title = note.title.substring(0,50) || 'Hiro.';
							// On Fatzelboeks
							if (id[1] == 'fb') {
								// Send package to facebook
								Hiro.lib.facebook.pipe({
									todo: function(obj) {
										// Open share dialog
										FB.ui({							
											method: 'share',
											href: url,
	           								name: title,
	            							description: text,	           								
	            							caption: 'https://' + location.host,
								            actions: {
								                name: 'Start Your Own',
								                link: 'https://www.hiroapp.com/connect/facebook',
								            }											
										});
									}
								});
							// Tweet (Love to 'Ooops, oh my' song by her)
							} else if (id[1] == 'tw') {
								Hiro.ui.tweet(url + ' ' + (note.text.substring(0,200) || title));
							// Send mail	
							} else if (id[1] == 'mail') {
								Hiro.ui.mail(title, url + ' ' + text);
							}
					}
				}				
			},			

			// Validate the current form, this is either triggered by keyup event handler or click on invite 
			validate: function(event,submit,string) {
				// Only one invite at a time
				if (this.inviting) return;

				var type, error, el = this.el_root, that = this, el_button = el.getElementsByClassName('hirobutton')[0], 
					el_input = el.getElementsByTagName('input')[0], el_error = el.getElementsByClassName('error')[0],
					string = string || el_input.value, parse = Hiro.util.mailorphone(string),
					peers = Hiro.data.get('note_' + Hiro.canvas.currentnote,'c.peers'), newpeer, contact, i, l,
					ta, el_ta = el.getElementsByClassName('peers')[0], 
					el_sel = el.getElementsByClassName('selected')[0], oldsel, newsel;

				// See if we have an email
				if (parse) {
					type = parse[0];
					string = parse[1];
				}

				// Check for dupes 
				if (type) {
					for ( i = 0, l = peers.length; i < l; i++ ) {
						// Delete peer and stop loop if successfull
						if (peers[i].user[type] == string) {
							// Set type
							type = 'dupe';

							// End loop			
							break;
						}	
					} 
				}				

				// User presses enter, evaleval!
				if (event.keyCode == 13 || submit) {
					// If user presses enter while a typeahead suggestion is loaded, avoid sending it back for validation with enter key
					if (event.keyCode == 13 && el_sel && !submit) {
						// Get data attribute
						this.validate(event,true,el_sel.getAttribute('data-hiro-action').split(':')[1]);

						// Stop here
						return;
					// If we gots a dupe
					} else if (type == 'dupe') {
						// Add error message
						error = (peers.role ='invited') ? 'Already invited' : 'Already has access';
					// Do some invite
					} else if (type) {
						// Set peerchange flag, shortcut (will be saved below)
						Hiro.data.get('note_' + Hiro.canvas.currentnote)._peerchange = true;

						// Create and add peer object to folio
						newpeer = { role: 'invited', user: {}};
						newpeer.user[type] = string;
						this.addpeer(newpeer);

						// Add copy of new peer to contacts as well
						contact = {};
						contact[type] = string;
						Hiro.user.contacts.add(contact);

						// Show quick inviting
						Hiro.ui.statsy.add('invite',0,'Inviting...','info',300);				

						// Set inviting so render below can work properly
						this.inviting = true;
					// Throw error, this is rendered by the render() below if error isn't an empty string	
					} else {
						error = 'Please use a valid email address or phone number';
					}	
				// Check for cursor up (38) & down (40), maybe left (37) or right (39) for typeahead	
				} else if (event.keyCode == 40 || event.keyCode == 38) {

					// Abort if we have no typeahead suggestions
					if (!el_ta.firstChild) return;

					// Noes, no seleted node
					if (!el_sel) {
						// Select first or last element
						el_sel = (event.keyCode == 40) ? el_ta.firstChild : el_ta.lastChild;						

						// Add classname
						el_sel.className += ' selected';

					// If we pressed up and have a prevous sibling
					} else if (event.keyCode == 38 && el_sel.previousSibling) {		
						// Set references, some browser lose the getElementsByClassName selections on classname change
						oldsel = el_sel; newsel = el_sel.previousSibling;

						// Add new class to sibling						
						newsel.className += ' selected';

						// Reset existing classname
						oldsel.className = 'peer';						
					// If we pressed down and have a next sibling
					} else if (event.keyCode == 40 && el_sel.nextSibling) {
						// Set references
						oldsel = el_sel; newsel = el_sel.nextSibling;

						// Add new class to sibling
						newsel.className += ' selected'

						// Reset existing classname
						oldsel.className = 'peer';
					}

					// Stop here
					return;
				}

				// Fetch typeahead results now if we made it that far
				if (!this.inviting) ta = Hiro.apps.sharing.typeahead(string);

				// Render everything
				Hiro.ui.render(function(){					
					// Add results to typeahead area or empty it					
					el_ta.innerHTML = '';
					if (ta) el_ta.appendChild(ta);

					// Clean up error if we have one
					el_error.innerHTML = error || ''; 	
					el_error.style.display = (error) ? 'block' : 'none';

					// Refocus input on submit event
					if (submit) el_input.focus();

					// Pretend to do something that takes time if we fired a proper invite
					if (that.inviting) {						
						// Enable next invite
						that.inviting = false;

						// Reset & focus input field
						el_input.value = '';
						el_input.focus();

						// Switch button to standard
						el_button.className = 'hirobutton grey';
						el_button.innerHTML = (Hiro.ui.mini()) ? 'Invite next' : 'Added! Invite next';	

						// Show quick inviting
						Hiro.ui.statsy.add('invite',3,'Invited.');	

					// We have a dupe
					} else if (type == 'dupe') {
						// Change button
						el_button.className = 'hirobutton grey';
						el_button.innerHTML = 'Invite <b>' + string + '</b>';
					// Make evrythign grey	
					} else if (type) {
						// Truncate string if it's too long
						if (string.length > 22) string = string.substring(0,20) + '...';

						// Change button
						el_button.className = 'hirobutton green';
						el_button.innerHTML = 'Invite <b>' + string + '</b> via ' + ((type == 'phone') ? 'SMS' : 'E-Mail');
					// Make evrythign grey	
					} else {
						// Truncate
						if (string.length > 30) string = string.substring(0,29) + '...';

						// Switch back to 'disabled'
						el_button.className = 'hirobutton grey';
						el_button.innerHTML = 'Invite <b>' + string + '</b>';						
					}	
				});				
			},

			// Populate header and widget with data from currentnote, triggerd by show and peer changes from server
			update: function() {
				var peers = Hiro.data.get('note_' + Hiro.canvas.currentnote, 'c.peers'),
					token = Hiro.data.get('note_' + Hiro.canvas.currentnote, '_token'),
					counter = this.el_root.getElementsByClassName('counter')[0],
					el_peers = this.el_root.getElementsByClassName('peers'), f, i, l, us, onlyus,
					el_url = this.el_root.getElementsByTagName('input');	

				// Preload facebook
				if (!window.FB) Hiro.lib.facebook.load();	

				// Populate!
				Hiro.ui.render(function(){
					// Insert URL into sharing part
					if (token) el_url[el_url.length - 1].value = 'https://' + location.host + '/#' + token;

					// Placeholder fragments
					f = document.createDocumentFragment();

					// Add other peers
					for (i =0, l = peers.length; i < l; i++) {
						// our own uid is always added by the server so this is save
						if (peers[i].user.uid && peers[i].user.uid == Hiro.data.get('profile','c.uid')) {
							// Add reference to ourselves
							us = peers[i];

							// But do not render yet
							continue;
						} 				

						// Fetch DOM snippet
						f.appendChild(Hiro.apps.sharing.renderpeer(peers[i])); 
					}		

					// See if we are the only ones
					if (peers.length == 0 || (peers.length == 1 && !f.firstChild)) onlyus = true;

					// if the counter changed
					counter.style.display = (onlyus) ? 'none' : 'block';

					// Add one if we had a dummy us
					counter.innerText = ( (!us) ? peers.length + 1 : peers.length ).toString();						

					// Add dummy user for ourselves (if doc was created offline and not synced yet)
					if (!us) us = { role: 'owner'};						

					// Clear both typeahead and peers list
					el_peers[0].innerHTML = el_peers[1].innerHTML = '';

					// Add ourselves and then rest to DOM
 					el_peers[1].appendChild(Hiro.apps.sharing.renderpeer(us,true,onlyus))					
					if (Hiro.ui.mini()) el_peers[1].insertBefore(f,el_peers[1].firstChild);
					else el_peers[1].appendChild(f);					
				});		
			},

			// Turns a peer entry into the respective DOM snippet
			renderpeer: function(peer,us,onlyus) {	
				var d, r, n, text, user, rt, action, tt;

				// Other peers
				if (!us) {
					// Try to retrieve user details from contacts
					if (peer.user.uid) user = Hiro.user.contacts.lookup[peer.user.uid]				

					// Build namestring, contact first
					text = ( (user) ? user.email || user.phone :  peer.user.email || peer.user.phone || peer.user.us ) || 'Anonymous';

					// Wrap it nicely if we have a name
					if (user && user.name) text = user.name + ' (' + text + ')';

				// Ourselves	
				} else {
					text = (onlyus) ? 'Only you' : 'You';
				}	

				// Build main DIV
				d = document.createElement('div');
				d.className = 'peer';

				// Find right data attribute
				if (!peer.user) {
					// Do nothing if we have no peer
				} else if (peer.user.uid) {
					action = 'uid:' + peer.user.uid; 
				} else if (peer.user.email) {
					action = 'email:' + peer.user.email;
				} else if (peer.user.phone) {
					action = 'phone:' + peer.user.phone;
				}

				// Set data attribute
				if (action) d.setAttribute('data-hiro-action','peer:' + action);

				// Add Owner tooltip or removal link
				if (peer.role == "owner") {
					tt = 'Owner';					
				} else {
					// Set tooltip for invited only
					if (peer.role == 'invited') tt = 'Invited';
					// Add remove link if user is not owner					
					r = document.createElement('a');
					r.className = 'remove';
					r.setAttribute('title',(rt || 'Revoke access'));
					d.appendChild(r);					
				}

				// Add seen flag to classname
				if (us || (peer.last_seen && peer.last_seen > Hiro.data.get('note_' + Hiro.canvas.currentnote)._lastedit)) {	
					// Pimp title
					if (tt) tt += ': ';
					tt += (us) ? 'You are looking at the latest version' : 'Has seen the latest version ' + Hiro.util.humantime(peer.last_seen) + ' ago';

					// Add green tick to icon				
					d.className += " seen";
				}		

				// Set tooltip
				if (tt) d.setAttribute('title', tt);						

				// Add user name span
				n = document.createElement('span');
				n.className = (peer.role == 'invited') ? 'name invited' : 'name';
				n.innerText = text;
				d.appendChild(n)

				// Return object
				return d;
			},	

			// Creates a DOM element for typeahead
			rendersuggestion: function(peer,s) {		
				var d, n, start, prop, hit, defaultchannel;

				// Find out which string matched
				for (prop in peer) {
					if (peer.hasOwnProperty(prop)) hit = prop;
				}

				// Find the default way to invite
				defaultchannel = (hit == 'email' || hit == 'phone') ? peer[hit] : peer.email || peer.phone;

				// Create containing div
				d = document.createElement('div');
				d.className = 'peer';
				d.setAttribute('data-hiro-action','ta:' + defaultchannel);

				// Define namestring
				ns = (peer.name) ? peer.name + '(' + defaultchannel + ')' : defaultchannel;

				// Insert <em>s around found string				
				start = ns.toLowerCase().indexOf(s.toLowerCase());
				ns = 'Add ' + ns.substring(0,start) + '<em>' + ns.substr(start,s.length) + '</em>' + ns.substring(start + s.length);

				// Add user name span
				n = document.createElement('span');
				n.className = 'name suggested';
				n.innerHTML = ns;

				// Finish construction
				d.appendChild(n);

				// Return object
				return d;
			},			

			// Typeahead function that fetches & renders contacts
			typeahead: function(string) {
				var matches, i, l, j, k, dupe, count = 0,
					f = document.createDocumentFragment(),
					peers = Hiro.data.get('note_' + Hiro.canvas.currentnote, 'c.peers');

				// Abort if we have nothing to search
				if (!string) return;

				// Get matches from contact list
				matches = Hiro.user.contacts.search(string);

				// If we got no matches then abort
				if (!matches || matches.length == 0) return false;

				// Fill fragment with up to 4 results
				for (i = 0, l = matches.length; i < l; i++ ) {
					dupe = false;

					// Make sure the match is no dupe
					for (j = 0, k = peers.length; j < k; j++) {
						if ((peers[j].user.uid && matches[i].uid && peers[j].user.uid == matches[i].uid) ||
							(peers[j].user.email && matches[i].email && peers[j].user.email == matches[i].email) ||
							(peers[j].user.phone && matches[i].phone && peers[j].user.phone == matches[i].phone)) dupe = true;
					}

					// Duped!
					if (dupe) continue;

					// count
					count++;

					// Add DOM snippet to placeholder
					f.appendChild(this.rendersuggestion(matches[i],string));

					// Only render 5 matches
					if (count == 4) break;
				}

				// Return data
				return f;
			},

			// Check if proper & execute invite
			addpeer: function(peer,noteid,source) {
				var peers, shadow, note;

				// Default to current note if none is provided
				noteid = noteid || Hiro.canvas.currentnote;

				// Get peers
				peers = Hiro.data.get('note_' + noteid, 'c.peers') || [];
				shadow = Hiro.data.get('note_' + noteid, 's.peers') || [];

				// On small screens we add the new peer to the top of the array
				if (Hiro.ui.mini()) peers.unshift(peer); 
				else peers.push(peer);

				// If the server triggered the add 
				if (source == 's') {
					// Also add it to the shadow
					shadow.push(JSON.parse(JSON.stringify(peer)));

					// Get full note
					note = Hiro.data.get('note_' + noteid);

					// See if we have a new edit timestamp thats more recent
					if (peer.last_edit && peer.last_edit > note._lastedit) {
						// Update values (will be saved by set below)
						note._lastedit = peer.last_edit;
						note._lasteditor = peer.user.uid;
					}
				}	

				// Save peer changes
				Hiro.data.set('note_' + noteid,'c.peers',peers,source);

				// If it concerns the current note
				if (noteid == Hiro.canvas.currentnote) {
					// Update counter / widget
					this.update(true);
					// Set cache reference to ourselves if not done yet
					if (!Hiro.canvas.cache._me && peer.user.uid == Hiro.data.get('profile','c.uid')) Hiro.canvas.cache._me = peer;
				}	

				// Repaint folio
				Hiro.folio.paint();
			},

			// Fetch a certain peer, needs our standard peer format
			getpeer: function(peer,noteid) {
				var peers, i, l, p;

				// Default to current note
				noteid = noteid || Hiro.canvas.currentnote;

				// Get peers array
				peers = Hiro.data.get('note_' + noteid,'c.peers');

				// Abort if there are no peers
				if (!peers || peers.length == 0) return false;

				// Iterate through peers
				for (i = 0, l = peers.length; i < l; i++ ) {
					// Go through all properties of the user object
					for (p in peers[i].user) {
						if (peers[i].user.hasOwnProperty(p)) {
							// Ignore all properties except those
							if (p != 'uid' && p != 'email' && p != 'phone') continue;							
							// Compare the unique peers[i] properties with the one of our provided user
							if (peer.user[p] == peers[i].user[p]) return peers[i];
						}
					}
				}

				// No peers found & returned above
				return false;
			},

			// Remove peer from peers
			removepeer: function(peer, noteid,source) {
				var peers, i, l, p;

				// Default to current note
				noteid = noteid || Hiro.canvas.currentnote;

				// Get peers array
				peers = Hiro.data.get('note_' + noteid,'c.peers');

				// Abort if there are no peers
				if (!peers || peers.length == 0) return false;

				// Iterate through peers
				for (i = 0, l = peers.length; i < l; i++ ) {
					// Go through all properties of the user object
					for (p in peers[i].user) {
						if (peers[i].user.hasOwnProperty(p)) {
							// Ignore all properties except those
							if (p != 'uid' && p != 'email' && p != 'phone') continue;
							// Compare the unique peers[i] properties with the one of our provided user
							if (peer.user[p] == peers[i].user[p]) {
								// Splice peer from array
								peers.splice(i,1);
								// Save peers
								Hiro.data.set('note_' + noteid,'c.peers',peers);
								// Paint folio to update counters
								Hiro.folio.paint();
								// Rerender peers widget if operation concerns current peer
								if (noteid == Hiro.canvas.currentnote) this.update();
								// Save changes
								Hiro.data.set('note_' + noteid,'c.peers',peers,source);
								// Ack deletion
								return true;
							}
						}
					}
				}

				// No peers found & deleted above
				return false;									
			}		
		} 

	},

	// Local data, model and persitence
	data: {
		// Object holding all data
		stores: {},

		// Name of stores that are synced with the server
		onlinestores: ['folio','profile'],

		// Log which data isn't saved and/or synced
		unsaved: [],
		unsynced: [],

		// Set up datastore on pageload
		init: function() {
			// Lookup most common store and all notes
			var p = this.local.fromdisk('profile'), n = this.local.fromdisk('_allnotes');

			// If we do have data stored locally
			if (p && n) {	
				// Remove landing page
				Hiro.ui.el_landingpage.style.display = 'none';

				// Load internal values
				this.unsynced = this.local.fromdisk('unsynced');			
				Hiro.sync.tokens = this.local.fromdisk('tokens');

				// Load stores into memory
				this.set('profile','',p,'l');
				for (var i = 0, l = n.length; i < l ; i++) {
					this.set('note_' + n[i].id,'',n[i],'l');
				}							
				this.set('folio','',this.local.fromdisk('folio'),'l');

				// Log 
				Hiro.sys.log('Found existing data in localstorage',localStorage);			

				// Commit any unsynced data to server
				Hiro.sync.commit();

				// Load doc onto canvas
				Hiro.canvas.load();
			} else {
				// Show landing page contents
				Hiro.ui.showlanding();

				// Bootstrap local only workspace
				Hiro.data.bootstrap();
			}

			// Attach localstore change listener
			Hiro.util.registerEvent(window,'storage',Hiro.data.localchange);			
		},		

		// Load minimal data necessary for session if we didn't get one from the server
		bootstrap: function() {
			var folio, profile;

			// Create minimal profile
			profile = { c: { contacts: [], tier: 0, session: 0 }, s: {}, sv: 0, cv: 0, kind: 'profile' };
			Hiro.data.set('profile','',profile);

			// Create minimal folio
			folio = { c: [], s: [], sv: 0, cv: 0, kind: 'folio' };
			Hiro.data.set('folio','',folio);		

			// Create new Note
			Hiro.folio.newnote();			

			// End loading bar
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('Spawned a new workspace in the client',[this.stores]);
			Hiro.sys.log('',null,'groupEnd');				
		},

		// Detect changes to localstorage for all connected tabs
		// All browser should fire this event if a different window/tab writes changes
		localchange: function(event) {
			// IE maps the event to window
			event = event || window.event;

			// Some browser fire the event in their own window (that wrote to localstorage), we prevent this here
			if (Hiro.ui.focus) return;

			// Extract proper key
			var k = event.key.split('.')[1];

			// Receive a message and execute it
			if (k == 'notify') {
				// Verify that it's the same session
				if (event.key.split('.')[2] == Hiro.data.get('profile','c.sid')) eval(event.newValue);
				return;
			}

			// Write changes
			if (event.newValue) Hiro.data.set(k,'',JSON.parse(event.newValue),'l',true);	
		},

		// Set local data
		set: function(store,key,value,source,paint) {
			source = source || 'c';

			// Create store if it doesn't exist yet
			if (!this.stores[store]) this.stores[store] = {};

			// Set data 
			if (key && key.indexOf('.') >= 0) { 
				this.deepset(this.stores[store],key,value);
			} else if (key) {
				this.stores[store][key] = value; 
			} else {
				// No key provided, so we write to the root of the object
				this.stores[store] = value
			};


			// Call respective post set handler
			if (store.substring(0,5) == 'note_' || this.onlinestores.indexOf(store) > -1) {
				// Mark store for syncing if the changes came from the client
				if (source == 'c' && this.unsynced.indexOf(store) < 0) this.unsynced.push(store);								

				// Call handler, if available
				if (this.stores[store] && this.post[this.stores[store].kind]) this.post[this.stores[store].kind](store,key,value,source,paint);

				// Only commit if changes came from client
				if (source == 'c') Hiro.sync.commit();	

			} else {
				// Mark store for local persistence and kickoff write
				if (source != 'l') this.local.quicksave(store);	
			}						
		},

		// If the key contains '.', we set the respective property
		// Example: someobj,'foo.bar.baz' becomes someobj[foo][bar][baz]
		deepset: function(obj,key,value) {
			// Split string into array
			var a = key.split('.'), o = obj;

            for (var i = 0, l = a.length; i < l - 1; i++) {
            	// Create current property string
                var n = a[i];
                // Create property (object) if it doesn't exist
                if (!(n in o)) o[n] = {};
            	// Go one level deeper
                o = o[n];
            }

            // Set value result
            o[a[a.length - 1]] = value;					
		},

		// Return data from local client
		get: function(store,key) {
			// We need a deeper look
			if (key && key.indexOf('.') >= 0 && this.stores[store]) {
				return this.deepget(this.stores[store],key);
			}

			// Simple lookups
			else if (key && this.stores[store] && this.stores[store][key]) {
				return this.stores[store][key];
			} else if (!key && this.stores[store]) {
				return this.stores[store];
			} else {
				return undefined;
			}
		},

		// Quick lookup of foo.bar.baz formated strings as keys
		deepget: function(obj,key) {
			// Split string into array
			var a = key.split('.'), o = obj;	
			
			// Simply go through values while we have some in the array
            while (a.length) {
            	// Pick the first key in line
                var n = a.shift();
                // Go deeper or return undefined
                if (n in o) {
                    o = o[n];
                } else {
                    return undefined;
                }
            }

            // Return the value at the end of the magnificient journey
            return o;
		},

		// Cleanly rename a store, we operate directly so no setters are triggered
		rename: function(oldid,newid) {
			var fs, i, l;

			// If we try to rename something that doesn't exist
			if (!this.stores[oldid]) {
				Hiro.sys.error('Tried to rename unknown store',[oldid,newid])
				return;
			}				

			// Copy object
			this.stores[newid] = JSON.parse(JSON.stringify(this.stores[oldid]));

			// In case of being a note, we also reset the folio and currentnote pointers to it
			if (oldid.substring(0,5) == 'note_') {
				// Update the client side of things
				if (Hiro.folio.lookup[oldid.substring(5)]) Hiro.folio.lookup[oldid.substring(5)].nid = newid.substring(5);	
				// Update the server side of things, removal first (we do splice and seperate push because the entry might not exist yet)
				fs = this.get('folio','s');
				for ( i = 0, l = fs.length; i < l ; i++ ) {
					if (fs[i].id == oldid.substring(5)) {
						fs.splice(i,1);
						break;
					}	
				}
				// Copy new one frome client to shadow (the lookup object isn't updated yet, so the key is still the old)
				if (Hiro.folio.lookup[oldid.substring(5)]) fs.push(JSON.parse(JSON.stringify(Hiro.folio.lookup[oldid.substring(5)])));

				// Set new currentnote id
				if (Hiro.canvas.currentnote = oldid.substring(5)) Hiro.canvas.currentnote = newid.substring(5);

				// Reset note id in store object
				this.stores[newid].id = newid.substring(5);
			}

			// Delete old object and localstorage object
			this.destroy(oldid);

			// Update our state arrays
			if (this.unsaved.indexOf(oldid) > -1) this.unsaved[this.unsaved.indexOf(oldid)] = newid;			
			if (this.unsynced.indexOf(oldid) > -1) this.unsynced[this.unsynced.indexOf(oldid)] = newid;

			// Save changes
			this.local.quicksave(newid);
			this.local.quicksave('folio');			
		},

		// Remove all synced data, this happens if we get new session data
		cleanup: function() {
			var i, l, f = this.get('folio','c'), c = this.get('profile','c.contacts');

			// Iterate through all folio docs
			for (i = f.length - 1; i >= 0; i--) {
				// Do not cleanup unsynced notes
				if (f[i].nid.length == 4) continue;

				// Delete synced notes
				this.destroy('note_' + f[i].nid);

				// Remove this entry from folio
				f.splice(i,1);
			}

			// Remove contacts
			for (i = c.length - 1; i >= 0; i--) {
				// Do not cleanup unsynced contacts
				if (c[i].user.uid) continue;

				// Remove this entry from contacts
				c.splice(i,1);
			}			
		},

		// Remove Note from memory & localstorage
		destroy: function(id) {
			this.stores[id] = null;
			delete this.stores[id];
			this.local.wipe(id);
		},

		// Various handlers executed after stores values are set, bit of poor mans react
		post: {
			// After a note store was set
			// TODO Bruno: Clean thi sup once most conditions are known
			note: function(store,key,value,source,paint) {
				var n = Hiro.data.stores[store], t, p, i, l,
					current = (store.substring(5) == Hiro.canvas.currentnote);

				// If the whole thing or client title changed, repaint the folio
				if ( key == 'c.title' || key == 'c.text' && !n.c.title) Hiro.folio.paint();
				else if (!key || key == 'c' || key == '_unseen') Hiro.folio.paint(true);	

				// If the update wasn't by client and concerns the current note
				if (source != 'c' && current) Hiro.canvas.paint();	

				// Abort here if the update came from localStorage to avoid infinite save loops
				if (source == 'l')  return;

				// Save
 				Hiro.data.local.quicksave(store);							
			},

			// After the folio was set
			folio: function(store,key,value,source,paint) {
				// Repaint folio
				Hiro.folio.paint(true);	

				// Abort if source is localStorage
				if (source == 'l') return;

				// Save
				Hiro.data.local.quicksave(store);
			},			

			// After the profile was set
			profile: function(store,key,value,source,paint) {
				// Update contact lookup
				Hiro.user.contacts.update();	

				// Abort if source is localStorage
				if (source == 'l') return;				

				// Save
				Hiro.data.local.quicksave(store);								
			}

		},

		// All localstorage related functions
		local: {
			// Internals
			saving: false,
			timeout: null,
			maxinterval: 3000,
			dynamicinterval: 100,			

			// Mark a store for local persistence and kick it off 
			quicksave: function(store) {
				// Add store to currently unsaved data
				if (Hiro.data.unsaved.indexOf(store) < 0) Hiro.data.unsaved.push(store);			

				// Update localstore
				this.persist();
			},

			// Persist data to localstorage
			persist: function() {
				// Do not run multiple saves at once
				if (this.saving) return;
				var start, end, dur, key, value, i, l;

				// Set flag and notify user
				this.saving = true;
				if (!Hiro.sync.synconline || Hiro.sync.cachelock || !Hiro.data.get('profile','c.tier')) Hiro.ui.statsy.add('sns',0,'Saving...');

				// Start timer
				start = Date.now(); 

				// Cycle through unsaved stores
				for (i = 0, l = Hiro.data.unsaved.length; i < l; i++) {
					key = Hiro.data.unsaved[i],	value = Hiro.data.stores[key];	

					// Write data into localStorage	
					this.todisk(key,value)						
				}

				// Persist list of unsynced values and tokens
				this.todisk('unsynced',Hiro.data.unsynced);
				this.todisk('tokens',Hiro.sync.tokens);				

				// Empty array
				Hiro.data.unsaved = [];

				// Measure duration
				end = Date.now(); 
				dur = (end - start);

				// Log longer persistance times
				if (dur > 20) Hiro.sys.log('Data persisted bit slowly, within (ms):',dur,'warn');

				// Set new value if system is significantly slower than our default interval
				this.dynamicinterval = ((dur * 100) < this.maxinterval ) ? ( dur * 100 || 100 ) : this.maxinterval;

				// Trigger next save to browsers abilities
				this.timeout = setTimeout(function(){
					Hiro.data.local.saving = false;

					// Rerun persist if new changes happened
					if (Hiro.data.unsaved.length > 0) Hiro.data.local.persist();

					// Or let user know were done
					else Hiro.ui.statsy.add('sns',3,'Saved.');	
				},this.dynamicinterval);
			},

			// Request data from persistence layer
			fromdisk: function(store,key) {
				var data;

				// In case we want all notes
				if (store == '_allnotes') {
					var notes = [], i , l = localStorage.length, k;

					for (i = 0; i < l; i++ ) {
						k = localStorage.key(i);
						if (k.substring(0,10) == 'Hiro.note_') notes.push(JSON.parse(localStorage.getItem(k)));
					}
					return notes;					
				}

				// Standard cases
				store = 'Hiro.' + store

				// Get data
				try {
					data = localStorage.getItem(store);	
					data = JSON.parse(data);						
				} catch (e) {
					Hiro.sys.error('Error retrieving data from localstore',e);		
				}

				// Fetch key or return complete object
				if (key && data[key]) {
					return data[key];
				} else {
					return data;
				}			
			},

			// Generic localstore writer, room for browser quirks
			todisk: function(key,value) {
				// Make sure we store a string and extend string with Hiro
				if (typeof value !== 'string') value = JSON.stringify(value);
				key = 'Hiro.' + key.toString();

				// Write and log poetntial errors
				try {
					localStorage.setItem(key,value);
				} catch(e) {		
					Hiro.sys.error('Datastore error',e);
				}	
			},

			// Delete some or all data set by our host
			wipe: function(store) {
				// No store, remove all
				if (!store) {
					// Iterate through all localstorage items for current domain
					for (var i = localStorage.length - 1;i > -1; i--) {
						// Verify that we only delete Hiro data and no third party stuff
						if (localStorage.key(i) && localStorage.key(i).substring(0, 5) == 'Hiro.') localStorage.removeItem(localStorage.key(i));
					}
				// store var provided, remove specific store	
				} else {
					if (localStorage['Hiro.' + store]) localStorage.removeItem('Hiro.' + store); 
				}	
			}
		}
	},

	// Connecting local and server state
	sync: {
		protocol: undefined,

		// Timing stuff
		lastsend: 0,
		latency: 100,

		// Prevent two commits being in progress
		commitinprogress: false,
		tags: [],

		// Lock thats released by appcache noupdate event
		cachelock: true,

		// Onlinestates incl initial values
		synconline: false,
		webonline: false,

		// Token(s) we will try to fallback on
		tokens: [],

		// Init sync
		init: function(ws_url) {
			// Check if we got Websocket support, might need refinement
			if (window.WebSocket && window.WebSocket.prototype.send) {
				// Connect via websockets
				this.protocol = 'ws';
				this.ws.url = ws_url;
			} else if (window.XMLHttpRequest) {
				// Longpolling fallback
				this.protocol = 'lp';			
			} else {
				Hiro.sys.error('Oh noes, no transport protocol available',navigator);					
			}	

			// Connect to server
			this.connect();
		},

		// Establish connection with server 
		connect: function() {
			if (this.protocol == 'ws') {
				this.ws.connect();
			}

			// Increment hprogress
			Hiro.ui.hprogress.inc(0.2)
		},

		// Try all reconnects
		reconnect: function() {
			if (!this.synconline && this[this.protocol]) this[this.protocol].reconnect();
			if (!this.webonline) this.ajax.reconnect();
		},

		// Authenticate connection
		auth: function() {
			var sid = Hiro.data.get('profile','c.sid'), payload;

			// Just quick ehlo with to make sure session is still valid
			if (sid) {	
				// End bootstrapping logging group
				Hiro.sys.log('Startup completed with existing ID',sid);	
				Hiro.sys.log('',undefined,'groupEnd');						        	

				// Send	a waiting commit or a client ack	
				if (!this.commit()) this.ping();	

			// We have no session! 	
			} else {
	        	// Logging
				Hiro.sys.log('No session found, creating new one');

				// Create session with new anontoken				
				this.createsession();					
			}
		},	

		// Create session handler
		createsession: function(token) {
			var r = { "name": "session-create" }, sid = Hiro.data.get('profile','c.sid');

			// Look into tokenbag as fallback (most likely by URL hash at this point)
			if (!token && this.tokens.length > 0) token = this.tokens[0];	

			// See if a token was provided
			if (token) {
				// Add token and optional session data to request
				r.token = token;

				// Add existing sid if present
				if (sid) {
					r.sid = sid;

		        	// Logging
					Hiro.sys.log('Requesting new session with existing SID ',sid,'warn');				
				}

	        	// Logging
				Hiro.sys.log('Requesting new session with token ',token);				

				// Sending request
				this.tx(r)				
			// No token provided, get one now	
			} else {
				// Get token (fires createsession again if successful)				
				this.getanontoken();
			}
		},	

		// Get token from Flask and use it to create new session
		getanontoken: function() {
        	// Logging
			Hiro.sys.log('Requesting anonymous token');		

			// Send request to backend
			Hiro.sync.ajax.send({
				url: '/tokens/anon',
	            type: 'GET',
				success: function(req,data) {
		        	// Logging
					Hiro.sys.log('Received anonymous token ' + data.token);	

					// Request session					
					Hiro.sync.createsession(data.token);										                    
				},
				error: function(req,data) {	
		        	// Logging
					Hiro.sys.error('Unable to fetch Anon token',req);                 		                    						                    
				}										
			});			
		},

		// Send message to server
		tx: function(data) {
			var sid = Hiro.data.get('profile','c.sid');
			if (!data) return;				

			// Make sure we always send an array
			if (!(data instanceof Array)) data = [ data ];			

			for (var i=0,l=data.length;i<l;i++) {	
				// Make sure no empty or null/undefined messages get sent
				if (!data[i]) continue;

				// Add timestamp
				this.lastsend = Hiro.util.now();	

				// Enrich data object with sid (if we have one) & tag
				if (!data[i].sid && sid) data[i].sid = sid;				
				if (!data[i].tag) {
					// Create tag and add it for later lookup
					data[i].tag = Math.random().toString(36).substring(2,8);	
					this.tags.push(data[i].tag);
				}	
			}

			// Send to respective protocol handlers
			if (this.protocol == 'ws') {
				this.ws.socket.send(JSON.stringify(data));
			} else if (this.protocol == 'lp') {
				this.lp.send(JSON.stringify(data));				
			} else {
				Hiro.sys.error('Tried to send data but no transport protocol available',data);
			}
		},

		// Receive message
		rx: function(data) {
			var i, l, handler, rt;
			if (!data) return;

			// Cycle through messages
			for (i=0,l=data.length; i<l; i++) {
				// Ignore empty messages
				if (!data[i]) continue;

				// Build handler name				
				handler = (data[i].name) ? data[i].name.replace(/-/g, "_") : undefined;
				if (handler) handler = 'rx_' + handler + '_handler';

				// Check if handler exists and abort if not
				if (!handler || !this[handler]) {
					Hiro.sys.error('Received unknown response:',data[i]);
					return;
				}

				// Fire handler
				this[handler](data[i]);	

				// Measure roundtrip and reset
				if (this.lastsend > 0) this.latency = (Hiro.util.now() - this.lastsend) || 100;
				this.lastsend = 0;			
			}
		},

		// Overwrite local state with servers on login, session create or fatal errors
		rx_session_create_handler: function(data) {
			var n, note, sf, cf, fv, peers, req, sp, cp, peer, user, i, l;

			// Remove all synced data
			Hiro.data.cleanup();

			// CReate new blank profile object
			sp = data.session.profile; 
			cp = {};

			// Set versions and other basics
			cp.cv = cp.sv = 0;	
			cp.kind = sp.kind;
			cp.id = sp.id;

			// Stringify contact array 
			peers = JSON.stringify(sp.val.contacts || []);
			user = JSON.stringify(sp.val.user)

			// Add data to profile object
			cp.c = JSON.parse(user); 
			cp.s = JSON.parse(user);

			// Add contacts & session
			cp.c.contacts = (cp.c.contacts) ? cp.c.contacts.concat(JSON.parse(peers)) : JSON.parse(peers);			
			cp.s.contacts = JSON.parse(peers);
			cp.c.sid = cp.s.sid = data.sid;	

			// Save profile, overwriting existing data
			Hiro.data.set('profile','',cp,'s');			

			// Create notes
			for (note in data.session.notes) {
				if (!data.session.notes.hasOwnProperty(note)) continue;

				// Create client and server references
				sn = data.session.notes[note];	
				cn = {};

				// Set versions and other basics
				cn.cv = cn.sv = 0;	
				cn.kind = sn.kind;
				cn.id = sn.id;			

				// Build client and shadow versions
				cn.c = {}; cn.s = {};

				// Copy peer array 
				peers = JSON.stringify(sn.val.peers || []);
				cn.c.peers = JSON.parse(peers);
				cn.s.peers = JSON.parse(peers);

				// Set custom internal values
				cn._token = sn.val.sharing_token;	
				cn._owner = sn.val.created_by.uid;
				cn._created = sn.val.created_at;

				// Loop through peers	
				// NOTE: We can't work with simple references and keep all data in the respective peer elements
				// because simple references become their own objects after writing/reading them to/from localstorage
				for (i = 0, l = cn.c.peers.length; i < l; i++ ) {
					// Shortcut
					peer = cn.c.peers[i];

					// Set latest editor if we have none yet or overwrite if more recent
					if (peer.last_edit && (!cn._lasteditor || cn._lastedit < peer.last_edit)) {
						cn._lasteditor = peer.user.uid;
						cn._lastedit = peer.last_edit;
					}

					// Set our own data
					if (peer.user.uid == cp.c.uid) {
						cn._ownedit = peer.last_edit;
						cn._cursor = peer.cursor_pos;
					}
				}			

				// Set text & title
				cn.c.text = cn.s.text = sn.val.text;
				cn.c.title = cn.s.title = sn.val.title;

				// Create a dedicated store for each note
				Hiro.data.set('note_' + note,'',cn,'s');				
			}		

			// Add notes to folio
			sf = data.session.folio; 
			cf = Hiro.data.get('folio') || {};
			cf.cv = cf.sv = 0;
			fv = JSON.stringify(sf.val);			
			cf.s = JSON.parse(fv);
			cf.c = (cf.c) ? cf.c.concat(JSON.parse(fv)) : JSON.parse(fv);	
			cf.kind = sf.kind;
			cf.id = sf.id;

			// Update tokens
			if (this.tokens.indexOf(data.token) > -1) {
				// Remove token
				this.tokens.splice(this.tokens.indexOf(data.token),1);

				// Log
				Hiro.sys.log('Succesfully consumed token ' + data.token + ' on session create.')	
			}

			// Folio triggers a paint, make sure it happens after notes ad the notes data is needed								
			Hiro.data.set('folio','',cf,'s');	

			// Load the first note mentioned in the folio onto the canvas
			if (cf.c && cf.c.length > 0) {
				// Load doc onto canvas
				Hiro.canvas.load();	
			// If the folio is still empty, we create a new note				
			} else {
				// Log
				Hiro.sys.log('New session contains no notes and folio is empty, creating & loading first note...')	

				// Do
				Hiro.folio.newnote();			
			}				

			// Reset UI
			Hiro.ui.setstage();				

			// Complete hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('New session created',data);
			Hiro.sys.log('',undefined,'groupEnd');						
		},

		// Process changes sent from server
		rx_res_sync_handler: function(data) {
			// Find out which store we're talking about
			var id = (data.res.kind == 'note') ? 'note_' + data.res.id : data.res.kind, ack = (this.tags.indexOf(data.tag) > -1),
				store = Hiro.data.get(id), dosave, update, regex, ops, i, l, j, jl, ssv, scv, stack, regex = /^=[0-9]+$/, obj, me;

			// Process change stack
			for (i=0,l=data.changes.length; i<l; i++) {
				// Check for potential infinite lopp				
				if (data.changes.length > 100 || (store.edits && store.edits.length > 100) ) {
					Hiro.sys.error('Unusual high number of changes',JSON.parse(JSON.stringify([data,store])));
				}	

				// Log stuff to doublecheck which rules should be applied				
				if (data.changes[i].clock.cv != store.cv || data.changes[i].clock.sv != store.sv) {
					// Shorten before get crazy here
					ssv = data.changes[i].clock.sv;
					scv = data.changes[i].clock.cv

					// Server sends an edit twice, so we just ignore it
					if (ssv < store.sv) {
						Hiro.sys.log('Server sent sv' + ssv + ' twice, local sv' + store.sv + ', ignoring changes:',data.changes[i].delta);
					// Log all other cases we don't handle / know how to handle yet	
					} else {
						Hiro.sys.error('Unknown sync case with Server cv' + scv + ' sv' + ssv	+ ' and Client cv' + store.cv + ' sv' +  store.sv,JSON.parse(JSON.stringify([data,store])));
					}
					continue;
				}	

				// Iterate through delta msg's
				ops = data.changes[i].delta;
				for (j = 0, jl = ops.length; j < jl; j++) {
					// Process ops according to ressource kind and op
					switch (data.res.kind  + '|' + ops[j].op) {	
						// Store token with the document
						// TODO Bruno: Find out what's that used for exactly					
						case 'note|set-token':
							// Set values
							store._token = ops[j].value;		
							update = true;
							break;						
						// Add a peer to a note			
						case 'note|add-peer':
							// Add to peers
							Hiro.apps.sharing.addpeer(ops[j].value,store.id,'s');	
							update = true;
							break;	
						// Add a peer to a note			
						case 'note|rem-peer':
							// Build peer object
							obj = { user: {} };
							obj.user[ops[j].path.split(':')[0].replace('peers/','')] = ops[j].path.split(':')[1];
							// Send off for removal
							Hiro.apps.sharing.removepeer(obj,store.id,'s');	
							update = true;
							break;
						// Swap an existing peer for a new one or change it's role		
						case 'note|swap-user':
						case 'note|change-role':						
							// Build peer object
							obj = { user: {} };
							obj.user[ops[j].path.split(':')[0].replace('peers/','')] = ops[j].path.split(':')[1];
							// Reset values (hackich shortcut depending on ops name not changing)
							Hiro.apps.sharing.getpeer(obj)[ops[j].op.split('-')[1]] = ops[j].value;	
							// Add new user
							update = true;
							break;																										
						// Update title if it's a title update					
						case 'note|set-title':
							// Set values
							store.s.title = store.c.title = ops[j].value;	
							// Set internal values
							if (store.id != Hiro.canvas.currentnote) store._unseen = true;								
							// Add notification if we're not focused
							if (!Hiro.ui.focus) Hiro.ui.tabby.notify(data.res.id);
							update = true;
							break;
						// Update text if it's a text update							
						case 'note|delta-text':
							if (!(regex.test(ops[j].value))) {
								// Patch values
								this.diff.patch(ops[j].value,data.res.id);
								// Add notification if we're not focused
								if (!Hiro.ui.focus) Hiro.ui.tabby.notify(data.res.id);								
								// Continue if we had no error
								update = true;	
							} else {
								Hiro.sys.error('Received unknown note delta op',ops[j])
							}							
							break;	
						// Set timestamp							
						case 'note|set-ts':
							// Reference for our own user 
							me = Hiro.data.get('profile','c');

							// If it was an ack for our user, do nothing
							if (!(ack && ops[j].path.split(':')[1] == me.uid)) {
								// Assign obj to peer
								obj = Hiro.apps.sharing.getpeer( { user: {uid: ops[j].path.split(':')[1] }} );

								// Update edit values
								if (ops[j].value.edit) {
									// Always update peer object value
									obj.last_edit = ops[j].value.edit;

									// Compare & set _lastedit & editor
									if (note._lastedit < ops[j].value.edit) {
										// Set edit & editor
										note._lastedit = ops[j].value.edit;
										note._lasteditor = obj.user.uid;
										// If it was someone else, also set _unseen
										if (obj.user.uid != me.uid && store.id != Hiro.canvas.currentnote) store._unseen = true;										
									}

									// If the devil was us, also reset _ownedit	
									if (obj.user.uid == me.uid) note._ownedit = ops[j].value.edit;
								}
								
								// Update seen	
								if (ops[j].value.seen) obj.last_seen = ops[j].value.seen;
							}

							// Always iterate & save
							update = true;														
							break;							
						// Set proper id of a new note					
						case 'folio|set-nid':
							// Rename existing store, this also takes care of the as of now missing folio shadow entry 
							Hiro.data.rename('note_' + ops[j].path.split(':')[1],'note_' + ops[j].value);												
							break;
						// Set changed folio status							
						case 'folio|set-status':
							Hiro.folio.lookup[ops[j].path.split(':')[1]].status = ops[j].value;
							update = true;								
							break;	
						// Add a new note to the folio	
						case 'folio|add-noteref':
							// Trigger newnote with know parameters
							Hiro.folio.newnote(ops[j].value.nid,ops[j].value.status);							
							// Add notification if we're not focused
							if (!Hiro.ui.focus) Hiro.ui.tabby.notify(ops[j].value.nid);							
							break;
						// Change a user property
						case 'profile|set-name':
						case 'profile|set-email':
						case 'profile|set-phone':	
						case 'profile|set-tier':																	
							// Get profile object
							me = Hiro.data.get('profile');

							// Set values
							me.c[ops[j].op.split('-')[1]] = me.s[ops[j].op.split('-')[1]] = ops[j].value;
							
							update = true;
							break; 									
						// Remove a user from the contact list
						case 'profile|rem-user':
							// Build quick object
							obj = {};
							obj[ops[j].path.split(':')[0].replace('contacts/','')] = ops[j].path.split(':')[1];
							// Remove
							Hiro.user.contacts.remove(obj,'s');
							update = true;
							break; 	
						// Add a user to the contact list
						case 'profile|add-user':
							// Add straight to contacts
							Hiro.user.contacts.add(ops[j].value,'s');
							update = true;
							break; 																			
						default:
							Hiro.sys.error('Received unknown change op from server',ops[j]);		
					}
				}		

				// Remove outdated edits from stores
				if (store.edits && store.edits.length > 0) {
					stack = store.edits.length;
					while (stack--) {
						if (store.edits[stack].clock.cv <= data.changes[i].clock.cv) store.edits.splice(stack,1); 
					}
				}

				// If any update happened
				if (update) {
					// Iterate server version
					store.sv++;
					// Reset update flag for next run (if changes contains more than 1 change)
					update = false;
					// Set flag to save data
					dosave = true;
				}						
			}

			// Remove store from unsynced list if we have no more edits
			if (!store.edits || store.edits.length == 0) Hiro.data.unsynced.splice(Hiro.data.unsynced.indexOf(store),1);							

			// Find out if it's a response or server initiated
			if (ack) {
				// Remove tag from list if it's a reply
				this.tags.splice(this.tags.indexOf(data.tag),1);

				// Showit
				if (Hiro.data.get('profile','c.tier') > 0) Hiro.ui.statsy.add('sns',2,'Synced.');					

				// Release lock preventing push of new commits
				this.commitinprogress = false;	
			// Respond if it was server initiated
			} else {
				// Send any edits as response if there are any waitingwaitingwaiting
				if (store.edits && store.edits.length > 0) {
					data.changes = store.edits;
				// Make a quick diff to see if anything changed 
				// The single = is interntional, as it sets the value of data.changes an evaluates the if in one go (i assume...)	
				} else if (data.changes = this.diff.makediff(data.res.id)) {
				// If there are no changes at all, send a blank ack
				} else {
					data.changes = [{ clock: { cv: store.cv, sv: store.sv }, delta: []}];
				}		

				// Send
				this.tx(data);				
			}	

			// Save changes back to store, for now we just save the whole store, see if this could/should be more granular in the future
			if (dosave) Hiro.data.set(id,'',store,'s');								
		},

		// Process consume token response
		rx_token_consume_handler: function(data) {
			// Remove data from tokens
			if (this.tokens.indexOf(data.token) > -1) {
				// Remove token
				this.tokens.splice(this.tokens.indexOf(data.token),1);

				// Save
				Hiro.data.local.todisk('tokens',this.tokens);				

				// Log
				Hiro.sys.log('Succesfully consumed token ' + data.token);

				// See if we got any other token waiting and consume again
				if (this.tokens.length > 0) this.consumetoken();
			// Strange, we received an unknown token
			} else {
				Hiro.sys.error('Server said it consumed token unknown to us',[this.tokens,data]);
			}
		},

		// Send simple ping to server, either generic if no store id is provided or latest store edits / empty delta
		ping: function(storeid) {
			var sid = Hiro.data.get('profile','c.sid'), store, data = {};

			// Abort if we have no SID
			if (!sid) return;			

			if (storeid) {
				// Fetch store data
				store = Hiro.data.get(storeid)		
				
				// Abort if store doesn't exist
				if (!store) {
					Hiro.sys.error('Store to be pinged does not exist on client', storeid);
					return;
				}

				// Wrap msg in standard sync format
				data = this.wrapmsg(store);
			} else {
				// Build ping
				data.name = "client-ehlo";
	       		data.sid = sid;				
			}		

    		// Send ping
    		this.tx(data);
		},		

		// Create messages representing all changes between local model and shadow
		commit: function() {
			var u = Hiro.data.unsynced, i, l, newcommit, s, d;

			// Only one build at a time, and only when we're online, already have a session ID and had a appcache NoUpdate
			if (this.commitinprogress || !this.synconline || !Hiro.data.get('profile','c.sid') || this.cachelock) return;			

			// Set commit to true and start building it
			this.commitinprogress = true;
			newcommit = [];

			// Cycle through stores flagged unsynced, iterating backwards because makediff could splice a store from the list
			for (i = u.length - 1; i > -1; i--) {
				var s = Hiro.data.get(u[i]),
					d = this.diff.makediff(s);	

				// If diff told us that there are old or new edits					
				if (d) newcommit.push(this.wrapmsg(s));
			}

			// If we have any data in this commit, send it to the server now
			if (newcommit && newcommit.length > 0) {
				// Showit
				if (Hiro.data.get('profile','c.tier')) Hiro.ui.statsy.add('sns',0,'Syncing...');

				// Save all changes locally: At this point we persist changes to the stores made by deepdiff etc
				Hiro.data.local.persist();

				// Send off
				this.tx(newcommit);

				// We did commit something!
				return true;
			} else {
				// Release lock as no new commits were found
				this.commitinprogress = false;

				// Nothing committed
				return false;
			}	
		},

		// Build a complete res-sync message for given store
		wrapmsg: function(store) {			
			// Build wrapper object
			var r = {};
			r.name = 'res-sync';
			r.res = { kind : store.kind , id : store.id };
			r.changes = store.edits || [{ clock: { cv: store.cv, sv: store.sv }, delta: []}];
			r.sid = Hiro.data.get('profile','c.sid');	

			// Return r
			return r;	
		},

		// Consume a provided token
		consumetoken: function(token) {
			var sid = Hiro.data.get('profile','c.sid'),
				msg = {
					name: 'token-consume',
					token: token || this.tokens[0],
					sid: sid					
				};

			// Abort if there's absolutely no token or session
			if (!sid || (!token && (!this.tokens || this.tokens.length == 0 ))) return;

			// Save provided token if not done so
			if (this.tokens.indexOf(token) == -1) {
				// Add
				this.tokens.push(token);
				// Save
				Hiro.data.local.todisk('tokens',this.tokens);
			}		

			// Else send it
			this.tx(msg);
		},

		// If either sync or template server just timed out or got a fatal response
		goneoffline: function(server) {
			// Depending on which server we mean
			switch (server) {
				case 'sync':
					// Start trying to reconnect
					this[this.protocol].reconnect();	

					// If we already where offline abort here 
					if (!this.synconline) return;

					// Set online/offline flag
					this.synconline = false;									

					break;
				case 'web':
					// Start trying to reconnect
					this.ajax.reconnect();

					// If we already where offline abort here 
					if (!this.webonline) return;

					// Set online/offline flag
					this.webonline = false;	

					// Switch dialog content if it's open
					if (Hiro.ui.dialog.open) {
						Hiro.ui.switchview('d_msg');
						Hiro.ui.render(function(){ Hiro.ui.dialog.el_close.style.display = 'block' });
					}					

					break;					
			}

			// Log
			Hiro.sys.log('Connection to ' + server + '-server lost','','warn');
		},

		// Yay, we just came (back) online
		cameonline: function(server) {
			// Log
			Hiro.sys.log('Connection to ' + server + '-server established');			

			// Depending on which server we mean
			switch (server) {
				case 'sync':
					// Set online/offline flag, reset reconnect delay
					this.synconline = true;
					this[this.protocol].rcd = 1000;

					break;
				case 'web':
					// Set online/offline flag
					this.webonline = true;
					this.ajax.rcd = 1000;

					// Switch dialog content if it's open
					if (Hiro.ui.dialog.open) {
						if (Hiro.data.get('profile','c.tier') > 0) {
							Hiro.ui.switchview('d_settings');
							Hiro.ui.render(function(){ Hiro.ui.dialog.el_close.style.display = 'block' }) 							
						} else {
							Hiro.ui.switchview('d_logio')
						}	
					}					

					break;					
			}
		},

		// Sends a message to other tabs via localstorage (this triggers the Hiro.data.localchange event in all other tabs)
		tabtx: function(cmd) {
			// Abort if we have no data
			if (!cmd) return;

			// make sure we store properly
			if (typeof cmd != 'string') cmd = JSON.stringify(cmd);

			// Save & trigger localstorage change event in other tabs
			if (localStorage) localStorage.setItem('Hiro.notify.' + Hiro.data.get('profile','c.sid'),cmd);
		},

		// WebSocket settings and functions
		ws: {
			// The socket object
			socket: null,

			// Generic config			
			url: undefined,
			// Reconnectdelay
			rcd: 1000,

			// Establish WebSocket connection
			connect: function() {
				//  Log kickoff
				Hiro.sys.log('Connecting to WebSocket server at',this.url);

				// Spawn new socket
				this.socket = new WebSocket(this.url);

				// Attach onopen event handlers
				this.socket.onopen = function(e) {
					Hiro.sys.log('WebSocket opened',this.socket);	

					// Switch to online
					Hiro.sync.cameonline('sync');		

					// Auth the connection right away
					Hiro.sync.auth();		
				}

				// Message handler
				this.socket.onmessage = function(e) {
					Hiro.sync.rx(JSON.parse(e.data));
				}

				// Close handler
				this.socket.onclose = function(e) {
					// Switch to offline
					Hiro.sync.goneoffline('sync');					
					Hiro.sys.log('WebSocket closed with code ' + e.code + ' and ' + (e.reason || 'no reason given.'),[e,this.socket]);	
				}				
			},

			// Attempt a reconnect
			reconnect: function() {
				// Double delay
				this.rcd = (this.rcd > 10000) ? 20000 : this.rcd * 2; 

				// Log
				Hiro.sys.log('Trying to reconnect to sync server via websockets in ' + ( this.rcd / 1000) + ' second(s)...');	

				// 
				window.setTimeout(function(){
					// Abort if for some reason sync is already back online
					if (Hiro.sync.synconline) return;

					// Attempt reconnect
					Hiro.sync.ws.connect();					
				},this.rcd);	
			}
		},

		// Generic AJAX as well as longpolling settings & functions
		ajax: {
			// When we deem a response successfull or let us know that the server is alive
			successcodes: [200,204],
			alivecodes: [400,403,404,405,500],

			// Internal values
			socket: null,
			rcd: 1000,

			// Generic AJAX request handler
			// obj Object supports:
			// Method: GET, POST, PATCH
			// URL: Target URL
			// Headers: HTTP Headers to be included
			// Success: Success callback function
			// Error: Error callback function			
			send: function(obj) {
				if (!obj) return;

				// Define default values
				var method = obj.type || 'GET',
					async = obj.async || true,
					contentType = obj.contentType || 'application/json; charset=UTF-8',
					payload = obj.payload || '';	

				// Build proper URL encoded string for Form fallback
				if (obj.payload && contentType == 'application/x-www-form-urlencoded') {
					// TODO: Move this into util once it's tested
					var str = [];
					for (var p in obj.payload) {
						if (obj.payload.hasOwnProperty(p)) {
							str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj.payload[p]));
						}
					}
					payload = str.join("&");				
				}		

				// Non Patch supporting devices, move to array check once we have more
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
						req.onreadystatechange = function() {
							if (this.readyState == 4) {
								Hiro.sync.ajax.responsehandler(obj,this,(Hiro.sync.ajax.successcodes.indexOf(this.status) > -1));
							}
						};

						// Here we have to get browser specific
						if (typeof req.ontimeout != 'undefined') {						
							req.ontimeout = function() { 
								Hiro.sync.ajax.responsehandler(obj,this);									
							};
						} else {
							// TODO: timeout fallback
						}	
						// Note: This fires only on network level errors where state never changes to 4, otherwise we use the handler above
						if (typeof req.onerror != 'undefined') {												
							req.onerror = function() {					 
								Hiro.sync.ajax.responsehandler(obj,this);		
							};	
						} else {
							req.addEventListener("error", function() { 						
								Hiro.sync.ajax.responsehandler(obj,this);			
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
					Hiro.sys.error('Generic AJAX Error',e);
				}
			},

			// Generic response handler
			responsehandler: function(obj,response,success) {
				// If we already processed this response
				if (obj.called) return;

				// Set called flag
				obj.called = true;		

				// Build proper <data> response
				var ct = response.getResponseHeader('content-type') || '',
					data = response.responseText || '';

				// Try to parse JSON
				if (ct.indexOf('application/json') > -1) {
					try { data = JSON.parse(data);
					} catch(e) { 
						Hiro.sys.error('Application/JSON response contains no valid JSON',[e,response,obj]); 
					}
				}

				// Send reponse
				if (success && obj.success) obj.success(response,data);
				else if (obj.error) obj.error(response,data);

				// Set internal status if applicable
				if (!Hiro.sync.webonline && (success || this.alivecodes.indexOf(response.status) > -1) ) {
					Hiro.sync.cameonline('web');
				} else if (Hiro.sync.webonline && !(success || this.alivecodes.indexOf(response.status) > -1)) {
					Hiro.sync.goneoffline('web');
				}

				// Speed up GC
				obj = response = null;			
			},

			// Returns proper cross browser xhr method
			getreq: function() {
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
			},

			// Try reconnecting to template server
			reconnect: function() {
				// Double delay
				this.rcd = (this.rcd > 30000) ? 60000 : this.rcd * 2; 

				// Log
				Hiro.sys.log('Trying to reconnect to template server in ' + ( this.rcd / 1000) + ' second(s)...');	

				// 
				window.setTimeout(function(){
					// Abort if for some reason sync is already back online
					if (Hiro.sync.webonline) return;

					// Attempt reconnect
					// TODO Bruno: See if a dedicated beacon/health template makes more sense
					Hiro.ui.dialog.load();					
				},this.rcd);				
			}			
		},

		// Diff/match/patch specific stuff
		diff: {
			// The dmp instance we're using, created as callback when dmp script is loaded
			dmp: null,

			// Run diff over a specified store, create and add edits to edits array, mark store as unsaved
			makediff: function(store) {
				// Don't run if we already have edits for this store
				// TODO Bruno: Allow multiple edits if sending times out despite being offline (once we're rock solid)
				if (store.edits && store.edits.length > 1) return true;			

				// Define vars
				var d, changes, id = (store.kind == 'note') ? 'note_' + store.id : store.kind;

				// Get delta from respective diffing function (functions also set shadows to current versions)
				switch (store.kind) {
					case 'note':
						d = this.diffnote(store);
						break;
					case 'folio':
						d = this.difffolio(store);
						break;
					case 'profile':
						d = this.diffprofile(store);
						break;							
				}

				// Build changes object, iterate cv and return data if we have any changes
				if (d) {
					// Build changes object, iterate client version
					changes = {};
					changes.clock = { sv : store['sv'] , cv : store['cv']++ };						
					changes.delta = d;

					// Add this round's changes to edits
					store.edits = store.edits || [];
					store.edits.push(changes);	

					// Mark store as tainted but do not persist yet for performance reasons
					if (Hiro.data.unsaved.indexOf(id) < 0) Hiro.data.unsaved.push(id);	

				// Remove store from unsynced already at this point (as opposed to res_sync ack/incoming) if we have nothing to sync						
				} else if (!store.edits || store.edits.length == 0) {				
					Hiro.data.unsynced.splice(Hiro.data.unsynced.indexOf(store),1);					
				}

				// Return changes						
				return changes || false;

			},

			// Specific folio diff, returns proper changes format
			// NOTE: This does not support deleted notes yet, switch to associative array lookup if we should start supporting that
			difffolio: function(store) {
				var i, l, delta;

				// Iterate through shadow
				// We also do this to avoid sending newly created notes, which do not have a proper ID
				// and are not synced yet
				for ( i = 0, l = store.s.length; i < l ; i++ ) {
					// If we have a different status
					if (Hiro.folio.lookup[store.s[i].nid].status != store.s[i].status) {
						// Create delta array if not done so yet
						if (!delta) delta = [];
						// Add change to delta array
						delta.push({ "op": "set-status", "path": "nid:" + store.s[i].nid, "value": Hiro.folio.lookup[store.s[i].nid].status });
						// Set shadow to client version
						store.s[i].status = Hiro.folio.lookup[store.s[i].nid].status;
					}					
				}

				// Lookup new notes that aren't synced yet
				if ( store.s.length != store.c.length ) {
					for ( i = 0, l = store.c.length; i < l; i++) {
						if (store.c[i].nid.length < 5) {
							// Create delta array if not done so yet
							if (!delta) delta = [];	
													
							// Add appropriate op msg
							delta.push({"op":"add-noteref", "path": "", "value": {"nid": store.c[i].nid, "status": store.c[i].status}})
						}
					}
				}

				// Return delta value if we have one or false
				return delta || false;
			},

			// Specific notes diff, returns proper changes format of all notes on client side
			diffnote: function(note) {
				var i, l, p, h, delta = [], op, peer, cursor, ad;

				// Do not diff notes that have no server ID yet
				if (note.id.length < 5) return false;	

				// Compare different values, starting with text
				if (note.c.text != note.s.text) {
					// Fill with dmp delta
					delta.push({"op": "delta-text", "path": "", "value": this.delta(note.s.text,note.c.text)});
					// Synchronize c/s text
					note.s.text = note.c.text;
				}

				// Check title	
				if (note.c.title != note.s.title) {
					// Add title op
					delta.push({"op": "set-title", "path": "", "value": note.c.title });
					// Copy c to s					
					note.s.title = note.c.title;
				}	

				// If we have any updates until here, we also update our own timestamps & cursor position
				if (delta.length > 0) {
					// Retrieve peer
					peer = Hiro.apps.sharing.getpeer({ user: { uid: Hiro.data.get('profile','c.uid') }}, note.id);

					// Add timestamps if we already have a proper syncable peer object of ourselves
					if (peer) {
						delta.push({"op": "set-ts", "path": "peers/uid:" + peer.user.uid, "value": { 
							"seen": peer.last_seen || note._ownedit || Hiro.util.now()
						}});	

						// Add cursor op 
						if (peer.cursor_pos) delta.push({"op": "set-cursor", "path": "peers/uid:" + peer.user.uid, "value": peer.cursor_pos })

					} 
				}

				// Peers changed
				if (note._peerchange) {		
					// Find the peers with no uid yet
					for (i = 0, l = note.c.peers.length; i < l; i++ ) {
						// Ignore those
						if (note.c.peers[i].user.uid) continue;
						// Iterate through the others
						for (p in note.c.peers[i].user) {					
							// Grab the first prop
							if (note.c.peers[i].user.hasOwnProperty(p)) {
								// Prepare op object
								op = {"op": "invite", "path": "peers/", "value": {}};
								// Add property / value
								op.value[p] = note.c.peers[i].user[p];
								// Add to changes
								delta.push(op);
								// Break this obj iteration
								break; 
							};
						}
					}

					// Compare the ones with UID to see if any were added / removed / changed
					ad = this.arraydiff(note.c.peers,note.s.peers,'user.uid');

					// Process arraydiff changes
					if (ad && ad.changed) {
						// Process changes
						for ( i = 0, l = ad.changed.length; i < l; i++) {
							// Compare seen timestamps
							if (ad.changed[i].client.last_seen != ad.changed[i].shadow.last_seen) {
								// Add op
								delta.push({"op": "set-ts", "path": "peers/uid:" + ad.changed[i].client.user.uid, "value": { 
									"seen": ad.changed[i].client.last_seen 
								}});
								// Equalize value
								ad.changed[i].shadow.last_seen = ad.changed[i].client.last_seen;
							}						
						}
					}
					
					// Reset flag
					note._peerchange = false;
				}

				// Set delta to false if it has no content
				if (delta.length == 0) delta = false;

				// Return value
				return delta;	
			},

			// Specific profile diff, returns proper changes format
			diffprofile: function(store) {
				var delta, h = Hiro.util.hash(store.c.contacts), i, l, c, p;

				// If name changed
				if (store.c.name != store.s.name) {
					// First if, create delta 
					delta = [];
					// Add op
					delta.push({ "op": "set-name", "path": "user/uid:" + store.c.uid, "value": store.c.name });
					// Copy value
					store.s.name = store.c.name;			
				}

				// Check if contacts hash changed
				if (h != store._contacthash) {
					// Go through the client side to find unsynced contacts
					for (i = 0, l = store.c.contacts.length; i < l; i++ ) {
						// If the user has an ID ( == is already synced), continue
						if (store.c.contacts[i].uid) continue;

						// Build delta if not done yet and create c shorthand
						delta = delta || [];
						c = store.c.contacts[i];

						// Create new delta object
						delta[delta.length] = { op: 'add-user', path: 'contacts/', value: {} };

						// Get properties
						for (p in c) {
							// Check for own & non uid properties
							if (c.hasOwnProperty(p) && p != 'uid') {
								// Add all available fields to user object
								delta[delta.length - 1].value[p] = c[p];
							}
						}			
					}

					// TODO Bruno: Look through all known contacts if any values changed. 
					// This should only happen on the client if we look at the phonebook again and find extra numbers, mails.				

					// Save new hash value
					store._contacthash = h;
				}

				// Return
				return delta || false;
			},	

			// Generic function that takes two arrays and returns a list of items that where 
			// Added to current and/or removed from shadow
			// This works independent of order but needs a unique ID property of the objects
			arraydiff: function(current,shadow,id) {								
				var delta = {}, removed = [], added = [], changed = [], lookup = {}, i, l, v, p, ch;

				// Return if we didn't provide two arrays
				if (!(current instanceof Array) || !(shadow instanceof Array)) return false;

				// Helper that converts id
				function gn(obj,prop) {
					if (prop.indexOf('.') == -1) return obj;
					p = prop.split('.')
					for (var i = 0; i < p.length; i++) {
						if (typeof obj != "undefined") obj = obj[p[i]]; 
					}
					return obj;
				}

				// Build associative array and add all shadow IDs removed array
				for (i = 0, l = shadow.length; i < l; i++) {
					// Get property
					v = gn(shadow[i],id);
					// Ignore if object doesn't have property
					if (!v) continue;
					// 	Build associative array and add to removed
					lookup[v] = shadow[i];
					removed.push(v);
				}

				// Cycle through current version
				// TODO Bruno: See how indexOf works and if it screws our complexity
				for (i = 0, l = current.length; i < l; i++) {
					v = gn(current[i],id);
					// Ignore if object doesn't have id we're looking for
					if (!v) return;
					// Remove from removed array as it's still there
					if (removed.indexOf(v) > -1) removed.splice(removed.indexOf(v),1);
					// See if we can find it the lookup object, if not it's been added
					if (!lookup[v]) {
						added.push(v);
					// If yes, we check if it changed and add it to changed, right now we only do this for last seen	
					} else if (current[i].last_seen && lookup[v].last_seen != current[i].last_seen) {
						// Build change object & add to changed
						changed.push({ id: v, shadow: lookup[v], client: current[i] });
					}	
				}	

				// Return false if nothing was added or removed
				if (removed.length == 0 && added.length == 0 && changed.length == 0) return false;	

				// Build delta
				if (removed.length > 0) delta.removed = removed;
				if (added.length > 0) delta.added = added;
				if (changed.length > 0) delta.changed = changed;

				// Return
				return delta;
			},

			// Compare two strings and return standard delta format
			delta: function(o,n) {
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

			// Apply a patch to a specific note 
			patch: function(delta,id) {
				var n = Hiro.data.get('note_' + id), diffs, patch;

            	// Build diffs from the server delta
            	try { 
            		diffs = this.dmp.diff_fromDelta(n.s.text,delta) 
            		patch = this.dmp.patch_make(n.s.text,diffs);
            	} 
            	catch(e) {
            		Hiro.sys.error('Something went wrong during patching:',e);
            	}	         	       	

            	// Apply
                if (diffs && (diffs.length != 1 || diffs[0][0] != DIFF_EQUAL)) { 
            		// Apply the patch
                    n.s.text = this.dmp.patch_apply(patch, n.s.text)[0]; 
                    n.c.text = this.dmp.patch_apply(patch, n.c.text)[0];                                                         
	                Hiro.sys.log("Patches successfully applied");
                }             	
			},	
		}
	},

	// Core system functionality
	sys: {
		version: undefined,
		inited: false,
		production: (window.location.href.indexOf('hiroapp') != -1),	

		// System setup, this is called once on startup and then calls inits for the various app parts 
		init: function(vars) {
			// Begin startup logging
			Hiro.sys.log('Hiro startup sequence','','group');		

			// Prevent initing twice
			if (this.inited) return;

			// Store keys
			if (vars.fb) Hiro.lib.facebook.key = vars.fb;
			if (vars.stripe) Hiro.lib.stripe.key = vars.stripe;

			// Create DMP socket
			Hiro.sync.diff.dmp = new diff_match_patch();	

			// Polyfills
			if (!Date.now) Date.now = function now() { return new Date().getTime(); };	
			if (!String.prototype.trim) String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };

			// Check for hashes
			if (window.location.hash) this.hashhandler();

			// Setup other app parts
			Hiro.folio.init();
			Hiro.canvas.init();
			Hiro.ui.init();	
			Hiro.data.init();			
			Hiro.sync.init(vars.ws);	
			Hiro.lib.init();		
			Hiro.apps.init();	

			// Set up UI according to user level
			Hiro.ui.setstage();			

			// Load application cache
			if (window.applicationCache) {
				var frame = document.createElement('iframe');
				frame.style.display = 'none';
				frame.src = '/offline/manifestwrapper/';
				document.body.appendChild(frame);
			// Release the cachelock	
			} else {
				Hiro.sync.cachelock = false;
			}

			// Make sure we don't fire twice
			this.inited = true;		

			// Yay, nothing went fatally wrong (This has a very long time so "Ready/Offline" doesn't get overwritten by the initial save)
			Hiro.ui.statsy.add('startup',0,((!Hiro.sync.synconline || Hiro.data.get('profile','c.tier') == 0) && 'Ready.' || 'Offline.'),'info',1000);				

			// Log completion
			Hiro.sys.log('Hiro.js fully inited');
		},

		// Called if we have a hash on init
		// Hash format is #baaceed1406d406e80b65e7053ab51fa:reset, where strings shorter than 20 chars are actions while longer are tokens
		hashhandler: function() {
			var h = window.location.hash.substring(1).split(':'), i, l;

			// Iterate through hash components
			for (i = 0, l = h.length; i < l; i++) {
				if (h[i].length == 32) Hiro.sync.tokens.push(h[i]);
			}
		},

		// Called if a relevant cache event is fired
		cachehandler: function(event) {
			console.log(event);
		},

		// Takes a version nr and compares it to what we have. 
		// If we had a version number and first two two levels (11.2.333) changed we ask the user to reload
		versioncheck: function(ver) {
			var p = Hiro.data.get('profile'),
				v = this.version || p._hiroversion, ov, nv;

			// Log
			Hiro.sys.log('Checking version ' + ver + ' against latest known version ' + v);	

			// Compare versions, if we already have a local one
			if (v && ver != v) {
				// Split and remove minor versions (appengine internal and our smaller ones)
				ov = v.split('-');
				nv = ver.split('-');
				ov.pop(); nv.pop();

				// Check if remaining major version (x-xx) changed
				if (ov.toString() != nv.toString()) {
					// TODO Bruno: Show dialog

					// Log to check how often this is used
					Hiro.sys.error('Forced upgrade from ' + ov.toString() + ' to '+ nv.toString());						
				}
			}

			// Save local var
			this.version = ver;

			// Save latest version in profile object if we have one
			if (p) Hiro.data.set('profile','_hiroversion',ver);
		},

		// Send error to logging provider and forward to console logging
		error: function(description,data) {
			// Throw error to generate stacktrace etc
			var err = new Error();
			var stacktrace = err.stack || arguments.callee.caller.toString(),
				description = description || 'General error';

			// Send to logging service
			if ('Raven' in window) Raven.captureMessage(description + ', version ' + Hiro.sys.version + ': ' + JSON.stringify(data) + ', ' + stacktrace);			

			// Log in console
			this.log(description,data,'error');
		},

		// console.log wrapper
		log: function(description,data,type) {
			// Set specific types
			type = type || 'log';
			data = data || '';

			// Log only on non production systems
			if (this.production) return;

			// Fire logging
			var log = (typeof console[type] == 'function') ? console[type](description,data) : console.log(description,data);
		}
	},

	// All things ui. Click it, touch it, fix it, show it.
	ui: {
		// General properties
		// TODO Bruno: Compare with http://patrickhlauke.github.io/touch/tests/results/
		touch: ('ontouchstart' in document.documentElement),
		mobileapp: (window.navigator.standalone),
		mini: function(){ return (document.body.offsetWidth < 481) },
		midi: function(){ return (document.body.offsetWidth > 480 && document.body.offsetWidth < 901) },		

		// DOM IDs. Note: Changing Nodes deletes this references, only use for inital HTML Nodes that are never replaced
		el_wastebin: document.getElementById('wastebin'),
		el_archive: document.getElementById('archivelink'),
		el_signin: document.getElementById('signin'),
		el_settings: document.getElementById('settings'),
		el_landingpage: document.getElementById('landing'),

		// Browser specific properties
		vendors: ['webkit','moz','o','ms'],
		browser: undefined,
		opacity: '',		

		// Folio open/close properties
		slidewidth: 300,
		slideduration: 200,
		slidepos: 0,
		slidedirection: 0,	

		// Internals
		focus: false,

		// Setup and browser capability testing
		init: function() {
			var style = this.el_wastebin.style,
				v = this.vendors, i, l, r, measure;

			// Determine CSS opacity property
			if (style.opacity !== undefined) this.opacity = 'opacity';
			else {
				for (i = 0, l = v.length; i < l; i++) {
					if (style[v[i] + 'Opacity'] !== undefined) {
						this.opacity = v[i] + 'Opacity';
						this.browser = v[i];
						break;
					}
				}
			}

			// Find out which browser we're using if we dont't know yet
			if (!this.browser) {
				for (i = 0, l = v.length; i < l; i++) {
					if (style[v[i] + 'Transition'] !== undefined) {
						this.browser = v[i];
						break;
					}
				}				
			}

			// Set vendor specific global animationframe property
			// Paul Irish polyfill from http://www.paulirish.com/2011/requestanimationframe-for-smart-animating/
			(function() {
			    var lastTime = 0, vendors = Hiro.ui.vendors;
			    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
			        window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
			        window.cancelAnimationFrame =
			          window[vendors[x]+'CancelAnimationFrame'] || window[vendors[x]+'CancelRequestAnimationFrame'];
			    }

			    if (!window.requestAnimationFrame)
			        window.requestAnimationFrame = function(callback, element) {
			            var currTime = Hiro.util.now();
			            var timeToCall = Math.max(0, 16 - (currTime - lastTime));
			            var id = window.setTimeout(function() { callback(currTime + timeToCall); },
			              timeToCall);
			            lastTime = currTime + timeToCall;
			            return id;
			        };

			    if (!window.cancelAnimationFrame)
			        window.cancelAnimationFrame = function(id) {
			            clearTimeout(id);
			        };
			}());

			// Mobile specific setup
			if (this.touch) {
				// Make sure the viewport is exactly the height of the browserheight to avoid scrolling issues
				// TODO Bruno: Find reliable way to use fullscreen in all mobile browsers, eg  minimal-ui plus scrollto fallback
				measure = 'height=' + window.innerHeight + ',width=device-width,initial-scale=1, maximum-scale=1, user-scalable=no';
				document.getElementById('viewport').setAttribute('content', measure);	

				// Attach swipe event listener 
				Hiro.util.registerEvent(window,'touchmove',Hiro.ui.swipe.move);
			}			

			// Start hprogress on init
			this.hprogress.init();	

			// Attach keyboard shortcut listener
			Hiro.util.registerEvent(window,'keydown',Hiro.ui.keyhandler);

			// Attach delegated clickhandler for shield, this handles every touch-start/end & mouse-down/up in the settings area
			this.fastbutton.attach(this.dialog.el_root,Hiro.ui.dialog.clickhandler)

			// Keyhandler for dialog
			Hiro.util.registerEvent(this.dialog.el_root,'input',this.dialog.keyhandler);	

			// Attach focus change handler
			this.attachfocuschange();

			// Attach History API event handler
			if (window.onpopstate) {
				window.onpopstate = function(e) { Hiro.ui.history.goback(e) };			
			} else {
				Hiro.util.registerEvent(window,'popstate', function(e) { Hiro.ui.history.goback(e) });			
			}						
		},

		// Render changes via rAF or, if window is not focused, right away
		// The reason we do this is that rAF collects all actions and executes them only if window gains focus again, 
		// so we could erronously end up with thousands of folio paints tha all get executed at once thus killing the window
		// for some secs or good
		render: function(fn) {
			// Check if a function is passed, try eval otherwise
			if (typeof fn != 'function') fn = eval(fn);

			// If window has focus
			if (this.focus) {
				requestAnimationFrame(fn)
			} else {
				fn();
			}
		},

		// Fire keyboard events if applicable
		keyhandler: function(event) {
			// Single keys that trigger an action
			switch (event.keyCode) {
				// If ESC key is pressed				
				case 27:
					// Hide dialog
					if (Hiro.ui.dialog.open) Hiro.ui.dialog.hide();
					// Hide widgets
					if (Hiro.apps.open.length > 0) Hiro.apps.close();
					break;
			}


			// If a key was pressed in combination with CTRL/ALT or APPLE
			if (event.ctrlKey || event.altKey || event.metaKey) {
				// Fire combos
				switch (event.keyCode) {
					// I key, open invite dialog
					case 73:
						Hiro.apps.show(Hiro.apps.sharing.el_root)					
						break;					
					// N key, not supressable in Chrome
					case 78:
						Hiro.util.stopEvent(event);						
						Hiro.folio.newnote();					
						break;
					// S key
					case 83:
						Hiro.util.stopEvent(event);						
						alert("Hiro saves all your notes automatically and syncs them with the cloud if you're signed in");
						break;
				}
			}
		},

		// Attach focuschange properly
		attachfocuschange: function() {
		    var handler = Hiro.ui.focuschange;

		    // Standards browser
		    if ('focus' in window && 'blur' in window) {
				Hiro.util.registerEvent(window, 'focus', handler);	 
				Hiro.util.registerEvent(window, 'blur', handler);				   	
		    }

		    // Iterate through teh crazies
		    else if ('hidden' in document)
		        document.addEventListener("visibilitychange", handler);
		    else if ('mozHidden' in document)
		        document.addEventListener("mozvisibilitychange", handler);
		    else if ('webkitHidden' in document)
		        document.addEventListener("webkitvisibilitychange", handler);
		    else if ('msHidden' in document)
		        document.addEventListener("msvisibilitychange", handler);
		    // IE 9 and lower:
		    else if ('onfocusin' in document)
		        document.onfocusin = document.onfocusout =  handler;

		    // All others (aka wishfull thinking)
		    else
		        window.onpageshow = window.onpagehide = window.onfocus = window.onblur =  handler;
		},	

		// If the focus of the current tab changed
		focuschange: function(event) {
			// Some browser send the event from window
	        event = event || window.event;			
	        var map = {focus: true, focusin: true, pageshow: true, blur: false, focusout: false, pagehide: false},
	        	focus = Hiro.ui.focus = (event.type in map) ? map[event.type] : !Hiro.ui.focus; 

	        // If the window gets focused
	        if (focus) {
	        	// Reset tab notifier
	        	if (Hiro.ui.tabby.active) Hiro.ui.tabby.cleanup();

	        	// Try immediate reconnect (eg focused because OS woke up)
				if (!Hiro.sync.synconline || !Hiro.sync.webonline) {
					Hiro.sync.reconnect();
				// Sent new seen timestamp	
				} else {
					Hiro.canvas.seen();
				}	
	        // If the window blurs
	        } else {

	        }
		},		

		// Setup UI according to account level where 0 = anon
		setstage: function(tier) {
			var t = Hiro.data.get('profile','c.tier');

			// If we want to set it to the current level
			if (tier && tier == t) return;

			// Set tier if none is provided 
			tier = tier || Hiro.data.get('profile','c.tier') || 0; 

			// Always load settings from server to determine contents and webserver availability
			this.dialog.load();				

			// Send tier setting to other tabs
			Hiro.sync.tabtx('Hiro.ui.setstage(' + tier + ');');

			// Switch designs
			switch (tier) {
				case 0:
					// Set styles at bottom of folio
					Hiro.ui.render(function(){
						Hiro.ui.el_signin.style.display = 'block';
						Hiro.ui.el_settings.style.display = Hiro.ui.el_archive.style.display = 'none';
					})				
					break;
				case 1:
				case 2:	
					// Set styles at bottom of folio				
					Hiro.ui.render(function(){
						Hiro.ui.el_signin.style.display = 'none';
						Hiro.ui.el_settings.style.display = Hiro.ui.el_archive.style.display = 'block';
					})									
					break;
			}
		},

		// Show landing page, triggered by either the landing page itself or Hiro.data if it has no local data
		// Whatever comes first to make sure it's bootstrapped properly
		showlanding: function() {
			var b = Hiro.ui.el_landingpage.contentDocument.body;

			// Abort if there is no content yet or we already hid the landing page iframe
			if (!b || Hiro.ui.el_landingpage.style.display == 'none') return;

			// Fade in contents
			Hiro.ui.fade(b,1)

			// Attach fastbuttons to landing page if it was to fast to do it itself
			Hiro.ui.fastbutton.attach(b,Hiro.ui.landingclick);				
		},

		// Handle clicks on landingpage
		landingclick: function(action,type) {
			// Woop, we inited started fiddling with something relevant
			if (type == 'full') {						
				switch (action) {
					case 'screenshot':
					case 'cto':	
						Hiro.ui.fade(Hiro.ui.el_landingpage,-1,150);										
						Hiro.canvas.el_text.focus(); 					
						//window.parent.analytics.track('Started Interacting');					
						break;		
					case 'signin':	
						Hiro.ui.fade(Hiro.ui.el_landingpage,-1,150);					
						Hiro.ui.dialog.show('d_logio','s_signin',Hiro.user.el_login.getElementsByTagName('input')[0]);	
						break;									
				}
			}
		},			

		// Switch to an element on the same DOM level and hide all others
		switchview: function(el, display) {
			// Function accepts both the element directly or a an ID 
			if (typeof el != 'object') el = document.getElementById(el);

			// Set default display
			if (!display || typeof display != 'string') display = 'block';

			// Walk up & down the same DOM level within animationframe
			var n;				
			if (el && el.style) {
				el.style.display = display;
				n = el.previousSibling;
				while (n) {
					if (n.style) n.style.display='none';
					 n = n.previousSibling;
				}
				n = el.nextSibling;
				while (n) {
					if (n.style) n.style.display='none';
					 n = n.nextSibling;
				}
			}
		},		

		// Slide folio: 1 to open, -1 to close
		slidefolio: function(direction,slideduration,force,callback) {
			// Catch cases where sliding makes no sense
			if ((direction < 0 && this.slidepos === 0) ||  
				(direction > 0 && this.slidepos > 100) ||
				(!force && this.slidedirection != 0))
				return;

			// Allow simple call without direction		
			if (!direction) direction = (this.slidedirection == 1 || Hiro.folio.open) ? -1 : 1;	

			// Repaint folio
			if (direction == 1) Hiro.folio.paint(true);		

			// Local vars
			var // Make sure we always have 50px on the right, even on narrow devices
				maxwidth = (document.body.offsetWidth - 50),
				distance = (maxwidth < this.slidewidth) ? maxwidth : this.slidewidth,
				// Start value
				x0 = this.slidepos,	
				// Target value
				x1 = (direction < 0) ? 0 : distance,
				// Distance to be achieved
				dx = x1 - x0,
				// Ideal easing duration
				sd = slideduration || this.slideduration,
				duration = sd / distance * Math.abs(dx),
				start = Hiro.util.now(),
				_this = this;	

			// Set direction
			_this.slidedirection = direction;				

			// Remove keyboard if we open the menu on touch devices
			if (document.activeElement && document.activeElement !== document.body && this.touch && direction === 1) document.activeElement.blur();

			// Close apps if they should be open
			if (Hiro.apps.open.length > 0) Hiro.apps.close();			

			// Easing function (quad), see 
			// Code: https://github.com/danro/jquery-easing/blob/master/jquery.easing.js
			// Overview / demos: http://easings.net/
			function ease(t, b, c, d) {
				if ((t/=d/2) < 1) return c/2*t*t + b;
				return -c/2 * ((--t)*(t-2) - 1) + b;
			}

			// Step through frames
			function step() {

				var dt = Hiro.util.now() - start, 
				    v = _this.slidepos = x0 + Math.round(ease(dt, 0, dx, duration)),
				    done = false;

				// All set or damn, we took too long
				if (dt >= duration) {
					dt = duration;
					done = true;
					// Make sure that in the last step we jump to the target position
					v = _this.slidepos = x1;
				} 

				// Change DOM CSS values
				Hiro.canvas.el_root.style.left = v + 'px';
				Hiro.canvas.el_root.style.right = Hiro.canvas.context.el_root.style.right = (v*-1)+'px'; 
						
				// If we still have time we step on each possible frame in modern browser or fall back in others											
				if (done) {
					// Timessssup
					Hiro.folio.open = (direction > 0) ? true : false;
					_this.slidedirection = 0;
					_this.slidetimer = 0;
					// Callback
					if (callback) callback();
				} else {
					_this.slidetimer = requestAnimationFrame(step);
				}	
			}

			// Kick off stepping loop
			step();							

		},

		// Fade a DOM element in or out via opacity changes, 1 top fade in, -1 to fade out
		fade: function(element, direction, duration, callback) {
			var a0 = parseFloat((a0 === undefined || a0 === '') ? ((direction < 0) ? 1 : 0) : this.getopacity(element)),
				a1 = (direction < 0) ? 0 : 1,
				da = a1 - a0,
				duration = duration || 1000,
				start = Hiro.util.now(), 
				_this = this, cssd, css, i = 0;

			// If we can read the transition property, use CSS animations instead
			// TODO Bruno: Investigate a proper way to do this 
			if (false &&  typeof element.style.transition == 'string') {
				cssd = (duration / 1000), csst = (a1 != 1) ? 'visibility 0s linear ' + cssd + 's' : 'visibility ' + cssd + 's';
				requestAnimationFrame(function(){
					if (Hiro.ui.browser) element.style[Hiro.ui.browser + 'Transition'] = '-' + Hiro.ui.browser + '-opacity ' + csst;
					element.style.transition = csst;				 
					element.style[Hiro.ui.browser + 'Opacity'] = element.style.opacity = a1;
					element.style.visibility = (a1) ? 'visible' : 'hidden';					
				});
				return;
			}	

			// Step through the animation
			function step() {
				var dt = Hiro.util.now() - start, done = false;

				// We're done or time expired
				if (dt >= duration) {
					dt = duration;
					done = true;
				}								

				// Change opacity
				element.style[_this.opacity] = a0 + da * dt / duration;

				// Keep stepping or clean up
				if (done) {
					if (element._fadeDirection < 0) element.style.display = 'none';					
					element._fadeDirection = 0;
					delete element._fadeTimer;
					delete element._fadeDirection;
					if (callback) callback();
				}
				else element._fadeTimer = requestAnimationFrame(step);
			}
		
			// Abort if we already reached max opacity or are currently fading
			if ((element._fadeDirection == direction) || (a0 == 0 && direction < 0) || (a0 == 1 && direction > 0)) return;
		
			// Compute / set internal values
			duration = duration * Math.abs(da);
			element._fadeDirection = direction;

			// Make sure the element is visible when fading in starting at 0 visibility
			if (direction > 0) {
				element.style.display='block';
				if (!a0) element.style[this.opacity]=0;
			} 

			// DO IT!
			step();			
		},		

		// Prgrammatically get Opacity of an element via property resolved on init or 2 common fallbacks
		getopacity: function(element) {
			if (this.opacity && element.style[this.opacity] !==undefined ) return element.style[this.opacity];
			if (element.currentStyle) return element.currentStyle["opacity"];
			if (window.getComputedStyle) return window.getComputedStyle(element,null).getPropertyValue("opacity");
		},		

		// Play a specific piece of autio
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

		// Little twitter helper
		tweet: function(string) {
			var a, e;
			// ABort if no string
			if (!string) return;

			// Build proper string
			string = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(string.substring(0,200));

			// Open twitter window or redirect to twitter
			if (this.mobileapp) {
				// iOS hack from http://stackoverflow.com/questions/7930001/force-link-to-open-in-mobile-safari-from-a-web-app-with-javascript
			    a = document.createElement('a');
			    a.setAttribute("href", string);
			    a.setAttribute("data-href", string);			    
			    a.setAttribute("target", "_blank");

			    e = document.createEvent("HTMLEvents");
			    e.initEvent("click", true, true);
			    a.dispatchEvent(e);
			// Normal modal  
			} else {
				window.open(string,'twitter','height=282,width=600');
			} 
		},	

		// Mail helper
		mail: function(subject,text,recipients) {
			var s =	'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);

			// TODO Bruno: Proper mail client detection etc
			window.location.href = s;
		},	

		// Left / right swipes
		swipe: {
			start_x: 0,
			start_y: 0,
			active: false,
			id: undefined,

			// Track movements
			move: function(e) {
				var that = Hiro.ui.swipe;			
				// If the user starts moving
	    		if (e.touches.length == 1 && !that.active && that.identifier != e.touches[0].identifier) {	   
	    			// Store reference to starting touch 			    			
	    			that.start_x = e.touches[0].screenX;
	    			that.start_y = e.touches[0].screenY;
	    			that.active = true;
	    			that.identifier = e.touches[0].identifier;

	    			// Set timeout after which assume it wasn't a swipe
	    			setTimeout(function(){
	    				that.active = false;	    				
	    				that.cancel();
	    			},120);

	    		// As long as we didn't time out / move off course	
	    		} else if (that.active) { 
	    			// init rest of variables  			
		    	 	var x = e.touches[0].screenX,
		    			y = e.touches[0].screenY,
		    			dx = that.start_x - x,
		    			dy = that.start_y - y;    			

		    		// If the left/right movement was more than 45 devicepixels	
		    		if (Math.abs(dx) >= (45 * window.devicePixelRatio)) {	
		    			// Cancel event listener	    			
		    			that.cancel();

		    			// Prevent further move action (stabilises ui)
		    			Hiro.util.stopEvent(e)

		    			// Cancel if we veered outside a 45° corridor
		    			if (Math.abs(dy) > Math.abs(dx*0.5)) return;

		    			// User swiped left
		    			if(dx > 0) {	    				
		    				// If the folio is open, close
		    				if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);
		    			}
		    			// User swiped right
		    			else {
		    				// Open folio
		    				if (!Hiro.folio.open) Hiro.ui.slidefolio(1,100);	    				
		    			}
		    		}
	    		}
			},	

			// Reset properties and remove listener
			cancel: function() {
				var that = Hiro.ui.swipe;
				// if (!that.start_x) return;

				// Reset internal values
				that.start_x = 0;
				that.active = false;			
			}			
		},		

		// Handle clicks depending on device (mouse or touch), this shoudl mostly be used on delegated handlers spanning larger areas
		fastbutton: {
			// Map of Nodes to events
			mapping: {},

			// Current event details
			x: 0,
			y: 0,
			touchx: 0,
			touchy: 0,
			lastid: undefined,

			// Values related to busting clicks (Click event is fired no matter what we do the faster up/down/start/end)
			installed: false,
			delay: 500,
			bustthis: [],

			// Attach event triggers
			attach: function(element,handler) {
				// Attach buster when attaching first fastbutton
				if (!this.installed) this.install(); 

				// Store handler in mapping table, create id if element has none
				if (!element.id) element.id = 'fastbutton' + Math.random().toString(36).substring(2,6);
				this.mapping[element.id] = {
					handler: handler
				};

				// TODO Bruno: See if there is a reliable way to check if device supports mouse or not
				Hiro.util.registerEvent(element,'mousedown',Hiro.ui.fastbutton.fire);
				Hiro.util.registerEvent(element,'mouseup',Hiro.ui.fastbutton.fire);				
				// Optionally attach touchstart event for touch devices
				if (Hiro.ui.touch) {
					Hiro.util.registerEvent(element,'touchstart', Hiro.ui.fastbutton.fire);
					Hiro.util.registerEvent(element,'touchend', Hiro.ui.fastbutton.fire);	
				} 
			},

			// Handle firing of events
			fire: function(event) {
				var target = event.target || event.srcElement, that = Hiro.ui.fastbutton, 
					// Traverse up DOM tree for up to two levels
					id = target.id || target.getAttribute('data-hiro-action') || 
						 target.parentNode.id || target.parentNode.getAttribute('data-hiro-action') || 
						 target.parentNode.parentNode.id || target.parentNode.parentNode.getAttribute('data-hiro-action'),	
					handler = that.mapping[this.id].handler, branch = this, button = event.which || event.button;		

				// Don't even start if it's not a leftclick, this also kills touch mousedown events
				if ((event.type == 'mousedown' || event.type == 'mouseup') && (button != 1 || event.touches)) return;				

				// Properly define x/y: screen (mouseup/down), event.touches[0] (tocuhstart) or last know touch pos (touchend)
				x = (event.screenX >= 0) ? event.screenX : ((event.touches.length > 0) ? event.touches[0].screenX : that.touchx); 
				y = (event.screenY >= 0) ? event.screenY : ((event.touches.length > 0) ? event.touches[0].screenY : that.touchy);																		
				
				// Stope events from propagating beyond our scope
				event.stopPropagation();

				// Note values and fire handler for beginning of interaction
				if (id && (event.type == 'mousedown' || event.type == 'touchstart')) {
					// First we remember where it all started
					that.x = that.touchx = x; that.y = that.touchy = y; that.lastid = id;

					// Call handler
					if (handler) handler(id,'half',target,branch,event)

					// Stop here for now
					return;	
				}						

				// Things that need start & end within n pixels. 
				// Being mouseup or touchend is implicity by having a lastaction id
				if 	(that.lastid && ((Math.abs(x - that.x) < 10) && (Math.abs(y - that.y) < 10 ))) {
					// Add coordinates to buster to prevent clickhandler from also firing, remove after n msecs
					that.bustthis.push(y,x);
					setTimeout(function(){
						Hiro.ui.fastbutton.bustthis.splice(0,2);
					},that.delay);		

					// Always stop fired event
					Hiro.util.stopEvent(event);		

					// Call handler
					if (id && handler) handler(id,'full',target,branch,event)	
				} 	

				// Reset values
				that.x = that.y = that.touchx = that.touchy = 0;
				that.lastid = undefined;
			},

			// Attach a click handler to the document that prevents clicks from firing if we just triggered something via touchend/mouseup above
			install: function() {
				// Log touchmoves
				Hiro.util.registerEvent(document,'touchmove',function(event){
					if (Hiro.ui.fastbutton.lastid) {
						Hiro.ui.fastbutton.touchx = event.touches[0].screenX;
						Hiro.ui.fastbutton.touchy = event.touches[0].screenY;						
					} 
				});				

				// Prevent clicks from happening
				Hiro.util.registerEvent(document,'click',Hiro.ui.fastbutton.bust,true);				
			},

			// Fires when buster installed & click event happens on document
			bust: function(event) {
				// See if we have something to bust at all
				if (Hiro.ui.fastbutton.bustthis.length == 0) return;

				// See if the click is close the where we fired the full handler above
				for (var i = 0, l = Hiro.ui.fastbutton.bustthis.length; i < l; i += 2) {
					if (Math.abs(Hiro.ui.fastbutton.bustthis[i] - event.screenY) < 25 
						&& Math.abs(Hiro.ui.fastbutton.bustthis[i + 1] - event.screenX) < 25) {
							Hiro.util.stopEvent(event);						
					}
				}				
			}			 		
		},

		// Attach events to areas that fire under certain conditions like hover and support delays
		touchy: {
			defaultdelay: 300,
			timeout: null,
			element: null,

			// Attach initial trigger
			attach: function(element,handler,delay) {
				// Always attach mouse event
				Hiro.util.registerEvent(element,'mouseover', function(e) {Hiro.ui.touchy.fire(e,element,handler,delay)});
				// Attach touchstart event for touch devices
				if (Hiro.ui.touch) Hiro.util.registerEvent(element,'touchstart', function(e) {Hiro.ui.touchy.fire(e,element,handler,delay)});
			},

			// If the event is fired
			fire: function(event,element,handler,delay) {
				// If its a touch event we fire the event immediately	
				if (event.type === 'touchstart') handler(event,element);				
				else if (event.type === 'mouseover') {	
					// Prevent event from triggering touchies fruther up the treee			
					Hiro.util.stopEvent(event);						
					// If we already listen to this element but moved to a different subnode do nothing					
					if (element === this.element) return;
					// Initiate the delayed event firing and stop event from bubbling				
					delay = delay || this.defaultdelay;
					this.element = element;
					// Set timeout as local var (only one touchy at a time)
					element._hirotimeout = setTimeout(function() {
						// If the timeout wasnt killed by the bounds handler, we execute the handler
						handler(event,element);
						// And clean up 
						Hiro.ui.touchy.abort(element);
						Hiro.util.releaseEvent(element,'mouseout',Hiro.ui.touchy.boundschecker);						
					}, delay);
					// Register mouseout event to clean things up once we leave target area
					Hiro.util.registerEvent(element,'mouseout', Hiro.ui.touchy.boundschecker);				
				} 
				// Log error to see if any browsers fire unknown events				
				else Hiro.sys.error('Touchy triggered unknown event: ', event);
			},

			// Abort current touchy session if we leave target DOM area
			boundschecker: function() {
				// Get the DOM element the cursor is moving to
				var target = event.relatedTarget || event.toElement;
				// If we mouseout to the same or a contained DOM node do nothing				
				if (target === this || this.contains(target)) return;
				// If we leave the DOM aree of interest, remove the handler and clean up
				Hiro.util.stopEvent(event);
				Hiro.util.releaseEvent(this,'mouseout',Hiro.ui.touchy.boundschecker);								
				Hiro.ui.touchy.element = null;
				Hiro.ui.touchy.abort(this);							
			},

			// Abort our timeout & clean up
			abort: function(element) {				
				window.clearTimeout(element._hirotimeout);				
				element._hirotimeout = undefined;									
			}

		},

		// Little lib that circles through tab title messages if browser is not focused
		tabby: {
			// Internals
			active: false,
			pool: [],
			timeout: null,
			faviconstate: 'normal',

			notify: function(id,silent) {
				// Cycles a que of notifictaions if tab is not focused and changes favicon
				var that = Hiro.ui.tabby, 
					nextstate = (that.faviconstate == 'normal') ? 'red' : 'normal',
					pos, nextpos, next, nexttitle;	

				// Forward message to other tabs
				Hiro.sync.tabtx('Hiro.ui.tabby.notify("' + id + '",true);');

				// Cancel all actions and reset state
				if (Hiro.ui.focus) {
					that.cleanup(); 		
					return;
				}	

				// Turn on internal notify value
				if (!that.active) that.active = true;

				// Add another message to the array if we haven't yet and play sound
				if (id && that.pool.indexOf(id) == -1) {
					that.pool.push(id); 
					if (!silent) Hiro.ui.playaudio('unseen',0.7);
				}	

				// Stop here if we're already cycling
				if (that.timeout) return;

				// Do cycling, find out next message first
				pos = that.pool.indexOf(id);
				nextpos = (pos + 1 == that.pool.length) ? 0 : ++pos;
				next = that.pool[nextpos];
				nexttitle = Hiro.data.get('note_' + next,'c.title') || 'New Note';

				// Switch between simple update flash and numbered notifications
				if (that.pool.length == 1 && Hiro.canvas.currentnote == next) {
					// If we only have one message and it's the current note, we cycle title between doc title and message
					document.title = (document.title == 'Updated!') ? nexttitle : 'Updated!';
				} else if (that.pool.length == 1) {
					// If we have multiple we cycle between them
					document.title = (document.title == ( Hiro.data.get('note_' + Hiro.canvas.currentnote,'c.title') || 'New Note') ) ? '(' + that.pool.length + ') ' + nexttitle + ' updated!' : (Hiro.data.get('note_' + Hiro.canvas.currentnote,'c.title') || 'New Note');				
				} else {
					// If we have multiple we cycle between them
					document.title ='(' + that.pool.length + ') ' + nexttitle + ' updated!';				
				}

				// Only one timeout cycling at a time
				if (that.timeout) return;				

				// Switch favicon
				that.setfavicon(nextstate);

				// Repeat cycle
				that.timeout = window.setTimeout(function(){ 
					// Make sure
					window.clearTimeout(that.timeout);
					that.timeout = null;

					// We send the current id to the function so it can easily pick the next from the array				
					that.notify(next);
				},1000);

			},

			// Clear the tab notifications
			cleanup: function() {
				var that = Hiro.ui.tabby;

				// Clear other tabs as well
				Hiro.sync.tabtx('Hiro.ui.tabby.cleanup()');				

				// Clear timeout							
				window.clearTimeout(that.timeout);
				that.timeout = null;

				// Reset document and internal states
				that.pool.length = 0;	
				that.active = false;														
				that.setfavicon('normal');		
				document.title = Hiro.canvas.el_title.value;					
			},

			// Change the favicon to a certain state
			setfavicon: function(state) {
				var h = document.head || document.getElementsByTagName('head')[0],
					old = document.getElementById('dynacon'), el = document.createElement('link'), src;

				// Remove any old links
				if (old) h.removeChild(old);	

				// pick right path & file
				switch (state) {
					case 'normal':
						src = '/static/img/favicon.png';
						break;
					case 'red':
						src = '/static/img/faviconred.png';	
						break;
				}

				// Build link	
				el.id = 'dynacon';
				el.rel = 'shortcut icon';
				el.href = src;

				// Set internal value
				this.faviconstate = state;

				Hiro.ui.render(function(){
					// Add favicon link to DOM
					h.appendChild(el);
				})	
			}			
		},

		// All dialog related stuff
		dialog: {
			// DOM elements that are NOT changing through AJAX reload etc
			el_root: document.getElementById('shield'),
			el_wrapper: document.getElementById('shield').firstChild,
			el_settings: document.getElementById('d_settings'),
			el_close: document.getElementById('d_close'),

			// Internal values
			open: false,
			lastx: 0,
			lasty: 0,
			lastaction: undefined,
			upgradeteaser: false,

			// Open dialog
			show: function(container, section, focus, close) {
				// If we're offline, show a default message
				if (!Hiro.sync.webonline) {
					container = 'd_msg';
					section = focus = undefined;
					close = true;
				}		

				// Fade in dialog
				Hiro.ui.fade(Hiro.ui.dialog.el_root,1,200,function(){
					// Blurring is slooow on small mobile browsers, so don't do it
					if (Hiro.ui.mini()) return;

					// Blur background
					Hiro.ui.render(function(){
						var filter = (Hiro.ui.browser) ? Hiro.ui.browser + 'Filter' : 'filter';
						Hiro.canvas.el_root.style[filter] = Hiro.folio.el_showmenu.style[filter] = Hiro.folio.el_root.style[filter] = 'blur(2px)';
					});
				});

				// Load facebook on first open, but do not init yet as this would blur on mobiles
				if (!window.FB) Hiro.lib.facebook.load();

				// Set wanted areas to display block
				if (container) Hiro.ui.switchview(container);
				if (section) Hiro.ui.switchview(section);		

				// Set focus				
				if (focus) focus.focus();								

				// Change visibility etc
				Hiro.ui.render(function(){
					// Update contents
					if (container == 'd_settings') Hiro.ui.dialog.update();

					// Show or hide close button, has to have own rAF because switchview above does too				
					Hiro.ui.dialog.el_close.style.display = (close) ? 'block' : 'none';

					// Center the white area
					Hiro.ui.dialog.center();	

					// Set top margin for upward movement
					Hiro.ui.dialog.el_wrapper.style.marginLeft = 0;														
				})	

				// Hide folio
				if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);
							
				// Attach event and set internal value
				Hiro.util.registerEvent(window,'resize',Hiro.ui.dialog.center);
				this.open = true;
			},

			// Fill data into settings dialog & and other preparations
			update: function() {
				var user = Hiro.data.get('profile','c'), fields = this.el_settings.getElementsByTagName('input'), d,
					plans = ['Anonymous','Basic','Advanced'];

				// Abort here if user is not signed up yet
				if (!(user.tier > 0)) return;

				// Fill the fields
				fields[0].value = user.name || '';
				fields[1].value = user.email || user.phone || '';
				fields[2].value = 'Member Since: ' + Hiro.util.monthddyyyy(user.signup_at) || 'Some time';
				fields[3].value = plans[user.tier] + ((Hiro.ui.mini()) ? '' : ' plan') + ': ' + Hiro.folio.owncount + ((user.tier < 2) ? ' of 10' : '') + ' notes';	

				// Remove upgrade link if user is already aying customer
				fields[3].nextSibling.style.display = (user.tier > 1) ? 'none' : 'block';			

				// Update the boxes
				this.paintboxes();
			},

			// Close the dialog 
			hide: function() {
				// Remove blur filters, only if we set them before
				var filter = (Hiro.ui.browser) ? Hiro.ui.browser + 'Filter' : 'filter';			

				Hiro.ui.render(function(){
					// Reset filter CSS
					if (Hiro.canvas.el_root.style[filter]) Hiro.canvas.el_root.style[filter] = Hiro.folio.el_showmenu.style[filter] = Hiro.folio.el_root.style[filter] = 'none';
				})	

				// Change visibility etc
				Hiro.ui.fade(Hiro.ui.dialog.el_root,-1,100);			

				// Reset left margin for inward movement after we closed the dialog
				setTimeout(function(){	
					Hiro.ui.render(function(){							
						Hiro.ui.dialog.el_wrapper.style.marginLeft = '300px';
						// Reset CSS class if we had a teaser
						if (Hiro.ui.dialog.upgradeteaser) {
							// Reset classname
							document.getElementById('s_plan').removeAttribute('class');
							document.getElementById('s_checkout').removeAttribute('class');	
							// Set flag
							Hiro.ui.dialog.upgradeteaser = false;
						}	
					});						
				},150);										

				// Detach event and set internal value				
				Hiro.util.releaseEvent(window,'resize',Hiro.ui.dialog.center);
				this.open = false;				
			},		

			// Center triggered initially and on resize
			center: function() {
				Hiro.ui.render( function(){
					var wh = document.body.clientHeight || document.documentElement.clientHeight || window.innerHeight,
						ww = document.body.clientWidth || document.documentElement.clientWidth || window.innerWidth,											
						dh = Hiro.ui.dialog.el_wrapper.clientHeight,
						dw = Hiro.ui.dialog.el_wrapper.clientWidth;

					// Set properties	
					Hiro.ui.dialog.el_wrapper.style.left = Math.floor((ww - dw) / 2 ) + 'px';
					Hiro.ui.dialog.el_wrapper.style.top = Math.floor((wh - dh) / 2 ) + 'px';					
				})
			},

			// If the user clicks somewhere in the dialog 
			clickhandler: function(action,type,target) {
				var param = action.split(':')[1], el;

				// Split actions into array
				action = action.split(':')[0];	

				// Woop, we inited started fiddling with something relevant
				if (type == 'half') {
					// List of actions to be switch
					switch (action) {
						case 'switch_s_plan':
						case 'switch_s_about':						
						case 'switch_s_account':
							Hiro.ui.switchview(document.getElementById(action.substring(7)));
							break;		
					}
				} else if (type == 'full') {
					// Kill focus on mobile devices if we execute an action
					if (target && target.tagName.toLowerCase() != 'input' && Hiro.ui.mini() && document.activeElement && document.activeElement.tagName.toLowerCase() == 'input') document.activeElement.blur();

					// 'hexecute'
					switch (action) {
						case 'd_msg':
						case 'd_close':	
							Hiro.ui.dialog.hide();
							break;																	
						case 'shield':
							// Double check that we clicked on shield on not some child
							if (target.id == 'shield') Hiro.ui.dialog.hide();
							break;						
						case 'switch_s_signup':
							Hiro.ui.switchview(document.getElementById('s_signup'));
							Hiro.user.el_register.getElementsByTagName('input')[0].focus();						
							break;							
						case 'switch_s_signin':						
							Hiro.ui.switchview(document.getElementById('s_signin'));
							Hiro.user.el_login.getElementsByTagName('input')[0].focus();					
							break;							
						case 'register':
						case 'login':
							Hiro.user.logio(event,(action == 'login'));
							break;	
						case 'fblogin':
						case 'fbsignup':						
							Hiro.user.fbauth(target,(action == 'fblogin'));
							break;																		
						case 'logout':
							Hiro.user.logout();
							break;
						case 'changeplan':							
						case 'upgrade':
							Hiro.ui.switchview(document.getElementById('s_plan'));
							break;	
						case 'selectplan':
							// 
							Hiro.user.checkout.show(param,target);
							break;	
						case 'savename':
							// Get name field
							el = Hiro.ui.dialog.el_settings.getElementsByTagName('input')[0];
							// Save name & update link text
							Hiro.data.set('profile','c.name',el.value);
							// Set target if we have none (clickhandler called by form submit pseudobutton click) and set text
							target = target || el.nextSibling.firstChild;
							target.innerText = 'Saved!';
							break;	
						case 'checkout':
							// Calls teh checkout
							Hiro.user.checkout.validate();
							break;				
					}
				}
			},

			// Clean up errors etc and handle input actions (namechange, cc etc)
			keyhandler: function(event) {
				var t = event.target || event.srcElement,
					c = t.getAttribute('class'), id = t.id || t.getAttribute('data-hiro-value'), 
					name = Hiro.data.get('profile','c.name'), el, mains = this.getElementsByClassName('mainerror'), i, l;

				// Remove error from input error overlay
				if (t.nextSibling.innerHTML && t.nextSibling.innerHTML.length > 0 && t.nextSibling.getAttribute('class').indexOf('error') > 0) t.nextSibling.innerHTML = ''; 

				// If we had an error CSS class in the input field
				if (c && c.indexOf('error') > 0) t.setAttribute('class',c.replace('error',''));

				// Get & empty all mainerrors
				Hiro.ui.render(function(){
					for (i = 0, l = mains.length; i < l; i++ ) {
						if (mains[i].innerHTML) mains[i].innerHTML = '';
					}
				});	

				// Copy values to other input if it happens on login
				if (t.id == 'signin_mail') document.getElementById('signup_mail').value = t.value;
				if (t.id == 'signup_mail') document.getElementById('signin_mail').value = t.value;

				// Small overlay helpers for input fields
				switch (id) {
					case 'name':		
						if (t.value != name) {
							t.nextSibling.style.display = 'block';
							t.nextSibling.firstChild.innerText = 'Save changes';
						} else {
							t.nextSibling.style.display = 'none';							
						}
						break;
				}
			},

			// Fetch latest settings template from server and load into placeholder div
			load: function() {
				// Send off AJAX request
				Hiro.sync.ajax.send({
					url: '/component/settings/',
					success: function(req,data) {
						if (data) {
							Hiro.ui.render(function(){
								Hiro.ui.dialog.el_settings.innerHTML = data;
								Hiro.ui.dialog.paintboxes();
							});						
						}	
					},
					error: function(req) {
						Hiro.sys.error('Unable to load settings',req);
					}
				});					
			},

			// Choose which buttons to display in plan selection boxes
			paintboxes: function() {
				var root = document.getElementById('s_plan').getElementsByClassName('plans')[0],
					tier = Hiro.data.get('profile','c.tier'), i, l, boxes, buttons;

				// Abort if dialog shouldn't be here for any reason
				if (!root) return;

				// Get remaining vars
				boxes = root.getElementsByClassName('box');
				buttons = root.getElementsByTagName('a');

				// Set all buttons to display none & reset content first
				for (i=0,l=buttons.length;i<l;i++) {
					if (buttons[i].className.indexOf('red') > -1) buttons[i].innerHTML = "Downgrade";		
					buttons[i].style.display = 'none';			
				}

				// Switch CSS
				switch (tier) {
					case 0:
					case 1:				
						boxes[0].getElementsByClassName('grey')[0].style.display = 
						boxes[1].getElementsByClassName('green')[0].style.display = 
						boxes[2].getElementsByClassName('green')[0].style.display = 'block';
						break;
					case 2:
						boxes[0].getElementsByClassName('light')[0].style.display = 
						boxes[1].getElementsByClassName('grey')[0].style.display = 
						boxes[2].getElementsByClassName('green')[0].style.display = 'block';
					 	break;
					case 3:
						boxes[0].getElementsByClassName('light')[0].style.display = 
						boxes[1].getElementsByClassName('light')[0].style.display = 
						boxes[2].getElementsByClassName('grey')[0].style.display = 'block';
						break;
				}				
			},

			// Show certain actions if user has unsufficient tier
			suggestupgrade: function(reason) {
				var that = Hiro.ui.dialog,
					el_plans = document.getElementById('s_plan'),
					el_checkout = document.getElementById('s_checkout'),
					els_header = that.el_root.getElementsByClassName('tease'),
					uid = Hiro.data.get('profile','c.uid');

				// For anon user simply show login
				if (!uid || uid == 0) {
					this.show('d_logio','s_signin',Hiro.user.el_login.getElementsByTagName('input')[0]);
					return;
				}	

				// Set flag
				this.upgradeteaser = true;

				// Render changes
				Hiro.ui.render(function(){
					// Set header
					els_header[0].innerHTML = els_header[1].innerHTML = reason;
					// Set CSS class
					el_plans.className = el_checkout.className = 'teaser';	
					// Open dialog		
					that.show('d_settings','s_plan',undefined,true);		
				});
			}			
		},

		// Simple top loading bar lib
		hprogress: {
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

		// User Notification lib
		statsy: {
			// Sequence object of UI notifications:
			statuschain: {
				chain: []
			},
			timeshown: 800,
			timeout: null,
			locked: false,
			el_status: document.getElementById('status'),			

			// Add status to the status chain, id 0 always starts a new chain
			add: function(id,phase,value,type,lock) {
				var s = this.statuschain;	 							

				// Start a new sequence if we're ready (no messages before that, nervous flashing)
				if (phase == 0 && Hiro.sys.inited) {
					// Do not overwrite if we already have a chain
					if (this.locked) return;

					// Clear previous timeout
					clearTimeout(this.timeout);

					// If the id changed, we reset the chain
					if (s.id != id) {
						this.statuschain = { chain: [] };
						s = this.statuschain;				

						// Set first status
						s.id = id;
						s.type = type || 'info';					

						// Set initial value
						s.chain[0] = value;												
					}						

					// Set phase to start
					s.phase = 0;								

					// Start showing first msg
					this.show(lock);						
				// Add or overwrite existing chain phase if it changed
				} else if (id == s.id && phase > s.phase && s.chain[phase] != value) {
					// Set value
					s.chain[phase] = value;

					// If our timeout died somewhere along the way we continue from last shown chain phase
					if (!this.timeout) this.show();					
				}						
			},

			// Disable statsy for a brief time
			shutup: function(time) {
				if (this.locked || !time || !Hiro.sys.inited) return;

				// Disable if we have a timestamp
				this.locked = true;

				// Reenable after x ms
				setTimeout(function(){
					Hiro.ui.statsy.locked = false;
				},time)
			},

			// Status logger, over time we could build this around the more state machiny stuff but for now it's simply showing the user msg'es
			show: function(lock) {
				var s = this.statuschain, i, l, el = this.el_status;

				// Do nothing if we'Re in lockdown
				if (this.locked) return;

				// Lockdown!
				if (lock) {
					this.locked = true;
					setTimeout(function(){
						Hiro.ui.statsy.locked = false;
					},lock)
				}

				// Find next message & iterate phase
				for (i = s.phase || 0, l = s.chain.length; i < l; i++ ) {
					// If chain slots are empty
					if (!s.chain[i]) continue;

					// Safe phase & exit
					s.phase = i;
					break;
				}	

				// Iterate phase or reset id
				if (s.phase++ == l) s.id = undefined;

				if (s.chain[i]) {
					// Render msg
					Hiro.ui.render(function(){
						// Show msg & iterate to next step
	 					el.innerHTML = s.chain[i];
					});

					// Show next msg after n msecs
					this.timeout = setTimeout(function(){
						// Reset timeout
						Hiro.ui.statsy.timeout = null;					
						// Show next;
						Hiro.ui.statsy.show();
					},this.timeshown); 
				}
			}
		},

		// History API related functions
		history: {
			// Internals
			first: true,

			// Add a new history state
			add: function(id) {
				// Build URL
				var url = '/note/' + id;

				// Only do this on production systems as long as the new version is only available at /shiny/
				if (!Hiro.sys.production) return;		

				// On the first call we only change the state insteading of adding a new one
				if (this.first && history && 'replaceState' in history) {
					// Change state
					history.replaceState(id, null, url);

					// Set flag to trigger normal pushstates from now on
					this.first = false;

				// Add to browser stack	
				} else if (history && 'pushState' in history) history.pushState(id, null, url);

			},

			// Triggered if user presses back button (popstate event)
			goback: function(event) {
				// Test if we have an id & supported history in the first place
				if (history && 'pushState' in history && event.state) Hiro.canvas.load(event.state,true);	
			}			
		}		
	},

	// External js library handling (Facebook, Analytics, DMP etc)
	lib: {

		// Save keys by library name
		keys: {},

		// Load libraries
		init: function() {
	
		},

		// Generic script loader
		loadscript: function(obj) {
			var head = document.getElementsByTagName("head")[0] || document.documentElement,
				s = document.createElement('script'), done;

			// Abort if we have no url
			if (!obj.url) return;

			// Set DOM node params	
			s.type="text/javascript"
			s.src = obj.url;
			s.async = true;
			if (obj.defer === true) s.defer = true;
			if (obj.id) s.id = obj.id;	

			// Attach handlers for all browsers, nicked from jQuery
			s.onload = s.onreadystatechange = function() {
			    if ( !done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") ) {
			        // Set flag
			        done = true;

			        // Execute success
			        if (obj.success) obj.success();				 
			    }
			};	

			// Onerror for modern browsers
			s.onerror = function() {
			    if ( !done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") ) {
			        // Set flag
			        done = true;

			        // Execute error
			        if (obj.error) obj.error('sourceoffline',s);

			        // Handle memory leak in IE
			        s.onload = s.onreadystatechange = null;
			        if (head && s.parentNode) head.removeChild(s);				        
			    }					
			}		

			// Insert into DOM
			head.insertBefore(s, head.firstChild);					
		},	

		// Stripe
		stripe: {
			url: 'https://js.stripe.com/v2/',
			key: undefined,
			loaded: false,
			inited: false,

			// If user selects plan to upgrade to, init right away
			load: function() {
				var that = this;

				// Call loadscript & init right away
				Hiro.lib.loadscript({
					url: that.url,
					delay: 0,
					success: function() {
						// Set flag & init
						that.loaded = true;
						that.init();
					}
				});			
			},

			// Lib specific init stuff
			init: function() {
				var k = this.key;

				// Check if we have a key
				if (k) {
					// Set key & flag
					Stripe.setPublishableKey(k);
					this.inited = true;

				// Oh noes, no key					
				} else {
					Hiro.sys.error('Tried to init Stripe, but no key found',Hiro.lib.keys)
				}
			}
		},

		// Facebooks: Facebook is already preloaded when we open the dialog
		facebook: {
			js: 'https://connect.facebook.net/en_US/all.js',
			key: undefined,
			inited: false,
			loaded: false,

			// Load script, we do this when the user opens the dialog
			load: function(success,error) {
				// If it'S already loaded
				if (this.loaded) return;

				// Do it!
				Hiro.lib.loadscript({
					url: this.js,					
					id: 'facebook-jssdk',	
					success: function() {
						// Set flag
						Hiro.lib.facebook.loaded = true;
						// Fire callback if we have one
						if (success) success();
						// Init right away on non-touch devices to avoid popup blockers (init below creates new stack)
						else if (!Hiro.ui.touch) Hiro.lib.facebook.init();
					},
					error: error				
				});				
			},

			// This blurs input, so we delay it until user selects first FB action
			init: function(success) {
				var that = this;

				// If we wrongly called it twice abort
				if (this.inited) return;

				// Init, which unfortunately offers no callback (anymore)
			    FB.init({ appId : that.key, version: 'v2.0', status : false, xfbml : false });

			    // Call 
			    FB.getLoginStatus(function(response){
			    	that.inited = true;
			    	if (success) success();
			    });				
			},

			// Abstract connectivity & lib specific foo
			pipe: function(obj) {
				var that = this;

				// If script wasn't loaded yet
				if (!this.loaded) {
					that.load(function() { that.pipe(obj) },obj.error);
					return;
				// Or not inited	
				} else if (!this.inited) {
					that.init(function() { that.pipe(obj) },obj.error);
					return;
				}	

				// Execute our command
				if (obj && obj.todo) obj.todo(obj);			
			}			

		}	
	},

	// Generic utilities like event attachment etc
	util: {

		// Takes a unix timestamp and turns it into mins/days/weeks/months
		// 86400 = 1 day
		// 604800 = 1 week 
		// 2592000 = 30 days
		// 31536000 = 1 year		
		humantime: function(timestamp) {			
			var now = Hiro.util.now(), t;

			// Make sure we got a UTC string
			if (typeof timestamp != 'number') timestamp = new Date(new Date(timestamp).toUTCString()).getTime();
			t = Math.round((now - timestamp) / 1000);

			// Return the various string values
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

		// Returns Month DD, YYYY
		monthddyyyy: function(ts) {
			var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
				d;

			// Get current date if none provided
			ts = ts || this.now();

			// Get proper date object
			d = new Date(ts);

			// Return string
			return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();

		},	

		// Return current timestamp in UTC unix msecs (or whatever format we'll decide to use)
		now: function() {
			return Date.now();
		},

		// Checks if a string resembles an email or phone number and returns [type,string]
		mailorphone: function(string) {
			var mailregex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
				nums = string.replace( /[^\d]/g, ''),
				type;

			// See if we have an email
			if (mailregex.test(string)) {
				type = 'email';
			// See if we have a long enough number	
			} else if (nums.length > 5) {
				type = 'phone';
				// see if we have a plus leading our number and convert string
				string = (string.replace( /([^\d\+])/g, '').charAt(0) == '+' && '+' || '') + nums; 
			// No good
			} else {
				return false;
			}

			return [type,string];
		},

		// Returns a hash for simple or complex object provided
		// According to http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
		// and it's links this produces the best results for our contacts use case 
		hash: function(s) {
			var h = 0, i, chr, l;

			// Check for & convert to string
			if (typeof s != 'string') s = JSON.stringify(s);

			// Return 0 if length is 0
			if (s.length == 0) return h;

			// Use reduce on modern browsers
		    if (Array.prototype.reduce) {
		        return s.split('').reduce( function(a,b) { 
		        	a = ( ( a << 5 ) - a ) + b.charCodeAt(0); 
		        	return a & a;
		        },0); 
		    // Use for loop on older ones          
		    } else {
				for (i = 0, l = s.length; i < l; i++) {
					// Grab next char
					c = s.charCodeAt(i);
					// Shift bitwise
					h = ((h << 5) - h) + c;
					// Convert to 32bit integer
					h |= 0; 
				}
				return h;
		    }		
		},

		// Cross browser event registration
		registerEvent: function(obj, eventType, handler, capture) {
			// Set default value for capture
			capture = capture || false;

			// Go through various implementations
			if (obj.addEventListener) obj.addEventListener(eventType.toLowerCase(), handler, capture);
			else if (obj.attachEvent) obj.attachEvent('on'+eventType.toLowerCase(), handler);
			else {
				var et=eventType.toUpperCase();
				if ((obj.Event) && (obj.Event[et]) && (obj.captureEvents)) obj.captureEvents(Event[et]);
				obj['on'+eventType.toLowerCase()]=handler;
			}
		},	

		// Cross browser event removal
		releaseEvent: function(obj, eventType, handler) {
			if (obj.removeEventListener) obj.removeEventListener(eventType.toLowerCase(), handler, false);
			else if (obj.detachEvent) {
				try { obj.detachEvent('on'+eventType.toLowerCase(), handler); }
				catch(e) { Hiro.sys.log('',e); }
			} else {
				var et=eventType.toUpperCase();
				if ((obj.Event) && (obj.Event[et]) && (obj.releaseEvents)) obj.releaseEvents(Event[et]);
				et='on'+eventType.toLowerCase();
				if ((obj[et]) && (obj[et]==handler)) obj.et=null;
			}
		},

		// Cross browser default event prevention
		stopEvent: function(e) {
			if (!e) return;
			if (e.preventDefault) e.preventDefault();
			else e.returnValue = false;
			if (e.stopPropagation) e.stopPropagation();
			e.cancelBubble = true;
		}		
	}
};







// DMP by Neil Fraser
(function(){function diff_match_patch(){this.Diff_Timeout=1;this.Diff_EditCost=4;this.Match_Threshold=0.5;this.Match_Distance=1E3;this.Patch_DeleteThreshold=0.5;this.Patch_Margin=4;this.Match_MaxBits=32}
diff_match_patch.prototype.diff_main=function(a,b,c,d){"undefined"==typeof d&&(d=0>=this.Diff_Timeout?Number.MAX_VALUE:(new Date).getTime()+1E3*this.Diff_Timeout);if(null==a||null==b)throw Error("Null input. (diff_main)");if(a==b)return a?[[0,a]]:[];"undefined"==typeof c&&(c=!0);var e=c,f=this.diff_commonPrefix(a,b);c=a.substring(0,f);a=a.substring(f);b=b.substring(f);var f=this.diff_commonSuffix(a,b),g=a.substring(a.length-f);a=a.substring(0,a.length-f);b=b.substring(0,b.length-f);a=this.diff_compute_(a,
b,e,d);c&&a.unshift([0,c]);g&&a.push([0,g]);this.diff_cleanupMerge(a);return a};
diff_match_patch.prototype.diff_compute_=function(a,b,c,d){if(!a)return[[1,b]];if(!b)return[[-1,a]];var e=a.length>b.length?a:b,f=a.length>b.length?b:a,g=e.indexOf(f);return-1!=g?(c=[[1,e.substring(0,g)],[0,f],[1,e.substring(g+f.length)]],a.length>b.length&&(c[0][0]=c[2][0]=-1),c):1==f.length?[[-1,a],[1,b]]:(e=this.diff_halfMatch_(a,b))?(f=e[0],a=e[1],g=e[2],b=e[3],e=e[4],f=this.diff_main(f,g,c,d),c=this.diff_main(a,b,c,d),f.concat([[0,e]],c)):c&&100<a.length&&100<b.length?this.diff_lineMode_(a,b,
d):this.diff_bisect_(a,b,d)};
diff_match_patch.prototype.diff_lineMode_=function(a,b,c){var d=this.diff_linesToChars_(a,b);a=d.chars1;b=d.chars2;d=d.lineArray;a=this.diff_main(a,b,!1,c);this.diff_charsToLines_(a,d);this.diff_cleanupSemantic(a);a.push([0,""]);for(var e=d=b=0,f="",g="";b<a.length;){switch(a[b][0]){case 1:e++;g+=a[b][1];break;case -1:d++;f+=a[b][1];break;case 0:if(1<=d&&1<=e){a.splice(b-d-e,d+e);b=b-d-e;d=this.diff_main(f,g,!1,c);for(e=d.length-1;0<=e;e--)a.splice(b,0,d[e]);b+=d.length}d=e=0;g=f=""}b++}a.pop();return a};
diff_match_patch.prototype.diff_bisect_=function(a,b,c){for(var d=a.length,e=b.length,f=Math.ceil((d+e)/2),g=f,h=2*f,j=Array(h),i=Array(h),k=0;k<h;k++)j[k]=-1,i[k]=-1;j[g+1]=0;i[g+1]=0;for(var k=d-e,q=0!=k%2,r=0,t=0,p=0,w=0,v=0;v<f&&!((new Date).getTime()>c);v++){for(var n=-v+r;n<=v-t;n+=2){var l=g+n,m;m=n==-v||n!=v&&j[l-1]<j[l+1]?j[l+1]:j[l-1]+1;for(var s=m-n;m<d&&s<e&&a.charAt(m)==b.charAt(s);)m++,s++;j[l]=m;if(m>d)t+=2;else if(s>e)r+=2;else if(q&&(l=g+k-n,0<=l&&l<h&&-1!=i[l])){var u=d-i[l];if(m>=
u)return this.diff_bisectSplit_(a,b,m,s,c)}}for(n=-v+p;n<=v-w;n+=2){l=g+n;u=n==-v||n!=v&&i[l-1]<i[l+1]?i[l+1]:i[l-1]+1;for(m=u-n;u<d&&m<e&&a.charAt(d-u-1)==b.charAt(e-m-1);)u++,m++;i[l]=u;if(u>d)w+=2;else if(m>e)p+=2;else if(!q&&(l=g+k-n,0<=l&&(l<h&&-1!=j[l])&&(m=j[l],s=g+m-l,u=d-u,m>=u)))return this.diff_bisectSplit_(a,b,m,s,c)}}return[[-1,a],[1,b]]};
diff_match_patch.prototype.diff_bisectSplit_=function(a,b,c,d,e){var f=a.substring(0,c),g=b.substring(0,d);a=a.substring(c);b=b.substring(d);f=this.diff_main(f,g,!1,e);e=this.diff_main(a,b,!1,e);return f.concat(e)};
diff_match_patch.prototype.diff_linesToChars_=function(a,b){function c(a){for(var b="",c=0,f=-1,g=d.length;f<a.length-1;){f=a.indexOf("\n",c);-1==f&&(f=a.length-1);var r=a.substring(c,f+1),c=f+1;(e.hasOwnProperty?e.hasOwnProperty(r):void 0!==e[r])?b+=String.fromCharCode(e[r]):(b+=String.fromCharCode(g),e[r]=g,d[g++]=r)}return b}var d=[],e={};d[0]="";var f=c(a),g=c(b);return{chars1:f,chars2:g,lineArray:d}};
diff_match_patch.prototype.diff_charsToLines_=function(a,b){for(var c=0;c<a.length;c++){for(var d=a[c][1],e=[],f=0;f<d.length;f++)e[f]=b[d.charCodeAt(f)];a[c][1]=e.join("")}};diff_match_patch.prototype.diff_commonPrefix=function(a,b){if(!a||!b||a.charAt(0)!=b.charAt(0))return 0;for(var c=0,d=Math.min(a.length,b.length),e=d,f=0;c<e;)a.substring(f,e)==b.substring(f,e)?f=c=e:d=e,e=Math.floor((d-c)/2+c);return e};
diff_match_patch.prototype.diff_commonSuffix=function(a,b){if(!a||!b||a.charAt(a.length-1)!=b.charAt(b.length-1))return 0;for(var c=0,d=Math.min(a.length,b.length),e=d,f=0;c<e;)a.substring(a.length-e,a.length-f)==b.substring(b.length-e,b.length-f)?f=c=e:d=e,e=Math.floor((d-c)/2+c);return e};
diff_match_patch.prototype.diff_commonOverlap_=function(a,b){var c=a.length,d=b.length;if(0==c||0==d)return 0;c>d?a=a.substring(c-d):c<d&&(b=b.substring(0,c));c=Math.min(c,d);if(a==b)return c;for(var d=0,e=1;;){var f=a.substring(c-e),f=b.indexOf(f);if(-1==f)return d;e+=f;if(0==f||a.substring(c-e)==b.substring(0,e))d=e,e++}};
diff_match_patch.prototype.diff_halfMatch_=function(a,b){function c(a,b,c){for(var d=a.substring(c,c+Math.floor(a.length/4)),e=-1,g="",h,j,n,l;-1!=(e=b.indexOf(d,e+1));){var m=f.diff_commonPrefix(a.substring(c),b.substring(e)),s=f.diff_commonSuffix(a.substring(0,c),b.substring(0,e));g.length<s+m&&(g=b.substring(e-s,e)+b.substring(e,e+m),h=a.substring(0,c-s),j=a.substring(c+m),n=b.substring(0,e-s),l=b.substring(e+m))}return 2*g.length>=a.length?[h,j,n,l,g]:null}if(0>=this.Diff_Timeout)return null;
var d=a.length>b.length?a:b,e=a.length>b.length?b:a;if(4>d.length||2*e.length<d.length)return null;var f=this,g=c(d,e,Math.ceil(d.length/4)),d=c(d,e,Math.ceil(d.length/2)),h;if(!g&&!d)return null;h=d?g?g[4].length>d[4].length?g:d:d:g;var j;a.length>b.length?(g=h[0],d=h[1],e=h[2],j=h[3]):(e=h[0],j=h[1],g=h[2],d=h[3]);h=h[4];return[g,d,e,j,h]};
diff_match_patch.prototype.diff_cleanupSemantic=function(a){for(var b=!1,c=[],d=0,e=null,f=0,g=0,h=0,j=0,i=0;f<a.length;)0==a[f][0]?(c[d++]=f,g=j,h=i,i=j=0,e=a[f][1]):(1==a[f][0]?j+=a[f][1].length:i+=a[f][1].length,e&&(e.length<=Math.max(g,h)&&e.length<=Math.max(j,i))&&(a.splice(c[d-1],0,[-1,e]),a[c[d-1]+1][0]=1,d--,d--,f=0<d?c[d-1]:-1,i=j=h=g=0,e=null,b=!0)),f++;b&&this.diff_cleanupMerge(a);this.diff_cleanupSemanticLossless(a);for(f=1;f<a.length;){if(-1==a[f-1][0]&&1==a[f][0]){b=a[f-1][1];c=a[f][1];
d=this.diff_commonOverlap_(b,c);e=this.diff_commonOverlap_(c,b);if(d>=e){if(d>=b.length/2||d>=c.length/2)a.splice(f,0,[0,c.substring(0,d)]),a[f-1][1]=b.substring(0,b.length-d),a[f+1][1]=c.substring(d),f++}else if(e>=b.length/2||e>=c.length/2)a.splice(f,0,[0,b.substring(0,e)]),a[f-1][0]=1,a[f-1][1]=c.substring(0,c.length-e),a[f+1][0]=-1,a[f+1][1]=b.substring(e),f++;f++}f++}};
diff_match_patch.prototype.diff_cleanupSemanticLossless=function(a){function b(a,b){if(!a||!b)return 6;var c=a.charAt(a.length-1),d=b.charAt(0),e=c.match(diff_match_patch.nonAlphaNumericRegex_),f=d.match(diff_match_patch.nonAlphaNumericRegex_),g=e&&c.match(diff_match_patch.whitespaceRegex_),h=f&&d.match(diff_match_patch.whitespaceRegex_),c=g&&c.match(diff_match_patch.linebreakRegex_),d=h&&d.match(diff_match_patch.linebreakRegex_),i=c&&a.match(diff_match_patch.blanklineEndRegex_),j=d&&b.match(diff_match_patch.blanklineStartRegex_);
return i||j?5:c||d?4:e&&!g&&h?3:g||h?2:e||f?1:0}for(var c=1;c<a.length-1;){if(0==a[c-1][0]&&0==a[c+1][0]){var d=a[c-1][1],e=a[c][1],f=a[c+1][1],g=this.diff_commonSuffix(d,e);if(g)var h=e.substring(e.length-g),d=d.substring(0,d.length-g),e=h+e.substring(0,e.length-g),f=h+f;for(var g=d,h=e,j=f,i=b(d,e)+b(e,f);e.charAt(0)===f.charAt(0);){var d=d+e.charAt(0),e=e.substring(1)+f.charAt(0),f=f.substring(1),k=b(d,e)+b(e,f);k>=i&&(i=k,g=d,h=e,j=f)}a[c-1][1]!=g&&(g?a[c-1][1]=g:(a.splice(c-1,1),c--),a[c][1]=
h,j?a[c+1][1]=j:(a.splice(c+1,1),c--))}c++}};diff_match_patch.nonAlphaNumericRegex_=/[^a-zA-Z0-9]/;diff_match_patch.whitespaceRegex_=/\s/;diff_match_patch.linebreakRegex_=/[\r\n]/;diff_match_patch.blanklineEndRegex_=/\n\r?\n$/;diff_match_patch.blanklineStartRegex_=/^\r?\n\r?\n/;
diff_match_patch.prototype.diff_cleanupEfficiency=function(a){for(var b=!1,c=[],d=0,e=null,f=0,g=!1,h=!1,j=!1,i=!1;f<a.length;){if(0==a[f][0])a[f][1].length<this.Diff_EditCost&&(j||i)?(c[d++]=f,g=j,h=i,e=a[f][1]):(d=0,e=null),j=i=!1;else if(-1==a[f][0]?i=!0:j=!0,e&&(g&&h&&j&&i||e.length<this.Diff_EditCost/2&&3==g+h+j+i))a.splice(c[d-1],0,[-1,e]),a[c[d-1]+1][0]=1,d--,e=null,g&&h?(j=i=!0,d=0):(d--,f=0<d?c[d-1]:-1,j=i=!1),b=!0;f++}b&&this.diff_cleanupMerge(a)};
diff_match_patch.prototype.diff_cleanupMerge=function(a){a.push([0,""]);for(var b=0,c=0,d=0,e="",f="",g;b<a.length;)switch(a[b][0]){case 1:d++;f+=a[b][1];b++;break;case -1:c++;e+=a[b][1];b++;break;case 0:1<c+d?(0!==c&&0!==d&&(g=this.diff_commonPrefix(f,e),0!==g&&(0<b-c-d&&0==a[b-c-d-1][0]?a[b-c-d-1][1]+=f.substring(0,g):(a.splice(0,0,[0,f.substring(0,g)]),b++),f=f.substring(g),e=e.substring(g)),g=this.diff_commonSuffix(f,e),0!==g&&(a[b][1]=f.substring(f.length-g)+a[b][1],f=f.substring(0,f.length-
g),e=e.substring(0,e.length-g))),0===c?a.splice(b-d,c+d,[1,f]):0===d?a.splice(b-c,c+d,[-1,e]):a.splice(b-c-d,c+d,[-1,e],[1,f]),b=b-c-d+(c?1:0)+(d?1:0)+1):0!==b&&0==a[b-1][0]?(a[b-1][1]+=a[b][1],a.splice(b,1)):b++,c=d=0,f=e=""}""===a[a.length-1][1]&&a.pop();c=!1;for(b=1;b<a.length-1;)0==a[b-1][0]&&0==a[b+1][0]&&(a[b][1].substring(a[b][1].length-a[b-1][1].length)==a[b-1][1]?(a[b][1]=a[b-1][1]+a[b][1].substring(0,a[b][1].length-a[b-1][1].length),a[b+1][1]=a[b-1][1]+a[b+1][1],a.splice(b-1,1),c=!0):a[b][1].substring(0,
a[b+1][1].length)==a[b+1][1]&&(a[b-1][1]+=a[b+1][1],a[b][1]=a[b][1].substring(a[b+1][1].length)+a[b+1][1],a.splice(b+1,1),c=!0)),b++;c&&this.diff_cleanupMerge(a)};diff_match_patch.prototype.diff_xIndex=function(a,b){var c=0,d=0,e=0,f=0,g;for(g=0;g<a.length;g++){1!==a[g][0]&&(c+=a[g][1].length);-1!==a[g][0]&&(d+=a[g][1].length);if(c>b)break;e=c;f=d}return a.length!=g&&-1===a[g][0]?f:f+(b-e)};
diff_match_patch.prototype.diff_prettyHtml=function(a){for(var b=[],c=/&/g,d=/</g,e=/>/g,f=/\n/g,g=0;g<a.length;g++){var h=a[g][0],j=a[g][1],j=j.replace(c,"&amp;").replace(d,"&lt;").replace(e,"&gt;").replace(f,"&para;<br>");switch(h){case 1:b[g]='<ins style="background:#e6ffe6;">'+j+"</ins>";break;case -1:b[g]='<del style="background:#ffe6e6;">'+j+"</del>";break;case 0:b[g]="<span>"+j+"</span>"}}return b.join("")};
diff_match_patch.prototype.diff_text1=function(a){for(var b=[],c=0;c<a.length;c++)1!==a[c][0]&&(b[c]=a[c][1]);return b.join("")};diff_match_patch.prototype.diff_text2=function(a){for(var b=[],c=0;c<a.length;c++)-1!==a[c][0]&&(b[c]=a[c][1]);return b.join("")};diff_match_patch.prototype.diff_levenshtein=function(a){for(var b=0,c=0,d=0,e=0;e<a.length;e++){var f=a[e][0],g=a[e][1];switch(f){case 1:c+=g.length;break;case -1:d+=g.length;break;case 0:b+=Math.max(c,d),d=c=0}}return b+=Math.max(c,d)};
diff_match_patch.prototype.diff_toDelta=function(a){for(var b=[],c=0;c<a.length;c++)switch(a[c][0]){case 1:b[c]="+"+encodeURI(a[c][1]);break;case -1:b[c]="-"+a[c][1].length;break;case 0:b[c]="="+a[c][1].length}return b.join("\t").replace(/%20/g," ")};
diff_match_patch.prototype.diff_fromDelta=function(a,b){for(var c=[],d=0,e=0,f=b.split(/\t/g),g=0;g<f.length;g++){var h=f[g].substring(1);switch(f[g].charAt(0)){case "+":try{c[d++]=[1,decodeURI(h)]}catch(j){throw Error("Illegal escape in diff_fromDelta: "+h);}break;case "-":case "=":var i=parseInt(h,10);if(isNaN(i)||0>i)throw Error("Invalid number in diff_fromDelta: "+h);h=a.substring(e,e+=i);"="==f[g].charAt(0)?c[d++]=[0,h]:c[d++]=[-1,h];break;default:if(f[g])throw Error("Invalid diff operation in diff_fromDelta: "+
f[g]);}}if(e!=a.length)throw Error("Delta length ("+e+") does not equal source text length ("+a.length+").");return c};diff_match_patch.prototype.match_main=function(a,b,c){if(null==a||null==b||null==c)throw Error("Null input. (match_main)");c=Math.max(0,Math.min(c,a.length));return a==b?0:a.length?a.substring(c,c+b.length)==b?c:this.match_bitap_(a,b,c):-1};
diff_match_patch.prototype.match_bitap_=function(a,b,c){function d(a,d){var e=a/b.length,g=Math.abs(c-d);return!f.Match_Distance?g?1:e:e+g/f.Match_Distance}if(b.length>this.Match_MaxBits)throw Error("Pattern too long for this browser.");var e=this.match_alphabet_(b),f=this,g=this.Match_Threshold,h=a.indexOf(b,c);-1!=h&&(g=Math.min(d(0,h),g),h=a.lastIndexOf(b,c+b.length),-1!=h&&(g=Math.min(d(0,h),g)));for(var j=1<<b.length-1,h=-1,i,k,q=b.length+a.length,r,t=0;t<b.length;t++){i=0;for(k=q;i<k;)d(t,c+
k)<=g?i=k:q=k,k=Math.floor((q-i)/2+i);q=k;i=Math.max(1,c-k+1);var p=Math.min(c+k,a.length)+b.length;k=Array(p+2);for(k[p+1]=(1<<t)-1;p>=i;p--){var w=e[a.charAt(p-1)];k[p]=0===t?(k[p+1]<<1|1)&w:(k[p+1]<<1|1)&w|((r[p+1]|r[p])<<1|1)|r[p+1];if(k[p]&j&&(w=d(t,p-1),w<=g))if(g=w,h=p-1,h>c)i=Math.max(1,2*c-h);else break}if(d(t+1,c)>g)break;r=k}return h};
diff_match_patch.prototype.match_alphabet_=function(a){for(var b={},c=0;c<a.length;c++)b[a.charAt(c)]=0;for(c=0;c<a.length;c++)b[a.charAt(c)]|=1<<a.length-c-1;return b};
diff_match_patch.prototype.patch_addContext_=function(a,b){if(0!=b.length){for(var c=b.substring(a.start2,a.start2+a.length1),d=0;b.indexOf(c)!=b.lastIndexOf(c)&&c.length<this.Match_MaxBits-this.Patch_Margin-this.Patch_Margin;)d+=this.Patch_Margin,c=b.substring(a.start2-d,a.start2+a.length1+d);d+=this.Patch_Margin;(c=b.substring(a.start2-d,a.start2))&&a.diffs.unshift([0,c]);(d=b.substring(a.start2+a.length1,a.start2+a.length1+d))&&a.diffs.push([0,d]);a.start1-=c.length;a.start2-=c.length;a.length1+=
c.length+d.length;a.length2+=c.length+d.length}};
diff_match_patch.prototype.patch_make=function(a,b,c){var d;if("string"==typeof a&&"string"==typeof b&&"undefined"==typeof c)d=a,b=this.diff_main(d,b,!0),2<b.length&&(this.diff_cleanupSemantic(b),this.diff_cleanupEfficiency(b));else if(a&&"object"==typeof a&&"undefined"==typeof b&&"undefined"==typeof c)b=a,d=this.diff_text1(b);else if("string"==typeof a&&b&&"object"==typeof b&&"undefined"==typeof c)d=a;else if("string"==typeof a&&"string"==typeof b&&c&&"object"==typeof c)d=a,b=c;else throw Error("Unknown call format to patch_make.");
if(0===b.length)return[];c=[];a=new diff_match_patch.patch_obj;for(var e=0,f=0,g=0,h=d,j=0;j<b.length;j++){var i=b[j][0],k=b[j][1];!e&&0!==i&&(a.start1=f,a.start2=g);switch(i){case 1:a.diffs[e++]=b[j];a.length2+=k.length;d=d.substring(0,g)+k+d.substring(g);break;case -1:a.length1+=k.length;a.diffs[e++]=b[j];d=d.substring(0,g)+d.substring(g+k.length);break;case 0:k.length<=2*this.Patch_Margin&&e&&b.length!=j+1?(a.diffs[e++]=b[j],a.length1+=k.length,a.length2+=k.length):k.length>=2*this.Patch_Margin&&
e&&(this.patch_addContext_(a,h),c.push(a),a=new diff_match_patch.patch_obj,e=0,h=d,f=g)}1!==i&&(f+=k.length);-1!==i&&(g+=k.length)}e&&(this.patch_addContext_(a,h),c.push(a));return c};diff_match_patch.prototype.patch_deepCopy=function(a){for(var b=[],c=0;c<a.length;c++){var d=a[c],e=new diff_match_patch.patch_obj;e.diffs=[];for(var f=0;f<d.diffs.length;f++)e.diffs[f]=d.diffs[f].slice();e.start1=d.start1;e.start2=d.start2;e.length1=d.length1;e.length2=d.length2;b[c]=e}return b};
diff_match_patch.prototype.patch_apply=function(a,b){if(0==a.length)return[b,[]];a=this.patch_deepCopy(a);var c=this.patch_addPadding(a);b=c+b+c;this.patch_splitMax(a);for(var d=0,e=[],f=0;f<a.length;f++){var g=a[f].start2+d,h=this.diff_text1(a[f].diffs),j,i=-1;if(h.length>this.Match_MaxBits){if(j=this.match_main(b,h.substring(0,this.Match_MaxBits),g),-1!=j&&(i=this.match_main(b,h.substring(h.length-this.Match_MaxBits),g+h.length-this.Match_MaxBits),-1==i||j>=i))j=-1}else j=this.match_main(b,h,g);
if(-1==j)e[f]=!1,d-=a[f].length2-a[f].length1;else if(e[f]=!0,d=j-g,g=-1==i?b.substring(j,j+h.length):b.substring(j,i+this.Match_MaxBits),h==g)b=b.substring(0,j)+this.diff_text2(a[f].diffs)+b.substring(j+h.length);else if(g=this.diff_main(h,g,!1),h.length>this.Match_MaxBits&&this.diff_levenshtein(g)/h.length>this.Patch_DeleteThreshold)e[f]=!1;else{this.diff_cleanupSemanticLossless(g);for(var h=0,k,i=0;i<a[f].diffs.length;i++){var q=a[f].diffs[i];0!==q[0]&&(k=this.diff_xIndex(g,h));1===q[0]?b=b.substring(0,
j+k)+q[1]+b.substring(j+k):-1===q[0]&&(b=b.substring(0,j+k)+b.substring(j+this.diff_xIndex(g,h+q[1].length)));-1!==q[0]&&(h+=q[1].length)}}}b=b.substring(c.length,b.length-c.length);return[b,e]};
diff_match_patch.prototype.patch_addPadding=function(a){for(var b=this.Patch_Margin,c="",d=1;d<=b;d++)c+=String.fromCharCode(d);for(d=0;d<a.length;d++)a[d].start1+=b,a[d].start2+=b;var d=a[0],e=d.diffs;if(0==e.length||0!=e[0][0])e.unshift([0,c]),d.start1-=b,d.start2-=b,d.length1+=b,d.length2+=b;else if(b>e[0][1].length){var f=b-e[0][1].length;e[0][1]=c.substring(e[0][1].length)+e[0][1];d.start1-=f;d.start2-=f;d.length1+=f;d.length2+=f}d=a[a.length-1];e=d.diffs;0==e.length||0!=e[e.length-1][0]?(e.push([0,
c]),d.length1+=b,d.length2+=b):b>e[e.length-1][1].length&&(f=b-e[e.length-1][1].length,e[e.length-1][1]+=c.substring(0,f),d.length1+=f,d.length2+=f);return c};
diff_match_patch.prototype.patch_splitMax=function(a){for(var b=this.Match_MaxBits,c=0;c<a.length;c++)if(!(a[c].length1<=b)){var d=a[c];a.splice(c--,1);for(var e=d.start1,f=d.start2,g="";0!==d.diffs.length;){var h=new diff_match_patch.patch_obj,j=!0;h.start1=e-g.length;h.start2=f-g.length;""!==g&&(h.length1=h.length2=g.length,h.diffs.push([0,g]));for(;0!==d.diffs.length&&h.length1<b-this.Patch_Margin;){var g=d.diffs[0][0],i=d.diffs[0][1];1===g?(h.length2+=i.length,f+=i.length,h.diffs.push(d.diffs.shift()),
j=!1):-1===g&&1==h.diffs.length&&0==h.diffs[0][0]&&i.length>2*b?(h.length1+=i.length,e+=i.length,j=!1,h.diffs.push([g,i]),d.diffs.shift()):(i=i.substring(0,b-h.length1-this.Patch_Margin),h.length1+=i.length,e+=i.length,0===g?(h.length2+=i.length,f+=i.length):j=!1,h.diffs.push([g,i]),i==d.diffs[0][1]?d.diffs.shift():d.diffs[0][1]=d.diffs[0][1].substring(i.length))}g=this.diff_text2(h.diffs);g=g.substring(g.length-this.Patch_Margin);i=this.diff_text1(d.diffs).substring(0,this.Patch_Margin);""!==i&&
(h.length1+=i.length,h.length2+=i.length,0!==h.diffs.length&&0===h.diffs[h.diffs.length-1][0]?h.diffs[h.diffs.length-1][1]+=i:h.diffs.push([0,i]));j||a.splice(++c,0,h)}}};diff_match_patch.prototype.patch_toText=function(a){for(var b=[],c=0;c<a.length;c++)b[c]=a[c];return b.join("")};
diff_match_patch.prototype.patch_fromText=function(a){var b=[];if(!a)return b;a=a.split("\n");for(var c=0,d=/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@$/;c<a.length;){var e=a[c].match(d);if(!e)throw Error("Invalid patch string: "+a[c]);var f=new diff_match_patch.patch_obj;b.push(f);f.start1=parseInt(e[1],10);""===e[2]?(f.start1--,f.length1=1):"0"==e[2]?f.length1=0:(f.start1--,f.length1=parseInt(e[2],10));f.start2=parseInt(e[3],10);""===e[4]?(f.start2--,f.length2=1):"0"==e[4]?f.length2=0:(f.start2--,f.length2=
parseInt(e[4],10));for(c++;c<a.length;){e=a[c].charAt(0);try{var g=decodeURI(a[c].substring(1))}catch(h){throw Error("Illegal escape in patch_fromText: "+g);}if("-"==e)f.diffs.push([-1,g]);else if("+"==e)f.diffs.push([1,g]);else if(" "==e)f.diffs.push([0,g]);else if("@"==e)break;else if(""!==e)throw Error('Invalid patch mode "'+e+'" in: '+g);c++}}return b};diff_match_patch.patch_obj=function(){this.diffs=[];this.start2=this.start1=null;this.length2=this.length1=0};
diff_match_patch.patch_obj.prototype.toString=function(){var a,b;a=0===this.length1?this.start1+",0":1==this.length1?this.start1+1:this.start1+1+","+this.length1;b=0===this.length2?this.start2+",0":1==this.length2?this.start2+1:this.start2+1+","+this.length2;a=["@@ -"+a+" +"+b+" @@\n"];var c;for(b=0;b<this.diffs.length;b++){switch(this.diffs[b][0]){case 1:c="+";break;case -1:c="-";break;case 0:c=" "}a[b+1]=c+encodeURI(this.diffs[b][1])+"\n"}return a.join("").replace(/%20/g," ")};
this.diff_match_patch=diff_match_patch;this.DIFF_DELETE=-1;this.DIFF_INSERT=1;this.DIFF_EQUAL=0;})()