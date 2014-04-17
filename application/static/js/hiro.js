/*

	Hiro client lib

	Hiro.folio: Manages the document list and the left hand folio sidebar

	Hiro.canvas: The currently loaded document
	Hiro.canvas.context: Search and right hand sidebar related functions

	Hiro.apps: Generic plugin setup 
	Hiro.apps.sharing: Sharing plugin
	Hiro.apps.publish: Publish selections to various external services

	Hiro.data: Core datamodel incl setter & getter & eventhandler
		store: unique store id, also seperate localstorage JSON string
		key: supports direct access to all object levels, eg foo.bar.baz
		value: arbitrary js objects

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

		// Init folio
		init: function() {
			var el = document.getElementById(this.el_root);

			// Event setup
			Hiro.ui.fastbutton.attach(el,Hiro.folio.folioclick);
			Hiro.ui.touchy.attach(el,Hiro.folio.foliotouch,55);			
		},

		// If the user clicked somewhere in the folio
		folioclick: function(event) {
			console.log('Yes, the folio',event);
		},

		// If the user hovered over the folio with mouse/finger
		foliotouch: function(event) {
			// Open the folio
			if (!Hiro.folio.open) Hiro.ui.slidefolio(1);
		}
	},

	// The white page, including the all elements like apps and the sidebar
	canvas: {
		// DOM IDs
		el_root: 'canvas',

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
		}		

	},

	// Core system functionality
	sys: {
		inited: false,

		// System setup, this is called once on startup and then calls inits for the various app parts 
		init: function(tier) {
			// Prevent initing twice
			if (this.inited) return;

			// Setup other app parts
			Hiro.folio.init();
			Hiro.canvas.init();
			Hiro.ui.init();			

			// Make sure we don't fire twice
			this.inited = true;
		}
	},

	// All things ui. Click it, touch it, fix it, show it.
	ui: {
		// General properties
		touch: ('ontouchstart' in document.documentElement),
		wastebin: document.getElementById('wastebin'),

		// Browser specific properties
		vendors: ['webkit','moz','o','ms'],
		opacity: '',		

		// Folio open/close properties
		slidewidth: 300,
		slideduration: 200,
		slidepos: 0,
		slidedirection: 0,	

		// Setup and browser capability testing
		init: function() {
			var style = this.wastebin.style,
				v = this.vendors;

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
