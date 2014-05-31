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

		// DOM IDs
		el_root: 'folio',
		el_notelist: 'notelist',
		el_archivelist: 'archivelist',
		el_showmenu: 'showmenu',		

		// Internal values
		autoupdate: null,

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
					case 'archive':
					case 'newnote':
						Hiro.folio.newnote();
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
			var el_n = document.getElementById(Hiro.folio.el_notelist),
				el_a = document.getElementById(Hiro.folio.el_archivelist);

			// Kick off regular updates, only once
			if (!Hiro.folio.updatetimeout) {
				Hiro.folio.updatetimeout = setInterval(Hiro.folio.paint,61000);
			}

			// Get data from store			
			var data = Hiro.data.get('folio','c');

			// Empty current list
			el_n.innerHTML = '';

			// Cycle through notes
			for (i=0,l=data.length;i<l;i++) {
				var el = (data[i].status == 'active') ? el_n : el_a;
				el.appendChild(Hiro.folio.renderlink(data[i].nid));
			}
		},	

		renderlink: function(id) {
			// Abort if we do not have all data loaded yet
			if (!Hiro.data.stores.folio || !Hiro.data.stores.folio) return;

			// Render active and archived document link
			var d = document.createElement('div'),
				note = Hiro.data.get('notes',id);

			// Set note root node properties	
			d.className = 'note';
			d.setAttribute('id','note_' + note.id);

			var link = document.createElement('a');
			link.setAttribute('href','/note/' + note.id);	

			var t = document.createElement('span');
			t.className = 'notetitle';
			t.innerHTML = note.c.title || 'Untitled Note';

			var stats = document.createElement('small');

			if (note.updated) {

			} else {
				stats.appendChild(document.createTextNode('Not saved yet'))							
			}	


			link.appendChild(t);
			link.appendChild(stats);			

			if (note.c.tribe.length > 0) {
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

			return d;			
		},

		// Move folio entry to top and resort rest of folio
		// TODO Bruno: Add sort by last own edit when we have it
		sort: function(totop) {
			var f = Hiro.data.get('folio','c');

			// Move note by id to top of list
			if (totop) {
				for (i=0,l=f.length;i<l;i++) {
					if (f[i].nid = totop) f.unshift(f.splice(i,1)[0]);
				}
			}

			// Save changes locally and repaint
			Hiro.data.set('folio','c',f);
		},

		// Add a new note to folio and notes array, then open it 
		newnote: function() {
			var f = Hiro.data.get('folio'),
				n = Hiro.data.get('notes'),
				id = 1;

			// Find a good id we can use
			for (i=0,l=f.c.length;i<l;i++) {
				if (f.c[i].nid.length < 3) id++;
			}	

			// Convert id to string
			id = id.toString();

			// Build new note entry for folio
			var folionote = {
				nid: id,
				status: 'active'
			}

			// Add new item to beginning of array
			f.c.unshift(folionote);

			// Build new note object for notes store
			var note = {
				c: { text: '', title: '', tribe: [] },
				sv: 0, cv: 0,
				id: id,
				kind: 'note'
			}

			// Add note,save and repaint folio
			Hiro.data.quicksave('folio');			
			Hiro.data.set('notes',id.toString(),note,'c','ADD',true);
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
				text = document.getElementById(this.el_text);

			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);				

			// Start hprogress bar
			Hiro.ui.hprogress.begin();	

			// Set internal values
			this.currentnote = id;

			// Load text & title onto canvas
			text.value = note.c.text;
			this.settitle(note.c.title);

			// End hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('Loaded note onto canvas:',note);
		},

		// Set title programmatically
		settitle: function(title) {
			var el = document.getElementById(this.el_title),
				title = title || 'Untitled Note';

			// Set title
			el.value = document.title = title;			
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

		// Set local data
		set: function(store,key,value,source,type,paint) {
			type = type || 'UPDATE',
			source = source || 'c';
			paint = paint || key.indexOf('.c.title');

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

				// Kick off sync 
				Hiro.sync.build();								
			}

			// Mark store for local persistence and kickoff write
			this.quicksave(store);
		},

		// If the key contains '.', we set the respective property
		// Example: someobj,'foo.bar.baz' becomes someobj[foo][bar][baz]
		deepset: function(obj,key,value) {
			// Split string into array
			var a = key.split('.');

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
				return false;
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
			var start, end, dur;
			this.saving = true;

			// Start timer
			start = new Date().getTime(); 

			// Cycle through unsaved stores
			for (var i = 0, l = this.unsaved.length; i < l; i++) {
				var key = this.unsaved[i],
					value = this.stores[key];	

				// Write data into localStorage	
				this.todisc('Hiro.' + key,value)						
			}

			// Persist list of unsynced values and msg queue
			this.todisc('Hiro.unsynced',this.unsynced);
			this.todisc('Hiro.queue',Hiro.sync.queue);

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
		todisc: function(key,value) {
			// Make sure we store a string
			if (typeof value !== 'string') value = JSON.stringify(value);

			// Write and log poetntial errors
			try {
				localStorage.setItem(key,value);
			} catch(e) {		
				Hiro.sys.error('Datastore error',e);
			}	
		}
	},

	// Connecting local and server state
	sync: {
		protocol: undefined,
		connected: false,
		authenticated: false,
		latency: 100,

		// TODO: Move this to persisted data store?
		sid: undefined,
		token: undefined,	

		// Message queue, states are: 
		// 0 = not sent, new tag; 1 = not sent, ack tag; 2 = sent; 4 = acked by server & ready to delete		
		queue: [],	
		tbc: [],
		queuelookup: {},
		building: false,

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
			token = token || this.token || 'userlogin';
			var payload = {
				"name": "session-create",
        		"token": token 
        	};

        	// Logging
			Hiro.sys.log('Requesting session',payload);			

			// Sending data
			this.tx(payload);
		},		

		// Send message to server
		tx: function(data) {
			if (!data) return;

			// Enrich data object
			if (!data.sid) data.sid = this.sid;
			if (!data.tag) data.tag = Math.random().toString(36).substring(2,8);

			// If status = 1, we advance the msg to 4 immediately
			if (data.status == 1) this.queuelookup(data.tag).status = 4;

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
			// Build handler name
			var handler = data.name.replace(/-/g, "_");
			handler = 'rx_' + handler + '_handler';

			// Check if handler exists and abort if not
			if (!this[handler]) {
				Hiro.sys.error('Received unknown response:',data);
				return;
			}

			// Fire handler
			this[handler](data);	
		},

		// Overwrite local state with servers on login, session create or fatal errors
		// TODO Bruno: Refactor once protocol is set
		rx_session_create_handler: function(data) {
			// Set internal value		
			this.sid = data.session.sid;

			// Folio triggers a paint, make sure it happens after notes ad the notes data is needed
			Hiro.data.set('notes','',data.session.notes,'s');				
			Hiro.data.set('user','',data.session.uid,'s');
			Hiro.data.set('folio','',data.session.folio,'s');	

			// Session reset doesn't give us cv/sv/shadow/backup etc, so we create them now
			for (note in data.session.notes) {
				var n = Hiro.data.get('notes',note),
					t = JSON.stringify(n.val.tribe);
				n.sv = n.cv = 0;
				n.c = {};
				n.s = {};
				n.c.text = n.c.shadow = n.s.text = n.val.text;
				n.c.title = n.s.title = n.val.title;
				n.c.tribe = JSON.parse(t);
				n.s.tribe = JSON.parse(t);				
				delete n.val;
			}

			// Save note changes
			Hiro.data.quicksave('notes');			

			// Clean up folio
			var f = Hiro.data.get('folio'),
				fv = JSON.stringify(f.val);
			f.cv = f.sv = 0;
			f.s = JSON.parse(fv);
			f.c = JSON.parse(fv);	
			delete f.val;		

			// Save folio changes
			Hiro.data.quicksave('folio');	

			// Visually update folio
			Hiro.folio.paint();

			// Respond with ehlo
			var req = {
        		name: "client-ehlo",
        		sid: this.sid,
        		tag: data.tag,
    		}
    		this.tx(req);

			// Complete hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('New session created',data);
			Hiro.sys.log('',null,'groupEnd');			
		},

		// Incoming sync request, could be server initiated or ACK
		// TODO Bruno: Check via deepdiff if the ack contains any new changes and apply if yes
		rx_res_sync_handler: function(data) {
			var ack = this.queuelookup[data.tag];

			// We do have a local msg, this is an ACK
			if (ack) {
				// Mark msg as complete
				ack.state = 4;

				// Calculate roundtrip time
				l = (new Date().getTime() - ack.sent);
				this.latency = (l > 0) ? l : 20;
			} else {
				this.processupdate(data,true);
			}
		},

		// Process changes sent from server
		processupdate: function(data,echo) {
			// Find out which store we're talking about
			var store = (data.res.kind == 'note') ? 'notes' : 'folio',
				r = Hiro.data.get(store,data.res.id);

			// Process change stack
			for (i=0,l=data.changes.length; i<l; i++) {
				var ch = data.changes[i];

				// If the server version is lower than the one we have, ignore
				if (ch.clock.sv < r.sv) continue;

				// See if title changed, so Bruno can toil along with apply flow
				// TODO Flo: Only send values that changed
				if (ch.delta.title[0] != ch.delta.title[1]) {
					r.s.title = r.c.title = ch.delta.title[1];
					// Set title visually if current document is open
					if (data.res.id == Hiro.canvas.currentnote) Hiro.canvas.settitle(ch.delta.title[1]);
				}	

				// Iterate server
				r.sv = ch.clock.sv;
			}	

			// Change queue tags to echo or echo explicitely
			if (echo && this.queue.length > 0 && this.queue[0].status == 0) {
				this.queue[0].status = 1;
				this.queue[0].tag = data.tag;
			} else if (echo) {
				this.echo(data);
			}

			// Save & repaint
			Hiro.data.quicksave(store);
			Hiro.folio.paint();
		},

		// Send simple confirmation for received request
		echo: function(data) {
			this.tx(data);
		},

		// Create messages representing all changes between local client and server versions
		// Update local server version right away and init sending cycle
		build: function() {
			var u = Hiro.data.unsynced,
				q = this.queue;

			// Only one build at a time
			if (this.building || u.length == 0) return;
			this.building = true;

			// Cycle through changes
			for (i=0,l=u.length;i<l;i++) {
				if (u[i] == 'notes') {
					// Cycle through notes store
					var n = Hiro.data.get('notes');					
					for (note in n) this.spawnmsg(this.diff.dd(n[note],u[i],true),n[note]);
				} else {
					// In case of non notes store get store first
					var s = Hiro.data.get(u[i]);				
					this.spawnmsg(this.diff.dd(s,u[i],true),s);
				}
			}

			// Empty list of unsynced stores to notice later changes
			Hiro.data.unsynced.length = 0;

			// Save all changes locally: At this point we persist changes to the stores made by deepdiff etc
			// and our msg queue
			Hiro.data.persist();

			// Send messages via processqueue handler
			this.processqueue();

			// Allow creation of next build and kick it off if we have new data
			setTimeout(function(){
				Hiro.sync.building = false;
				if (Hiro.data.unsynced.length > 0) Hiro.sync.build();
			},this.latency);
		},

		// Build a complete message object from simple changes array
		spawnmsg: function(changes,store) {
			if (!changes || !store) return;

			// Build wrapper object
			var r = {};
			r.name = 'res-sync';
			r.res = { kind : store['kind'] , id : store['id'] };
			r.changes = [ changes ];
			r.sid = Hiro.sync.sid;
			r.tag = Math.random().toString(36).substring(2,8);

			// Add (ready)state to msg
			r.state = 0;

			// Add data to queue
			Hiro.sync.queue.push(r);
		},

		// Cycle through queue and send all objects with state < 2 to server
		// TODO: Add payload [] and push & send in bulk if Hync is ready
		processqueue: function() {
			var q = this.queue;

			// Cycle through complete queue, bottom to top
			for (i = q.length - 1; i >= 0; i--) {

				// Process unsent messages
				if (q[i].state < 2) {

					// Add timestamp
					q[i].sent = new Date().getTime();

					// Send to server
					this.tx(q[i]);

					// Advance state
					// TODO: Make sure this only happens when we're online and send above is confirmed
					q[i].state = 2;					
				}

				// Discard confirmed messages
				if (q[i].state == 4) {
					q.splice(i,1);
					continue;
				}

				// Update lookup object
				this.queuelookup[q[i].tag] = q[i];	
			}
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
				Hiro.sys.log('Connecting to WebSocket server at',this.url,'group');

				// Spawn new socket
				this.socket = new WebSocket(this.url);

				// Attach onopen event handlers
				this.socket.onopen = function(e) {
					Hiro.sys.log('WebSocket opened',this.socket);	

					// Switch to online
					Hiro.sys.online = Hiro.sync.connected = true;	

					// Auth the connection right away
					Hiro.sync.auth();		
				}

				// Message handler
				this.socket.onmessage = function(e) {
					Hiro.sync.rx(JSON.parse(e.data));
				}

				// Close handler
				this.socket.onclose = function(e) {
					Hiro.sys.log('WebSocket closed',this.socket);	
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
			// TODO Bruno: Ignore order diffs of client folio array 
			dd: function(store,rootstoreid,uniform) {
				// Define a function that returns true for params we want to ignore
				var ignorelist = function(path,key) {
					if (key == 'shadow' || key == 'backup') return true; 
				};

				// Make raw diff
				var d = DeepDiff(store.s,store.c,ignorelist);

				// Abort if we don't have any diffs
				if (!d || d.length == 0) return false;

				// Start building request
				var changes = {};
				changes.clock = { sv : store['sv'] , cv : store['cv']++ };
				changes.delta = {};				

				// Create proper delta format
				for (i=0,l=d.length;i<l;i++) {
					// If the last path element is a text element, we get a dmp delta from the rhs text & shadow
					if (d[i].path == 'text') {
						// Get dmp delta
						changes.delta.text = this.delta(store.c.shadow,store.c.text);

						// Create backup to be able to fall back if all fails
						store.c.backup = store.c.shadow;

						// Update shadow to latest value
						store.c.shadow = store.c.text;
					} else {
						changes.delta[d[i].path] = [d[i].lhs,d[i].rhs];
					}
				}

				// Apply changes to local serverstate object
				if (uniform) {
					for (i=0,l=d.length;i<l;i++) {
						DeepDiff.applyChange(store.s,store.c,d[i]);
					}
				}	

				// Mark store as tainted but do not persist yet for performance reasons
				if (Hiro.data.unsaved.indexOf(rootstoreid) < 0) Hiro.data.unsaved.push(rootstoreid);			

				// Return changes
				return changes;
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
			}			
		}
	},

	// Core system functionality
	sys: {
		version: undefined,
		inited: false,
		production: (window.location.href.indexOf('hiroapp') >= 0),	
		online: false,	

		// System setup, this is called once on startup and then calls inits for the various app parts 
		init: function(tier,ws_url,online) {
			// Prevent initing twice
			if (this.inited) return;

			// Set online/offline
			this.online = online;

			// Setup other app parts
			Hiro.folio.init();
			Hiro.canvas.init();
			Hiro.ui.init(tier);	
			Hiro.sync.init(ws_url);	
			Hiro.lib.init();							

			// Make sure we don't fire twice
			this.inited = true;

			// Log completetion
			Hiro.sys.log('Hiro inited');
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
		el_archive: document.getElementById('archive'),
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
				v = this.vendors;

			// Set up UI according to user level
			this.setstage(tier);	

			// Determine CSS opacity property
			if (style.opacity !== undefined) this.opacity = 'opacity';
			else {
				for (var i = 0, l = v.length; i < l; i++) {
					var v = v[i] + 'Opacity';
					if (style[v] !== undefined) {
						this.opacity = v;
						break;
					}
				}
			}

			// Set vendor specific global animationframe property
			if (!window.requestAnimationFrame) {
				for (var i=0, l = v.length; i < l; i++) {
					var v = v[i], r = window[v + 'RequestAnimationFrame'];
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

// Minified Deep-Diff: https://github.com/flitbit/diff/
!function(e){"use strict";var t,n,i=[];if(typeof global=="object"&&global){t=global}else if(typeof window!=="undefined"){t=window}else{t={}}n=t.DeepDiff;if(n){i.push(function(){if("undefined"!==typeof n&&t.DeepDiff===h){t.DeepDiff=n;n=e}})}function r(e,t){e.super_=t;e.prototype=Object.create(t.prototype,{constructor:{value:e,enumerable:false,writable:true,configurable:true}})}function f(e,t){Object.defineProperty(this,"kind",{value:e,enumerable:true});if(t&&t.length){Object.defineProperty(this,"path",{value:t,enumerable:true})}}function a(e,t,n){a.super_.call(this,"E",e);Object.defineProperty(this,"lhs",{value:t,enumerable:true});Object.defineProperty(this,"rhs",{value:n,enumerable:true})}r(a,f);function u(e,t){u.super_.call(this,"N",e);Object.defineProperty(this,"rhs",{value:t,enumerable:true})}r(u,f);function l(e,t){l.super_.call(this,"D",e);Object.defineProperty(this,"lhs",{value:t,enumerable:true})}r(l,f);function o(e,t,n){o.super_.call(this,"A",e);Object.defineProperty(this,"index",{value:t,enumerable:true});Object.defineProperty(this,"item",{value:n,enumerable:true})}r(o,f);function s(e,t,n){var i=e.slice((n||t)+1||e.length);e.length=t<0?e.length+t:t;e.push.apply(e,i);return e}function c(t,n,i,r,f,h,p){f=f||[];var b=f.slice(0);if(h){if(r&&r(b,h))return;b.push(h)}var d=typeof t;var v=typeof n;if(d==="undefined"){if(v!=="undefined"){i(new u(b,n))}}else if(v==="undefined"){i(new l(b,t))}else if(d!==v){i(new a(b,t,n))}else if(t instanceof Date&&n instanceof Date&&t-n!=0){i(new a(b,t,n))}else if(d==="object"&&t!=null&&n!=null){p=p||[];if(p.indexOf(t)<0){p.push(t);if(Array.isArray(t)){var y,m=t.length,g=function(e){i(new o(b,y,e))};for(y=0;y<t.length;y++){if(y>=n.length){i(new o(b,y,new l(e,t[y])))}else{c(t[y],n[y],g,r,[],null,p)}}while(y<n.length){i(new o(b,y,new u(e,n[y++])))}}else{var w=Object.keys(t);var D=Object.keys(n);w.forEach(function(f){var a=D.indexOf(f);if(a>=0){c(t[f],n[f],i,r,b,f,p);D=s(D,a)}else{c(t[f],e,i,r,b,f,p)}});D.forEach(function(t){c(e,n[t],i,r,b,t,p)})}p.length=p.length-1}}else if(t!==n){if(!(d==="number"&&isNaN(t)&&isNaN(n))){i(new a(b,t,n))}}}function h(t,n,i,r){r=r||[];c(t,n,function(e){if(e){r.push(e)}},i);return r.length?r:e}function p(e,t,n){if(n.path&&n.path.length){var i=e[t],r,f=n.path.length-1;for(r=0;r<f;r++){i=i[n.path[r]]}switch(n.kind){case"A":p(i[n.path[r]],n.index,n.item);break;case"D":delete i[n.path[r]];break;case"E":case"N":i[n.path[r]]=n.rhs;break}}else{switch(n.kind){case"A":p(e[t],n.index,n.item);break;case"D":e=s(e,t);break;case"E":case"N":e[t]=n.rhs;break}}return e}function b(e,t,n){if(!(n instanceof f)){throw new TypeError("[Object] change must be instanceof Diff")}if(e&&t&&n){var i=e,r,a;a=n.path.length-1;for(r=0;r<a;r++){if(typeof i[n.path[r]]==="undefined"){i[n.path[r]]={}}i=i[n.path[r]]}switch(n.kind){case"A":p(i[n.path[r]],n.index,n.item);break;case"D":delete i[n.path[r]];break;case"E":case"N":i[n.path[r]]=n.rhs;break}}}function d(e,t,n){if(e&&t){var i=function(i){if(!n||n(e,t,i)){b(e,t,i)}};c(e,t,i)}}Object.defineProperties(h,{diff:{value:h,enumerable:true},observableDiff:{value:c,enumerable:true},applyDiff:{value:d,enumerable:true},applyChange:{value:b,enumerable:true},isConflict:{get:function(){return"undefined"!==typeof n},enumerable:true},noConflict:{value:function(){if(i){i.forEach(function(e){e()});i=null}return h},enumerable:true}});if(typeof module!="undefined"&&module&&typeof exports=="object"&&exports&&module.exports===exports){module.exports=h}else{t.DeepDiff=h}}();