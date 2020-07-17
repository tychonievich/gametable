function wsConnect(onopen) {
    if (window.sock && window.sock.readyState < 2) return
    let url = 'ws://' + location.host + '/ws' + location.search
    console.log('connecting to', url)
    window.sock = new WebSocket(url);
    window.sock.onopen = evt => console.log('connected')
    window.sock.onmessage = msg => {
        let obj = JSON.parse(msg.data)
        //console.log('got',msg.data)
        addUser(obj.user)
        if (obj.func in handlers) handlers[obj.func](obj.user, ...obj.args)
        else console.warn('unhandled function', obj.func, obj.args)
    }
    window.sock.onclose = () => {
        alert('connection to server lost; reload page to reconnect')
        console.error("websocket connection lost")
    }
}

// signals look like {"func":"...", "user":"...", "args":[]}

// CSS query selectors need special escaping to work on non-identifier IDs
function cssIdEscape(id) {
    if (!id) return
    return id.replace(/[-!"#$%&\'()*+,./;<=>?@\[\\\]^`{}|~]/g, '\\$&')
        .replace(/[ ]/g,'\\ ')
        .replace(/[\n\r\t\f\v]/g,(x => '\\'+x.codePointAt(0).toString(16)+' '))
        .replace(/^[0-9]/,'\\3$& ')
        .replace(/:/g, '\\3A ')
}


var diceUndos = {}
var strokeUndos = {}
var moveUndos = {}
var turnmode = false
var showIndicator = false;

var sid   = null; // session ID
var idcnt = 0; // id count for this session
function nextID() { return window.sid + '-' + (++idcnt); }

function addUser(user) {
    if (!user) return
    if (!document.getElementById(user)) {
        let tray = document.createElement('div')
        document.getElementById('dice').appendChild(tray)
        tray.id = user
    }
    if (!diceUndos[user]) diceUndos[user] = {un:[],re:[]}
    // add stroke undos
    // add move undos
}
function pushDice(user) {
    where = document.getElementById(user)
    if (where.childElementCount == 0) return false
    let e = document.createDocumentFragment()
    while(where.childElementCount) {
        e.appendChild(where.firstElementChild)
        e.lastChild.classList.add('old')
    }
    if (!e.querySelector('br:last-child'))
        e.appendChild(document.createElement('br'))
    diceUndos[user].un.push(e)
    return true
}

var handlers = {
    newscene: sender => {
        // fired when GM clears the scene
        diceUndos = {}
        document.querySelectorAll('div#dice > div').forEach(x => x.remove())
        
        let hastoken = false
        c.querySelectorAll('g > *').forEach(x => {
            let cr = x.ownCr;
            if (cr && x.id == user+'-0') {// my token; replicate it
                postAction('newtoken', [cr.x, cr.y, {name:user}])
                hastoken = true
            } else if (cr && cr.pinGM && user == 'GM') {
                let num = Number(cr.id.replace(/.*-/g, ''))
                postAction('newtoken', [cr.x, cr.y, {pinGM:true}, {name:cr.name, num:num}])
                hastoken = true
            }
            if (cr) cr.remove()
            else x.remove()
        })
        c.querySelectorAll('defs pattern').forEach(x => x.remove())
        if (!hastoken) {
            if (user == 'GM') postAction('ping',[]) 
            else postAction('newtoken', [randomX(), randomY(), {name:user}])
        }
    },
    welcome: sender => {
        // fired after all other messages consumed; use to do user join actions
        if (user == 'GM') {
            if (!document.getElementById(user))
                postAction('ping', [])
        } else {
            if (!document.getElementById(user+'-0'))
                postAction('newtoken', [randomX(), randomY(), {name:user}])
        }
    },
    session: (sender,num) => {
        // fired as soon as a connection is made to number this connection
        window.sid = 's'+num
    },
    ping: sender => {}, // just to let people know a user exists
    
    roll: (sender, sides, num) => {
        let where = document.getElementById(sender)
        where.appendChild(document.createElement('span'))
        where.lastChild.classList.add(sides)
        where.lastChild.classList.add('die')
        where.lastChild.title = sides
        where.lastChild.appendChild(document.createTextNode(num))
        if (sides == 'd20') {
            if (num == 1) where.lastChild.classList.add('fumble')
            if (num == 20) where.lastChild.classList.add('crit')
        }
    },
    traybr: sender => {
        let where = document.getElementById(sender)
        if (!where.querySelector('br:last-child'))
            where.appendChild(document.createElement('BR'))
        where.lastElementChild.scrollIntoView()
    },
    trayclear: pushDice,
    trayolder: sender => {
        let where = document.getElementById(sender)
        if (diceUndos[sender].un.length > 0) {
            if (pushDice(sender)) diceUndos[sender].re.push(diceUndos[sender].un.pop())
            where.appendChild(diceUndos[sender].un.pop())
        }
        if (where.lastElementChild) where.lastElementChild.scrollIntoView()
    },
    traynewer: sender => {
        let where = document.getElementById(sender)
        if (diceUndos[sender].re.length > 0) {
            pushDice(sender)
            where.appendChild(diceUndos[sender].re.pop())
        }
        if (where.lastElementChild) where.lastElementChild.scrollIntoView()
    },
    traytotal: (sender, extra) => {
        let where = document.getElementById(sender)
        if (!where.lastElementChild) return
        if (where.querySelector('span.total + br:last-child')) return
        let sum = 0
        let oldsum = 0
        where.querySelectorAll('.die, br').forEach(x => {
            if (x.tagName == 'BR') { 
                if (sum) oldsum = sum
                sum = 0
            } else {
                sum += Number(x.textContent)
            }
        })
        if (!sum) sum = oldsum
        if (sum) {
            while (where.lastElementChild.tagName == 'BR')
                where.removeChild(where.lastElementChild)
            where.appendChild(document.createElement('span'))
            where.lastChild.classList.add('total')
            where.lastChild.appendChild(document.createTextNode(
                (extra? ' + '+extra : '') +
                ' = ' + 
                (extra ? eval(extra+'+'+sum) : sum)
            ))
            where.appendChild(document.createElement('br'))
        }
        where.lastElementChild.scrollIntoView()
    },
    
    newtoken: (sender,x,y,token,self) => {
        //console.log('new token', token)
        if (self) token = {...self, ...token}
        let num = token.num || 0
        let old = c.getElementById(token.name+'-'+num)
        if (!old) {
            let def = {
                width: 5,
                color: 'gray',
                id: token.name.replace(/[^a-zA-Z0-9]+/g, '_')+'-'+num
            }
            let critter = new Creature('#tokens', x, y, {...def, ...token})
            //console.log('creature created', critter.id)
        } else {
            old.ownCr.set({pos:{x:x,y:y}})
            old.ownCr.set(token)
        }
        resortTokens()
    },
    edittoken: (sender, attr) => {
        c.querySelectorAll('circle[id|='+cssIdEscape(attr.name)+']').forEach(x => {
            //console.log('set',x.ownCr, attr)
            x.ownCr.set(attr)
        })
        resortTokens()
    },
    editone: (sender, id, attr) => {
        c.getElementById(id).ownCr.set(attr)
        resortTokens()
    },
    moveone: (sender, id, pos) => {
        c.getElementById(id).ownCr.set({pos:pos})
    },
    delone: (sender, id) => {
        c.getElementById(id).ownCr.remove()
    },
    toggleclass: (sender, id, cls) => {
        c.getElementById(id).ownCr.toggleClass(cls)
    },
    
    bgimage: (sender, url, width, center) => {
        createSVG('#background', 'image', {
            x:center.x-width/2, y:center.y-width/2,
            width:width, height:width,
            href:url,
            preserveAspectRatio:'xMaxYMax',
        })
    },
    '.indicator': (sender, center) => {
        let old = c.getElementById('mouse-'+sender)
        if (!center) {
            if (old) old.remove()
        } else {
            if (!old) createSVG('#overlay', 'text', {
                x: center.x,
                y: center.y,
                id: 'mouse-'+sender,
                'text-anchor':'middle',
            })
            else {
                old.setAttribute('x', center.x);
                old.setAttribute('y', center.y);
            }
        }
        
    },
    
    newstroke: (sender, id, within, attrs) => {
        if (!c.getElementById(id)) {
            attrs.id = id
            newStroke(within, id, attrs)
            
            // if restart server, could have duplicate ids; fix
            if (id.startsWith(window.sid+'-')) {
                let num = Number(id.split('-')[1])
                window.idcnt = Math.max(window.idcnt, num+1)
            }
        }
    },
    stroke: (sender, id, idx, pt) => {
        //console.log('stroke',id,idx,pt)
        if (id.startsWith('trail-')) {
            let s = c.getElementById(id.substring(6)).ownCr
            s.lockAt(idx, pt)
        } else {
            let s = c.getElementById(id)
            s.lock(idx, pt)
        }
    },
    delstroke: (sender, id) => {
        let s = c.getElementById(id)
        if (s.ownCr) {
            s.truncate(0)
            if (s.label) s.label.remove()
            delete s.ownCr.trail
        }
        s.remove()
    },
    truncate: (sender, id, len) => {
        //console.log(id)
        let s = c.getElementById(id)
        s.truncate(len)
        if (s.ownCr && len <= 0) {
            //console.log('zero-length trail')
            if (s.label) s.label.remove()
            delete s.ownCr.trail
            s.remove()
        }
    },

    nextturn: sender => {
        // commit all movement
        c.querySelectorAll('polyline[id|=trail]').forEach(x => {
            delete x.ownCr.trail
            if (x.label) x.label.remove()
            x.remove()
        })
        // clear all dice trays
        document.querySelectorAll('#dice > div').forEach(x => pushDice(x.id))
    },
    turnmode: (sender, on) => {
        handlers.nextturn()
        window.turnmode = on
    },
}

function postAction(func) {
    if (arguments.length > 1) {
        if (arguments.length == 2 && Array.isArray(arguments[1]))
            func = {func:func, args:arguments[1]}
        else 
            func = {func:func, args:Array.prototype.slice.call(arguments,1)}
    }
    if ('object' == typeof func) func = JSON.stringify(func)
//console.log('sending', func)
    if (!window.sock || window.sock.readyState > 1) wsConnect()
    if (!window.sock || window.sock.readyState > 1)
        throw Error('unable to open WebSocket')
    window.sock.send(func)
}


var cursorMode = 'select' // also 'draw', 'token'
var pen = {w:1, color:'black'}
var visible = true
var clicked = null
var selected = null
var lineMode = false

function drawMode() {
    if (cursorMode == 'select') {
        lifthandler()
        if (selected) selected.removeClass('selected')
        resortTokens()
    }
    if (cursorMode != 'draw') {
        cursorMode = 'draw'
        selected = false
        let brush = c.getElementById('brush')
        brush.r.baseVal.value = pen.w/2
        brush.style.stroke = pen.color;
        brush.style.display = ''
    }
}
function selectMode() {
    if (cursorMode != 'select') {
        lifthandler()
        cursorMode = 'select'
        let brush = c.getElementById('brush')
        brush.style.display = 'none'
        selected = false
    }
}
function tokenMode() {
    if (cursorMode != 'token') lifthandler()
    if (cursorMode == 'select' && selected) selected.removeClass('selected')
    resortTokens()
    cursorMode = 'token'

    selected = {name:window.prompt('Token name:')}
    let num=0
    c.querySelectorAll('circle[id|='+cssIdEscape(selected.name)+']').forEach(x => num=Math.max(num,x.id.replace(/.*-/,'')))
    selected.num = num

    let brush = c.getElementById('brush')
    brush.r.baseVal.value = 2.5
    brush.style.stroke = 'gray'
    brush.style.display = ''
}

function isValidColor(c) {
  	var ele = document.createElement("div");
	ele.style.color = c;
	return !!ele.style.color.replace(/\s+/,'')
}

function circCmp(a,b) {
    if (a.classList.contains('down') != b.classList.contains('down'))
        return a.classList.contains('down') ? -1 : 1
    if (a.classList.contains('flying') != b.classList.contains('flying'))
        return a.classList.contains('flying') ? 1 : -1
    if (a.classList.contains('prone') != b.classList.contains('prone'))
        return a.classList.contains('prone') ? -1 : 1
    if (a.classList.contains('selected') != b.classList.contains('selected'))
        return a.classList.contains('selected') ? 1 : -1
    return -(a.r.baseVal.value - b.r.baseVal.value)
}
function resortTokens() {
    let toks = c.getElementById('tokens')
    let s = Array.from(toks.children)
    s.sort(circCmp)
    s.forEach(x => toks.appendChild(x))
}

function keyhandler(evt) {
    if (document.querySelector('dialog')) return

    if (evt.isComposing || evt.repeat) return;
    if (evt.key == 'Escape') { window.mode = 'select'; return; }
    let k = evt.key
    if (evt.altKey) k = 'M+'+k
    if (evt.ctrlKey || evt.metaKey) k = 'C+'+k

    switch(k) {
        case '0': postAction('d10'); break;
        case '1': postAction('d12'); break;
        case '2': postAction('d20'); break;
        case '4': case '6': case '8': postAction('d'+evt.key); break;
        case '=': case '+': postAction('traytotal',[]); break;
        // note: could change + to add with a popup and single-art traytotal
        case 'Enter': postAction('traybr',[]); break;
        case 'Delete': case 'Backspace': 
            if (user == 'GM' && evt.shiftKey) postAction('clearall');
            else postAction('trayclear',[]);
            break;
        case 'PageUp': 
            if (user == 'GM' && evt.shiftKey) postAction('prevscene');
            else postAction('trayolder',[]);
            break;
        case 'PageDown': 
            if (user == 'GM' && evt.shiftKey) postAction('nextscene');
            else postAction('traynewer',[]); 
            break;
        
        case 'z': zoom(zoomer*Math.cbrt(3)); break
        case 'Z': zoom(zoomer/Math.cbrt(3)); break
        case 's': selectMode(); break
        case 'b': visible = true; drawMode(); break
        case 'p': visible = false; drawMode(); break
        
        case 'c': case 'C': // c = all, C = one
        let color = window.prompt('Enter new color')
        if (color && isValidColor(color)) {
            if (cursorMode == 'select' && selected) {
                if (k == 'C')
                    postAction('editone', [selected.id, {color:color}])
                else
                    postAction('edittoken', [{name:selected.name, color:color}])
            } else if (cursorMode == 'draw') {
                pen.color = color
                c.getElementById('brush').style.stroke = pen.color

            } else if (cursorMode == 'token') {
                selected.color = color
                c.getElementById('brush').style.stroke = pen.color
            }
        }
        break
        case 'w': case 'W': // w = all, W = one
        if (cursorMode == 'select' && selected) {
            let size = window.prompt('Size of token:\nTiny/Small/Medium/Large/Huge/Gargantuan\nor diameter, in feet')
            if (size == null) break
            if (size.length == 0) size = 'Medium'
            if (Number.isNaN(Number(size))) size = {'t':2,'s':3.5,'m':5,'l':10,'h':15,'g':20}[size.toLowerCase()[0]]
            size = Number(size) || 5
            if (k == 'W')
                postAction('editone', [selected.id, {width:size}])
            else
                postAction('edittoken', [{name:selected.name, width:size}])
        } else if (cursorMode == 'draw') {
            pen.w = window.prompt('Width of marker (in feet)') || 1
            c.getElementById('brush').r.baseVal.value = pen.w/2
        } else if (cursorMode == 'token') {
            let size = window.prompt('Size of token:\nTiny/Small/Medium/Large/Huge/Gargantuan\nor diameter, in feet')
            if (size == null) break
            if (size.length == 0) size = 'Medium'
            if (Number.isNaN(Number(size))) size = {'t':2,'s':3.5,'m':5,'l':10,'h':15,'g':20}[size.toLowerCase()[0]]
            size = Number(size) || 5
            selected.width = size
            c.getElementById('brush').r.baseVal.value = size/2
        }
        break
        case 'i': case 'I': // i = all, I = one
        if (cursorMode == 'select' && selected) {
            let pic = window.prompt('URL of new image', selected.get('image'))
            if (!pic) pic = false
            if (k == 'I')
                postAction('editone', [selected.id, {image:pic}])
            else
                postAction('edittoken', [{name:selected.name, image:pic}])
        } else if (cursorMode == 'token') {
            let pic = window.prompt('URL of new image')
            if (!pic) pic = false
            selected.image = pic
        }
        break
        
        case 'r': 
        zoom(10)
        c.viewBox.baseVal.x = - c.viewBox.baseVal.width/2
        c.viewBox.baseVal.y = - c.viewBox.baseVal.height/2
        break

        case 't': tokenMode(); break
        
        case 'l': case 'L':
        if (cursorMode == 'draw' && selected)
            console.info('cannot change line mode while drawing')
        else
            lineMode = k == 'l'
        break
        
        case 'x': 
        if (cursorMode == 'select' && selected)
            if (window.confirm(`Really delete ${selected.name}?\nThis cannot be undone!`))
                postAction('delone', [selected.id])
        break
        
        case 'u': 
        if (user == 'GM') postAction('turnmode', [!window.turnmode])
        break
        case 'n': if (user == 'GM') postAction('nextturn', []); break

        case 'f':
        if (cursorMode == 'select' && selected)
            postAction('toggleclass', [selected.id, 'flying'])
        break
        case 'o':
        if (cursorMode == 'select' && selected)
            postAction('toggleclass', [selected.id, 'prone'])
        break
        case 'd':
        if (cursorMode == 'select' && selected)
            postAction('toggleclass', [selected.id, 'down'])
        break

        case 'a':
        if (cursorMode == 'select' && selected) {
            statusDialog(selected)
        }
        break

        case 'v': console.warn('visible change not implemented'); break
        
        // consider adding point-to mode
        // consider adding undo-redo
        // add token sort
        // fly normal prone down, small->big
        // consider adding tray sort

        case 'C+z': console.warn('undo not implemented'); break;
        case 'C+Z': case 'C+y': console.warn('redo not implemented'); break;

        case 'B':
        if (user == 'GM' && cursorMode == 'select' && !selected) {
            let pic = window.prompt('URL of background image')
            if (!pic) pic = false
            let width = window.prompt('with of image (in feet)')
            postAction('bgimage', [pic, width, window._lastMousePos])
        }
        break;

        



        default: return;
    }
    //evt.preventDefault()
}

function clickhandler(evt) {
    if (document.querySelector('dialog')) return
    //console.log(evt.target)
    if (user == 'GM' && evt.target.tagName == 'polyline' && evt.target && (evt.ctrlKey || evt.metaKey)) {
        // delete stroke action
        postAction('delstroke', [evt.target.id])
        evt.preventDefault()
        return
    } else if (evt.target.tagName == 'text' && evt.target.ownSt) {
        // truncate action
        let len = window.prompt("Limit to how many feet?")
        if (!len) return;
        len = Number(len);
        if (Number.isNaN(len)) return;
        
        //console.log('truncate', evt.target)
        
        postAction('truncate', [evt.target.ownSt.id, len])
        //console.log('truncate',evt.target.ownSt, len)
        evt.preventDefault()
        return
    }
    if (cursorMode == 'select') {
        if (evt.target.ownCr && evt.target.ownCr != selected) {
            if (selected) selected.removeClass('selected')
            selected = evt.target.ownCr; // select
            selected.addClass('selected')
            resortTokens()
        } else {
            clicked = getMousePos(evt) // pan or drag
            if (evt.target.ownCr) { // drag
                clicked.x -= selected.x;
                clicked.y -= selected.y ;
            } else {
                if (selected) selected.removeClass('selected')
                selected = null; // pan
                resortTokens()
            }
        }
    } else if (cursorMode == 'draw') { // drawing
        let here = getMousePos(evt);
        let attrs =  {
            stroke: pen.color,
            'stroke-width': pen.w,
        }
        let within = (visible ? '#background' : '#invisible')
        selected = newStroke(within, nextID(), attrs);
        if (!visible) selected.notify = false
        //console.log('creating', selected.id)
        postAction('newstroke', [selected.id, within, attrs])
        selected.extend(here)
        //console.log('click',here,selected);
    } else if (cursorMode == 'token') { // token placement
        let here = getMousePos(evt);
        selected.num += 1
        postAction('newtoken', [here.x, here.y, selected])
    }
}
function lifthandler(evt) {
     if (document.querySelector('dialog')) return

    if (cursorMode == 'select') {
        if (selected && selected.trail) {
            selected.trail.endExtend()
        }
        clicked = null
    } else if (cursorMode == 'draw') {
        if (selected) {
            //console.log('lift',selected);
            selected.endExtend()
            if (selected.label) {
                selected.label.remove()
                delete selected.label
            }
            // to do: undo.push(selected.path)
            //console.log(selected.parentElement.id)
            if (selected.parentElement.id == 'invisible')
                selected.remove()
            selected = null
        }
    }
}
function movehandler(evt) {
    if (document.querySelector('dialog')) return

    let here = getMousePos(evt);
    let brush = c.getElementById('brush')
    brush.cx.baseVal.value = here.x
    brush.cy.baseVal.value = here.y
    if (cursorMode == 'select') {
        if (selected && clicked) { // drag
            if (turnmode)
                selected.moveTo(
                    (here.x - clicked.x),
                    (here.y - clicked.y),
                )
            else
                postAction('moveone', [
                    selected.id,
                    {
                        x:(here.x - clicked.x),
                        y:(here.y - clicked.y),
                    }
                ])
        } else if (clicked) { // pan
            pan(here.x - clicked.x, here.y - clicked.y)
        }
    } else if (cursorMode == 'draw') { // drawing
        if (selected) {
            if (lineMode) {
                selected.addLabel()
                selected.pts.length = 2
                selected.pts[1] = here
                selected.locked = 1
                selected._lock(1)
            } else selected.extend(here)
        }
    }
}


SVGPolylineElement.prototype.notify = function(id, idx, pt) {
    postAction('stroke', [id, idx, pt])
}



function svgResize(ignoreEvents) {
    let rect = document.getElementById('board').getClientRects()[0]
    let w = rect.width/zoomer, h = rect.height/zoomer;
    let dw = w - c.viewBox.baseVal.width, dh = h - c.viewBox.baseVal.height
    
    c.viewBox.baseVal.x -= dw/2
    c.viewBox.baseVal.y -= dh/2
    c.viewBox.baseVal.width = w
    c.viewBox.baseVal.height = h
    
    let overlay = document.getElementById('overlay')
    let fs = getComputedStyle(overlay.parentElement).fontSize.split(/(\d+)/)
    overlay.style.fontSize = fs[0] + (fs[1]/zoomer) + fs[2]
}
function pan(dx,dy) {
    c.viewBox.baseVal.x -= dx
    c.viewBox.baseVal.y -= dy
}
function zoom(newzoom) {
    if (newzoom == zoomer) return
    window.zoomer = newzoom
    svgResize([])
}

function randomX(centering) {
    centering = centering || 0
    return ((1-centering)*Math.random() + centering*0.5) * c.viewBox.baseVal.width + c.viewBox.baseVal.x
}
function randomY(centering) {
    centering = centering || 0
    return ((1-centering)*Math.random() + centering*0.5) * c.viewBox.baseVal.height + c.viewBox.baseVal.y
}

function statusDialog(creature) {
    // <dialog> has spotty support, so uses polyfill
    let d = document.createElement('dialog')
    d.innerHTML = `Edit token status:
    <form method="dialog">
`+(user == 'GM' ? `<label><input type="checkbox" id="PinGM"/> PinGM</label><br/>` : '')+`
<label><input type="checkbox" id="status_blinded"/> Blinded</label><br/>
<label><input type="checkbox" id="status_charmed"/> Charmed</label><br/>
<label><input type="checkbox" id="status_deafened"/> Deafened</label><br/>
<label><input type="checkbox" id="status_exhaustion1"/> Exhaustion1</label><br/>
<label><input type="checkbox" id="status_exhaustion2"/> Exhaustion2</label><br/>
<label><input type="checkbox" id="status_exhaustion3"/> Exhaustion3</label><br/>
<label><input type="checkbox" id="status_exhaustion4"/> Exhaustion4</label><br/>
<label><input type="checkbox" id="status_exhaustion5"/> Exhaustion5</label><br/>
<label><input type="checkbox" id="status_frightened"/> Frightened</label><br/>
<label><input type="checkbox" id="status_grappled"/> Grappled</label><br/>
<label><input type="checkbox" id="status_incapacitated"/> Incapacitated</label><br/>
<label><input type="checkbox" id="status_invisible"/> Invisible</label><br/>
<label><input type="checkbox" id="status_paralyzed"/> Paralyzed</label><br/>
<label><input type="checkbox" id="status_petrified"/> Petrified</label><br/>
<label><input type="checkbox" id="status_poisoned"/> Poisoned</label><br/>
<label><input type="checkbox" id="status_prone"/> Prone</label><br/>
<label><input type="checkbox" id="status_restrained"/> Restrained</label><br/>
<label><input type="checkbox" id="status_stunned"/> Stunned</label><br/>
<label><input type="checkbox" id="status_unconscious"/> Unconscious</label><br/>
Other: <input type="text" id="status_other"/> <br/>
<input type="submit" id="status_submit" value="Done"/>
    </form>`
    document.body.appendChild(d);
    dialogPolyfill.registerDialog(d);
    // pre-fill known status
    for(let s of creature.token.classList) {
        if (s == 'selected') continue   
        let e = document.getElementById('status_'+s)
        if (e) e.checked = true
        else {
            e = document.getElementById('status_other')
            if (e.value.length > 0) e.value += ', '
            e.value += s
        }
    }
    if (user == 'GM' && creature.pinGM)
        document.getElementById('PinGM').checked = true

    // add submission event handler
    d.addEventListener('close', (evt)=>{
        let os = new Set(creature.token.classList)
        os.delete('selected')
        let ns = new Set(Array.from(d.querySelectorAll('input:checked')).map(x => x.id.substring(7)))
        ns.delete('')
        for(let e of os) if (!ns.has(e)) postAction('toggleclass', [creature.id, e])
        for(let e of ns) if (!os.has(e)) postAction('toggleclass', [creature.id, e])
        if (user == 'GM') creature.pinGM = document.getElementById('PinGM').checked
        d.remove()
    })
    
    d.showModal();
}


function loaded() {
    console.log('loaded')
    let param = new URLSearchParams(location.search)
    if (!param.has('room') || !param.has('name')) {
        document.head.innerHTML = ''
        document.title = 'Pick a game'
        document.body.innerHTML = `<h1>Whiteboard Gaming</h1>
        <p>Please pick your game:</p>
		<form>
			<p>
				<label for="room">Game:</label>
				<input id="id" type="text" name="room" autofocus/>
			</p>
			<p>
				<label for="name">Character name:</label>
				<input id="name" type="text" name="name"/>
			</p>
			<button type="submit">Enter</button>
		</form>`
        return
    }
    document.title = param.get('room')+' game table'
    window.user = param.get('name')
    window.room = param.get('room')

    wsConnect( () => postAction('ping',[]) )
    document.addEventListener('keydown', keyhandler)
    
    window.zoomer = 10
    window.c = document.getElementById('board')
    c.addEventListener('mousedown', clickhandler)
    c.addEventListener('mouseup', lifthandler)
    c.addEventListener('mouseleave', lifthandler)
    c.addEventListener('mousemove', movehandler)
    document.addEventListener('blur', lifthandler)
    
    // only want to observe the board, but observer doesn't seem to accept SVG
    // instead, observe its parent and sibling elements
    let obs = new ResizeObserver(svgResize)
    obs.observe(document.getElementById('help'))
    obs.observe(document.getElementById('play'))
    
    document.getElementById('help').innerHTML = `
<details>
<summary>Keys:   d<u>4</u> d<u>6</u> d<u>8</u> d1<u>0</u> d<u>1</u>2 d<u>2</u>0</summary>
<div><strong>Dice trays</strong>:   
    <span><u>Enter</u> new line</span>   
    <span><u>=</u> sums line</span>   
    <span><u>Del</u> clears</span>   
    <span><u>PgUp</u>/<u>PgDn</u> history</span>
</div>
<div><strong>Mouse mode</strong>:   
    <span><u>s</u>elect</span>   
    <span><u>b</u>ackground drawing</span>   
    <span><u>p</u>ersonal drawing</span>   
    <span>straight-<u>l</u>ine</span>/<span>drawn-<u>L</u>ine</span>
</div>
<div><strong>Actions</strong>:   
    <span>change <u>c</u>olor</span>   
    <span>add <u>t</u>oken</span>   
    <span><u>z</u>oom in/<u>Z</u>oom out</span>   
    <span><u>r</u>eset pan/zoom</span>   
    <span>toggle <u>i</u>dicator</span>
</div>
<div><strong>Selected token actions</strong>:   
    <span><u>c</u>olor</span>   
    <span><u>i</u>mage</span>   
    <span>token <u>w</u>idth</span>   
    <span><u>a</u>dd status</span>   
    <span><u>f</u>lying</span>   
    <span>pr<u>o</u>ne</span>   
    <span><u>d</u>ead</span><!--   
    <span><u>v</u>isible</span>-->
</div>`+(user!='GM'?'':`
<div><strong>GM Actions</strong>:   
    <span>t<u>u</u>rn-based movement</span>   
    <span><u>n</u>ext turn</span>      
    <span><u>x</u> remove token</span>      
    <span>Shift+tray = board</span>   
    <span><u>B</u>ackground image</span>   
</div>
`)+`
</details>`
}

