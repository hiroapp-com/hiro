/*

	Hiro client lib

	Hiro.folio: Manages the document list and the left hand folio sidebar

	Hiro.canvas: The currently loaded document
	Hiro.canvas.context: Search and right hand sidebar related functions

	Hiro.user: User management incl login logout etc
	Hiro.user.contacts: Contacts including lookup object etc

	Hiro.apps: Generic plugin setup 
	Hiro.apps.sharing: Sharing plugin
	Hiro.apps.publish: Publish selections to various external services

	Hiro.data: Core datamodel incl setter & getter & eventhandler
		store: unique store id, also seperate localstorage JSON string
		key: supports direct access to all object levels, eg foo.bar.baz
		value: arbitrary js objects
		source: Where the update is coming from (client/server)

	Hiro.sync: Data synchronization with local and remote APIs
	Hiro.sync.ws: Websocket client
	Hiro.sync.lp: Longpolling fallback 
	Hiro.sync.ajax: Generic AJAX stuff

	Hiro.ui: Basic UI related functions like showing/hiding dialogs, sliding menu etc
	Hiro.ui.fastbutton: Button event handlers that fire instantly on touch devices
	Hiro.ui.touchy: Trigger events on hover/touchstart with an optional delay
	Hiro.ui.swipe: Custom swipe functionality for touch devices
	Hiro.ui.hprogres: Thin progress bar on very top of page

	Hiro.sys: Core functionality like setup, logging etc

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
		el_root: document.getElementById('folio'),
		el_notelist: document.getElementById('notelist'),
		el_archivelist: document.getElementById('archivelist'),
		el_showmenu: document.getElementById('showmenu'),
		el_archivelink: document.getElementById('archivelink'),		

		// Internal values
		autoupdate: null,
		archivecount: 0,

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
			// Clicks on the main elements, fired immediately on touchstart/mousedown
			if (type == 'half') {				
				switch (id) {
					case 'signin':
						Hiro.ui.dialog.show('d_logio','s_signin',Hiro.user.el_login.getElementsByTagName('input')[0]);
						break;					
					case 'archivelink':
						Hiro.folio.archiveswitch();
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
					case 'newnote':
						Hiro.canvas.load(Hiro.folio.newnote());
						break;
					case 'settings':
						Hiro.ui.dialog.show('d_settings','s_account');
						break;						
					case 'note':
						// If the click was on an archive icon
						if (target.className == 'archive') {
							// Directly set status
							Hiro.folio.lookup[noteid].status = (Hiro.folio.lookup[noteid].status == 'active') ? 'archive' : 'active';
							// Getset hack to kick off persistence / sync
							Hiro.data.set('folio','',Hiro.data.get('folio'));
							return;
						}		

						// Move entry to top of list and load note
						Hiro.folio.sort(noteid);
						Hiro.canvas.load(noteid);												
				}				
			}
		},

		// If the user hovered over the folio with mouse/finger
		foliotouch: function(event) {
			var target = event.target || event.srcElement;

			// Open the folio
			if (!Hiro.folio.open) {
				Hiro.ui.slidefolio(1);
			}		
		},

		// Rerender data
		paint: function() {
			// that scope because it's called by timeout as well
			var that = Hiro.folio, i, l, data, 
				f0 = document.createDocumentFragment(), f1;

			// Kick off regular updates, only once
			if (!that.updatetimeout) {
				that.updatetimeout = setInterval(Hiro.folio.paint,61000);
			}

			// Get data from store			
			data = Hiro.data.get('folio','c');
			if (!data) return;

			// Reset archivecount
			that.archivecount = 0;

			// Cycle through notes
			for (i=0,l=data.length;i<l;i++) {
				// Attach note entries to fragments
				if (data[i].status == 'active') {
					f0.appendChild(that.renderlink(data[i]))
				// If we didn't have an archived Note yet create the fragment	
				} else if (data[i].status == 'archive') {
					if (!f1) f1 = document.createDocumentFragment();
					f1.appendChild(that.renderlink(data[i]))
				} else {
					Hiro.sys.error('Tried to paint Note with invalid status',data[i]);
				}

				// Update lookup object
				that.lookup[data[i].nid] = data[i];			
			}

			// Switch folio DOM contents with fragments
			requestAnimationFrame(function(){
				// Empty
				that.el_notelist.innerHTML = that.el_archivelist.innerHTML = '';

				// Append
				that.el_notelist.appendChild(f0);				
				if (f1) that.el_archivelist.appendChild(f1);

				// Update text contents of archivelink
				if (!that.archiveopen) that.el_archivelink.innerHTML = (that.archivecount > 0) ? 'Archive  (' + that.archivecount.toString() + ')' : 'Archive';
			})
		},	

		renderlink: function(folioentry) {
			// Abort if we do not have all data loaded yet
			if (!Hiro.data.stores.folio || !Hiro.data.stores.folio) return;

			// Render active and archived document link
			var d = document.createElement('div'),
				id = folioentry.nid,
				note = Hiro.data.get('note_' + id),
				link, t, stats, a, time, tooltip, s, sn;			

			// Set note root node properties	
			d.className = 'note';
			d.setAttribute('id','note_' + note.id);

			// Insert Link, Title and stats
			link = document.createElement('a');
			link.setAttribute('href','/note/' + note.id);	

			t = document.createElement('span');
			t.className = 'notetitle';
			t.innerHTML = note.c.title || 'Untitled Note';
			if (id.length < 5 && !note.c.title) t.innerHTML = 'New Note';

			stats = document.createElement('small');

			// Build archive link
			a = document.createElement('div');
			a.className = 'archive';		

			// Prepare archive link and iterate counter
			if (folioentry.status == 'active') {
				// Add tooltip
				a.setAttribute('title','Move to archive...')
			} else if (folioentry.status == 'archive') {
				// Add tooltip
				a.setAttribute('title','Move back to current notes...')				
				// Iterate counter
				this.archivecount++;
			} else {
				Hiro.sys.error('Folio contains document with unknown status',[folioentry,note])
			}	

			// Get basic time string
			time = (note._lastedit) ? Hiro.util.humantime(note._lastedit) + ' ago': 'Note saved yet';

			// Attach elements to root node
			link.appendChild(t);
			link.appendChild(stats);			

			if (note._shared) {
				// Add sharing icon to document and change class to shared
				s = document.createElement('div');
				s.className = 'sharing';

				// Add sharing hover tooltip
				tooltip = 'Shared with ' + (note.c.peers.length - 1) + ' other';	
				if (note.c.peers.length > 2) tooltip = tooltip + 's';
				s.setAttribute('title',tooltip);	
				link.appendChild(s);		
				
				// Change classname
				d.className = 'note shared';		

				// Add bubble if changes weren't seen yet
				if (note._unseen) {
					// Show that document has unseen updates
					sn = document.createElement('div');
					sn.className = "bubble red";
					sn.innerHTML = '*';
					link.appendChild(sn);
					tooltip = tooltip + ', just updated';					
				}	

				// Append time indicator if someone else did the last update
				if (note._lasteditor && note._lasteditor != Hiro.data.stores.profile.c.uid)	time = time + ' by ' + (Hiro.user.contacts.lookup[note._lasteditor].name || Hiro.user.contacts.lookup[note._lasteditor].uid);					
			}

			// Append stats with time indicator
			stats.appendChild(document.createTextNode(time));

			// Attach link & archive to element
			d.appendChild(link);				
			d.appendChild(a);			

			return d;			
		},

		// Move folio entry to top and resort rest of folio for both, local client and server versions
		// TODO Bruno: Add sort by last own edit when we have it
		sort: function(totop) {
			var fc = Hiro.data.get('folio','c'), i, l;

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
			}

			// Save changes and trigger repaint		
			Hiro.data.set('folio','c',fc);
		},

		// Add a new note to folio and notes array, then open it 
		newnote: function() {
			var f = Hiro.data.get('folio'),
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

			// Add new item to beginning of array
			f.c.unshift(folioc);		

			// Build new note object for notes store
			note = {
				c: { text: '', title: '', peers: [] },
				s: { text: '', title: '', peers: [] },				
				sv: 0, cv: 0,
				id: id,
				kind: 'note'
			}

			// Add note and save						
			Hiro.data.set('note_' + id,'',note);
			Hiro.data.set('folio','',f);

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
				this.el_archivelink.innerHTML = 'Archive  ' + c;
				this.archiveopen = false;
			} else {
				this.el_notelist.style.display = 'none';
				this.el_archivelist.style.display = 'block';
				this.el_archivelink.innerHTML = 'Close Archive'
				this.archiveopen = true;
			}	
		}			
	},

	// The white page, including the all elements like apps and the sidebar
	canvas: {
		// Internal values
		currentnote: undefined,
		quoteshown: true,
		textheight: 0,

		// DOM IDs
		el_root: document.getElementById('canvas'),
		el_title: document.getElementById('pageTitle'),
		el_text: document.getElementById('pageContent'),
		el_quote: document.getElementById('nicequote'),

		// Key maps
		keys_noset: [16,17,18,20,33,34,35,36,37,38,39,40],

		// Init canvas
		init: function() {
			// Event setup
			Hiro.util.registerEvent(this.el_text,'keyup',Hiro.canvas.textup);
			Hiro.util.registerEvent(this.el_text,'keydown',Hiro.canvas.textdown);			
			Hiro.util.registerEvent(this.el_title,'keyup',Hiro.canvas.titleup);			
			Hiro.ui.fastbutton.attach(this.el_title,Hiro.canvas.titleclick,true);			

			// When a user touches the white canvas area
			Hiro.ui.touchy.attach(this.el_root,Hiro.canvas.canvastouch,55);			
		},

		// When a user presses a key, handle important low latency stuff like keyboard shortcuts here
		textdown: function(event) {		
			// If the user presses Arrowup or Pageup at position 0
			if (event.keyCode == 38 || event.keyCode == 33) {
				var c = Hiro.canvas.getcursor();
				if (c[0] == c[1] && c[0] == 0) {
					// Focus Title
					Hiro.canvas.el_title.focus();
					// If we're running the mini UI, also scroll the textarea to the top
					if (Hiro.canvas.el_text.scrollTop != 0) Hiro.canvas.el_text.scrollTop = 0;
				}	
			} 

			// The dreaded tab key
			if (event.keyCode == 9) {
				// First, we have to kill all the tabbbbbsss
				Hiro.util.stopEvent(event);

				// Determine current cursor position
				var c = Hiro.canvas.getcursor(),
					text = this.value.substr(0, c[0]) + '\t' + this.value.substr(c[1]);

				// Set internal data and display
				Hiro.data.set('note_' + Hiro.canvas.currentnote, 'c.text',text)
				this.value = text;

				// Reposition cursor
				Hiro.canvas.setcursor(c[1] + 1);
			}

			// Resize canvas if we grew
			if (Hiro.canvas.scrollHeight != Hiro.canvas.textheight) Hiro.canvas.resize();
		},		

		// When a user releases a key, this includes actions like delete or ctrl+v etc
		textup: function(event) {
			// Handle keys where we don't want to set a different value (and most important kick off commit)
			if ((Hiro.canvas.keys_noset.indexOf(event.keyCode) > -1) || (event.keyCode > 111 && event.keyCode < 124)) return;

			// Change internal object value
			Hiro.data.set('note_' + Hiro.canvas.currentnote, 'c.text',this.value);

			// Switch quote on/off based on user actions
			if ((this.value.length > 0 && Hiro.canvas.quoteshown) || (this.value.length == 0 && !Hiro.canvas.quoteshown)) {
				var d = (Hiro.canvas.quoteshown) ? -1 : 1;
				Hiro.ui.fade(Hiro.canvas.el_quote,d,450);
				Hiro.canvas.quoteshown = !Hiro.canvas.quoteshown;				
			} 
		},		

		// When a key is released in the title field
		titleup: function(event) {
			// Jump to text if user presses return, pagedown or arrowdown
			if (event.keyCode == 40 || event.keyCode == 13 || event.keyCode == 34) Hiro.canvas.setcursor(0);

			// Lenovo nostalgia: Goto End on End
			if (event.keyCode == 35) Hiro.canvas.setcursor(Hiro.canvas.el_text.value.length);			

			// Handle keys where we don't want to set a different value (and most important kick off commit)
			if ((Hiro.canvas.keys_noset.indexOf(event.keyCode) > -1) || (event.keyCode > 111 && event.keyCode < 124)) return;

			// Change internal object value
			Hiro.data.set('note_' + Hiro.canvas.currentnote, 'c.title',this.value);	

			// Change browser window title
			document.title = this.value;					
		},

		// When the user clicks into the title field
		titleclick: function(id,type,target) {
			var note = Hiro.data.get('note_' + Hiro.canvas.currentnote);

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
			// If we call load without id we just pick the doc on top of the folio
			var	id = id || Hiro.data.get('folio').c[0].nid,
				note = Hiro.data.get('note_' + id);

			// Close the folio if it should be open
			if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);				

			// Start hprogress bar
			Hiro.ui.hprogress.begin();	

			// Set internal values
			this.currentnote = id;			

			// Visual update
			this.paint();

			// Set cursor
			this.setcursor(0);

			// Update sharing stuff
			Hiro.apps.close();
			Hiro.apps.sharing.update();

			// End hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('Loaded note onto canvas:',note);
		},

		// Paint canvas
		paint: function() {
			// Make sure we have a current note
			this.currentnote = this.currentnote || Hiro.data.get('folio').c[0].nid;

			var n = Hiro.data.get('note_' + this.currentnote),
				title = n.c.title || 'Untitled Note', text = n.c.text;

			// If we havn't synced the Note yet, call it 'New'
			if (this.currentnote.length < 5 && !n.c.title) title = 'New Note';

			// Set title & text
			if (!n.c.title || this.el_title.value != n.c.title) this.el_title.value = document.title = title;	
			if (this.el_text.value != text) this.el_text.value = text;	

			// 	Switch quote on or off for programmatic text changes
			if ((text.length > 0 && this.quoteshown) || (text.length == 0 && !this.quoteshown)) {
				var d = (this.quoteshown) ? -1 : 1;
				Hiro.ui.fade(this.el_quote,d,150);
				this.quoteshown = !this.quoteshown;				
			} 			

			// Resize textarea
			this.resize();
		},

		// Resize textarea to proper height
		resize: function() {
			// Abort on small devices
			if (window.innerWidth < 481) return;

			// With the next available frame
			requestAnimationFrame(function(){
				// Reset to get proper value
				// Hiro.canvas.el_text.style.height = '1px';

				// Set values
				Hiro.canvas.textheight = Hiro.canvas.el_text.scrollHeight;
				Hiro.canvas.el_text.style.height = Hiro.canvas.textheight.toString() + 'px';
			})

			// If we are at the last position, also make sure to scroll to it to avoid Chrome etc quirks
			// if (this.el_text.value.length == Hiro.canvas.getcursor()[1] && this.el_text.scrollHeight > document.body.offsetHeight) window.scrollTo(0,this.el_text.scrollHeight);
		},

		// Get cursor position, returns array of selection start and end. These numbers are equal if no selection.
		getcursor: function() {
		    var el = this.el_text, x, y, content;	

		    if ('selectionStart' in el) {
		    	//Mozilla and DOM 3.0
		        x = el.selectionStart;
				y = el.selectionEnd;
				var l = el.selectionEnd - el.selectionStart;
				content = el.value.substr(el.selectionStart, l)
		    } else if (document.selection) {
		    	//IE
		        el.focus();
		        var r = document.selection.createRange(),
		        	tr = el.createTextRange()
		        	tr2 = tr.duplicate();
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

		// Set cursor position, accepts either number or array of two numbers representing selection start & end
		setcursor: function(pos) {
			var el = this.el_text;

			// Set default value
			pos = pos || Hiro.data.get('note_' + this.currentnote).c.cursor_pos || 0;

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
				url = (login) ? '/login' : '/register', 
				b = branch.getElementsByClassName('hirobutton')[1],
				v = branch.getElementsByTagName('input'),							
				e = branch.getElementsByClassName('mainerror')[0],
				payload = {	
					email: v[0].value.toLowerCase().trim(),
					password: v[1].value
				};

			// Prevent default event if we have one from firing submit
			if (event) Hiro.util.stopEvent(event);	

			// Preparation
			if (this.authinprogress) return;
			this.authinprogress = true;				
			b.innerHTML = (login) ? 'Logging in...' : 'Signing Up...';

			// Remove focus on mobiles
			if ('ontouchstart' in document.documentElement && document.activeElement) document.activeElement.blur();				

			// Clear any old error messages
			v[0].nextSibling.innerHTML = '';
			v[1].nextSibling.innerHTML = '';				
			e.innerHTML = '';			

			// Send request to backend
			Hiro.sync.ajax.send({
				url: url,
	            type: "POST",
	            contentType: "application/x-www-form-urlencoded",
	            payload: payload,
				success: function(req,data) {
					Hiro.user.logiocomplete(data,login);										                    
				},
				error: function(req,data) {				
	                b.innerHTML = (login) ? 'Log-In' : 'Create Account';
	                Hiro.user.authinprogress = false;						
					if (req.status==500) {
						e.innerHTML = "Something went wrong, please try again.";
						Hiro.sys.error('Auth server error for ' + payload.email,req);							
						return;
					}
	                if (data.email) {
	                	v[0].className += ' error';
	                	v[0].nextSibling.innerHTML = data.email[0];
	                }	
	                if (data.password) {
	                	v[1].className += ' error';	                    	
	                	v[1].nextSibling.innerHTML = data.password[0];  
	                }	                 		                    						                    
				}										
			});	
		},

		// Post successfull auth stuff
		// TODO Bruno: Pack all the good logic in here once we get tokens from server, eg 
		// > Send local notes to server 
		logiocomplete: function(data,login) {

			// Close dialog
			Hiro.ui.dialog.hide();

			// Reset visual stage according to new user level
			Hiro.ui.setstage(data.tier);			
		},

		// Send logout command to server, fade out page, wipe localstore and refresh page on success
		logout: function() {
			// Wipe local data immediately 
			Hiro.data.local.wipe();

			// Notifiy server
			Hiro.sync.ajax.send({
				url: "/logout",
                type: "POST",
				success: function() {
					Hiro.sys.log('Logged out properly, reloading page');
                    window.location.href = '/shiny/';							                    
				}									
			});			

			// Start fading out body
			Hiro.ui.fade(document.body,-1,400);			
		},	

		// Request password reset
		requestpwdreset: function() {

		},		

		// Hello. Is it them you're looking for?
		contacts: {
			// Lookup by ID
			lookup: {},

			// Iterate through peers and update lookup above
			update: function() {
				var c = Hiro.data.get('profile','c.contacts'), i, l;

				for (i = 0, l = c.length; i < l; i++) {
					this.lookup[c[i].uid] = c[i];
				}
			},

			// Search all relevant contact properties and return array of matches
			search: function(string,list) {
				var contacts = Hiro.data.get('profile','c.contacts'),
					results = [];

				// Iterate through contacts
				for (var i=0,l=contacts.length;i<l;i++) {					
					// Rules to be observed
					if (contacts[i].name.toLowerCase().indexOf(string.toLowerCase()) == -1) continue;
					if (list && list.indexOf(contacts[i].uid) > -1) continue;
					// Add all who made it until
					results.push(contacts[i]);
				}

				// Return list of result references
				return results;
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
				Hiro.util.registerEvent(el,'keyup',Hiro.apps[app].keyhandler)		
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

		// Fires on touch or click within an app
		clickhandler: function(id,type,target,branch) {
			if (type == 'full') {
				switch (id) {
					case 'close':
						Hiro.apps.close(branch.id);
				}
			}
		},

		// Open app widget
		show: function(el_app) {
			// Add ID to open list
			this.open.push(el_app.id.substring(4));

			// Update & display app			
			requestAnimationFrame(function(){
				Hiro.apps.sharing.update(true);
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
		},

		// OK, fuck it, no time to rewrite vue/angular
		sharing: {
			el_root: document.getElementById('app_sharing'),

			// Handle all keyboard events happening withing widget
			keyhandler: function(event) {
				Hiro.apps.sharing.typeahead(event);
			},

			// Populate header and widget with data from currentnote, triggerd by show
			update: function(full) {
				var peers = Hiro.data.get('note_' + Hiro.canvas.currentnote, 'c.peers'),
					counter = this.el_root.getElementsByClassName('counter')[0],
					el_peers = this.el_root.getElementsByClassName('peers')[0];

				// If we don't have any peers yet
				// TODO Bruno: Remove this once we have proper no server/no localstorage handling
				if (!peers) return;	

				// if the counter changed
				if (peers.length != counter.innerHTML) {
					counter.style.display = (peers.length > 0) ? 'block' : 'none';
					counter.innerHTML = peers.length.toString();
				}	

				// If we don't want a full update stop here
				if (!full) return;

				// If we are the only ones in körberl
				if (peers.length == 1) {
					el_peers.innerHTML = 'Yo you';
				} else {
					requestAnimationFrame(function(){
						var f = document.createDocumentFragment();
						for (var i =0, l = peers.length; i < l; i++) {
							f.appendChild(Hiro.apps.sharing.renderpeer(peers[i])); 
						}
						el_peers.innerHTML = '';
						el_peers.appendChild(f);	
					});				
				}	
			},

			// Turns a peer entry into the respective DOM snippet
			renderpeer: function(peer,l) {		
				var d, r, n, profile = Hiro.data.get('profile','c'),
					user = Hiro.user.contacts.lookup[peer.user.uid] || profile,
					currentuser = (peer.user.uid == profile.uid),
					namestring = (user.email) ? user.name + ' (' + user.email + ')' : user.name;

				d = document.createElement('div');
				d.className = 'peer';
				// if (!currentuser && user.status && user.status == 'invited') d.setAttribute('title', (user.status.charAt(0).toUpperCase() + user.status.slice(1)));

				if (peer.role != "owner") {
					// Add remove link if user is not owner					
					r = document.createElement('a');
					r.className = 'remove';
					var rt = (currentuser) ? 'Revoke your own access' : 'Revoke access';
					r.setAttribute('title',rt);
					d.appendChild(r);
				} else {
					d.setAttribute('title', 'Owner');
				}

				// Add user name span
				n = document.createElement('span');
				n.className = (user.status == 'invited') ? 'name invited' : 'name';
				n.innerHTML = (currentuser) ? 'You' : namestring;
				d.appendChild(n)

				// Return object
				return d;
			},	

			// Typeahead function that fetches & renders contacts
			typeahead: function(event) {
				var t = event.srcElement || event.target, matches, blacklist = [],
					peers = Hiro.data.get('note_' + Hiro.canvas.currentnote, 'c.peers');

				// Abort if we have nothing to search
				if (!t.value) return;

				// Build list of UID blacklist
				for (var i = 0, l = peers.length; i < l; i++ ) {
					blacklist.push(peers[i].user.uid);
				}

				// Get matches from contact list
				matches = Hiro.user.contacts.search(t.value,blacklist);


				console.log( matches );
			}		
		} 

	},

	// Local data, model and persitence
	data: {
		// Object holding all data
		stores: {},
		// Name of stores that are synced with the server
		onlinestores: ['folio','profile'],

		// Config
		enabled: undefined,

		// Log which data isn't saved and/or synced
		unsaved: [],
		unsynced: [],

		// Set up datastore on pageload
		init: function() {
			// Lookup most common store and all notes
			var p = this.local.fromdisk('profile'), n = this.local.fromdisk('_allnotes');

			// If we do have data stored locally
			if (p && n) {				
				// Load internal values
				this.unsynced = this.local.fromdisk('unsynced');			

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

			}

			// Attach localstore change listener
			Hiro.util.registerEvent(window,'storage',Hiro.data.localchange);			
		},		

		// Detect changes to localstorage for all connected tabs
		// All browser should fire this event if a different window/tab writes changes
		localchange: function(event) {
			// IE maps the event to window
			event = event || window.event;

			// Extract proper key
			var k = event.key.split('.')[1];

			// Receive a message
			if (k == 'notify') {
				console.log(event);
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

				// Kick off commit, no matter if the changes came from the server or client, but not localstorage
				if (source != 'l') Hiro.sync.commit();	

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

		// Various handlers executed after stores values are set, bit of poor mans react
		post: {
			// After a note store was set
			note: function(store,key,value,source,paint) {
				var n = Hiro.data.stores[store];

				// Update the last edit & editor data
				if (source == 'c') {
					n._lasteditor = Hiro.data.stores.profile.c.uid;
					n._lastedit = new Date().toISOString();				
				}

				// If the whole thing or client title changed, repaint the folio
				if (!key || key == 'c' || key == 'c.title') Hiro.folio.paint();

				// If the update wasn't by client and concerns the current note
				if (source != 'c' && store.substring(5) == Hiro.canvas.currentnote) Hiro.canvas.paint();	

				// Abort here if the update came from localStorage to avoid infinite save loops
				if (source == 'l')  return;

				// More complex actions, make sure to use proper keys for very frequent actions
				if (key != 'c.title' && key != 'c.text') {
					// Go through peers				
					if (n.c.peers && n.c.peers.length > 1) {
						// Create/set shared flag to true
						n._shared = true;

						// Make sure we have a last editor and edit
						n._lasteditor = Hiro.data.stores.profile.c.uid;	
						if (!n._lastedit) n._lastedit = 0;				

						// Iterate through peers
						for (var i = 0, l = n.c.peers.length, p; i < l; i++) {
							p = n.c.peers[i], t = new Date(p.last_edit);
							// Check if peers edit is more recent than what we got
							if (t > n._lastedit) {
								n._lastedit = t;
								n._lasteditor = p.user.uid;
							}
						}
					} else if (n._shared) {
						n._shared = n._lasteditor = false;
					}
				}				

				// Save
 				Hiro.data.local.quicksave(store);							
			},

			// After the folio was set
			folio: function(store,key,value,source,paint) {
				// Repaint folio
				Hiro.folio.paint();	

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
				this.saving = true;

				// Start timer
				start = new Date().getTime(); 

				// Cycle through unsaved stores
				for (i = 0, l = Hiro.data.unsaved.length; i < l; i++) {
					key = Hiro.data.unsaved[i],	value = Hiro.data.stores[key];	

					// Write data into localStorage	
					this.todisk(key,value)						
				}

				// Persist list of unsynced values and msg queue
				this.todisk('unsynced',Hiro.data.unsynced);

				// Empty array
				Hiro.data.unsaved = [];

				// Measure duration
				end = new Date().getTime(); 
				dur = (end - start);

				// Log longer persistance times
				if (dur > 20) Hiro.sys.log('Data persisted bit slowly, within (ms):',dur);

				// Set new value if system is significantly slower than our default interval
				this.dynamicinterval = ((dur * 50) < this.maxinterval ) ? dur * 50 || 50 : this.maxinterval;

				// Trigger next save to browsers abilities
				this.timeout = setTimeout(function(){
					Hiro.data.local.saving = false;
					// Rerun persist if new changes happened
					if (Hiro.data.unsaved.length > 0) Hiro.data.local.persist();
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
					for (var i = localStorage.length;i >= 0; i--) {
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
			var user = Hiro.data.get('profile','c');

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
			var sid = Hiro.data.get('profile','c.sid'), req;
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

				// Enrich data object with sid (if we have one) & tag
				if (!data[i].sid && Hiro.data.get('profile')) data[i].sid = Hiro.data.get('profile','c').sid;				
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
			var n, f, fv, peers, req, p;

			// Clean up profile object
			p = data.session.profile;
			p.c = {}; p.s = {};
			// Copy strings to client and server version
			p.c.email = p.s.email = p.val.user.email;
			p.c.name = p.s.name = p.val.user.name;	
			p.c.uid = p.s.uid = p.val.user.uid;
			p.c.sid = p.s.sid = data.session.sid;
			p.cv = p.sv = 0;			
			// Stringify contact array, parse and delete remains	
			pv = JSON.stringify(p.val.contacts);
			p.c.contacts = JSON.parse(pv); 
			p.s.contacts = JSON.parse(pv);
			delete p.val;

			// Save profile
			Hiro.data.set('profile','',data.session.profile,'s');				 			

			// Session reset doesn't give us cv/sv/shadow/backup etc, so we create them now
			for (var note in data.session.notes) {
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

				// Create a dedicated store for each note
				Hiro.data.set('note_' + note,'',n,'s');				
			}		

			// Clean up folio
			f = data.session.folio;
			fv = JSON.stringify(f.val);
			f.cv = f.sv = 0;
			f.s = JSON.parse(fv);
			f.c = JSON.parse(fv);	
			delete f.val;

			// Folio triggers a paint, make sure it happens after notes ad the notes data is needed								
			Hiro.data.set('folio','',data.session.folio,'s');	

			// Load doc onto canvas
			Hiro.canvas.load();											

			// Complete hprogress
			Hiro.ui.hprogress.done();

			// Log
			Hiro.sys.log('New session created',data);
			Hiro.sys.log('',null,'groupEnd');			
		},

		// Process changes sent from server
		rx_res_sync_handler: function(data) {
			// Find out which store we're talking about
			var id = (data.res.kind == 'note') ? 'note_' + data.res.id : data.res.kind,
				store = Hiro.data.get(id), update, regex, mod, i, l, j, jl, stack, regex = /^=[0-9]+$/;

			// Process change stack
			for (i=0,l=data.changes.length; i<l; i++) {
				// Check for potential infinite lopp				
				if (data.changes.length > 100 || (store.edits && store.edits.length > 100) ) {
					Hiro.sys.error('Unusual high number of changes',JSON.parse(JSON.stringify([data,store])));
				}	

				// Log stuff to doublecheck which rules should be applied				
				if (data.changes[i].clock.cv != store.cv || data.changes[i].clock.sv != store.sv) {
					Hiro.sys.error('Sync rule was triggered, find out how to handle it',JSON.parse(JSON.stringify([data,store])));
					// continue;
				}	

				// Update title if it's a title update
				if (data.res.kind == 'note' && data.changes[i].delta.title) {
					store.s.title = store.c.title = data.changes[i].delta.title;
					// Set val
					update = true;
				}				

				// Update text if it's a text update
				if (data.res.kind == 'note' && data.changes[i].delta.text && !(regex.test(data.changes[i].delta.text))) {
					// Apply the change
					this.diff.patch(data.changes[i].delta.text,data.res.id);
					update = true;
				}	

				// Update folio if it's a folio update
				if (data.res.kind == 'folio' && data.changes[i].delta.mod) {
					mod = data.changes[i].delta.mod;
					for (j=0,jl=mod.length;j<jl;j++) {
						Hiro.folio.lookup[mod[j][0]][mod[j][1]] = mod[j][3];
					}
					// Repaint folio
					update = true;					
				}	

				// Remove outdated edits from stores
				if (store.edits && store.edits.length > 0) {
					stack = store.edits.length;
					while (stack--) {
						if (store.edits[stack].clock.cv < data.changes[i].clock.cv) store.edits.splice(stack,1); 
					}
				}
			}

			// Update server version if we got updates
			if (update) store.sv++;					

			// Find out if it's a response or server initiated
			if (this.tags.indexOf(data.tag) > -1) {
				// Remove tag from list
				this.tags.splice(this.tags.indexOf(data.tag),1);
			// Respond if it was server initiated
			} else {
				// Send any edits waiting or an empty ack		
				data.changes = (store.edits && store.edits.length > 0) ? store.edits : [{ clock: { cv: store.cv, sv: store.sv }, delta: {}}];

				// Send
				this.ack(data);				
			}	

			// Save changes back to store, for now we just save the whole store, see if this could/should be more granular in the future
			if (update) Hiro.data.set(id,'',store,'s');								

			// Release lock preventing push of new commits
			this.commitinprogress = false;
		},

		// Send simple confirmation for received request
		ack: function(data) {		
			// Send echo
			this.tx(data);
		},

		// Create messages representing all changes between local model and shadow
		commit: function() {
			var u = Hiro.data.unsynced, i, l, newcommit, s, d;

			// Only one build at a time, and only when we're online
			if (this.commitinprogress || !this.online) return;
			this.commitinprogress = true;
			newcommit = [];

			// Cycle through stores flagged unsynced
			for (i=0,l=u.length;i<l;i++) {
				var s = Hiro.data.get(u[i]),
					d = this.diff.makediff(s);	

				// If diff told us that there are old or new edits					
				if (d) newcommit.push(this.wrapmsg(s));
			}

			// If we have any data in this commit, send it to the server now
			if (newcommit && newcommit.length > 0) {
				// Send off
				this.tx(newcommit);

				// Save all changes locally: At this point we persist changes to the stores made by deepdiff etc
				Hiro.data.local.persist();
			} else {
				// Release lock as no new commits were found
				this.commitinprogress = false;
			}	
		},

		// Build a complete message object from simple changes array
		wrapmsg: function(store) {				
			// Build wrapper object
			var r = {};
			r.name = 'res-sync';
			r.res = { kind : store['kind'] , id : store['id'] };
			r.changes = store.edits;
			r.sid = Hiro.data.get('profile','c').sid;		

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
					Hiro.sys.log('WebSocket closed with code ' + e.code + ' and ' + (e.reason || 'no reason given.'),[e,this.socket]);	
				}				
			},
		},

		// Generic AJAX as well as longpolling settings & functions
		ajax: {
			// When we deem a response successfull
			successcodes: [200,204],

			// Internal values
			socket: null,

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

					// Add this rounds changes to edits
					store.edits = store.edits || [];
					store.edits.push(changes);	

					// Mark store as tainted but do not persist yet for performance reasons
					if (Hiro.data.unsaved.indexOf(id) < 0) Hiro.data.unsaved.push(id);							
				} 

				// Return changes						
				return changes || false;

			},

			// Specific folio diff, returns proper changes format
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
						store.s[i].nid = Hiro.folio.lookup[store.s[i].nid].status;
					}					
				}

				// Return delta value if we have one or false
				return delta || false;
			},

			// Specific notes diff, returns proper changes format of all notes on client side
			diffnote: function(note) {
				var delta;

				// Compare different values, starting with text
				if (note.c.text != note.s.text) {
					if (!delta) delta = {};
					delta.text = this.delta(note.s.text,note.c.text);
					note.s.text = note.c.text;
				}

				// Check title	
				if (note.c.title != note.s.title) {
					if (!delta) delta = {};
					delta.title = note.s.title = note.c.title;
				}			

				// Return value
				return delta || false;	
			},

			// Specific profile diff, returns proper changes format
			diffprofile: function() {
				
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
		production: (window.location.href.indexOf('hiroapp') >= 0),	

		// System setup, this is called once on startup and then calls inits for the various app parts 
		init: function(tier,ws_url) {
			// Begin startup logging
			Hiro.sys.log('Hiro startup sequence','','group');		

			// Prevent initing twice
			if (this.inited) return;

			// Create DMP socket
			Hiro.sync.diff.dmp = new diff_match_patch();		

			// Setup other app parts
			Hiro.folio.init();
			Hiro.canvas.init();
			Hiro.ui.init(tier);	
			Hiro.data.init();			
			Hiro.sync.init(ws_url);	
			Hiro.lib.init();		
			Hiro.apps.init();			

			// Load application cache
			if (window.applicationCache) {
				var frame = document.createElement('iframe');
				frame.style.display = 'none';
				frame.src = '/offline/manifestwrapper/';
				document.body.appendChild(frame);
			};						

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

		// DOM IDs. Note: Changing Nodes deletes this references, only use for inital HTML Nodes that are never replaced
		el_wastebin: document.getElementById('wastebin'),
		el_archive: document.getElementById('archivelink'),
		el_signin: document.getElementById('signin'),
		el_settings: document.getElementById('settings'),

		// Browser specific properties
		vendors: ['webkit','moz','o','ms'],
		browser: undefined,
		opacity: '',		

		// Folio open/close properties
		slidewidth: 300,
		slideduration: 200,
		slidepos: 0,
		slidedirection: 0,	

		// Setup and browser capability testing
		init: function(tier) {
			var style = this.el_wastebin.style,
				v = this.vendors, i, l, v, r, measure;

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
			            var currTime = new Date().getTime();
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

			// Set up UI according to user level
			this.setstage(tier);	

			// Make sure the viewport is exactly the height of the browserheight to avoid scrolling issues
			// TODO Bruno: Find reliable way to use fullscreen in all mobile browsers, eg  minimal-ui plus scrollto fallback
			measure = 'height=' + window.innerHeight + ',width=device-width,initial-scale=1, maximum-scale=1, user-scalable=no';
			document.getElementById('viewport').setAttribute('content', measure);				

			// Start hprogress on init
			this.hprogress.init();	

			// Attach keyboard shortcut listener
			Hiro.util.registerEvent(window,'keydown',Hiro.ui.keyhandler);

			// Attach delegated clickhandler for shield, this handles every touch-start/end & mouse-down/up
			this.fastbutton.attach(this.dialog.el_root,Hiro.ui.dialog.clickhandler)
		},

		// Fire keyboard events if applicable
		keyhandler: function(event) {
			// Single keys that trigger an action
			switch (event.keyCode) {
				// If ESC key is pressed				
				case 27:
					if (Hiro.ui.dialog.open) Hiro.ui.dialog.hide();
					break;
			}

			// If a key was pressed in combination with CTRL/ALT or APPLE
			if (event.ctrlKey || event.altKey || event.metaKey) {
				// Fire combos
				switch (event.keyCode) {
					// N key, not supressable in Chrom
					case 78:
						Hiro.util.stopEvent(event);						
						Hiro.canvas.load(Hiro.folio.newnote());					
						break;
					// S key
					case 83:
						Hiro.util.stopEvent(event);						
						alert("Hiro saves all your notes automatically and syncs them with the cloud if you're signed in");
						break;
				}
			}
		},

		// Setup UI according to account level where 0 = anon
		setstage: function(tier) {
			// tier = tier || Hiro.sys.user.data.tier || 0;
			switch (tier) {
				case 0:
					// Set styles at bottom of folio
					requestAnimationFrame(function(){
						Hiro.ui.el_signin.style.display = 'block';
						Hiro.ui.el_settings.style.display = Hiro.ui.el_archive.style.display = 'none';
					})				
					break;
				case 1:
				case 2:	
					// Set styles at bottom of folio				
					requestAnimationFrame(function(){
						Hiro.ui.el_signin.style.display = 'none';
						Hiro.ui.el_settings.style.display = Hiro.ui.el_archive.style.display = 'block';
					})

					// Load settings contents
					this.dialog.load();										
					break;
			}
		},

		// Switch to an element on the same DOM level and hide all others
		switchview: function(el, display) {
			// Function accepts both the element directly or a an ID 
			if (typeof el != 'object') el = document.getElementById(el);

			// Set default display
			if (!display || typeof display != 'string') display = 'block';

			// Walk up & down the same DOM level within animationframe
			requestAnimationFrame(function(){
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
			});
		},		

		// Slide folio: 1 to open, -1 to close
		slidefolio: function(direction,slideduration,force) {
			// Catch cases where sliding makes no sense
			if ((direction < 0 && this.slidepos === 0) ||  
				(direction > 0 && this.slidepos > 100) ||
				(!force && this.slidedirection != 0))
				return;

			// Allow simple call without direction		
			if (!direction) direction = (this.slidedirection == 1 || Hiro.folio.open) ? -1 : 1;			

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
				start = new Date().getTime(),
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
				Hiro.canvas.el_root.style.left = v + 'px';
				Hiro.canvas.el_root.style.right = Hiro.canvas.context.el_root.style.right = (v*-1)+'px'; 
						
				// If we still have time we step on each possible frame in modern browser or fall back in others											
				if (done) {
					// Timessssup
					Hiro.folio.open = (direction > 0) ? true : false;
					_this.direction = 0;
					_this.slidetimer = 0;
				} 
				else _this.slidetimer = requestAnimationFrame(step);
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
				start = new Date().getTime(), 
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

		// Handle clicks depending on device (mouse or touch), this shoudl mostly be used on delegated handlers spanning larger areas
		fastbutton: {
			// Map of Nodes to events
			mapping: {},

			// Current event details
			x: 0,
			y: 0,
			lastid: undefined,

			// Values related to busting clicks (Click event is fired no matter what we do the faster up/down/start/end)
			busterinstalled: false,
			delay: 500,
			bustthis: [],

			// Attach event triggers
			attach: function(element,handler,allowevents) {
				// Attach buster when attaching first fastbutton
				if (!this.busterinstalled) this.installbuster(); 

				// Store handler in mapping table, create id if element has none
				if (!element.id) element.id = 'fastbutton' + Math.random().toString(36).substring(2,6);
				this.mapping[element.id] = {
					handler: handler,
					allowevents: allowevents
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
				var target = event.target || event.srcElement, that = Hiro.ui.fastbutton, x = event.screenX, y = event.screenY,
					// Traverse up DOM tree for up to two levels
					id = target.id || target.getAttribute('data-hiro-action') || 
						 target.parentNode.id || target.parentNode.getAttribute('data-hiro-action') || 
						 target.parentNode.parentNode.id || target.parentNode.parentNode.getAttribute('data-hiro-action'),	
					handler = that.mapping[this.id].handler, branch = this, button = event.which || event.button;	

				// Don't even start if it's not a leftclick, this also kills touch mousedown events
				if (event.type == 'mousedown' && button != 1) return;	

				// Stop event and prevent it from bubbling further up
				if (!(target.tagName == 'INPUT' || target.tagName == 'TEXTAREA') && !that.mapping[this.id].allowevents) Hiro.util.stopEvent(event);

				// Note values and fire handler for beginning of interaction
				if (id && (event.type == 'mousedown' || event.type == 'touchstart')) {
					// First we remember where it all started
					that.x = x; that.y = y; that.lastid = id;

					// Call handler
					if (handler) handler(id,'half',target,branch,event)

					// Stop here for now
					return;	
				}

				// Things that need start & end on the same element or within n pixels. 
				// Being mouseup or touchend is implicity by having a lastaction id
				// TODO Bruno: Think about if we can move this to document
				if 	(that.lastid && (id == that.lastid || ((Math.abs(x - that.x) < 10) && (Math.abs(y - that.x) < 10 )))) {
					// Add coordinates to buster to prevent clickhandler from also firing, remove after n msecs
					that.bustthis.push(y,x);
					setTimeout(function(){
						Hiro.ui.fastbutton.bustthis.splice(0,2);
					},that.delay);

					// Call handler
					if (handler) handler(id,'full',target,branch,event)	
				} 	

				// Reset values
				that.x = that.y = 0;
				that.lastid = undefined;
			},

			// Attach a click handler to the document that prevents clicks from firing if we just triggered something via touchend/mouseup above
			installbuster: function() {
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

		// All dialog related stuff
		dialog: {
			// DOM elements that are NOT changing through AJAX reload etc
			el_root: document.getElementById('shield'),
			el_wrapper: document.getElementById('shield').firstChild,
			el_settings: document.getElementById('d_settings'),

			// Internal values
			open: false,
			lastx: 0,
			lasty: 0,
			lastaction: undefined,

			// Open dialog
			show: function(container, section, focus, mobilefocus) {
				// If we're offline, show a default message
				if (!Hiro.sync.online) {
					container = 'd_msg';
					section = focus = undefined;
				}

				// Change visibility etc
				requestAnimationFrame(function(){
					if (container) Hiro.ui.switchview(container);
					if (section) Hiro.ui.switchview(section);	
					if (focus) focus.focus();
					Hiro.ui.dialog.center();	

					Hiro.ui.fade(Hiro.ui.dialog.el_root,1,200,function(){
						// Blurring is slooow on small mobile browsers, so don't do it
						if (window.innerWidth < 481) return;

						// Blur background
						requestAnimationFrame(function(){
							var filter = (Hiro.ui.browser) ? Hiro.ui.browser + 'Filter' : 'filter';
							Hiro.canvas.el_root.style[filter] = Hiro.folio.el_showmenu.style[filter] = Hiro.folio.el_root.style[filter] = 'blur(2px)';
						});
					});

					// CSS Manipulations
					requestAnimationFrame(function(){
						// Set top margin for upward movement
						Hiro.ui.dialog.el_wrapper.style.marginLeft = 0;
					})														
				})	

				// Hide folio
				if (Hiro.folio.open) Hiro.ui.slidefolio(-1,100);
							
				// Attach event and set internal value
				Hiro.util.registerEvent(window,'resize',Hiro.ui.dialog.center);
				this.open = true;
			},

			// Close the dialog 
			hide: function() {
				// Remove blur filters, only if we set them before
				var filter = (Hiro.ui.browser) ? Hiro.ui.browser + 'Filter' : 'filter';				
				if (Hiro.canvas.el_root.style[filter]) Hiro.canvas.el_root.style[filter] = Hiro.folio.el_showmenu.style[filter] = Hiro.folio.el_root.style[filter] = 'none';
				
				// Change visibility etc
				Hiro.ui.fade(Hiro.ui.dialog.el_root,-1,100);			

				// Reset left margin for inward movement
				setTimeout(function(){				
					Hiro.ui.dialog.el_wrapper.style.marginLeft = '300px';
				},100);										

				// Detach event and set internal value				
				Hiro.util.releaseEvent(window,'resize',Hiro.ui.dialog.center);
				this.open = false;				
			},		

			// Center triggered initially and on resize
			center: function() {
				requestAnimationFrame( function(){
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
				// Woop, we inited started fiddling with something relevant
				if (type == 'half') {
					// List of actions to be triggered
					switch (action) {
						case 'switch_s_plan':
						case 'switch_s_about':						
						case 'switch_s_account':
							Hiro.ui.switchview(document.getElementById(action.substring(7)));
							break;		
					}
				} else if (type == 'full') {
					switch (action) {
						case 'd_msg':						
						case 'shield':
							Hiro.ui.dialog.hide();
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
						case 'fbauth':
							Hiro.user.fbauth();
							break;																		
						case 'logout':
							Hiro.user.logout();
							break;
						case 'upgrade':
							Hiro.ui.switchview(document.getElementById('s_plan'));
							break;						
					}
				}
			},

			// Fetch latest settings template from server and load into placeholder div
			load: function() {
				// Send off AJAX request
				Hiro.sync.ajax.send({
					url: '/newsettings/',
					success: function(req,data) {
						if (data) Hiro.ui.dialog.el_settings.innerHTML = data;
					},
					error: function(req) {
						Hiro.sys.error('Unable to load settings',req);
					}
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
		}		
	},

	// External js library handling (Facebook, Analytics, DMP etc)
	lib: {

		// Load libraries
		init: function() {
			return;
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

		// Takes a unix timestamp and turns it into mins/days/weeks/months
		// 86400 = 1 day
		// 604800 = 1 week 
		// 2592000 = 30 days
		// 31536000 = 1 year		
		humantime: function(timestamp) {			
			var now = new Date(new Date().toUTCString()).getTime(), t;

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