"use strict";

import {
	client_id,
	client_secret,
	syncStoreKeys,
	localStoreKeys,
	Auth_Success,
	Auth_None,
	Auth_Failure,
	Auth_Unavailable,
	Imgur_OAuth2URL,
	SynchronousStore,
	isAnonymous,
	setAccessToken,
	assert,
	request,
	refreshToken,
	populateAlbumMenu,
	resetMenu,
} from './common.js'

function authenticationRedirect() {
	let queryParams = {};
	let queryString = location.hash.substring(1);
	let queryRegex = /([^&=]+)=([^&]*)/g;
	var queryMatch;
	while (queryMatch = queryRegex.exec(queryString)) {
		queryParams[decodeURIComponent(queryMatch[1])] = decodeURIComponent(queryMatch[2]);
	}

	if (queryParams.hasOwnProperty('access_token')) {
		assert(queryParams.refresh_token);
		assert(queryParams.account_username);

		chrome.runtime.openOptionsPage(_ => {
			chrome.runtime.sendMessage({ type: "authentication", authenticated: true, info: queryParams })
			.then(_ => {
				chrome.tabs.getCurrent(tab => chrome.tabs.remove(tab.id))
			})
		});

		return true;
	}

	return false;
}

var Store = SynchronousStore();

if (!authenticationRedirect()) {
	window.onload = _ => Store.onLoad(wire);

	Store.listener(chrome.runtime.onMessage, message => {
		if (message.type === "authentication") {
			if (message.authenticated) {
				Store.authorized = true;
				Store.refresh_token = message.info.refresh_token;
				Store.username = message.info.account_username;

				setAccessToken(message.info.access_token, message.info.expires_in);

				displayAuthorized(message.info.account_username);
			} else {
				displayUnauthorized();
			}
		}
	});
}

function wire() {
	checkAndDisplayAuthorization();

	if (Store.incognito) {
		document.getElementById('incognito').checked = true;
	}

	if (Store.to_direct_link) {
		document.getElementById('to_direct_link').checked = true;
	}

	if (Store.no_focus) {
		document.getElementById('no_focus').checked = true;
	}

	if (Store.to_clipboard) {
		document.getElementById('to_clipboard').checked = true;
	}

	if (Store.clipboard_only) {
		document.getElementById('clipboard_only').checked = true;
	}

	if (Store.to_albums) {
		document.getElementById('to_albums').checked = true;
	}

	if (Store.scale_capture) {
		document.getElementById('scale_capture').checked = true;
	}

	document.getElementById('auth-button').addEventListener('click', function () {
		chrome.tabs.create({ url: `https://api.imgur.com/oauth2/authorize?client_id=${client_id}&response_type=token` });
	});

	document.getElementById('logout').addEventListener('click', function (event) {
		setUnauthorized();
		displayUnauthorized();
	});

	document.getElementById('incognito').addEventListener('change', function (event) {
		Store.incognito = event.target.checked;
	});

	document.getElementById('to_direct_link').addEventListener('change', function (event) {
		Store.to_direct_link = event.target.checked;
	});

	document.getElementById('no_focus').addEventListener('change', function (event) {
		Store.no_focus = event.target.checked;
	});

	document.getElementById('to_clipboard').addEventListener('change', function (event) {
		if (event.target.checked) {
			chrome.permissions.request({ permissions: ['clipboardWrite'] },
				granted => {
					Store.to_clipboard = granted;

					if (!granted) {
						// This does not retrigger the event. But both
						// retriggering and not are fine.
						this.checked = false;
					}
				}
			);
		} else {
			chrome.permissions.remove({ permissions: ['clipboardWrite'] },
				_ => { Store.to_clipboard = false; }
			);
		}
	});

	document.getElementById('clipboard_only').addEventListener('change', function (event) {
		Store.clipboard_only = event.target.checked;
	});

	document.getElementById('scale_capture').addEventListener('change', function (event) {
		Store.scale_capture = event.target.checked;
	});

	if (window.devicePixelRatio != 1.) {
		document.getElementById('scale_capture').parentElement.parentElement.style.display = "";
	}

	document.getElementById('to_albums').addEventListener('change', function (event) {
		Store.to_albums = event.target.checked;

		if (event.target.checked) {
			updateAndDisplayAlbums();
		} else {
			document.getElementById("album-options").style.display = "none";
			resetMenu();
		}
	});

	document.getElementById('settings-menu-item').addEventListener('click', function () {
		document.getElementById('settings').setAttribute('class','selected');
		document.getElementById('settings').style.display = '';
		document.getElementById('settings-menu-item').setAttribute('class','selected');

		document.getElementById('about').removeAttribute('class');
		document.getElementById('about').style.display = 'none';
		document.getElementById('about-menu-item').removeAttribute('class');
	});

	document.getElementById('about-menu-item').addEventListener('click', function () {
		document.getElementById('about').setAttribute('class','selected');
		document.getElementById('about').style.display = '';
		document.getElementById('about-menu-item').setAttribute('class','selected');

		document.getElementById('settings').removeAttribute('class');
		document.getElementById('settings').style.display = 'none';
		document.getElementById('settings-menu-item').removeAttribute('class');
	});
}

