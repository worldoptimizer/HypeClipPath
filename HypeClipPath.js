/*!
Hype ClipPath 1.7.2
copyright (c) 2021 Max Ziebell, (https://maxziebell.de). MIT-license
*/

/*
* Version-History
* 0.9 (Beta) Initial release under MIT-license
* 1.0 First official release, inverted logic and still a function
* 1.1 With a little refactoring HTML clipping is supported, limitations apply
* 1.2 Fixed a bug determining if it's a SVG or Group
* 1.3 Converted to full extension. Added new methods on hypeDocument 
* 1.4 Added live preview in IDE
* 1.5 Fixed some preview issues (nudging, delay)
* 1.6 Fixed some preview issues (zoom, at the cost of antialias)
* 1.7 Using Mutation Observer (not only IDE), debouncing and performance update
* 1.7.1 fixed Safari update bug
* 1.7.2 fixed querySelector bug (thanks to michelangelo)
*/

if("HypeClipPath" in window === false) window['HypeClipPath'] = (function () {

	var kSvgNS = 'http://www.w3.org/2000/svg';

	/* debounce updates to frames (see sceneLoad) */
	var _tickId;
	var _tickRunning = false;
	var _updatesToRunOnTick = {};

	/* @const */
	const _isHypeIDE = window.location.href.indexOf("/Hype/Scratch/HypeScratch.") != -1;

	var _lookup = {};

	/* FPS */
	var _FPS;

	/* Compability */
	var _supportsClipPath = false;
	if(window.CSS && window.CSS.supports){
		_supportsClipPath = CSS.supports("clip-path", "url(#test)");
	}

	function supportsClipPath() {
		return _supportsClipPath;
	}

	/* clip path generator function */
	function generateClipPath(){
		/* create clip and path node */
		var clipPathElm = document.createElementNS(kSvgNS, 'clipPath');
		var pathElm = document.createElementNS(kSvgNS, 'path'); 
		/* append path data to clip path */
		clipPathElm.appendChild(pathElm);
		/* return our clip path for further processing */
		return clipPathElm;
	}

	/* clip path update function */
	function updateClipPath(clipPathElm, obj){
		/* fetch path node */
		var pathElm = clipPathElm.querySelector('path'); 
		/* set attributes, transfer path data */
		for(var name in obj.pathAttributes){
			if (obj.pathAttributes[name]) {
				pathElm.setAttribute(name, obj.pathAttributes[name]);
			}
		}
		/* assign unique id to clip path and offset */
		for(var name in obj.clipPathAttributes){
			if (obj.clipPathAttributes[name]) {
				clipPathElm.setAttribute(name, obj.clipPathAttributes[name]);
			}
		}
	}

	/* defs generator function */
	function generateDefs(){
		/* create and return defs node */
		var defsElm = document.createElementNS(kSvgNS, 'defs');	
		return defsElm;
	}

	/* extend Hype */
	function extendHype(hypeDocument, element, event) {
		/* init document specific lookup for mutation observer */
		var hypeDocId = hypeDocument.documentId();
		_lookup[hypeDocId] = {};

		/* hypeDocument function to get cached current scene (caching depends on reset of cache in sceneUnload) */
		hypeDocument.getCurrentSceneElement = function(){
			if (_lookup[hypeDocId]['currentSceneElm']==undefined){
				 _lookup[hypeDocId]['currentSceneElm'] = document.querySelector('#'+hypeDocument.documentId()+' > .HYPE_scene[style*="block"]');
			}
			return _lookup[hypeDocId]['currentSceneElm'];
		}

		/* hypeDocument function to apply ALL clip path in scene (debounced to framerate) */
		hypeDocument.applyClipPaths = function(){
			/* fetch scene  */
			var sceneElm = hypeDocument.getCurrentSceneElement();
			/* fetch candidates and loop over them */
			var targetElms = sceneElm.querySelectorAll('[data-clip-path]');
			/* loop over candidates */
			for (var i=0; i < targetElms.length; i++) {
				hypeDocument.applyClipPathToElement(targetElms[i]);
			}
		}

		/* hypeDocument function to apply a clip path (debounced to framerate) */
		hypeDocument.applyClipPathToElement = function(targetElm){
			if (targetElm.dataset.clipPath) {			
				if (!_updatesToRunOnTick[targetElm.id]) {
					_updatesToRunOnTick[targetElm.id] = function(){
						/* fetch scene sourceElm */
						var sceneElm = hypeDocument.getCurrentSceneElement();
						var sourceElm = sceneElm.querySelector(targetElm.dataset.clipPath);
						/* if found apply it */
						if (sourceElm) {
							hypeDocument.generateClipPathForElement(sourceElm, targetElm);
						} else {
							//remove
							removeClipPath(targetElm);
						}
					}
				}
			} else {
				//remove
				removeClipPath(targetElm);
			}
		}

		/* hypeDocument function calculate transforms on a vector element and return an SVG compatible transform string */
		/* we can't just clone the transforms from one to another node as SVG transforms have a diffrent logic on the transform origin 
		   If anybody knows a quicker way of doing this please contact me! Source: https://css-tricks.com/transforms-on-svg-elements */
		hypeDocument.calculateAndStoreTransformForElement = function(sourceElm){
			var hypeDocId = hypeDocument.documentId();
			var sceneElm = hypeDocument.getCurrentSceneElement();
			var transformLookup = _lookup[hypeDocId][sceneElm.id]['Transform'];
			/* get offsets */
			var sourceLeft =  hypeDocument.getElementProperty(sourceElm, 'left');
			var sourceTop = hypeDocument.getElementProperty(sourceElm, 'top');
			/* offsets */
			var offsetX = sourceLeft;
			var offsetY = sourceTop;
			var originOffsetX = 0;
			var originOffsetY = 0;
			/* scale */
			var sourceScaleX = hypeDocument.getElementProperty(sourceElm, 'scaleX');
			var sourceScaleY = hypeDocument.getElementProperty(sourceElm, 'scaleY');
			/* rotation */
			var sourceRotate = hypeDocument.getElementProperty(sourceElm, 'rotateZ') || 0;
			/* store for later use source */
			transformLookup[sourceElm.id] = {
				'left': sourceLeft,
				'top': sourceTop,
				'scaleX': sourceScaleX,
				'scaleY': sourceScaleY,
				'rotateZ': sourceRotate
			};
			/* transformOrigin */
			if (sourceRotate!=0 || sourceScaleX!=1 || sourceScaleY!=1) {
				var sourceWidth = hypeDocument.getElementProperty(sourceElm, 'width');
				var sourceHeight = hypeDocument.getElementProperty(sourceElm, 'height');
				var transformOrigin = (sourceElm.style.transformOrigin) ? String(sourceElm.style.transformOrigin).split(' ') : [50,50];
				originOffsetX = sourceWidth * parseFloat(transformOrigin[0]) / 100;
				originOffsetY = sourceHeight * parseFloat(transformOrigin[1]) / 100;
			}
			/* queue transforms using unshift as they are counter intuitive applied in reverse in SVG */
			var transform = [];
			if (sourceScaleX!=1 || sourceScaleY!=1) {
				transform.unshift('scale('+sourceScaleX+' '+sourceScaleY+')');
				transform.unshift('translate('+(-originOffsetX*(sourceScaleX-1))+' '+(-originOffsetY*(sourceScaleY-1))+')');
			}
			if (sourceRotate) {
				transform.unshift('rotate('+sourceRotate+' '+originOffsetX+' '+originOffsetY+')');
			}
			transform.unshift('translate('+offsetX+' '+offsetY+')');
			/* return string */
			return transform.join(' ');
		}

		/* hypeDocument function to apply a clip path (attention: not debounced) */
		hypeDocument.generateClipPathForElement = function(sourceElm, targetElm){
			/* if source and target are defined process them */
			if (sourceElm && targetElm) {
				/* do stuff if source and target contain SVG */
				if (sourceElm.querySelector('svg')) {
					var applyElm = targetElm.classList.contains('HYPE_element_container') ? targetElm : targetElm.parentNode;
					/* make sure we have a SVG as direct child */
					switch (sourceElm.dataset.clipPathStyle) {
						/* clip path using url (default) */
						default:
							var uniqueIdBase = "hype_clip_path_"+targetElm.getAttribute('id')+'_'+sourceElm.getAttribute('id');
							var uniqueId = uniqueIdBase+'_'+(Math.ceil(Math.random()*100000+100000));
							/* make sure we have a defs section (like on imported SVG from AI) */
							if (!sourceElm.querySelector('svg > defs')) {
								/* append defs */
								sourceElm.querySelector('svg').appendChild(generateDefs());
							} else if(_isHypeIDE) {
								/* move defs to last position as the Hype IDE has bug and updates first path even if in defs */
								sourceElm.querySelector('svg').appendChild(sourceElm.querySelector('svg > defs'));
							}
							/* append clip path node if needed */
							var clipPathElm = sourceElm.querySelector('svg > defs > [id^='+uniqueIdBase+']');
							if (!clipPathElm) {
								clipPathElm = sourceElm.querySelector('svg > defs').appendChild(generateClipPath());
							}
							/* update clip path node */
							updateClipPath (clipPathElm, {
								clipPathAttributes: {
									'id': uniqueId,
									'shape-rendering': 'optimizeSpeed',
								},
								pathAttributes:  {
									'd' : sourceElm.querySelector('svg > path').getAttribute('d'),
									'clip-rule': targetElm.dataset.clipPathClipRule,
									'transform': hypeDocument.calculateAndStoreTransformForElement(sourceElm),
									'shape-rendering': 'optimizeSpeed',
								}
							});
							/* set clip path as CSS style to applyElm being targetElm or targetElm.parentNode */
							applyElm.style.webkitClipPath = 'url("#'+uniqueId+'")';
							applyElm.style.clipPath = 'url("#'+uniqueId+'")';
							/* reverse lookup */
							sourceElm.dataset.clipPathSelector = targetElm.dataset.clipPath;
							forceRedraw(applyElm);
							break;	
					}
					/* as safari doesn't clip outside the bounds on groups let's remind people in chrome */
					applyElm.style.overflow = 'hidden';
					/* hide source element */
					if (!_isHypeIDE && !sourceElm.dataset.clipPathVisible){
						sourceElm.style.opacity = 0;
						sourceElm.style.pointerEvents = 'none';
					}
				}
			}
		}
	}

	/* function to setup a mutation observer */
	function setupObserver (hypeDocument, element, options){
		var hypeDocId = hypeDocument.documentId();
		var sceneElm = hypeDocument.getCurrentSceneElement();
		var observerLookup = _lookup[hypeDocId][sceneElm.id]['Observer'];
		if (!observerLookup[options.mOiD]) {
			observerLookup[options.mOiD] = new MutationObserver(function(mutations) {
				mutations.forEach(function(mutation) {
					options.callback.call(null, hypeDocument, mutation);
				});
			});
		}
		/* start monitoring for related changes */
		observerLookup[options.mOiD].observe(element, options);
	}

	/* callback for a mutation observer on target nodes (on the fly changes of dataset attributes) */
	function callbackTargetProps(hypeDocument, mutation){
		/* clip path attribute was mingled with */
		switch (mutation.attributeName) {
			case 'data-clip-path':
				if(processingClipPathDemandsUpdate(mutation)){
					hypeDocument.applyClipPathToElement(mutation.target);
				}
				break;

			case 'data-clip-path-clip-rule':
				hypeDocument.applyClipPathToElement(mutation.target);
				break;
		}
	}

	/* callback for a mutation observer on target nodes (montoring transform changes) */
	function callbackSourceProps(hypeDocument, mutation){
		var sceneElm = _isHypeIDE? document : hypeDocument.getCurrentSceneElement();
		/* clip path attribute was mingled with */
		switch (mutation.attributeName) {
			case 'style':
				if (processingStyleDemandsUpdate(hypeDocument, mutation)){
					/* apply update to targets referenced by this source */
					var selector = mutation.target.dataset.clipPathSelector;
					var targetElms = sceneElm.querySelectorAll ('[data-clip-path="'+selector+'"]');
					for (var i=0; i < targetElms.length; i++) {
						hypeDocument.applyClipPathToElement(targetElms[i]); /* TODO only update transform not path data */
					}
				}
				break;	
		}
	}

	/* callback for a mutation observer on target nodes (path updates) */
	function callbackPathProps(hypeDocument, mutation){
		var sceneElm = _isHypeIDE? document : hypeDocument.getCurrentSceneElement();
		switch (mutation.attributeName) {
			case 'd':
				var selector = mutation.target.parentNode.parentNode.dataset.clipPathSelector;
				if (selector) {
					var targetElms = sceneElm.querySelectorAll ('[data-clip-path="'+selector+'"]');
					for (var i=0; i < targetElms.length; i++) {
						hypeDocument.applyClipPathToElement(targetElms[i]);
					}
				}
				break;
		}
	}

	/* determine if there are change in style (return boolean) */	
	function processingStyleDemandsUpdate(hypeDocument, mutation){				
		var hypeDocId = hypeDocument.documentId();
		var sceneElm = hypeDocument.getCurrentSceneElement();
		var transformLookup = _lookup[hypeDocId][sceneElm.id]['Transform'];
		var transform = transformLookup[mutation.target.id];
		var update = false;
		if (transform) {
			for (var prop in transform){
				if (transform[prop] != hypeDocument.getElementProperty(mutation.target, prop)){
					return true;
				}
			}
		}
		return false;				
	}

	/* determine if dataset.clipPath has changes (return boolean) */
	function processingClipPathDemandsUpdate(mutation){
		/* fetche values */
		var newValue = mutation.target.dataset.clipPath;
		var oldValue = mutation.oldValue;
		/* if they differ act */
		if (newValue != oldValue) {
			/* is new value set */
			if (newValue) {
				/* apply new clip path */
				return true;		
			} else {
				/* else remove clip path */
				removeClipPath(mutation.target)
			}
		}
		return false;
	}

	function removeClipPath (targetElm){
		var applyElm = targetElm.classList.contains('HYPE_element_container') ? targetElm : targetElm.parentNode;
		applyElm.style.webkitClipPath = null;
		applyElm.style.clipPath = null;
	}


	var forceRedraw = function(element){
		var disp = element.style.display;
		element.style.display = 'none';
		void 0!=element.offsetHeight;
		element.style.display = disp;
	};

	/* sceneLoad */
	function sceneLoad(hypeDocument, element, event) {
		/* make sure we have a scene specific storage */
		var hypeDocId = hypeDocument.documentId();
		/* fetch fresh scene element */
		var sceneElm = hypeDocument.getCurrentSceneElement();
		if (!_lookup[hypeDocId][sceneElm.id]){
			_lookup[hypeDocId][sceneElm.id] = {};
			_lookup[hypeDocId][sceneElm.id]['Observer'] = {};
			_lookup[hypeDocId][sceneElm.id]['Transform'] = {};
		}

		/* initial apply */		
		hypeDocument.applyClipPaths();

		/* fetch candidates and loop over them */
		var targetElms = sceneElm.querySelectorAll('[data-clip-path]');
		/* cancel any running ticks */
		if (_tickId) window.cancelAnimationFrame(_tickId);
		/* loop over candidates if we have any */
		if (Object.keys(targetElms).length){
			for (var i=0; i < targetElms.length; i++) {
				/* initial apply */
				//hypeDocument.applyClipPathToElement(targetElms[i]);
				/* ignore observer setup is set to static */
				if (!targetElms[i].hasAttribute('data-clip-path-static') || _isHypeIDE){
					/* observer target (masked element/group) */
					setupObserver(hypeDocument, targetElms[i], {
						attributes: true, 
						attributeOldValue: true,
						attributeFilter: ['data-clip-path', 'data-clip-path-clip-rule'],
						mOiD: targetElms[i].id,
						callback: callbackTargetProps
					});
					/* observer source (mask path) if clipPath is set and found */
					if(targetElms[i].dataset.clipPath){
						var sourceElm = sceneElm.querySelector(targetElms[i].dataset.clipPath);
						if (sourceElm) {
							setupObserver(hypeDocument, sourceElm, {
								attributes: true, 
								attributeOldValue: true,
								attributeFilter: ['style'],
								mOiD: sourceElm.id,
								callback: callbackSourceProps
							});
							var query =  _isHypeIDE ? '[hypeobjectid="'+sourceElm.getAttribute('hypeobjectid')+'"] > svg > path' : '#'+sourceElm.id+' > svg > path';
							setupObserver(hypeDocument, document.querySelector(query), {
								attributes: true, 
								attributeOldValue: true,
								attributeFilter: [ "d"],
								mOiD: sourceElm.id+'_path',
								callback: callbackPathProps
							});
						}
					}
				}
			}
			/* setup new tick debouncer if needed */
			if (_FPS){
				var fpsInterval = 1000 / _FPS;
    			var then = -1000;
    			var startTime = then;
	  			var tick = function(){
	  				if (!_tickRunning) {
						now = performance.now();
		    			elapsed = now - then;
		    			if (elapsed > fpsInterval) {
		    				_tickRunning = true;
		    				then = now - (elapsed % fpsInterval);
		    				for (var id in _updatesToRunOnTick) {
								_updatesToRunOnTick[id]();
							}
							_updatesToRunOnTick = {};
							_tickRunning = false;
		    			}
	    			}
	    			_tickId = window.requestAnimationFrame(tick);
	    		}
			} else {
				var tick = function(){
					if (!_tickRunning) {
						tickRunning = true;
						for (var id in _updatesToRunOnTick) {
							_updatesToRunOnTick[id]();
						}
						_updatesToRunOnTick = {};
						tickRunning = false;
					}
					_tickId = window.requestAnimationFrame(tick);
				}
			}
			/* start tick */
			if (_isHypeIDE) {
				window.requestAnimationFrame(tick);	
			} else {
				tick();
			}
		}
	}

	function setFramesPerSecond (FPS){
		FPS = parseInt(FPS);
		_FPS = (FPS>0 && FPS<60) ? FPS : null;
	}

	/* sceneUnload */
	function sceneUnload(hypeDocument, element, event) {
		/* disconnect mutation observer */
		var hypeDocId = hypeDocument.documentId();
		var sceneElm = hypeDocument.getCurrentSceneElement();
		var observerLookup = _lookup[hypeDocId][sceneElm.id]['Observer'];
		for (var mOiD in observerLookup) {
			observerLookup[mOiD].disconnect();
			if(_isHypeIDE) delete(observerLookup[mOiD]);
		}
		/* delete cache version so a new one is generated */
		delete _lookup[hypeDocId]['currentSceneElm'];
	}

	/* parse transforms helper for IDE */
	function parse_transform(a) {
	    var b = {};
	    for (var i in a = a.match(/(\w+)\(([^,)]+),?([^)]+)?\)/gi)) {
	        var c = a[i].match(/[\w\.\-]+/g);
	        b[c.shift()] = c;
	    }
	    return b;
	}

	/* IDE preview -- START */
	window.addEventListener("DOMContentLoaded", function(event) {
		if (_isHypeIDE && supportsClipPath()) {
			/* make a fake hypeDocument (IDE) version */
			var hypeDocument = {
				getElementProperty: function(elm, prop){
					switch (prop){ /* TODO WebkitMatrix lookups (although they are influenced by rotation) rather use upcoming hypeattributescalex/y */
						case 'left': return parseFloat(elm.getAttribute('hypeattributeleft')); break;
						case 'top': return parseFloat(elm.getAttribute('hypeattributetop')); break;
						case 'rotateZ': return parseFloat(elm.getAttribute('hypeattributerotationanglez')); break;
						case 'width': return parseFloat(elm.style.width); break;
						case 'height': return parseFloat(elm.style.height); break;
						case 'scaleX': var transform = parse_transform(elm.style.transform); return transform.scaleX ? parseFloat(transform.scaleX): 1; break;
						case 'scaleY': var transform = parse_transform(elm.style.transform); return transform.scaleY ? parseFloat(transform.scaleY): 1;  break;
					}
				},
				documentId: function(){
					return 'hypeDocument'
				}
			};
			/* fake a HypeDocumentLoad event */
			extendHype(hypeDocument);
			/* overwrite extentions that need tweaking in IDE enviroment */
			hypeDocument.getCurrentSceneElement = function(){
				return document.getElementById('HypeMainContentDiv');
			}
			/* fake a HypeSceneLoad event */
			sceneLoad(hypeDocument);
			/* temporary workaround as long as the IDE uses zoom on 100% and plus */
			var zoomCorrector = function(mutations) {
				mutations.forEach(function(mutation) {
					if (mutation.type == 'attributes') {
						if (mutation.attributeName == 'style') {
							var zoom = mutation.target.style.zoom;
							if (zoom){
								mutation.target.style.zoom = null;
								mutation.target.style.transform = 'scale('+zoom+', '+zoom+')';
								mutation.target.style.transformOrigin = 'left top';
							}
						}
					}
				});
			}
			/* fix zoom in IDE to only use transforms */
			var zoomObserver = new MutationObserver(zoomCorrector);
			var HypeSceneEditorElm = document.getElementById('HypeSceneEditor');
			zoomObserver.observe(HypeSceneEditorElm, { 
				attributes: true,
				attributeOldValue: true,
				attributeFilter: [ "style"]
			});
			/* trigger an initial zoom event */
			zoomCorrector([{
				target: HypeSceneEditorElm,
				type : 'attributes',
				attributeName : 'style'
			}]);
			/* track changes */
			var changeObserver = new MutationObserver(function(mutations) {
				mutations.forEach(function(mutation) {
					/* detection of removal of attribute data-clip-path in IDE */
					if (!mutation.target.hasAttribute('data-clip-path')) {	
						removeClipPath(mutation.target);
					}
				});
				/* delay because existing observers need to run before being reset */
				setTimeout(function(){
					sceneUnload(hypeDocument);
					sceneLoad(hypeDocument);
				},1);	
			});
			/* wait for Hype IDE to add build view */
			changeObserver.observe(hypeDocument.getCurrentSceneElement(), { 
				attributes: true, 
				attributeOldValue: true, 
				subtree: true,
				attributeFilter: ["data-clip-path"],
			});
		} else{
			/* not Hype IDE or doesn't support clip path so let's set up some rules to help with these legacy browsers */
			if (!supportsClipPath()) {
				document.styleSheets[0].insertRule('.hideIfClipPathNotSupported {display:none!important;}',0);
				document.styleSheets[0].insertRule('.showIfClipPathNotSupported {display:block!important;}',1);	
			}
		}
	});
	/* IDE preview -- END */

	/* setup callbacks */
	if (supportsClipPath()){
		if("HYPE_eventListeners" in window === false) { window.HYPE_eventListeners = Array();}
		window.HYPE_eventListeners.push({"type":"HypeDocumentLoad", "callback": extendHype});
		window.HYPE_eventListeners.push({"type":"HypeSceneLoad", "callback": sceneLoad});
		window.HYPE_eventListeners.push({"type":"HypeSceneUnload", "callback": sceneUnload});
	}
	/* Reveal Public interface to window['HypeClipPath'] */
	return {
		version: '1.7.2',
		'supportsClipPath': supportsClipPath,
		'setFramesPerSecond': setFramesPerSecond
	};
})();