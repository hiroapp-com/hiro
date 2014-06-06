/*

	Hiro client lib

	Hiro.folio: Manages the document list and the left hand folio sidebar

	Hiro.canvas: The currently loaded document
	Hiro.canvas.context: Search and right hand sidebar related functions

	Hiro.apps: Generic plugin setup 
	Hiro.apps.sharing: Sharing plugin
	Hiro.apps.publish: Publish selections to various external services

	Hiro.store: Core datamodel incl setter & getter & eventhandler
		store: unique store id, also seperate localstorage JSON string
		key: supports direct access to all object levels, eg foo.bar.baz
		value: arbitrary js objects
		source: Where the update is coming from (client/server)

	Hiro.sync: Data synchronization with local and remote APIs
	Hiro.sync.ws: Websocket client
	Hiro.sync.ajax: Longpolling fallback and generic AJAX requests	
	Hiro.sync.store: Local storage abstractions	

	Hiro.ui: Basic UI related functions like showing/hiding dialogs, sliding menu etc
	Hiro.ui.fastbutton: Button event handlers that fire instantly on touch devices
	Hiro.ui.touchy: Trigger events on hover/touchstart with an optional delay
	Hiro.ui.swipe: Custom swipe functionality for touch devices
	Hiro.ui.hprogres: Thin progress bar on very top of page

	Hiro.sys: Core functionality like setup, logging etc
	Hiro.sys.user: Internal user management

	Hiro.lib: External libraries like Facebook or analytics	

	Hiro.util: Utilities like event attachment, humanized timestamps etc

*/


