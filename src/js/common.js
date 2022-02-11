"use strict";

export const client_id = "0c0196a10c50197";
export const client_secret = null;

if (!client_secret) {
    /*
    * Hello
    *
    * client_secret is required for OAuth2--so, if you plan on linking to
    * user accounts. If you don't, remove this check and hack away.
    *
    * There's no particular value or secrecy attached to the client_id beyond
    * potentially inconveniencing This Humble Repo Owner. Same with the secret,
    * but once you have user auth's you really want to be managing this
    * stuff yourself.
    *
    * graeme
    */
    throw new Error("Missing imgur api keys");
}

export const syncStoreKeys = ["incognito", "to_direct_link", "no_focus", "to_clipboard", "clipboard_only", "scale_capture", "to_albums", "albums", "username", "authorized", "refresh_token"];
export const localStoreKeys = ["access_token", "valid_until"];

export const Auth_Success = 1;
export const Auth_None = 0;
export const Auth_Failure = -1;
export const Auth_Unavailable = -2;

export const Imgur_OAuth2URL = "https://api.imgur.com/oauth2/token";

// Provides a synchronous view onto application storage (and communicates with
// other tabs to make that happen), and prevents storing keys not defined on
// extension installation.
//
// It's not a singleton, there's more than one, right?
let storePolyton = null;
export function SynchronousStore() {
    if (storePolyton) {
        return storePolyton;
    }

    var initialised = false;

    let self = storePolyton = {};

    let sync = {};
    let local = {};

    let pending = {
        sync: {},
        local: {}
    };

    let loadListeners = [];

    var saveTimeoutId = null;
    function saveToStore() {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }

        saveTimeoutId = setTimeout(_ => {
            chrome.storage.sync.set(pending.sync);
            chrome.storage.local.set(pending.local);

            chrome.runtime.sendMessage({ type: "store update", info: { sync: pending.sync, local: pending.local } });

            pending.sync = {};
            pending.local = {};

            saveTimeoutId = null;
        });
    }

    Promise.all([
        chrome.storage.local.get(localStoreKeys),
        chrome.storage.sync.get(syncStoreKeys)
    ]).then(([localStorage, syncStorage]) => {
        Object.assign(local, localStorage);
        Object.assign(sync, syncStorage);

        initialised = true;

        loadListeners.forEach(listener => listener.listener(...listener.args));
        loadListeners = null;
    });

    syncStoreKeys.forEach(key => {
        Object.defineProperty(self, key, {
            get() {
                assert(initialised, "SynchronousStorage is uninitialised");
                return sync[key];
            },
            set(value) {
                sync[key] = value;
                pending.sync[key] = value;
                saveToStore();
            }
        });
    });

    localStoreKeys.forEach(key => {
        Object.defineProperty(self, key, {
            get() {
                assert(initialised, "SynchronousStorage is uninitialised");
                return local[key];
            },
            set(value) {
                local[key] = value;
                pending.local[key] = value;
                saveToStore();
            }
        });
    });

    // Albums are the only mutable item in storage and we don't track updates
    // to it. In principle we could make the returned albums object self-
    // managing aswell. But why bother
    self.saveAlbums = _ => {
        pending.sync.albums = {};
        Object.assign(pending.sync.albums, sync.albums);
        saveToStore();
    };

    // Store needs time after the script is first loaded to make an async
    // request for the storage data.

    // Register functions to be called when Store is initialised.
    self.onLoad = (listener, args) => {
        args = args || [];

        if (initialised) {
            listener(...args);
        } else {
            loadListeners.push({ listener: listener, args: args });
        }
    };

    // Register chrome events that require storage to be available.
    self.listener = (event, listener) => {
        event.addListener((...args) => self.onLoad(listener, args));
    };

    // In principle we want there to be only one store. We can't share a
    // singleton around from the background page, because it gets loaded and
    // unloaded frequently. The options page may need the store but with no
    // background page store available. Instead, we have to notify all extant
    // Stores of updates.  If we don't do this, the background page's options
    // will be incorrect until it is unloaded (potentially a long time). This
    // complexity is really pushing the limit of what I'd consider reasonable
    // for this kind of thing.
    //
    // But I really do hate having to hit some async api in order to check a single
    // configuration value

    chrome.runtime.onMessage.addListener(message => {
        if (message.type === "store update") {
            Object.assign(sync, message.info.sync);
            Object.assign(local, message.info.local);
        }
    });

    Object.freeze(self);

    return self;
}