function displayAuthorized(username) {
	var authButton = document.getElementById('auth-button');
	authButton.disabled = true;

	var authorizeElement = document.getElementById('authorize');
	var currentAccountElement = document.getElementById('current-account');
	authorizeElement.style.display = "none";
	currentAccountElement.style.display = "";

	document.getElementById("user").innerHTML = username;

	document.getElementById('incognito').removeAttribute('disabled');
	document.getElementById('to_albums').removeAttribute('disabled');

	populateAlbumMenu();
}

function setUnauthorized() {
	Store.authorized = false;
	Store.username = null;
	Store.refresh_token = null;
	Store.access_token = null;
}

function displayUnauthorized() {
	var authButton = document.getElementById('auth-button');
	authButton.disabled = false;

	var authorizeElement = document.getElementById('authorize');
	var currentAccountElement = document.getElementById('current-account');
	authorizeElement.style.display = "";
	currentAccountElement.style.display = "none";

	document.getElementById('incognito').setAttribute('disabled', 'disabled');
	document.getElementById('to_albums').setAttribute('disabled', 'disabled');

	resetMenu();
}

function checkAndDisplayAuthorization() {
	// If we have auth details we display it first and then check it is still
	// valid to avoid an ugly repaint in the common case

	return Promise.resolve().then(_ => {
		if (Store.authorized && Store.access_token && Store.refresh_token && Store.username) {
			displayAuthorized(Store.username);

			return refreshToken().then(_ => Auth_Success);
		} else {
			return Auth_None;
		}
	})
	.catch(error => error.json(_ => {
			setUnauthorized();
	        console.error("Lost authorization", error.info);

	        return Auth_Failure;
	    }, _ => {
	        console.error("Failed to refresh token", error);

	        return Auth_Unavailable;
	    }
 	))
 	.then(result => {
 		switch (result) {
 			case Auth_Success: {
 				if (Store.to_albums) {
 					return updateAndDisplayAlbums();
 				}
 			} break;
 			case Auth_None:
 			case Auth_Failure: {
 				displayUnauthorized();
 			} break;
 			case Auth_Unavailable: {
 				document.getElementById("not-available").style.display = "";
 				document.getElementById("current-account").style.display = "none";
 				document.getElementById("authorize").style.display = "none";
 				document.getElementById("album-options").style.display = "none";
 			} break;
 		}
 	});
}

function getUserAlbums(username, accessToken) {
	return request(`https://api.imgur.com/3/account/${username}/albums/`)
		.headers({ Authorization: "Bearer " + accessToken })
		.then(response => response.data);
}

function albumTitle(album) {
	return album.title || `Untitled (${album.id})`;
}

function addToAlbumMenu(album) {
	Store.albums[album.id] = albumTitle(album);
	Store.saveAlbums();
	populateAlbumMenu();
}

function removeFromAlbumMenu(album) {
	if (Store.albums[album.id]) {
		delete Store.albums[album.id];

		Store.saveAlbums();
		populateAlbumMenu();
	}
}

function createAlbumSelector(album, selected) {
	var id = `album-${album.id}`;
	var innerHTML =
			`<input type="checkbox" id="${id}" ${selected ? 'checked="checked"' : ""} />
			<label for="${id}">
	   			${album.cover ? `<img class="album-cover" src="https://i.imgur.com/${album.cover}.jpg" />` : ""}
				<p class="album-title">${albumTitle(album)}</p>
			</label>`;

	var element = document.createElement("div");
	element.classList.add("album-selector");

	if (selected) {
		element.classList.add("selected");
	}

	element.innerHTML = innerHTML;

	var inputElement = element.children[0];
	assert(inputElement.tagName === "INPUT");

	inputElement.addEventListener("change", event => {
		if (event.target.checked) {
			element.classList.add("selected");

			addToAlbumMenu(album);
		} else {
			element.classList.remove("selected");

			removeFromAlbumMenu(album);
		}
	});

	return element;
}

function updateAndDisplayAlbums() {
	return getUserAlbums(Store.username, Store.access_token).then(albums => {
		var albumListElement = document.getElementById("album-list");

		while (albumListElement.firstChild) {
			albumListElement.removeChild(albumListElement.firstChild);
		}

		var albumsHaveUpdate = false;
		var selectedIds = [];

		if (albums.length) {
			albums.forEach(album => {
				var selected = Store.albums.hasOwnProperty(album.id);

				if (selected) {
					selectedIds.push(album.id);

					if (albumTitle(album) !== Store.albums[album.id]) {
						Store.albums[album.id] = albumTitle(album);
						albumsHaveUpdate = true;
					}
				}

				var element = createAlbumSelector(album, selected);

				albumListElement.append(element);
			});

			Object.keys(Store.albums).forEach(dropdownAlbumId => {
				if (selectedIds.indexOf(dropdownAlbumId) === -1) {
					delete Store.albums[dropdownAlbumId];
					albumsHaveUpdate = true;
				}
			});

			if (albumsHaveUpdate) {
				Store.saveAlbums();
			}

			populateAlbumMenu();
		}

		document.getElementById("album-options").style.display = "";
	});
}
