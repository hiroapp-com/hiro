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

		// Internal values
		autoupdate: null,

		// Init folio
		init: function() {
			var el = document.getElementById(this.el_root);

			// Event setup
			Hiro.ui.fastbutton.attach(el,Hiro.folio.folioclick);
			Hiro.ui.touchy.attach(el,Hiro.folio.foliotouch,55);			
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
				Hiro.canvas.load(note);
			}
		},

		// If the user hovered over the folio with mouse/finger
		foliotouch: function(event) {
			// Open the folio
			if (!Hiro.folio.open) Hiro.ui.slidefolio(1);
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
			var data = Hiro.data.get('folio','Docs');

			// Empty current list
			el_n.innerHTML = '';

			// Cycle through notes
			for (i=0,l=data.length;i<l;i++) {
				el_n.appendChild(Hiro.folio.renderlink(data[i]));
			}
		},	

		renderlink: function(note) {
			// Render active and archived document link
			var d = document.createElement('div');
			d.className = 'note';
			d.setAttribute('id','note_' + note);

			var link = document.createElement('a');
			link.setAttribute('href','/note/' + note);	

			var t = document.createElement('span');
			t.className = 'notetitle';
			t.innerHTML = note || 'Untitled Note';

			var stats = document.createElement('small');

			if (note.updated) {

			} else {
				stats.appendChild(document.createTextNode('Not saved yet'))							
			}	


			link.appendChild(t);
			link.appendChild(stats);

			if (note.shared) {
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
		}			
	},

	// The white page, including the all elements like apps and the sidebar
	canvas: {
		// DOM IDs
		el_root: 'canvas',
		el_text: 'pageContent',

		// Init canvas
		init: function() {
			var el = document.getElementById(this.el_root);

			// Event setup
			Hiro.ui.touchy.attach(el,Hiro.canvas.canvastouch,55);			
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

			// Load text onto canvas
			text.value = note.val;

			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1);

			console.log('loadin...',note);
		}		

	},

	// Local data, model and persitence
	data: {
		// Object holding all data
		stores: {},

		// Config
		enabled: undefined,
		unsaved: [],
		saving: false,
		timeout: null,
		maxinterval: 3000,
		dynamicinterval: 100,

		// Set local data
		set: function(store,key,value,source,type) {
			type = type || 'UPDATE';

			// Create store if it doesn't exist yet
			if (!this.stores[store]) this.stores[store] = undefined;

			// Set key TODO: Find a good generic mechanism for creating keys further down the hierarchy
			if (key) { this.stores[store][key] = value; } else {this.stores[store] = value};

			// Add store to currently unsaved data
			if (this.unsaved.indexOf(store) < 0) this.unsaved.push(store);

			// Repaint folio
			if (store == 'folio') Hiro.folio.paint();

			// Update localstore
			this.persist();
		},

		// Return data from local client
		get: function(store,key) {
			if (key && this.stores[store][key]) {
				return this.stores[store][key];
			} else if (this.stores[store]) {
				return this.stores[store];
			} else {
				this.fromdisk(store,key);
			}
		},

		// Request data from persistence layer
		fromdisk: function(store,key) {
			var data,
				store = 'Hiro.' + store;

			// Get data
			try {
				data = localStorage.getItem(store);			
			} catch (e) {
				Hiro.sys.error('Error retrieving data from localstore',e);		
			}

			// Fetch key or return complete object
			data = JSON.parse(data);
			if (key && data[key]) {
				return data[key];
			} else {
				return data;
			}			
		},

		// Persist data to localstorage
		persist: function() {
			// Do not run multiple saves
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
				try {
					localStorage.setItem('Hiro.' + key,value);
				} catch(e) {		
					Hiro.sys.error('Datastore error',e);
				}							
			}

			// Empty array
			this.unsaved = [];

			// Measure duration
			end = new Date().getTime(); 
			dur = (end - start);

			// Set new value if system is significantly slower than our default interval
			this.dynamicinterval = ((dur * 50) < this.maxinterval ) ? dur * 50 || 50 : this.maxinterval;

			// Trigger next save to browsers abilities
			this.timeout = setTimeout(function(){
				Hiro.data.saving = false;
				// Rerun persist if new changes happened
				if (Hiro.data.unsaved.length > 0) Hiro.data.persist();
			},this.dynamicinterval);
		}
	},

	// Connecting local and server state
	sync: {
		protocol: undefined,
		connected: false,
		authenticated: false,

		// TODO: Move this to persisted data store?
		sid: undefined,
		token: undefined,		

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
			data.sid = this.sid;
			data.tag = Math.random().toString(36).substring(2,8);

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
			// Handle specific cases
			if (data.name == 'session-create') {
				// Set internal value		
				this.sid = data.sid;

				// Overwrite local store with server state
				Hiro.data.set('folio','',data.session.folio.val,'s');
				Hiro.data.set('notes','',data.session.notes,'s');				
				Hiro.data.set('user','',data.session.folio.val.User,'s');

				// Log
				Hiro.sys.log('New session created',data);
				Hiro.sys.log('',null,'groupEnd');				
			} else {
				// Abort if it's an unknown response
				Hiro.sys.error('Received unknown response:',data);	
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
		slidefolio: function(direction) {
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
				duration = this.slideduration / distance * Math.abs(dx);
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
			console.log(a0,a1);
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

		}

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