var Hiro = {
	version: '1.10.3',

	// Sidebar and internal data structure
	folio: {
		// States
		open: false,
		archiveopen: false,

		// DOM IDs
		el_root: 'folio',
		el_notelist: 'notelist',
		el_archivelist: 'archivelist',
		el_showmenu: 'showmenu',
		el_archivelink: 'archivelink',		

		// Internal values
		autoupdate: null,
		archivecount: 0,
		// Use lookup[id] to lookup folio element by id (note: this isn't the note itself, just the folio entry)
		lookup: {},

		// Init folio
		init: function() {
			var el = document.getElementById(this.el_root),
				sm = document.getElementById(this.el_showmenu);

			// Event setup
			Hiro.ui.fastbutton.attach(el,Hiro.folio.folioclick);			
			Hiro.ui.touchy.attach(el,Hiro.folio.foliotouch,55);	
			Hiro.ui.touchy.attach(sm,Hiro.folio.foliotouch,55);					
		},

		// If the user clicked somewhere in the folio
		folioclick: function(event) {
			// Stop default event
			Hiro.util.stopEvent(event);		

			var target = event.target || event.srcElement,
				note;
			
			// Clicks on the main elements
			if (target.id) {				
				switch (target.id) {
					case 'archivelink':
						Hiro.folio.archiveswitch();
						break;
					case 'newnote':
						note = Hiro.folio.newnote();
						break;
					case 'settings':
						console.log(target.id);
						break;
					default:
						if (target.id.indexOf('note_') > -1) note = target.id.replace('note_','');
				}
			} else {
				// Walk two DOM levels up to see if we have a note id
				note = target.parentNode.id || target.parentNode.parentNode.id;
				if (note.indexOf('note_') > -1) note = note.replace('note_','');
			}

			// If the click was on an archive icon
			if (target.className == 'archive') {
				// Directly set status
				Hiro.folio.lookup[note].status = (Hiro.folio.lookup[note].status == 'active') ? 'archive' : 'active';
				// Getset hack to kick off persistence / sync
				Hiro.data.set('folio','',Hiro.data.get('folio'));
				return;
			}

			// If the click was on a note link then load the note onto canvas
			if (note) {
				// Move entry to top of list
				Hiro.folio.sort(note);
				Hiro.canvas.load(note);
			}
		},

		// If the user hovered over the folio with mouse/finger
		foliotouch: function(event) {
			var target = event.target || event.srcElement;
			// Open the folio
			if (!Hiro.folio.open) {
				Hiro.ui.slidefolio(1);
			} else if (target.id == 'showmenu' || target.id == 'updatebubble') {
				Hiro.ui.slidefolio(-1);				
			}			
		},

		// Rerender data
		paint: function() {
			// that scope because it's called by timeout as well
			var that = Hiro.folio, i, l, el, data,
				el_n = document.getElementById(Hiro.folio.el_notelist),
				el_a = document.getElementById(Hiro.folio.el_archivelist),
				el_al = document.getElementById(Hiro.folio.el_archivelink);

			// Kick off regular updates, only once
			if (!that.updatetimeout) {
				that.updatetimeout = setInterval(Hiro.folio.paint,61000);
			}

			// Get data from store			
			data = Hiro.data.get('folio','c');

			// Empty current list and archivecount
			el_n.innerHTML = el_a.innerHTML = '';
			that.archivecount = 0;

			// Cycle through notes
			for (i=0,l=data.length;i<l;i++) {
				// Make sure we have a note


				// Check which DOM bucket and fire renderlink
				el = (data[i].status == 'active') ? el_n : el_a;
				el.appendChild(that.renderlink(data[i]));	

				// Update lookup object
				that.lookup[data[i].nid] = data[i];			
			}

			// Update text contents of archivelink
			if (!that.archiveopen) el_al.innerHTML = (that.archivecount > 0) ? 'Archive  (' + that.archivecount.toString() + ')' : 'Archive';
		},	

		renderlink: function(folioentry) {
			// Abort if we do not have all data loaded yet
			if (!Hiro.data.stores.folio || !Hiro.data.stores.folio) return;

			// Render active and archived document link
			var d = document.createElement('div'),
				id = folioentry.nid,
				note = Hiro.data.get('notes',id),
				link, t, stats, a;			

			// Set note root node properties	
			d.className = 'note';
			d.setAttribute('id','note_' + note.id);

			// Insert Link, Title and stats
			link = document.createElement('a');
			link.setAttribute('href','/note/' + note.id);	

			t = document.createElement('span');
			t.className = 'notetitle';
			t.innerHTML = note.c.title || 'Untitled Note';

			stats = document.createElement('small');

			// Build archive link
			a = document.createElement('div');
			a.className = 'archive';		

			// Prepare archive link and iterate counter
			if (folioentry.status == 'active') {

			} else if (folioentry.status == 'archive') {
				// Iterate counter
				this.archivecount++;
			} else {
				Hiro.sys.error('Folio contains document with unknown status',[folioentry,note])
			}

			if (note.updated) {

			} else {
				stats.appendChild(document.createTextNode('Not saved yet'))							
			}	

			// Attach elements to root node
			link.appendChild(t);
			link.appendChild(stats);			

			if (note.c.peers.length > 0) {
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

			// Attach link & archive to element
			d.appendChild(link);				
			d.appendChild(a);			

			return d;			
		},

		// Move folio entry to top and resort rest of folio for both, local client and server versions
		// TODO Bruno: Add sort by last own edit when we have it
		sort: function(totop) {
			var fc = Hiro.data.get('folio','c'),
				fs = Hiro.data.get('folio','s'),
				i, l;

			// Move note by id to top of list
			if (totop) {
				// Update client array
				for (i=0,l=fc.length;i<l;i++) {
					if (fc[i].nid == totop) {
						// Remove item from array and insert at beginning
						fc.unshift(fc.splice(i,1)[0]);
						break;	
					} 
				}
				// Update server array (we need the same order there for deepdiff to work)
				for (i=0,l=fs.length;i<l;i++) {
					if (fs[i].nid == totop) {
						// Remove item from array and insert at beginning
						fs.unshift(fs.splice(i,1)[0]);
						break;	
					} 
				}				
			}

			// Save changes locally and repaint
			Hiro.data.quicksave('folio');
			this.paint();
		},

		// Add a new note to folio and notes array, then open it 
		newnote: function() {
			var f = Hiro.data.get('folio'),
				n = Hiro.data.get('notes'),
				id = 1, i, l, folioc, folios, note;

			// Find a good id we can use
			for (i=0,l=f.c.length;i<l;i++) {
				if (f.c[i].nid.length < 3) id++;
			}	

			// Convert id to string
			id = id.toString();

			// Build new note entries for folio, use status new on serverside to mark changes for deepdiff
			folioc = {
				nid: id,
				status: 'active'
			}
			folios = {
				nid: id,
				status: 'new'
			}

			// Add new item to beginning of array
			f.c.unshift(folioc);
			f.s.unshift(folios);		

			// Build new note object for notes store
			// TODO Bruno: Make sure we mark the notes as different once hync supports
			note = {
				c: { text: '', title: '', peers: [] },
				s: { text: '', title: '', peers: [] },				
				sv: 0, cv: 0,
				id: id,
				kind: 'note'
			}

			// Add note and save						
			Hiro.data.set('notes',id.toString(),note,'c','ADD',false);
			Hiro.data.set('folio','',f);

			// Return the id of the we just created
			return id;
		},

		// Switch documentlist between active / archived 
		archiveswitch: function() {
			var act = document.getElementById(this.el_notelist),
				arc = document.getElementById(this.el_archivelist),
				el = document.getElementById(this.el_archivelink),
				c = (this.archivecount > 0) ? '(' + this.archivecount.toString() + ')' : '';

			// Set CSS properties and TExt string
			if (this.archiveopen) {
				act.style.display = 'block';
				arc.style.display = 'none';
				el.innerHTML = 'Archive  ' + c;
				this.archiveopen = false;
			} else {
				act.style.display = 'none';
				arc.style.display = 'block';
				el.innerHTML = 'Close Archive'
				this.archiveopen = true;
			}	
		}			
	},

	// The white page, including the all elements like apps and the sidebar
	canvas: {
		// Internal values
		currentnote: undefined,

		// DOM IDs
		el_root: 'canvas',
		el_title: 'pageTitle',
		el_text: 'pageContent',

		// Init canvas
		init: function() {
			var canvas = document.getElementById(this.el_root),
				text = document.getElementById(this.el_text),
				title = document.getElementById(this.el_title);

			// Event setup
			Hiro.util.registerEvent(text,'keyup',Hiro.canvas.textup);
			Hiro.util.registerEvent(title,'keyup',Hiro.canvas.titleup);			
			Hiro.ui.fastbutton.attach(title,Hiro.canvas.titleclick);			

			// When a user touches the white canvas area
			Hiro.ui.touchy.attach(canvas,Hiro.canvas.canvastouch,55);			
		},

		// When a user releases a key, this includes keys like delete or ctrl+v etc
		textup: function(event) {
			// Change internal object value
			Hiro.data.set('notes',Hiro.canvas.currentnote + '.c.text',this.value);
		},

		// When the focus comes off the title
		titleup: function(event) {
			// Change internal object value
			Hiro.data.set('notes',Hiro.canvas.currentnote + '.c.title',this.value);	
			// Change browser window title
			document.title = this.value;					
		},

		// When the user clicks into the title field
		titleclick: function(event) {
			var note = Hiro.data.get('notes',Hiro.canvas.currentnote),
				target = event.target || event.srcElement;

			// Empty field if Note has no title yet
			if (target.value && !note.c.title) target.value = '';
		},

		// If the user hovers over the canvas
		canvastouch: function(event) {
			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1);
		},

		// Load a note onto the canvas
		load: function(id) {
			var note = Hiro.data.get('notes',id),
				text = document.getElementById(this.el_text),
				// If we call load without id we just pick the doc on top of the folio
				id = id || Hiro.data.get('folio').c[0].nid;

			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);				

			// Start hprogress bar
			Hiro.ui.hprogress.begin();	

			// Set internal values
			this.currentnote = id;

			// Visual update
			this.paint();

			// End hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('Loaded note onto canvas:',note);
		},

		// Paint canvas
		// TODO Bruno: See if requestanimationframe helps her and at folio.paint()
		paint: function() {
			var el_title = document.getElementById(this.el_title),
				el_text = document.getElementById(this.el_text),
				current = this.currentnote || Hiro.data.get('folio').c[0].nid,
				n = Hiro.data.get('notes',current),
				title = n.c.title || 'Untitled Note', text = n.c.text;

			// Set title & text
			if (!n.c.title || el_title.value != n.c.title) el_title.value = document.title = title;	
			if (el_text.value != text) el_text.value = text;							
		}	
	},

	// Local data, model and persitence
	data: {
		// Object holding all data
		stores: {},
		// Name of stores that are synced with the server
		onlinestores: ['notes','folio'],

		// Config
		enabled: undefined,
		saving: false,
		timeout: null,
		maxinterval: 3000,
		dynamicinterval: 100,

		// Log which data isn't saved and/or synced
		unsaved: [],
		unsynced: [],

		// Set up datastore on pageload
		init: function() {
			// Attach localstore change listener
			Hiro.util.registerEvent(window,'storage',Hiro.data.localchange);

			// Lookup most common store
			var f = this.fromdisk('folio');

			// If we do have data stored locally
			if (f) {				
				// Load internal values
				this.unsynced = this.fromdisk('unsynced');			

				// Load stores into memory
				this.set('user','',this.fromdisk('user'));				
				this.set('notes','',this.fromdisk('notes'));				
				this.set('folio','',f);

				// Log 
				Hiro.sys.log('Found existing data in localstorage',localStorage);				

				// Commit any unsynced data to server
				Hiro.sync.commit();

				// Load doc onto canvas
				Hiro.canvas.load();
			} else {

			}
		},		

		// Detect changes to localstorage for all connected tabs
		// All browser should fire this event if a different window/tab writes changes
		localchange: function(event) {
			// IE maps the event to window
			event = event || window.event;

			// Extract proper key
			var k = event.key.split('.')[1];

			// Write changes
			if (event.newValue) Hiro.data.set(k,'',JSON.parse(event.newValue),'l');

			// See if we should redraw the canvas
			// TODO Bruno: This most likely (re)moves the cursor, 
			// 			   find out we should abuse the .edits update before to properly patch the position
			if (k == 'notes') Hiro.canvas.paint();
		},

		// Set local data
		set: function(store,key,value,source,type,paint) {
			type = type || 'UPDATE',
			source = source || 'c';
			paint = paint || (key && key.indexOf('.c.title') > -1);

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

			// If the store is an onlinestore 
			if (this.onlinestores.indexOf(store) > -1) {
			
				// Repaint folio
				if (store == 'folio' || paint) Hiro.folio.paint();

				// Mark store for syncing
				if (source == 'c' && this.unsynced.indexOf(store) < 0) this.unsynced.push(store);	

				// Kick off commit, no matter if the changes came from the server or client, but not localstorage
				if (source != 'l') Hiro.sync.commit();								
			}

			// Mark store for local persistence and kickoff write
			if (source != 'l') this.quicksave(store);
		},

		// If the key contains '.', we set the respective property
		// Example: someobj,'foo.bar.baz' becomes someobj[foo][bar][baz]
		deepset: function(obj,key,value) {
			// Split string into array
			var a = key.split('.'), i, l;

			// Loop through array and step down object tree
			for (i=0,l=a.length; i<l; i++) {
				// Stop one level before last and set value
				if (i == (l-1)) {
					obj[a[i]] = value;
					return;
				}
				obj = obj[a[i]];
			}
		},

		// Return data from local client
		get: function(store,key) {
			if (key && this.stores[store] && this.stores[store][key]) {
				return this.stores[store][key];
			} else if (!key && this.stores[store]) {
				return this.stores[store];
			} else {
				return undefined;
				// this.fromdisk(store,key);
			}
		},

		// Mark a store for local persistence and kick it off 
		quicksave: function(store) {
			// Add store to currently unsaved data
			if (this.unsaved.indexOf(store) < 0) this.unsaved.push(store);			

			// Update localstore
			this.persist();
		},

		// Persist data to localstorage
		persist: function() {
			// Do not run multiple saves at once
			if (this.saving) return;
			var start, end, dur, key, i, l;
			this.saving = true;

			// Start timer
			start = new Date().getTime(); 

			// Cycle through unsaved stores
			for (i = 0, l = this.unsaved.length; i < l; i++) {
				key = this.unsaved[i],
					value = this.stores[key];	

				// Write data into localStorage	
				this.todisk(key,value)						
			}

			// Persist list of unsynced values and msg queue
			this.todisk('unsynced',this.unsynced);

			// Empty array
			this.unsaved = [];

			// Measure duration
			end = new Date().getTime(); 
			dur = (end - start);

			// Log longer persistance times
			if (dur > 20) Hiro.sys.log('Data persisted bit slowly, within (ms):',dur);

			// Set new value if system is significantly slower than our default interval
			this.dynamicinterval = ((dur * 50) < this.maxinterval ) ? dur * 50 || 50 : this.maxinterval;

			// Trigger next save to browsers abilities
			this.timeout = setTimeout(function(){
				Hiro.data.saving = false;
				// Rerun persist if new changes happened
				if (Hiro.data.unsaved.length > 0) Hiro.data.persist();
			},this.dynamicinterval);
		},

		// Request data from persistence layer
		fromdisk: function(store,key) {
			var data,
				store = 'Hiro.' + store;

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
		wipe: function(key) {

			// No key, remove all
			if (!key) localStorage.clear();
		}
	},

	// Connecting local and server state
	sync: {
		protocol: undefined,
		online: false,
		authenticated: false,

		// Timing stuff
		lastsend: 0,
		latency: 100,

		// Prevent two commits being in progress
		commitinprogress: false,
		tags: [],

		// Init sync
		init: function(ws_url) {
			// Check if we got Websocket support, might need refinement
			if (window.WebSocket && window.WebSocket.prototype.send) {
				this.protocol = 'ws';
				this.ws.url = ws_url;
			} else if (window.XMLHttpRequest) {
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

		// Authenticate connection
		auth: function(token) {
			var user = Hiro.data.get('user');

			// Just quick ehlo with to make sure session is still valid
			if (user && user.sid) {	
	        	// Logging
				Hiro.sys.log('Startup completed with existing ID',user.sid);	

				// Send			
				this.commit();

				// End bootstrapping logging group
				Hiro.sys.log('',null,'groupEnd');				
			// Hm, no session ID, request a new one
			} else {
				// Apply token
				token = token || this.token || 'userlogin';
				var payload = {
					"name": "session-create",
	        		"token": token 
	        	};

	        	// Logging
				Hiro.sys.log('Requesting new session',payload);			

				// Sending data
				this.tx(payload);
			}
		},	

		// Send simple ping to server
		ping: function() {
			var sid = Hiro.data.get('user','sid');
			if (!sid) return;

			// Build ping
			req = {
        		name: "client-ehlo",
        		sid: sid
    		}

    		// Send ping
    		this.tx(req);
		},	

		// Send message to server
		tx: function(data) {
			if (!data) return;				

			// Make sure we always send an array
			if (!(data instanceof Array)) {
				data = [ data ];
			}			

			for (var i=0,l=data.length;i<l;i++) {	
				// Make sure no empty or null/undefined messages get sent
				if (!data[i]) continue;

				// Add timestamp
				this.lastsend = new Date().getTime();	

				// Enrich data object with sid & tag
				if (!data[i].sid) data[i].sid = Hiro.data.get('user','sid');				
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
				if (this.lastsend > 0) this.latency = (new Date().getTime() - this.lastsend) || 100;
				this.lastsend = 0;			
			}
		},

		// Overwrite local state with servers on login, session create or fatal errors
		// TODO Bruno: Refactor once protocol is set
		// TODO Bruno/Flo: Build new folio with single note if server has no session data
		rx_session_create_handler: function(data) {
			var n, f, fv, peers, req, user;
			// Build user object
			user = { id: data.session.uid, sid: data.session.sid};

			// Session reset doesn't give us cv/sv/shadow/backup etc, so we create them now
			for (note in data.session.notes) {
				n = data.session.notes[note];
				peers = (n.val.peers) ? JSON.parse(JSON.stringify(n.val.peers)) : undefined;
				n.sv = n.cv = 0;
				n.c = {};
				n.s = {};
				n.c.text = n.s.text = n.val.text;
				n.c.title = n.s.title = n.val.title;
				n.c.peers = peers;
				n.s.peers = peers;				
				delete n.val;
			}		

			// Clean up folio
			f = data.session.folio;
			fv = JSON.stringify(f.val);
			f.cv = f.sv = 0;
			f.s = JSON.parse(fv);
			f.c = JSON.parse(fv);	
			delete f.val;

			// Folio triggers a paint, make sure it happens after notes ad the notes data is needed
			Hiro.data.set('notes','',data.session.notes,'s');						
			Hiro.data.set('folio','',data.session.folio,'s');	
			Hiro.data.set('user','',user,'s');						

			// Visually update folio & canvas
			Hiro.folio.paint();
			Hiro.canvas.paint();

			// Respond with commit to make sure changes arrive at the server
			this.commit();			

			// Complete hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('New session created',data);
			Hiro.sys.log('',null,'groupEnd');			
		},

		// Process changes sent from server
		rx_res_sync_handler: function(data) {
			// Find out which store we're talking about
			var store = (data.res.kind == 'note') ? 'notes' : 'folio',
				key = (data.res.kind == 'note') ? data.res.id : '',
				r = Hiro.data.get(store,key), paint, regex, ack, mod, i, l, j, jl, stack;

			// Find out if it's a response or server initiated
			ack = (this.tags.indexOf(data.tag) > -1);

			// Process change stack
			for (i=0,l=data.changes.length; i<l; i++) {
				// Log stuff to doublecheck which rules should be applied				
				if (data.changes[i].clock.cv != r.cv || data.changes[i].clock.sv != r.sv) {
					Hiro.sys.error('Sync rule was triggered, find out how to handle it',JSON.parse(JSON.stringify([data,r])));
					continue;
				}	

				// Update title if it's a title update
				if (store == 'notes' && data.changes[i].delta.title) {
					r.s.title = r.c.title = data.changes[i].delta.title;
					// Set title visually if current document is open
					if (data.res.id == Hiro.canvas.currentnote) Hiro.canvas.paint();
					// Repaint folio
					paint = true;
				}				

				// Update text if it's a text update
				if (store == 'notes' && data.changes[i].delta.text) {
					// Regex to test for =NUM format
					regex = /^=[0-9]+$/;

					// Now we can safely apply change
					if (!(regex.test(data.changes[i].delta.text))) this.diff.patch(data.changes[i].delta.text,data.res.id);

				}	

				// Update folio if it's a folio update
				if (store == 'folio' && data.changes[i].delta.mod) {
					mod = data.changes[i].delta.mod;
					for (j=0,jl=mod.length;j<jl;j++) {
						Hiro.folio.lookup[mod[j][0]][mod[j][1]] = mod[j][3];
					}
					// Repaint folio
					paint = true;					
				}	

				// Remove outdated edits from stores
				if (r.edits && r.edits.length > 0) {
					stack = r.edits.length;
					while (stack--) {
						if (r.edits[stack].clock.cv < data.changes[i].clock.cv) r.edits.splice(stack,1); 
					}
				}

				// Iterate server version
				r.sv++;
			}

			// Save & repaint
			Hiro.data.quicksave(store);
			if (paint) Hiro.folio.paint();

			// Remove tag from list
			if (ack) {
				this.tags.splice(this.tags.indexOf(data.tag),1);
			// Respond if it was server initiated
			} else {
				// TODO Bruno: Evil hack, pls fix tomorrow				
				data.changes = r.edits || [{ clock: { cv: r.cv++, sv: r.sv }, delta: {}}];

				this.ack(data);
			}	

			// Release lock preventing push of new commits
			this.commitinprogress = false;
		},

		// Send simple confirmation for received request
		ack: function(data,reply) {		
			// Send echo
			this.tx(data);
		},

		// Create messages representing all changes between local model and shadow
		commit: function() {
			var u = Hiro.data.unsynced, i, l;

			// Only one build at a time, and only when we're online
			if (this.commitinprogress || !this.online) return;
			this.commitinprogress = true;
			var newcommit = [];

			// Cycle through stores flagged unsynced
			for (i=0,l=u.length;i<l;i++) {
				if (u[i] == 'notes') {
					// Cycle through notes store
					var n = Hiro.data.get('notes');					
					for (note in n) {
						this.diff.dd(n[note],u[i],true);
						if (n[note].edits && n[note].edits.length > 0) newcommit.push(this.wrapmsg(n[note].edits,n[note]));
					}	
				} else {
					// In case of non notes store get store first
					var s = Hiro.data.get(u[i]);				
					this.diff.dd(s,u[i],true);					
					if (s.edits && s.edits.length > 0) newcommit.push(this.wrapmsg(s.edits,s));
				}
			}

			// Save all changes locally: At this point we persist changes to the stores made by deepdiff etc
			Hiro.data.persist();

			// If we have any data in this commit, send it to the server now
			if (newcommit && newcommit.length > 0) {
				this.tx(newcommit);
			} else {
				// Send quick ping
				this.ping();

				// Release lock as no new commits were found
				this.commitinprogress = false;
			}	
		},

		// Build a complete message object from simple changes array
		wrapmsg: function(edits,store) {
			if (!edits || edits.length == 0 || !store || !edits[0]) return;

			// Build wrapper object
			var r = {};
			r.name = 'res-sync';
			r.res = { kind : store['kind'] , id : store['id'] };
			r.changes = edits;
			r.sid = Hiro.data.get('user','sid');		

			// Return r
			return r;	
		},

		// WebSocket settings and functions
		ws: {
			// The socket object
			socket: null,
			// Generic config			
			url: undefined,

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
					Hiro.sync.online = true;	

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
					Hiro.sync.online = false;					
					Hiro.sys.log('WebSocket closed',[e,this.socket]);	
				}				
			},
		},

		// Longpolling settings & functions
		lp: {

		},

		// Diff/match/patch specific stuff
		diff: {
			// The dmp instance we're using, created as callback when dmp script is loaded
			dmp: null,

			// Run Deep Diff over a specified store and optionally make sure they are the same afterwards
			dd: function(store,rootstoreid,uniform) {
				// Define a function that returns true for params we want to ignore
				var ignorelist = function(path,key) {
					if (key == 'backup') return true; 
				};

				// Don't run if we already have edits for this store
				// TODO Bruno: Allow multiple edits if sending times out despite being offline (once we're rock solid)
				if (store.edits && store.edits.length > 1) return;

				// Make raw diff
				var d = DeepDiff(store.s,store.c,ignorelist),
					changes, i, l, c;

				// Abort if we don't have any diffs
				if (!d || d.length == 0) return false;

				// Start building changes object
				changes = {};
				changes.clock = { sv : store['sv'] , cv : store['cv']++ };
				changes.delta = {};			

				// Create proper delta format and apply changes to serverside
				// Note: This is going to get very long and potentiall ugly...
				for (i=0,l=d.length;i<l;i++) {
					// If the last path element is a text element, we get a dmp delta from the rhs text & shadow
					if (d[i].path == 'text') {
						// Get dmp delta
						changes.delta.text = this.delta(store.s.text,store.c.text);

						// TODO Bruno: Add backup handling (ost return case)
						// store.c.backup = store.s.text;

						// Update local server version to latest value
						store.s.text = store.c.text;

					// If a new note was added to the folio	or had it's status changed
					} else if (rootstoreid == 'folio' && d[i].item.lhs == 'new') {
						// Add change to changes array
						if (!changes.delta.add) changes.delta.add = [];
						c = { nid: store.c[d[i].index].nid, status: store.c[d[i].index].status};
						// TODO Bruno: Add changes for submission once supported by hync
						// changes.delta.add.push(c);
						continue;

						// Set 'new' server version value to client version value and disable b0rked applychange
						// TODO Bruno: This currently affects all changes in this diff, think of better way
						store.s[d[i].index].status = d[i].item.rhs;
						uniform = false; 	
					// Status of a note in folio changed					
					} else if (rootstoreid == 'folio' && d[i].item.path[0] == 'status') {
						// Add change to changes array
						if (!changes.delta.mod) changes.delta.mod = [];	
						c = [ store.c[d[i].index].nid,'status',d[i].item.lhs,d[i].item.rhs];
						changes.delta.mod.push(c);

						// Update values and prevent deepdiff apply
						store.s[d[i].index].status = d[i].item.rhs;
						uniform = false;	
					// Generic changes					
					} else {
						changes.delta[d[i].path] = d[i].rhs;
					}

					// Apply changes to local serverstate object
					if (uniform) DeepDiff.applyChange(store.s,store.c,d[i]);
				}

				// Mark store as tainted but do not persist yet for performance reasons
				if (Hiro.data.unsaved.indexOf(rootstoreid) < 0) Hiro.data.unsaved.push(rootstoreid);			

				// Append changes to resource edits
				store.edits = store.edits || [];
				store.edits.push(changes);
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
				var n = Hiro.data.get('notes',id), diffs, patch;

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
	                if (id == Hiro.canvas.currentnote) Hiro.canvas.paint();
                }             	
			},	
		}
	},

	// Core system functionality
	sys: {
		version: undefined,
		inited: false,
		production: (window.location.href.indexOf('hiroapp') >= 0),	

		// System setup, this is called once on startup and then calls inits for the various app parts 
		init: function(tier,ws_url) {
			// Begin startup logging
			Hiro.sys.log('Hiro startup sequence','','group');

			// Prevent initing twice
			if (this.inited) return;

			// Setup other app parts
			Hiro.folio.init();
			Hiro.canvas.init();
			Hiro.ui.init(tier);	
			Hiro.data.init();			
			Hiro.sync.init(ws_url);	
			Hiro.lib.init();							

			// Make sure we don't fire twice
			this.inited = true;

			// Log completetion
			Hiro.sys.log('Hiro.js fully inited');
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

			// Log
			if (!this.production) console[type](description,data);
		}
	},

	// All things ui. Click it, touch it, fix it, show it.
	ui: {
		// General properties
		touch: ('ontouchstart' in document.documentElement),

		// DOM IDs. Note: Changing Nodes deletes this references, only use for inital HTML Nodes that are never replaced
		el_wastebin: document.getElementById('wastebin'),
		el_archive: document.getElementById('archivelink'),
		el_signin: document.getElementById('signin'),
		el_settings: document.getElementById('settings'),

		// Browser specific properties
		vendors: ['webkit','moz','o','ms'],
		opacity: '',		

		// Folio open/close properties
		slidewidth: 300,
		slideduration: 200,
		slidepos: 0,
		slidedirection: 0,	

		// Setup and browser capability testing
		init: function(tier) {
			var style = this.el_wastebin.style,
				v = this.vendors, i, l, v;

			// Set up UI according to user level
			this.setstage(tier);	

			// Determine CSS opacity property
			if (style.opacity !== undefined) this.opacity = 'opacity';
			else {
				for (i = 0, l = v.length; i < l; i++) {
					v = v[i] + 'Opacity';
					if (style[v] !== undefined) {
						this.opacity = v;
						break;
					}
				}
			}

			// Set vendor specific global animationframe property
			if (!window.requestAnimationFrame) {
				for (i=0, l = v.length; i < l; i++) {
					v = v[i], r = window[v + 'RequestAnimationFrame'];
					if (r) {
						window.requestAnimationFrame = r;
						window.cancelAnimationFrame = window[v + 'CancelAnimationFrame'] ||	window[v + 'CancelRequestAnimationFrame'];
						break;
					}
				}
			}	

			// Start hprogress on init
			this.hprogress.init();		
		},

		// Setup UI according to account level where 0 = anon
		setstage: function(tier) {
			//tier = tier || Hiro.sys.user.data.tier || 0;
			switch(tier) {
				case 0:
					this.el_signin.style.display = 'block';
					this.el_settings.style.display = this.el_archive.style.display = 'none';
					break;
				case 1:
					this.el_signin.style.display = 'none';
					this.el_settings.style.display = this.el_archive.style.display = 'block';
					break;
			}
		},

		// Slide folio: 1 to open, -1 to close
		slidefolio: function(direction,slideduration) {
			// Catch cases where sliding makes no sense
			if ((direction < 0 && this.slidepos === 0) ||  
				(direction > 0 && this.slidepos > 100) ||
				(this.slidedirection != 0))
				return;

			// Local vars
			var el = document.getElementById(Hiro.canvas.el_root),
				// Make sure we always have 50px on the right, even on narrow devices
				maxwidth = (document.body.offsetWidth - 50),
				distance = (maxwidth < this.slidewidth) ? maxwidth : this.slidewidth,
				// Start value
				x0 = this.slidepos,	
				// Target value
				x1 = (direction < 0) ? 0 : distance,
				// Distance to be achieved
				dx = x1 - x0;
				// Ideal easing duration
				sd = slideduration || this.slideduration,
				duration = sd / distance * Math.abs(dx);
				start = new Date().getTime();
				_this = this;		

			// Remove keyboard if we open the menu on touch devices
			if (document.activeElement && document.activeElement !== document.body && this.touch && direction === 1) document.activeElement.blur();

			// Easing function (quad), see 
			// Code: https://github.com/danro/jquery-easing/blob/master/jquery.easing.js
			// Overview / demos: http://easings.net/
			function ease(t, b, c, d) {
				if ((t/=d/2) < 1) return c/2*t*t + b;
				return -c/2 * ((--t)*(t-2) - 1) + b;
			}

			// Step through frames
			function step() {

				var dt = new Date().getTime() - start, 
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
				el.style.left = v + 'px';
				el.style.right = (v*-1)+'px';
						
				// If we still have time we step on each possible frame in modern browser or fall back in others											
				if (done) {
					// Timessssup
					Hiro.folio.open = (direction > 0) ? true : false;
					_this.direction = 0;
					_this.slidetimer = 0;
				} 
				else if (window.requestAnimationFrame) _this.slidetimer = requestAnimationFrame(step);
				else _this.slidetimer = setTimeout(step, 20);
			}

			// Kick off stepping loop
			step();							

		},

		// Fade a DOM element in or out via opacity changes, 1 top fade in, -1 to fade out
		fade: function(element, direction, duration) {
			var a0 = parseFloat((a0 === undefined || a0 === '') ? ((direction < 0) ? 1 : 0) : this.getopacity(element)),
				a1 = (direction < 0) ? 0 : 1,
				da = a1 - a0,
				duration = duration || 1000,
				start = new Date().getTime(), 
				_this = this;

			// Step through the animation
			function step() {
				var dt = new Date().getTime() - start, done = false;

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
				}
				else if (window.requestAnimationFrame) element._fadeTimer = requestAnimationFrame(step);
				else element._fadeTimer = setTimeout(step, 20);
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

		// Handle clicks depending on device (mouse or touch)
		fastbutton: {
			// Current event details
			x: undefined,
			y: undefined,

			// Attach initial event trigger
			attach: function(element,handler) {
				// Always attach click event
				Hiro.util.registerEvent(element,'click', function(e) {Hiro.ui.fastbutton.fire(e,handler)});
				// Optionally attach touchstart event for touch devices
				if (Hiro.ui.touch) Hiro.util.registerEvent(element,'touchstart', function(e) {Hiro.ui.fastbutton.fire(e,handler)});
			},

			// If the initial event is fired
			fire: function(event,handler) {
				if (event.type === 'click') {
					// If the event is a click event we just execute the handler and quit
					handler(event);					
				} else if (event.type === 'touchstart') {
					// In this case we attach a touchend event to wait for and set the start coordinates
					console.log('touchend')
				} else {
					// Log error to see if any browsers fire unknown events
					Hiro.sys.error('Fastbutton triggered unknown event: ', event);
				}
			},

			// Reset the coordinates and remove touchend event
			reset: function() {
				Hiro.ui.fastbutton.x = Hiro.ui.fastbutton.y = undefined;
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
				// If its a touch event, we turn this into a fastbutton without delay (but spatial limitation)				
				if (event.type === 'touchstart') Hiro.ui.fastbutton.fire(event,handler);				
				else if (event.type === 'mouseover') {
					// If we already listen to this element but moved to a different subnode do nothing
					if (element === this.element) return;
					// Initiate the delayed event firing
					delay = delay || this.defaultdelay;
					this.element = element;
					// Set timeout as local var (only one touchy at a time)
					this.timeout = setTimeout(function() {
						// If the timeout wasnt killed by the bounds handler, we execute the handler
						handler(event);
						// And clean up 
						Hiro.ui.touchy.abort(element);
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
				// If we leave the DOM are of interest, remove the handler and clean up
				Hiro.util.releaseEvent(this,'mouseout',Hiro.ui.touchy.boundschecker);					
				Hiro.ui.touchy.element = null;
				if (Hiro.ui.touchy.timeout) Hiro.ui.touchy.abort();							
			},

			// Abort our timeout & clean up
			abort: function() {
				clearTimeout(this.timeout);				
				this.timeout  = null;				
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
		}		
	},

	// External js library handling (Facebook, Analytics, DMP etc)
	lib: {

		// Load libraries
		init: function() {
			// Load Google Diff Match Patch
			this.loadscript('/static/js/diff_match_patch.js',undefined,function(){
				Hiro.sync.diff.dmp = new diff_match_patch();
			},true,0);		
		},

		// Generic script loader
		loadscript: function(url,id,callback,defer,delay) {
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
				if (callback) { 
					Hiro.util.registerEvent(o,'load',function(e){
						try { callback(null, e); } 
						catch (e) {
							// Make sure this always happens
							Hiro.sys.log('Scriptloader callback was not executed:',e)
						}
					}); 
				}	

				// Insert into DOM
				s.parentNode.insertBefore(o, s);
			},delay);					
		},		
	},

	// Generic utilities like event attachment etc
	util: {

		// Cross browser event registration
		registerEvent: function(obj, eventType, handler) {
			if (obj.addEventListener) obj.addEventListener(eventType.toLowerCase(), handler, false);
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

// Raw Deep-Diff for debugging: https://github.com/flitbit/diff/
;(function(undefined) {
	"use strict";

	var $scope
	, conflict, conflictResolution = [];
	if (typeof global == 'object' && global) {
		$scope = global;
	} else if (typeof window !== 'undefined'){
		$scope = window;
	} else {
		$scope = {};
	}
	conflict = $scope.DeepDiff;
	if (conflict) {
		conflictResolution.push(
			function() {
				if ('undefined' !== typeof conflict && $scope.DeepDiff === accumulateDiff) {
					$scope.DeepDiff = conflict;
					conflict = undefined;
				}
			});
	}

	// nodejs compatible on server side and in the browser.
  function inherits(ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  }

  function Diff(kind, path) {
  	Object.defineProperty(this, 'kind', { value: kind, enumerable: true });
  	if (path && path.length) {
  		Object.defineProperty(this, 'path', { value: path, enumerable: true });
  	}
  }

  function DiffEdit(path, origin, value) {
  	DiffEdit.super_.call(this, 'E', path);
  	Object.defineProperty(this, 'lhs', { value: origin, enumerable: true });
  	Object.defineProperty(this, 'rhs', { value: value, enumerable: true });
  }
  inherits(DiffEdit, Diff);

  function DiffNew(path, value) {
  	DiffNew.super_.call(this, 'N', path);
  	Object.defineProperty(this, 'rhs', { value: value, enumerable: true });
  }
  inherits(DiffNew, Diff);

  function DiffDeleted(path, value) {
  	DiffDeleted.super_.call(this, 'D', path);
  	Object.defineProperty(this, 'lhs', { value: value, enumerable: true });
  }
  inherits(DiffDeleted, Diff);

  function DiffArray(path, index, item) {
  	DiffArray.super_.call(this, 'A', path);
  	Object.defineProperty(this, 'index', { value: index, enumerable: true });
  	Object.defineProperty(this, 'item', { value: item, enumerable: true });
  }
  inherits(DiffArray, Diff);

  function arrayRemove(arr, from, to) {
  	var rest = arr.slice((to || from) + 1 || arr.length);
  	arr.length = from < 0 ? arr.length + from : from;
  	arr.push.apply(arr, rest);
  	return arr;
  }

  function deepDiff(lhs, rhs, changes, prefilter, path, key, stack) {
  	path = path || [];
  	var currentPath = path.slice(0);
  	if (key) {
  		if (prefilter && prefilter(currentPath, key)) return;
  		currentPath.push(key);
  	}
  	var ltype = typeof lhs;
  	var rtype = typeof rhs;
  	if (ltype === 'undefined') {
  		if (rtype !== 'undefined') {
  			changes(new DiffNew(currentPath, rhs ));
  		}
  	} else if (rtype === 'undefined') {
  		changes(new DiffDeleted(currentPath, lhs));
  	} else if (ltype !== rtype) {
  		changes(new DiffEdit(currentPath, lhs, rhs));
  	} else if (lhs instanceof Date && rhs instanceof Date && ((lhs-rhs) != 0) ) {
  		changes(new DiffEdit(currentPath, lhs, rhs));
  	} else if (ltype === 'object' && lhs != null && rhs != null) {
  		stack = stack || [];
  		if (stack.indexOf(lhs) < 0) {
  			stack.push(lhs);
  			if (Array.isArray(lhs)) {
  				var i
  				, len = lhs.length
  				, ea = function(d) {
  					changes(new DiffArray(currentPath, i, d));
  				};
  				for(i = 0; i < lhs.length; i++) {
  					if (i >= rhs.length) {
  						changes(new DiffArray(currentPath, i, new DiffDeleted(undefined, lhs[i])));
  					} else {
  						deepDiff(lhs[i], rhs[i], ea, prefilter, [], null, stack);
  					}
  				}
  				while(i < rhs.length) {
  					changes(new DiffArray(currentPath, i, new DiffNew(undefined, rhs[i++])));
  				}
  			} else {
  				var akeys = Object.keys(lhs);
  				var pkeys = Object.keys(rhs);
  				akeys.forEach(function(k) {
  					var i = pkeys.indexOf(k);
  					if (i >= 0) {
  						deepDiff(lhs[k], rhs[k], changes, prefilter, currentPath, k, stack);
  						pkeys = arrayRemove(pkeys, i);
  					} else {
  						deepDiff(lhs[k], undefined, changes, prefilter, currentPath, k, stack);
  					}
  				});
  				pkeys.forEach(function(k) {
  					deepDiff(undefined, rhs[k], changes, prefilter, currentPath, k, stack);
  				});
  			}
  			stack.length = stack.length - 1;
  		}
  	} else if (lhs !== rhs) {
      if(!(ltype === "number" && isNaN(lhs) && isNaN(rhs))) {
  		  changes(new DiffEdit(currentPath, lhs, rhs));
      }
  	}
  }

  function accumulateDiff(lhs, rhs, prefilter, accum) {
  	accum = accum || [];
  	deepDiff(lhs, rhs,
  		function(diff) {
  			if (diff) {
  				accum.push(diff);
  			}
  		},
  		prefilter);
  	return (accum.length) ? accum : undefined;
  }

	function applyArrayChange(arr, index, change) {
		if (change.path && change.path.length) {
			// the structure of the object at the index has changed...
			var it = arr[index], i, u = change.path.length - 1;
			for(i = 0; i < u; i++){
				it = it[change.path[i]];
			}
			switch(change.kind) {
				case 'A':
					// Array was modified...
					// it will be an array...
					applyArrayChange(it[change.path[i]], change.index, change.item);
					break;
				case 'D':
					// Item was deleted...
					delete it[change.path[i]];
					break;
				case 'E':
				case 'N':
					// Item was edited or is new...
					it[change.path[i]] = change.rhs;
					break;
			}
		} else {
			// the array item is different...
			switch(change.kind) {
				case 'A':
					// Array was modified...
					// it will be an array...
					applyArrayChange(arr[index], change.index, change.item);
					break;
				case 'D':
					// Item was deleted...
					arr = arrayRemove(arr, index);
					break;
				case 'E':
				case 'N':
					// Item was edited or is new...
					arr[index] = change.rhs;
					break;
			}
		}
		return arr;
	}

	function applyChange(target, source, change) {
		if (!(change instanceof Diff)) {
			throw new TypeError('[Object] change must be instanceof Diff');
		}
		if (target && source && change) {
			var it = target, i, u;
			u = change.path.length - 1;
			for(i = 0; i < u; i++){
				if (typeof it[change.path[i]] === 'undefined') {
					it[change.path[i]] = {};
				}
				it = it[change.path[i]];
			}
			switch(change.kind) {
				case 'A':
					// Array was modified...
					// it will be an array...
					applyArrayChange(it[change.path[i]], change.index, change.item);
					break;
				case 'D':
					// Item was deleted...
					delete it[change.path[i]];
					break;
				case 'E':
				case 'N':
					// Item was edited or is new...
					it[change.path[i]] = change.rhs;
					break;
				}
			}
		}

	function applyDiff(target, source, filter) {
		if (target && source) {
			var onChange = function(change) {
				if (!filter || filter(target, source, change)) {
					applyChange(target, source, change);
				}
			};
			deepDiff(target, source, onChange);
		}
	}

	Object.defineProperties(accumulateDiff, {

		diff: { value: accumulateDiff, enumerable:true },
		observableDiff: { value: deepDiff, enumerable:true },
		applyDiff: { value: applyDiff, enumerable:true },
		applyChange: { value: applyChange, enumerable:true },
		isConflict: { get: function() { return 'undefined' !== typeof conflict; }, enumerable: true },
		noConflict: {
			value: function () {
				if (conflictResolution) {
					conflictResolution.forEach(function (it) { it(); });
					conflictResolution = null;
				}
				return accumulateDiff;
			},
			enumerable: true
		}
	});

	if (typeof module != 'undefined' && module && typeof exports == 'object' && exports && module.exports === exports) {
		module.exports = accumulateDiff; // nodejs
	} else {
		$scope.DeepDiff = accumulateDiff; // other... browser?
	}
}());