let Store = SynchronousStore();

export function isAnonymous(isIncognito) {
    return !Store.authorized || (isIncognito && !Store.incognito);
}

export function setAccessToken(token, expiresIn) {
    if (!expiresIn) expiresIn = 60 * 60 * 1000;

    Store.access_token = token;
    Store.valid_until = Date.now() + expiresIn;
}

export function assert(condition, message) {
    if (!condition) throw new Error(message);
}

export function request(url) {
    var result = {
        url: url,
        method: "GET",
        data: null,
        headerEntries: {},
        responseTypeValue: "text",

        post(data) {
            this.method = "POST";

            if (typeof(data) === "object") {
                this.data = {};
                Object.assign(this.data, data);
            } else if (typeof(data) === "string") {
                this.data = data;
            } else {
                assert(0, "Invalid POST data");
            }

            return this;
        },

        headers(headers) {
            Object.assign(this.headerEntries, headers);
            return this;
        },

        catch(callback) {
            return this.then(identity => identity).catch(callback);
        },

        then(callback) {
            let init = {
                method: this.method,
                headers: this.headerEntries,
            };

            if (this.method === "POST") {
                if (typeof(this.data) === "object") {
                    let data = new FormData();

                    Object.keys(this.data).forEach(key => {
                        data.append(key, this.data[key]);
                    });

                    init.body = data;
                } else {
                    init.body = this.data;
                }
            }

            return fetch(this.url, init)
                .then(response => response.ok ? response.json() : Promise.reject(response))
                .then(callback);
        }
    };

    return result;
}

export function refreshToken() {
    return request(Imgur_OAuth2URL)
        .post({
            refresh_token: Store.refresh_token,
            client_id: client_id,
            client_secret: client_secret,
            grant_type: "refresh_token"
        })
        .then(response => {
            setAccessToken(response.access_token, response.expires_in);
            return response;
        });
}

export function populateAlbumMenu() {
    if (Store.to_albums && Object.keys(Store.albums).length > 0) {
        var albums = Store.albums;

        chrome.contextMenus.removeAll(_ => {
            chrome.contextMenus.create({ 'title': 'Capture area', 'contexts': ['page'], 'id': 'area parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });
            chrome.contextMenus.create({ 'title': 'Capture area', 'contexts': ['page'], 'id': 'area', 'parentId': 'area parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*'] });
            chrome.contextMenus.create({ 'type' : 'separator', 'id': 'area sep', 'contexts': ['page'], 'parentId': 'area parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });

            chrome.contextMenus.create({ 'title': 'Rehost image', 'contexts': ['image'], 'id': 'rehost parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });
            chrome.contextMenus.create({ 'title': 'Rehost image', 'contexts': ['image'], 'id': 'rehost', 'parentId': 'rehost parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*'] } );
            chrome.contextMenus.create({ 'type' : 'separator', 'id': 'rehost sep', 'contexts': ['image'], 'parentId': 'rehost parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });

            for (var id in albums) {
                chrome.contextMenus.create({ 'title': albums[id], 'contexts': ['page'], 'id': 'area ' + id, 'parentId': 'area parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });
                chrome.contextMenus.create({ 'title': albums[id], 'contexts': ['image'], 'id': 'rehost ' + id, 'parentId': 'rehost parent', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']  });
            }
        });
    } else {
        resetMenu();
    }
}

export function resetMenu() {
    chrome.contextMenus.removeAll(_ => {
        chrome.contextMenus.create({ 'title': 'Capture area', 'contexts': ['page'], 'id': 'area', 'documentUrlPatterns' : ['http://*/*', 'https://*/*'] });
        chrome.contextMenus.create({ 'title': 'Rehost image', 'contexts': ['image'], 'id': 'rehost', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']});
    });
}
