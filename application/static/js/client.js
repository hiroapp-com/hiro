var WPCLib = {
	version: '0.0.1',

	// Folio is the nav piece on the left, holding all file management pieces
	folio: {
		folioId: 'folio',
		logoutId: 'logout',	

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
			WPCLib.util.registerEvent(document.getElementById(WPCLib.context.id),'mouseover', WPCLib.ui.menuHide);			
		},

		docs: {
			// All Document List interactions in seperate namespace
			doclistId: 'doclist',
			active: [],
			archived: [],
			loaddocs: function() {
				// Get the list of documents from the server
				$.getJSON('/docs/', function(data) {
					var f = WPCLib.folio.docs;
					// TODO: This if catches a case when data is being returned empty, make sure we need this
					if (data.active) { f.active = data.active } else { f.newdoc(); };
					f.archived = data.archived;						
					f.update();
					WPCLib.canvas.loaddoc(data.active[0].id,data.active[0].title);			
				});
			},

			loadlocal: function(localdoc) {	
				// Load locally saved document
				var ld = JSON.parse(localdoc);					
				console.log('Localstorage doc found, loading ', ld);						
				document.getElementById('landing').style.display = 'none';

				// Render doc in folio
				this.active.push(ld);
				this.update();

				// Render doc on canvas
				WPCLib.canvas.loadlocal(ld);
			},

			update: function() {
				// update the document list from the active / archive arrays
				// TODOs: Add timeout to update document age, implement for archive, create new doc if list is empty
				var act = this.active;
				var docs = document.getElementById(this.doclistId);	
				docs.innerHTML = '';			
				for (i=0,l=act.length;i<l;i++) {		
					for (var i=0,l=act.length;i<l;i++) {
						var d = document.createElement('a');
						var docid = act[i].id;
						var title = act[i].title;
						d.className = 'document';
						d.setAttribute('href','/docs/'+docid);	
						d.setAttribute('id','doc_'+docid);
						d.setAttribute('onclick','return false;');

						var t = document.createElement('span');
						t.className = 'doctitle';
						t.innerHTML = title;

						var stats = document.createElement('small');
						stats.appendChild(document.createTextNode(WPCLib.util.humanizeTimestamp(act[i].created) + " ago"))			

						d.appendChild(t);
						d.appendChild(stats);	

						docs.appendChild(d);
						WPCLib.folio.docs._events(docid,title);						
					}						    
				}
			},

			_events: function(docid,title) {
				// Attach events to doc links
				WPCLib.util.registerEvent(document.getElementById('doc_'+docid),'click', function() {
					WPCLib.canvas.loaddoc(docid, title);
				});
			},

			creatingDoc: false,
			newdoc: function() {
				// Initiate the creation of a new document

				// Avoid creating multiple docs at once and check for user level
				if (this.creatingDoc == true) return;
				this.creatingDoc = true;

				if (WPCLib.sys.user.level == 0) {
					WPCLib.sys.user.upgrade(1);
					return;
				}
				if (WPCLib.sys.user.level == 1 && this.active.length >= 10) {
					WPCLib.sys.user.upgrade(2);
					return;					
				}
				// Render a placeholder until we get the OK from the server
				var ph = document.createElement('a');
				ph.className = 'document';
				ph.setAttribute('href','#');	
				ph.setAttribute('id','doc_creating');
				ph.setAttribute('onclick','return false;');	
				var pht = document.createElement('span');
				pht.className = 'doctitle';
				pht.innerHTML = 'Creating new document...';	
				var phs = document.createElement('small');
				phs.appendChild(document.createTextNode("Right now"))
				ph.appendChild(pht);
				ph.appendChild(phs);
				document.getElementById(this.doclistId).insertBefore(ph,document.getElementById(this.doclistId).firstChild);

				// Create the doc on the canvas
				WPCLib.canvas.newdoc();
				WPCLib.ui.menuHide();

				// Get/Set ID of new document
				if (WPCLib.sys.user.level==0||!WPCLib.sys.user.level) {
					var doc = document.getElementById('doc_creating');
					console.log('unknown user, setting up localstore ');

					// Set params for local doc
					WPCLib.canvas.docid = 'localdoc';

					// Save document & cleanup
					doc.firstChild.innerHTML = 'New Document';
					doc.id = 'doc_localdoc';
				} else {
					// Request new document id
					var doc = document.getElementById('doc_creating');
					console.log('known user, setting up remote store ');

					// /docs/ expects a payload, so we build one here
					// TODO Flo pls remove this and allow requests for doc id without existing title/text
					var file = {};
					file.title = '';
					file.text = '';
					file.hidecontext = WPCLib.context.show;
					file.cursor = 0;

					// Only submit this timestamp
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
							doc.firstChild.innerHTML = 'New Document';
							doc.id = 'doc_'+data;		                    
						}
					});


					WPCLib.canvas.docid = 'localdoc';

					// Save document & cleanup
					doc.firstChild.innerHTML = 'New Document';
					doc.id = 'doc_localdoc';				
				}

				// Get ready for the creation of new documents
				this.creatingDoc = false;
			}
		},

		showSettings: function() {
			WPCLib.ui.showDialog(event);
			WPCLib.ui.menuHide();
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

		_init: function() {
			// Basic init on page load

			// Document events
			var el = document.getElementById(this.contentId);			
			var p = document.getElementById(this.canvasId);								
			WPCLib.util.registerEvent(p,'mouseup',this.textclick);
			WPCLib.util.registerEvent(el,'keydown',this.keyhandler);	
			WPCLib.util.registerEvent(el,'keyup',this.update);
			WPCLib.util.registerEvent(el,'change',this._resize);	
			WPCLib.util.registerEvent(el,'cut',this._delayedresize);	
			WPCLib.util.registerEvent(el,'paste',this._delayedresize);
			WPCLib.util.registerEvent(el,'drop',this._delayedresize);		
		},	


		savedoc: function() {
			// Save the currently open document
			// For now we only say a doc is updated once it's saved
			this.lastUpdated = WPCLib.util.now();

			// Build the JSON object from th evarious pieces
			var file = {};
			file.id = this.docid;
			file.title = document.getElementById(this.pageTitle).value;
			file.text = this.text;
			file.created = this.created;
			file.last_updated = this.lastUpdated;
			file.cursor = this.caretPosition;
			file.hidecontext = !WPCLib.context.show;
			file.links = {};
			file.links.sticky = WPCLib.context.sticky;
			file.links.normal = WPCLib.context.links;
			file.links.blacklist = WPCLib.context.blacklist;			

			// TODO: Wire up backend saving
			if (this.docid!='doc_localdoc' && WPCLib.sys.user.level > 0) {
				console.log('saving remotely: ', JSON.stringify(file));				
				$.ajax({
					url: "/docs/"+this.docid,
	                type: "POST",
	                contentType: "application/json; charset=UTF-8",
	                data: JSON.stringify(file),
					success: function(data) {
	                    window.console.log("Saved!");
						WPCLib.canvas.saved = true;	                    
					}
				});
			} else {
				console.log('saving locally: ', file);					
				localStorage.setItem("WPCdoc", JSON.stringify(file));
				WPCLib.canvas.saved = true;					
			}						
		},		

		loaddoc: function(docid, title) {
			// Load a specific document to the canvas
			if (!this.saved) this.savedoc();			
			console.log('loading doc id: ', docid);

			// If we already know the title, we shorten the waiting time
			if (title) document.getElementById(this.pageTitle).value = title;	
			document.getElementById(this.contentId).value = 'Loading...'

			// Load data onto canvas
			var file = 'docs/'+docid;
			var that = this;
			$.ajax({
				dataType: "json",
				url: file,
				success: function(data) {
					WPCLib.canvas.docid = data.id;
					WPCLib.canvas.created = data.created;
					WPCLib.canvas.lastUpdated = data.last_updated;			

					// Show data on canvas
					if (WPCLib.context.show != data.hidecontext) WPCLib.context.switchview();
					WPCLib.ui.menuHide();						
					if (!title) document.getElementById(that.pageTitle).value = data.title;
					document.getElementById(that.contentId).value = data.text;
					that.text = data.text;
					that._setposition(data.cursor);
					WPCLib.canvas._removeblank();	

					// Load links
					WPCLib.context.sticky = data.links.sticky || [];
					WPCLib.context.links = data.links.normal || [];
					WPCLib.context.blacklist = data.links.blacklist || [];	
					if (data.links.sticky || data.links.normal) WPCLib.context.renderresults();
					document.getElementById(WPCLib.context.statusId).innerHTML = 'All loaded, keep going.';						
				}
			});						
		},	

		loadlocal: function(data) {
			// Loading a local document on the canvas
			document.getElementById(this.pageTitle).value = data.title;	
			document.getElementById(this.contentId).value = data.text;
			this._setposition(data.cursor);
			WPCLib.canvas._removeblank();	

			// Load links
			WPCLib.context.sticky = data.links.sticky || [];
			WPCLib.context.links = data.links.normal || [];
			WPCLib.context.blacklist = data.links.blacklist || [];	
			if (data.links.sticky || data.links.normal) WPCLib.context.renderresults();
			if (WPCLib.context.show != data.hidecontext) WPCLib.context.switchview();
			document.getElementById(WPCLib.context.statusId).innerHTML = 'Welcome back!';							

			// Set internal values	
			this.text = data.text;	
			this.docid = data.id;
			this.created = data.created;
			this.lastUpdated = data.last_updated;
		},

		newdoc: function() {
			// Create a new document (canvas part)

			// See if the current document was changed in any way (Should we even allow the creation of new documents of the current one is blank?)
			if (
					!this.saved && 
					document.getElementById(this.contentId).value && 
					document.getElementById(this.pageTitle).value != this.defaultTitle
				) this.savedoc();	

			// Set up blank document	
			var title = document.getElementById(this.pageTitle);
			var content = document.getElementById(this.contentId);		
			title.value = this.defaultTitle;
			content.value = '';			
			document.getElementById(this.quoteId).style.display = 'block';
			WPCLib.ui.fade(document.getElementById(this.quoteId),+1,300);			
			this.quoteShown = true;
			if (WPCLib.context.show == false) WPCLib.context.switchview();
			document.getElementById(WPCLib.context.resultsId).innerHTML = '';
			document.getElementById(WPCLib.context.statusId).innerHTML = 'Ready to inspire';
			this.created = WPCLib.util.now();

			// Empty the link lists
			WPCLib.context.wipe();	


			// Attach title event handlers, very crude atm but will refine if behaviour is liked by users
			WPCLib.util.registerEvent(title,'mouseover', this._showtitletip);
			WPCLib.util.registerEvent(title,'mouseout', this._hidetitletip);
			WPCLib.util.registerEvent(title,'click', function() {
				if (title.value == WPCLib.canvas.titleTip) {
					title.value = '';	
					WPCLib.canvas._removetitletips(title);						
				};
			})

			WPCLib.util.registerEvent(content,'keydown',this._cleanwelcome);		
			document.getElementById(WPCLib.canvas.contentId).focus();		
		},
		_showtitletip: function() {
			var title = document.getElementById(WPCLib.canvas.pageTitle);	
			var tip = WPCLib.canvas.titleTip;		
			title.value = tip;			
		},	
		_hidetitletip: function() {
			var title = document.getElementById(WPCLib.canvas.pageTitle);	
			var tip = WPCLib.canvas.titleTip;	
			if (title.value==tip) {
				title.value = WPCLib.canvas.defaultTitle;
			}
		},
		_removetitletips: function(title) {
			if (!title) var title = document.getElementById(WPCLib.canvas.pageTitle);
			WPCLib.util.releaseEvent(title,'mouseover', WPCLib.canvas._showtitletip);
			WPCLib.util.releaseEvent(title,'mouseout', WPCLib.canvas._hidetitletip);
		},	

		_cleanwelcome: function() {
			// Remove welcome teaser etc which was loaded if document was blank
			var el = document.getElementById(WPCLib.canvas.contentId);		
			WPCLib.ui.fade(document.getElementById('nicequote'),-1,1000);
			WPCLib.util.releaseEvent(el,'keydown',WPCLib.canvas._cleanwelcome);
			WPCLib.canvas.quoteShown = false;
		},

		_removeblank: function() {
			// Make sure we remove all blank stuff from the canvas
			this._removetitletips();
			this._cleanwelcome();
		},

		update: function() {
			// update function bound to page textarea, return to local canvas scope
			WPCLib.canvas.evaluate();			
		},		

		_resize: function() {
			// Resize canvas textarea as doc grows
			// TODO: Consider cut/copy/paste, fix padding/margin glitches
		    var text = document.getElementById(WPCLib.canvas.contentId);
        	text.style.height = 'auto';		    
		    text.style.height = text.scrollHeight+'px';
		},

		_delayedresize: function() {
			// Experiment with crossbrowser resizing
	        window.setTimeout(WPCLib.canvas._resize, 0);
		},

		keyhandler: function(e) {
			// Various actions when keys are pressed
			var k = e.keyCode;
			var r = [];
			// Tab key insert 5 whitespaces
			if (k==9) WPCLib.canvas._replacekey(e,'tab');

			// Space and return triggers brief analysis
			if (k==32||k==13||k==9) {
				WPCLib.canvas._wordcount();	
				WPCLib.canvas._logcontent();	
			}
			WPCLib.canvas._resize();
		},

		_replacekey: function(e,key) {
			// Replace default key behavior with special actions
			// TODO: Make sure this works properly on all browsers, fix position jump
			var pos = this._getposition()[1];		
			var src = document.getElementById(WPCLib.canvas.contentId).value; 				
			if (key == 'tab') {
	  			document.getElementById(WPCLib.canvas.contentId).value = [src.slice(0, pos), '\t', src.slice(pos)].join('');         
	        }

	        // Prevent default behaviour for those keys
			if (key == 'tab') {
	            WPCLib.util.stopEvent(e);
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
				WPCLib.context.analyze(WPCLib.canvas.text);					
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
			// document.getElementById("wordcount").innerHTML = 'Words: ' + this.wordcount + " Lines: " + this.linecount + " Pos: " + pos;			
		},

		textclick: function() {
			// when text is clicked
			var sel = WPCLib.canvas._getposition();
			if (sel[0] != sel[1]) WPCLib.context.analyze(sel[2]);
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
			var el = document.getElementById(this.contentId);
    		if (el.setSelectionRange) {
        		el.focus();
        		el.setSelectionRange(pos,pos);
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
			var c = document.getElementById(this.id);
			var can = document.getElementById(WPCLib.canvas.canvasId);
			var t = document.getElementById(WPCLib.canvas.pageTitle);
			var con = document.getElementById(WPCLib.canvas.contentId);
			var sw = document.getElementById('switchview');
			var menu = WPCLib.ui.menuCurrPos * -1;
			if (this.show) {
				c.style.display = 'none';
				var cr = menu - 1;
				can.style.right = cr+'px';
				t.style.fontSize = '2.5em';
				con.style.fontSize = '1.2em';
				// because the min height is set on an empty document, the changed line height will make the textarea too large
				if (con.value=='') con.style.minHeight = '22em';				
				sw.innerHTML = '+';
				this.show = false;
			} else {
				c.style.display = 'block';
				//Make sure we move the context back into the picture when it was moved right via loaddoc while the menu was open
				if (menu==0) c.style.right = 0;
				var cr = menu + 300;			
				can.style.right = cr+'px';
				t.style.fontSize = '1.9em';
				con.style.fontSize = '1em';
				sw.innerHTML = 'x';				
				this.show = true;
			}
		},

		analyze: function(string, chunktype) {
			// Send text to server for analysis
			document.getElementById(this.statusId).innerHTML = 'Analyzing...';
			$.post('http://wonderpad-old.herokuapp.com/analyze', {content: string}, 
			function(data){	
				console.log(data);
	            WPCLib.context.search(data,chunktype);
	        });
		},

		wipe: function() {
			// reset the context sidebar contents
			this.links.length = 0;
			this.sticky.length = 0;
			this.blacklist.length = 0;

		},

		search: function(data,chunktype) {
			// Search according to search terms returned
			document.getElementById(this.statusId).innerHTML = 'Searching...';			
			var data = data.chunktype || data.textrank_chunks;
			var searchstring = "";

			// Build the searchstring from JSON object
			for (var item in data) {
			  if (data.hasOwnProperty(item)) {
			  	if (chunktype=='proper_chunks') {
			    	searchstring = searchstring + ' "' + data[item].head + '"';
			  	} else {
			    	searchstring = searchstring + data[item] + ' ';			  		
			  	}
			  }
			};

			// Post data if we have a proper searchstring
			if (searchstring) {
				var postData = {search_terms: searchstring,use_shortening: true};
				console.log('searching for: ',postData);
				var that = this;						
				$.post('http://wonderpad-old.herokuapp.com/relevant', postData,
		           function(data) {
		            WPCLib.context.storeresults(data.results);
		            WPCLib.context.renderresults();		             
					document.getElementById(that.statusId).innerHTML = 'Ready for more?';		             
		        });
			} else {
					document.getElementById(this.statusId).innerHTML = 'Nothing interesting found.';
			}
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
			// Add events that should be called when DOM is ready to the setupTask queue
			this.onstartup( function() {
				WPCLib.canvas._init();
				console.log('page started for user ' + WPCLib.sys.user.id);
				// Load settings into dialog
				WPCLib.ui.loadDialog(WPCLib.sys.settingsUrl);
			});

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

			setStage: function(level) {
				// Show / hide features based on user level, it's OK if some of that can be tweaked via js for now
				// TODO replace once we get proper backend response
				level = level || 0;

				var results = document.getElementById(WPCLib.context.resultsId);
				var signupButton = document.getElementById(WPCLib.context.signupButtonId);
				var logout = document.getElementById(WPCLib.folio.logoutId);

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
				}

				// generic styles
				switch(level) {
					case 1:
					case 2:					
						results.style.overflowY = 'auto';
						results.style.bottom = 0;
						results.style.marginRight = '1px';
						results.style.paddingRight = '2px';						
						signupButton.style.display = 'none';
						logout.style.display = 'inline-block'					
						break;	
				}				
			},

			upgrade: function(level) {
				console.log('Upgrade user to ', level);
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
			if (t<3600) return Math.round(t/60) + " minutes";
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
			if (e.preventDefault) {
				e.preventDefault();
			}
			if (e.stopPropagation) {
				e.stopPropagation();
			}
			e.returnValue = false;
			e.cancelBubble = true;
		}
	},

	// Everything UI / visually relevant
	ui: {
		menuCanvasLeft: 50,
		menuCanvasRight: 300,	
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

		loadDialog: function(url) {
			// (pre)load a special URL into our settings iframe
			var d = document.getElementById(this.dialogWrapperId);
			var frame = d.getElementsByTagName('iframe')[0];
			frame.src = url;
		},

		showDialog: function(event,url,section, width, height) {
			// Show a modal popup 
			var s = document.getElementById(this.modalShieldId);
			var d = document.getElementById(this.dialogWrapperId);
			if (event) event.preventDefault();			

			// spawn shield
			s.style.display = 'block';

			// spawn dialogwrapper
			d.style.display = 'block';
			d.style.width = (width || this.dialogDefaultWidth) + 'px';
			d.style.height = (height || this.dialogDefaultHeight) + 'px';
			this._centerDialog();

			// load url into iframe, only if we need a special URL, otherwise it's preloaded on init
			if (url) this.loadDialog(url);

			// Recenter on window size changes
			WPCLib.util.registerEvent(window, 'resize', this._centerDialog);
			this.dialogTimer = window.setInterval(this._centerDialog, 200);
		},

		hideDialog: function() {
			// Hide the current dialog
			var s = document.getElementById(this.modalShieldId);
			var d = document.getElementById(this.dialogWrapperId);

			// remove resize clickhandler & timer
			if (this.dialogTimer) {
				window.clearInterval(this.dialogTimer);
				this.dialogTimer=null;
				WPCLib.util.releaseEvent(window, 'resize', this._centerDialog);
			}

			// reload iframe
			d.getElementsByTagName('iframe')[0].src = d.getElementsByTagName('iframe')[0].src;

			// Hide shield & dialog
			s.style.display = 'none';
			d.style.display = 'none';

		},

		upgrade: function() {
			
		},

		_centerDialog: function() {
			var s = document.getElementById(WPCLib.ui.modalShieldId);
			var d = document.getElementById(WPCLib.ui.dialogWrapperId);
			d.style.left= Math.floor((s.offsetWidth - d.offsetWidth)/2) +'px';
			d.style.top= Math.floor((s.offsetHeight - d.offsetHeight)/2) +'px';
		},

		menuSlide: function(direction, callback) {
			var startTime, duration, x0, x1, dx, ref;
			var canvas = document.getElementById('canvas');
			var context = document.getElementById('context');
			var mCaRi = this.menuCanvasRight;
			var mCoRi = this.menuContextRight;			
			// Adjust the right positions if context menu is not shown	
			if (!WPCLib.context.show) {
				mCaRi = mCaRi - 301;
				mCoRi = mCoRi - 301;
			}	
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
				canvas.style.left=ref.menuCanvasLeft+v+'px';
				canvas.style.right=mCaRi-v+'px';
				context.style.right=mCoRi-v+'px';								
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
				(this.menuCurrPos==this.menuSlideSpan && direction>0)) return;
			x0=this.menuCurrPos;
			x1=(direction<0)? 0:this.menuSlideSpan;
			dx=x1-x0;
			duration=this.menuSlideDuration/this.menuSlideSpan*Math.abs(dx);
			startTime=new Date().getTime();
			ref=this;
			this.menuSlideCurrDirection=direction;
			step();			
		},

		menuHide: function() {
			if (this.menuHideTimer) {
				clearTimeout(this.menuHideTimer);				
			}
			var that = WPCLib.ui;
			this.menuHideTimer = setTimeout(function(){that.menuSlide(-1);},1);			
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

		fade: function(element, direction, duration, callback) {	
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
