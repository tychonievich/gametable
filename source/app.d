import vibe.core.core;
import vibe.core.file;
import vibe.core.log;
import vibe.core.sync;
import vibe.data.json;
import vibe.core.path;
import vibe.http.fileserver;
import vibe.http.router;
import vibe.http.server;
import vibe.http.websockets;
import vibe.utils.string;
import vibe.web.web;
import std.conv : text, to;
import std.string;
import vibe.data.json;
import std.conv : text, to;
import std.regex : ctRegex, matchFirst, replaceAll;

final class WebChat {
	void getWS(string room, string name, scope WebSocket socket) {
		auto r = getOrCreateRoom(room);
		socket.send(Json([
			"func":Json("session"),
			"args":Json([Json(r.users++)])
		]).toString);
		auto sender = runTask({ // server-to-client
			auto next = r.startat;
			bool welcomed = false;
			while(socket.connected) {
				while(next < r.messages.length) {
					auto m = r.messages[next++];
					if (name == `GM` || `hide` !in m || !m[`hide`])
						socket.send(m.toString);
				}
				if (!welcomed) {
					socket.send(`{"func":"welcome","args":[]}`);
					welcomed = true;
				}
				r.waitForMessage(next);
			}
		});
		while (socket.waitForData) { // client-to-server
			auto message = socket.receiveText;
			if (message == `clearall`) { if (name == `GM`) r.newScene; }
			else if (message == `nextscene`) { if (name == `GM`) r.changeScene(false); }
			else if (message == `prevscene`) { if (name == `GM`) r.changeScene(true); }
			else if (message.length) r.addMessage(name, message, this);
		}
		sender.join;
	}

	private Room[string] m_rooms;
	private Room getOrCreateRoom(string id) {
		if (auto pr = id in m_rooms) return *pr;
		// race condition here not a problem for fibers, but would be for threads
		return m_rooms[id] = new Room(id);
	}

	private Token[string] m_tokens;
	private Token getOrCreateToken(string name) {
		if (auto pr = name in m_tokens) return *pr;
		return m_tokens[name] = new Token(name);
	}
}

final class Room {
	public int users;
	this(string id) {
		path = (`rooms/`~id~`.log`);
		import std.string : lineSplitter;
		if (path.existsFile)
			foreach(line; path.readFileUTF8.lineSplitter)
				messages ~= line.parseJson;
		if (!mutex) {
			mutex = new TaskMutex;
			monitor = createManualEvent;
		}
		startat = 0;
	}
	void newScene() {
		if (messages.length <= startat) return;
		// atomically do the following:
		synchronized(mutex) {
			// move room.log to room.log.###
			// linear search not optimal; double then binary better
			int end = 0; while(text(path,'.',end).existsFile) end += 1;
			path.moveFile(text(path,'.',end));
			logInfo("created %s.%d", path, end);
		
			// put unlogged clear-all in messages
			messages ~= Json(["func":Json("newscene"),"args":Json.emptyArray]);
			monitor.emit;
			// set the startat for new connections
			startat = messages.length;
		}
	}
	void changeScene(bool backward) {
		synchronized(mutex) {
			int prev = -1; while(text(path,'.',prev+1).existsFile) prev += 1;
			int next = 0; while(text(path,next-1).existsFile) next -= 1;
			// if have r.log, r.log.0, r.log.1, r.log-1, r.log-2
			// then prev = 1, next = -2
			// back moves log to -3 and 1 to log
			// fore moves log to 2 and -2 to log
			if (backward) {
				if (prev <= -1) return;
				logInfo("saving %s%d; restoring from %s.%d", path, next-1,path,prev);
				if (path.existsFile) path.moveFile(text(path,next-1));
				text(path,'.',prev).moveFile(path);
			} else {
				if (next >= 0) return;
				logInfo("saving %s.%d; restoring %s%d", path, prev+1,path,next);
				if (path.existsFile) path.moveFile(text(path,'.',prev+1));
				text(path,next).moveFile(path);
			}
			messages ~= Json(["func":Json("newscene"),"args":Json.emptyArray]);
			startat = messages.length;
			foreach(line; path.readFileUTF8.lineSplitter)
				messages ~= line.parseJson;
			monitor.emit;
		}
	}
	void addMessage(string from, string msg, WebChat app) {
		import std.random : uniform;
		enum r = ctRegex!`^d[1-9][0-9]*$`;
		if (msg.matchFirst(r))
			msg = text(`{"func":"roll","args":["`,msg,`",`,uniform!"[]"(1,to!int(msg[1..$]))-(msg==`d10`?1:0),`]}`);
		
		auto ans = msg.parseJson;
		ans[`user`] = from;
		if (ans[`func`].get!string.matchFirst(ctRegex!`[tT]oken`)) {
		//if (ans[`func`].get!string == `newtoken`) {
			auto tok = app.getOrCreateToken(ans[`args`][$-1][`name`].get!string);
			tok.setAttr(ans[`args`][$-1]);
			auto got = tok.data.clone;
            foreach(string k,v; ans[`args`][$-1]) if (k !in got) got[k] = v;
            ans[`args`][$-1] = got;
		}
		synchronized(mutex) {
			messages ~= ans;
			this.path.appendToFile(ans.toString~'\n');
		}
		monitor.emit;
	}
	void waitForMessage(size_t next) {
		while(messages.length <= next) monitor.wait;
	}
	string path;
	Json[] messages;
	size_t startat;
	LocalManualEvent monitor;
	TaskMutex mutex;
}

final class Token {
	Json data;
	NativePath path;
	this(string name) {
		path = NativePath.fromString(`tokens/`
			~ name
			.replaceAll(ctRegex!`\p{C}|/`, ``)
			.replaceAll(ctRegex!`-\d+$`, ``)
			~ `.json`);
		if (path.existsFile) data = path.readFileUTF8.parseJsonString;
		else {
			data = Json([`name`:Json(name)]);
			path.writeFileUTF8(data.toPrettyString);
		}
	}
	void setAttr(Json attr) {
		bool change = false;
		foreach(k,v; attr.get!(Json[string])) {
			if (k != `num` && k != `pos` && (k !in data || data[k] != v)) {
				change = true;
				data[k] = v;
			}
		}
		if (change) path.writeFileUTF8(data.toPrettyString);
	}
}

void main() {
	auto router = new URLRouter;
    router.registerWebInterface(new WebChat);
    router.get("/", serveStaticFile("public/room.html"));
    router.get("*", serveStaticFiles("public/"));
    
    auto conf = "serverconf.json".readFileUTF8.parseJsonString;

	auto settings = new HTTPServerSettings;
	settings.port = conf[`port`].get!ushort;
	//settings.bindAddresses = conf[`host`].deserializeJson!(string[]); // enable to listen on only some interfaces
	listenHTTP(settings, router);

	runApplication();
}

