"use strict";

const client_id = "0c0196a10c50197";
const client_secret = null;

if (!client_secret) {
    throw new Error("Missing imgur api keys");
}

const syncStoreKeys = ["incognito", "to_direct_link", "no_focus", "to_clipboard", "clipboard_only", "scale_capture", "to_albums", "albums", "username", "authorized", "refresh_token"];
const localStoreKeys = ["access_token", "valid_until"];

const Auth_Success = 1;
const Auth_None = 0;
const Auth_Failure = -1;
const Auth_Unavailable = -2;

const Imgur_OAuth2URL = "https://api.imgur.com/oauth2/token";

function getLocalStore() {
    return new Promise((resolve, reject) => chrome.storage.local.get(localStoreKeys, resolve));
}

function getSyncStore() {
    return new Promise((resolve, reject) => chrome.storage.sync.get(syncStoreKeys, resolve));
}

function SynchronousStore() {
    var initialised = false;

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

    Promise.all([getLocalStore(), getSyncStore()]).then(storage => {
        Object.assign(local, storage[0]);
        Object.assign(sync, storage[1]);

        initialised = true;

        loadListeners.forEach(listener => listener.listener(...listener.args));
        loadListeners = null;
    });

    syncStoreKeys.forEach(key => {
        Object.defineProperty(this, key, {
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
        Object.defineProperty(this, key, {
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
    this.saveAlbums = _ => {
        pending.sync.albums = {};
        Object.assign(pending.sync.albums, sync.albums);
        saveToStore();
    };

    // Store needs time after the script is first loaded to make an async
    // request for the storage data.

    // Register functions to be called when Store is initialised.
    this.onLoad = (listener, args) => {
        args = args || [];

        if (initialised) {
            listener(...args);
        } else {
            loadListeners.push({ listener: listener, args: args });
        }
    };

    // Register chrome events that require storage to be available.
    this.listener = (event, listener) => {
        event.addListener((...args) => this.onLoad(listener, args));
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

    Object.freeze(this);
}

function isAnonymous(isIncognito) {
    return Store.authorized && (isIncognito && !Store.incognito);
}

function setAccessToken(token, expiresIn) {
    if (!expiresIn) expiresIn = 60 * 60 * 1000;

    Store.access_token = token;
    Store.valid_until = Date.now() + expiresIn;
}

function isJSONResponse(response) {
    return typeof(response) === "string" && response.startsWith("{\"") && response.endsWith("}");
}

function xhrError(error, xhr, json) {
    error.info = {
        xmlHttpRequest: xhr,
        status: xhr.status,
        statusText: xhr.statusText,
        response: xhr.response,
        url: xhr.responseURL
    };

    if (json) {
        error.info.response = JSON.parse(xhr.response);
        error.hasJSONResponse = true;
    } else {
        error.hasJSONResponse = false;
    }

    return error;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

function request(url) {
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

        responseType(type) {
            this.responseTypeValue = type;
            return this;
        },

        catch(callback) {
            return this.then(identity => identity).catch(callback);
        },

        then(callback) {
            let self = this;
            return new Promise((resolve, reject) => {
                assert(self === this);
                var xhr = new XMLHttpRequest();
                xhr.open(self.method, self.url, true);
                xhr.responseType = self.responseTypeValue;

                Object.keys(self.headerEntries).forEach(header => {
                    xhr.setRequestHeader(header, self.headerEntries[header]);
                });

                xhr.onreadystatechange = () => {
                    if (xhr.readyState === 4) {
                        let isJson = isJSONResponse(xhr.response);

                        if (xhr.status !== 200) {
                            reject(xhrError(new Error(xhr.status), xhr, isJson));
                        } else if (isJson) {
                            resolve(tryParseJson(xhr.response));
                        } else {
                            resolve(xhr.response);
                        }
                    }
                };

                switch (self.method) {
                    case "GET": {
                        xhr.send();
                    } break;
                    case "POST": {
                        var data;

                        if (typeof(self.data) === "object") {
                            data = new FormData(0);

                            Object.keys(self.data).forEach(key => {
                                data.append(key, self.data[key]);
                            });
                        } else {
                            data = self.data;
                        }

                        xhr.send(data);
                    } break;
                    default: {
                        assert(0);
                    };
                }
            }).then(callback);
        }
    };

    return result;
}

function refreshToken() {
    return request(Imgur_OAuth2URL)
        .post({
            refresh_token: Store.refresh_token,
            client_id: client_id,
            client_secret: client_secret,
            grant_type: "refresh_token"
        })
        .then(response => (setAccessToken(response.access_token, response.expires_in), response));
}

function populateAlbumMenu() {
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

function resetMenu() {
    chrome.contextMenus.removeAll(_ => {
        chrome.contextMenus.create({ 'title': 'Capture area', 'contexts': ['page'], 'id': 'area', 'documentUrlPatterns' : ['http://*/*', 'https://*/*'] });
        chrome.contextMenus.create({ 'title': 'Rehost image', 'contexts': ['image'], 'id': 'rehost', 'documentUrlPatterns' : ['http://*/*', 'https://*/*']});
    });
}