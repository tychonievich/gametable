The intent of this project is to replicate the tabletop gaming environment I used for collaborative storytelling and role-playing games to the degree such is possible online.

# Installing and running

1. create directories `rooms` and `tokens` that are server-writeable. Directory structure should look like
    
        gametable/
        ├── dub.json
        ├── LICENSE
        ├── public/
        │   ├── d10.svg
        │   ├── d12.svg
        │   ├── d20.svg
        │   ├── d4.svg
        │   ├── d6.svg
        │   ├── d8.svg
        │   ├── room.html
        │   ├── styles.css
        │   ├── svg.js
        │   └── ui.js
        ├── README.md
        ├── rooms/
        ├── serverconf.json
        ├── source/
        │   └── app.d
        └── tokens/

    `rooms/` is used to store action logs so that as new scenes are created the old ones can be restored.
    `tokens/` is used to store the width, color, and image of game pieces.

2. edit `serverconf.json` to have the right port number for your application.

    The `host` field in that file is not used by default (vibe.d defaults to listening on all interfaces) but can be enabled by uncommenting a line in `source/app.d`.

3. `dub build` to create the server

4. `dub` to run the server

5. Send your friends to `http://your.server.com:8080` (or whatever port you picked)
    
    When you log in, user the character name `GM` to get access to game master functionality.

## User Interface

The user interface assumes a keyboard (not a mobile device) and binds most actions to single keypresses.
A list of such keys is present in the game itself.



# Hacking and extending

`source/app.d` is a fairly minimal [vibe.d](https://vibed.org) server
that mostly just echoes websocket messages to all users.
It also has some special tracking of rooms and tokens.

`public/svg.js` defines the character and stroke/line/path types.

`public/ui.js` handles the keyboard and mouse and websocket. It's a bit of spaghetti code, sorry.

`public/room.html` and `public/styles.css` define the page layout and filters.

## Avoiding message cycles

Take care that you never have a websocket message able to generate another websocket message. In partucular, the following all send webscoket messages:

- window `postAction` and most key and mouse events
- PolyLineElement `_lock`, `_endExtend`, `extend`, `_simplify`, and 
- Creature `moveTo`

There are a small number of known-to-terminate websocket-caused websocket messages:

- The `welcome` message causes a user who has not seen a past message from themselves to send either `ping` or `newtoken` so others know they have arrived
- The `newscene` message causes all logged-in users to send either `ping` or `newtoken` so the new scene keeps all users

## Rebuilding and reloading

If you edit `source/app.d` you'll need to rebuild with `dub` before your changes become visible.

The other files are served up live on every connection attempt, so refreshing the webpage should see the latest version.

# Future features

- [ ] dice tray reordering
    - [ ] allow dummy entries in tray list
- [ ] undo/redo of drawing and motion
- [ ] invisible tokens and drawings
- [ ] flying height
- [ ] background images
- [ ] password protection
    - [ ] per room
    - [ ] with SSO
    - [ ] upload token image
    - [ ] allow GM renaming
- [ ] prevent or notify if same user logs in twice
