//////////////////////////////////////////////////////////////////////
//  Section 0: missing core operations
Array.prototype.peek = function() { return this[this.length-1]; }

// CSS query selectors need special escaping to work on non-identifier IDs
function cssIdEscape(id) {
    return id.replace(/[-!"#$%&\'()*+,./;<=>?@\[\\\]^`{}|~]/g, '\\$&')
        .replace(/[ ]/g,'\\ ')
        .replace(/[\n\r\t\f\v]/g,(x => '\\'+x.codePointAt(0).toString(16)+' '))
        .replace(/^[0-9]/,'\\3$& ')
        .replace(/:/g, '\\3A ')
}




//////////////////////////////////////////////////////////////////////
// Section 1: SVG and windowing management, including pan and zoom

/** Helper function to make SVG elements with correct namespace */
function createSVG(within, name, attrs){
    const svgNS = 'http://www.w3.org/2000/svg'
    var el = document.createElementNS(svgNS, name);
    for (var attr in attrs)
        if (attrs.hasOwnProperty(attr))
            el.setAttribute(attr, attrs[attr]);
    if ('string' == typeof within) within = c.querySelector(within);
    return within.appendChild(el);
}

/** Gets zoomed, panned coordinates of mouse */
function getMousePos(evt) {
    let CTM = c.getScreenCTM();
    let ans = {
        x: (evt.clientX - CTM.e) / CTM.a, 
        y: (evt.clientY - CTM.f) / CTM.d,
    }
    return ans;
    
}


//////////////////////////////////////////////////////////////////////
// Section 2: pen-stroke datatype and support functions

/** creates a perpendicular distance measuring object from a pair of points */
function PrecomputePdist(a,b) {
    let nx = b.y-a.y, ny = a.x-b.x;
    this.nd = Math.hypot(nx,ny);
    this.x = a.x
    this.y = a.y
    this.nx = this.nd ? nx/this.nd : 0
    this.ny = this.nd ? ny/this.nd : 0
}
/** unsigned distance */
PrecomputePdist.prototype.d = function(p) {
    return this.nd ? Math.abs(this.nx*(p.x-this.x) + this.ny*(p.y-this.y))
        : Math.hypot((p.x-this.x), this.ny*(p.y-this.y))
}
/** signed distance */
PrecomputePdist.prototype.sd = function(p) {
    return this.nd ? this.nx*(p.x-this.x) + this.ny*(p.y-this.y)
        : Math.hypot((p.x-this.x), this.ny*(p.y-this.y))
}



/** SVG does not store polyline points as numbers, so we do */
Object.defineProperty(SVGPolylineElement.prototype, 'pts', {value:null, writable:true})
/** To enable path simplification (needed for distance measuring) we store the number already simplified */
Object.defineProperty(SVGPolylineElement.prototype, 'locked', {value:0, writable:true})


/** Helper to find end-point of path */
Object.defineProperty(SVGPolylineElement.prototype, 'end', 
    { get(){ return this.pts ? this.pts[this.pts.length-1] : undefined } })
/** Helper to find start-point of path */
Object.defineProperty(SVGPolylineElement.prototype, 'start', 
    { get(){ return this.pts ? this.pts[0] : undefined } })

/**
 * For dragging to a new point: adds to end and simplifies if possible.
 * Call as pl.extend({x:xCoord, y:yCoord})
 * May result in pl.notify being called, which in turn may generate 
 * server callback, so only call from UI, not from server
 */
SVGPolylineElement.prototype.extend = function(p) {
    if (!this.pts) this.pts = []
    this.pts.push(p)
    if (this.locked == 0) {
        this._lock(0)
    } else this.addLabel()
    this._simplify()
    this._refresh()
}

SVGPolylineElement.prototype.addLabel = function() {
    if (!this.label) {
        this.label = createSVG('#overlay', 'text', {
            x: this.start.x,
            y: this.start.y,
            'text-anchor':'middle',
        })
        this.label.ownSt = this
        this.label.appendChild(document.createTextNode(''))
        this._refresh()
    }
}

/**
 * There are many path simplification algorithms in the literature,
 * but none that suited my needs:
 * 
 * - Ramer-Douglas-Peuker is global, does not work incrementally
 * - Visvalinam-Whyatt removes narrow slivers, such as up-and-back travel
 * - Reumann-Witkam is very dependent on the first segment
 * - Openheim is length-constrained Reumann-Witkam (might work, though)
 * - Lang has max distances and tip cutting
 * - Zhao-Saalfeld I couldn't find documente,d but oversamples
 * 
 * Mine: from last locked point, add points one at a time until fat line 
 * no longer contains all passed points. Then lock *a point* and discard 
 * those before it. I tried locking the most out-of-line point, but that
 * didn't work well for double-back paths so I switched to locking the
 * maximum triangle distance instead.
 */
SVGPolylineElement.prototype._simplify = function() {
    let minlen = (this.style.strokeWidth || this.getAttribute('stroke-width') || getComputedStyle(this).strokeWidth.replace(/\D/g, '')) / 8

    // possibly round up to 2*devicePixelRatio/zoom
    
    let l = this.pts[this.locked-1];
    for(let i=this.locked+1; i<this.pts.length; i+=1) {
        let p = this.pts[i]
        let dmes = new PrecomputePdist(l, p)
        let use = false, mi = -1, md = -1
        for(let j=this.locked; j<i; j+=1) {
            let d = dmes.d(this.pts[j])
            if (d > minlen) use = true;
            let d1 = Math.hypot(l.x-this.pts[j].x, l.y-this.pts[j].y)
            let d2 = Math.hypot(p.x-this.pts[j].x, p.y-this.pts[j].y)
            if (d1 > minlen && d2 > minlen && d > md) { mi = j; md = d; }
        }
        if (use && mi >= 0) {
            //console.log('b4', JSON.stringify(this.pts), this.locked)
            this._lock(mi)
            //console.log('now', JSON.stringify(this.pts), this.locked)
            i = this.locked-1; // restart
            l = this.pts[this.locked-1];
        }
    }
}

/**
 * Private helper method to aid in simplifying; 
 * also calls this.notify(id, index, pt) if the notify callback is defined.
 */
SVGPolylineElement.prototype._lock = function(i) {
    if (i < this.locked) return
    if (!this.pts) this.pts = []
    this.pts.splice(this.locked, i-this.locked)
    this.locked += 1
    this._refresh()
    if (this.notify) this.notify(this.id, this.locked-1, this.pts[this.locked-1])
}

/** Private helper method to move this.pts into SVG's points attribute */
SVGPolylineElement.prototype._refresh = function() {
    if (!this.pts) this.pts = []
    let payload = this.pts.map(p=>[p.x,p.y]).join(' ')
    if (this.pts && this.pts.length == 1) {
        this.setAttribute('points', payload + ' ' + payload)
    } else {
        this.setAttribute('points', payload)
    }
    if (this.label)
        this.label.lastChild.data = Math.round(this.length())
}

/**
 * Public method to be called upon server notification of a lock event.
 * Call as pl.lock(index, point)
 */
SVGPolylineElement.prototype.lock = function(i,p) {
    if (!this.pts) this.pts = []
    if (this.locked == i) {
        this.locked += 1
        this.pts[i] = p;
        this._refresh()
    } else if (this.locked > i) {
        if (this.pts[i] != p) {
            this.pts[i] = p;
            this._refresh()
        }
    } else {
        throw Error(`Cannot lock ${i} when only ${this.locked} are locked now`)
    }
}


/** UI method to conclude all drags, simplifying the rest of the path */
SVGPolylineElement.prototype.endExtend = function() {
    if (!this.pts || this.locked == this.pts.length) return

    let mi = this._penult()
    if (mi !== false) this._lock(mi)

    this._lock(this.pts.length-1)

    this._refresh()
}
/** private helper to find the point other than the last that would be kept */
SVGPolylineElement.prototype._penult = function() {
    if (this.locked < this.pts.length-1) {
        let l = this.pts[this.locked-1]
        let mi = -1, md = 0
        for(let i=this.locked; i<this.pts.length; i+=1) {
            let d = Math.hypot(l.x-this.pts[i].x, l.y-this.pts[i].y)
            if (d > md) {
                mi = i;
                md = d;
            }
        }
        return mi >= 0 ? mi : false;
    } else return false
}
/** length of entire path, as it would appear if endExtend were called */
SVGPolylineElement.prototype.length = function() {
    if (this.pts.length == 0) return false
    let ans = 0;
    
    // include locked pts
    let p0 = this.pts[0];
    let p = null
    for(let i=1; i<this.locked; i+=1) {
        p = this.pts[i]
        ans += Math.hypot(p.x-p0.x,p.y-p0.y);
        p0 = p;
    }
    // and what would be finished if finished now
    if (this.locked < this.pts.length) {
        if ((pi = this._penult()) != false) {
            p = this.pts[pi]
            ans += Math.hypot(p.x-p0.x,p.y-p0.y);
            p0 = p;
        }
        p = this.pts[this.pts.length-1]
        ans += Math.hypot(p.x-p0.x,p.y-p0.y);
        p0 = p;
    }

    return ans;
}
/**
 * Returns false if dist < 0 or > path length
 * Returns index if dist hits a point directly
 * Returns point otherwise (interplated between i-1 and i)
 */
SVGPolylineElement.prototype.pointOnPath = function(dist) {
    if (this.pts.length == 0 || dist < 0) return false
    if (dist == 0) return 0
    
    let p0 = this.pts[0];
    for(let i=1; i<this.pts.length; i+=1) {
        if (dist < 1e-3) return i-1
        let p = this.pts[i]
        let arc = Math.hypot(p.x-p0.x,p.y-p0.y);
        if (arc < dist + 1e-3) { dist -= arc; p0=p; continue; }
        let t = dist/arc, t0 = 1-t
        return {x:p0.x*t0 + p.x*t, y:p0.y*t0 + p.y*t, i:i} 
    }
    if (dist < 1e-3) return this.pts.length-1
    return false
}
/** Adjusts path to have no more than a given length */
SVGPolylineElement.prototype.truncate = function(len) {
    let clip = this.pointOnPath(len)
    if (clip === false || clip == this.pts.length-1) return false
    if ('number' == typeof clip) {
        this.pts.splice(clip+1)
        this.locked = this.pts.length
    } else {
        this.pts[clip.i] = clip
        this.pts.splice(clip.i+1)
        this.locked = this.pts.length
    }
    this._refresh()
    if (this.ownCr) this.ownCr.set({pos:this.end})
    return true
}



/**
 * A stroke is an extendable, length-measured, visual SVG path.
 * Coordinates are stored in game feet, not SVG pixels
 * 
 * attrs may include
 * - color (any CSS color, default 'gray')
 * - opacity (0..1, default 1)
 * - measure (boolean, default true)
 * - width (line width in feet, default 1)
 * - minlen (number in feet between vertices, default = width)
 * - owner (token object to be informed of truncation, default null)
 */
function newStroke(within, id, attrs) {
    let ans = createSVG(within, 'polyline', attrs)
    ans.id = id
    ans.style.fill = 'none'
    ans.style.strokeLinejoin = 'round'
    ans.style.strokeLinecap = 'round'
    return ans
}



//////////////////////////////////////////////////////////////////////
// Section 3: token datatype and support functions

window.textLength = (function() {
    let canvas = document.createElement('canvas')
    let context = canvas.getContext('2d')
    context.font = '1px sans-serif'
    return t => context.measureText(t).width
})()

/**
 * A moveable circular token, typically used for a creature.
 * Coordinates are stored in game feet, not SVG pixels
 * 
 * attrs may include
 * - color (any CSS color, default 'gray')
 * - width (token diameter in feet, default 5)
 * - name (string)
 * - image (url, defaults to text showing name)
 */
function Creature(within, x, y, attrs) {
    this.x = x
    this.y = y

    if (!attrs.name) attrs.name = 'creature'
    this.id = attrs.id || attrs.name +'-'+ c.querySelectorAll('*[id|="'+attrs.name+'"]').length
    
    this.trail = null // created upon move, removed afterward
    
    this.token = createSVG(within, 'circle', {
        id: this.id,
        cx: this.x, cy: this.y,
        r: 2.5,
        'stroke-width': 1/4,
        fill: 'url(#bg-'+this.id+')', // FIX ME: escape or replace
    })
    this.token.ownCr = this
    this.title = createSVG(this.token, 'title', {});
    this.title.appendChild(document.createTextNode(''));

    
    this.bg = createSVG('defs', 'pattern', {
        id: 'bg-'+this.id, // FIX ME: escape or replace
        patternUnits: "objectBoundingBox",
        width: 1, height: 1,
        viewBox: '-1 -1 2 2',
    })
    // each bg is two components: a white fill and an image or text
    createSVG(this.bg, 'rect', {x: -1, y: -1, width: 2, height: 2, fill: 'white'})
    createSVG(this.bg, 'text', {
        x: 0, y: .5/3, 
        'text-anchor':'middle', 'font-family': 'sans-serif'
    })
    this.bg.lastChild.appendChild(document.createTextNode(''))

    
    let def = 
        {color:'gray'
        ,name:'creature'
        ,width:5
        ,image:null
        }
    this.set({...def, ...attrs})
}

/**
 * Can change creation-time attributes dynamically;
 * see constructor for keys that can be put in attrs
 */
Creature.prototype.set = function(attrs) {
    if ('pos' in attrs) {
        this.x = attrs.pos.x;
        this.y = attrs.pos.y;
        this.token.cx.baseVal.value = this.x
        this.token.cy.baseVal.value = this.y
        if (this.trail && this.trail.length() <= 0) {
            this.trail.remove();
            this.trail = null;
        }
    }
    if ('name' in attrs) {
        this.name = attrs.name
        this.title.firstChild.data = attrs.name
        if (this.bg.lastChild.tagName == 'text') {
            let fs = 1.8/textLength(this.name);
            this.bg.lastChild.firstChild.data = this.name
            this.bg.lastChild.setAttribute('y', fs/3)
            this.bg.lastChild.setAttribute('font-size', fs)
        }
    }
    if ('color' in attrs) {
        this.token.style.stroke = attrs.color
        if (this.trail) this.trail.style.stroke = attrs.color
    }
    if ('width' in attrs) {
        this.token.r.baseVal.value = attrs.width/2;
        if (this.trail) this.trail.style.strokeWidth = attrs.width
    }
    if ('image' in attrs) { // future: add zoom region
        if (this.bg.lastChild.tagName == 'image') {
            if (attrs.image) 
                this.bg.lastChild.href.baseVal = attrs.image
            else {
                this.bg.lastChild.remove()
                let fs = 1.8/textLength(this.name);
                createSVG(this.bg, 'text', {
                    x: 0, y: fs/3,
                    'font-size': fs,
                    'text-anchor': "middle",
                    'font-family': 'sans-serif'
                }).appendChild(document.createTextNode(this.name));
                
            }
        } else {
            if (attrs.image) {
                this.bg.lastChild.remove()
                createSVG(this.bg, 'image', {
                    href: attrs.image,
                    preserveAspectRatio: "xMidYMin slice",
                    x: -1, y: -1, width: 2, height: 2,
                })
            } else {
                let fs = 1.8/textLength(this.name);
                this.bg.lastChild.firstChild.data = this.name
                this.bg.lastChild.setAttribute('y', fs/3)
                this.bg.lastChild.setAttribute('font-size', fs)
            }
        }
        
    }
}

Creature.prototype.recreateArgs = function() {
    return [this.x, this.y, {
        'name':this.name,
        'color':this.token.style.stroke,
        'width':this.token.r.baseVal.value*2,
        'image':
            ( this.bg.lastChild.tagName == 'image' 
            ? this.bg.lastChild.href.baseVal.value
            : false
            )
    }]
}

Creature.prototype.ensureTrail = function() {
    if (!this.trail) {
        this.trail = newStroke('#trails', `trail-${this.id}`, {
            'stroke':this.token.style.stroke,
            'opacity': 0.25,
            'stroke-width': this.token.r.baseVal.value*2,
        })
        this.trail.ownCr = this
        this.trail.pts = Array()
        this.trail.pts.push({x:this.x, y:this.y})
        this.trail.locked = 1
    }
}

Creature.prototype.moveTo = function(x,y) {
    if (x == this.x && y == this.y) return;
    this.ensureTrail()
    this.trail.addLabel()
    this.trail.extend({x:x, y:y})
    this.set({pos:this.trail.end})
}

Creature.prototype.lockAt = function(i,p) {
    if (p.x == this.x && p.y == this.y) return;
    this.ensureTrail()
    this.trail.addLabel()
    this.trail.lock(i,p)
    this.set({pos:this.trail.end})
}

Creature.prototype.addClass = function(s) {
    this.token.classList.add(s)
    this.bg.classList.add(s)
}
Creature.prototype.removeClass = function(s) {
    this.token.classList.remove(s)
    this.bg.classList.remove(s)
}
Creature.prototype.toggleClass = function(s) {
    this.token.classList.toggle(s)
    this.bg.classList.toggle(s)
}







