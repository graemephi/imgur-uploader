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

const Store = SynchronousStore();

function encodeURL(url) {
	if (url.startsWith("data:image")) {
		url = url.split(',')[1];
	}

	return encodeURIComponent(url);
}

function imageToDataURL(tabId, src, clipRect, dimensions) {
	return new Promise((resolve, reject) => {
		chrome.scripting.executeScript({ target: { tabId }, files: ['js/domOperations.js'] }, _ => {
			chrome.tabs.sendMessage(tabId, { type: "dom op", op: "imageToDataURL", src, clipRect, dimensions }, message => {
				if (message.ok) {
					resolve(message.result);
				} else {
					reject(message.result);
				}
			});
		});
	});
}

function clipboardWrite(tabId, src) {
	return new Promise(resolve => {
		chrome.scripting.executeScript({ target: { tabId }, files: ['js/domOperations.js'] }, _ => {
			chrome.tabs.sendMessage(tabId, { type: "dom op", op: "clipboardWrite", src }, resolve);
		});
	});
}

function imageUploadRequest(image, anonymous) {
	let authorization = anonymous ? `Client-id ${client_id}` : `Bearer ${Store.access_token}`;

	return request("https://api.imgur.com/3/image")
		.post(image)
		.headers({
			Authorization: authorization,
			'Content-Type': "application/x-www-form-urlencoded"
		});
}

function uploadImage(tabId, image, albumId, isRetry) {
	assert(tabId);
	return new Promise(resolve => chrome.windows.getCurrent(resolve))
		.then(currentWindow => {
			if (Store.authorized && Store.valid_until < Date.now()) {
				return refreshToken().then(_ => currentWindow);
			}

			return currentWindow;
		})
		.then(currentWindow => {
			let anonymous = isAnonymous(currentWindow.incognito);

			var body = `image=${encodeURL(image)}`;

			if (albumId) {
				body += `&album=${albumId}`;
			}

			return imageUploadRequest(body, anonymous)
				.catch(error => {
					if (Store.authorized && error.status === 403) {
						return refreshToken().then(_ => imageUploadRequest(body, anonymous));
					} else {
						return Promise.reject(error);
					}
				});
		})
		.then(response => open(tabId, response.data, albumId))
		.catch(error => {
			console.error("Failed upload", error);

			if (Store.authorized && error.url === Imgur_OAuth2URL && error.status === 403) {
				return notify("Upload Failure", `Do not have permission to upload as ${Store.username}.`);
			} else if (!isRetry) {
				return imageToDataURL(tabId, image).then(data => uploadImage(tabId, data, albumId, true));
			} else {
				return notify("Upload Failure", "That didn't work. You might want to try again.");
			}
		});
}

function open(tabId, data, albumId) {
	let imageLink = data.link.replace("http:", "https:");

	if (Store.to_clipboard) {
		clipboardWrite(tabId, imageLink);
	}

	if (Store.to_clipboard && Store.clipboard_only) {
		notify("Image uploaded", "The URL has been copied to your clipboard.");
	} else if (Store.to_direct_link) {
		chrome.tabs.create({ url: imageLink, active: !Store.no_focus });
	} else if (albumId) {
		let imageId = /^([a-zA-Z0-9]+)$/.exec(data.id)[0];

		let albumUrl = `https://imgur.com/a/${albumId}`;
		let albumUrlWithHash = albumUrl + "#" + imageId;

		chrome.tabs.create({ url: albumUrlWithHash, active: !Store.no_focus });
	} else {
		chrome.tabs.create({ url: 'https://imgur.com/' + data.id, active: !Store.no_focus });
	}
}

function notify(title, message) {
	let options = {
		type: "basic",
		title: title,
		message: message,
		iconUrl: "img/logo.png"
	};

	return new Promise(resolve => chrome.notifications.create("", options, resolve));
}

Store.listener(chrome.runtime.onInstalled, details => {
	if (details.reason == "install") {
		Store.authorized = false;
		Store.incognito = false;
		Store.to_direct_link = false;
		Store.no_focus = false;
		Store.to_clipboard = false;
		Store.clipboard_only = false;
		Store.to_albums = false;
		Store.scale_capture = false;
		Store.albums = {};

		Store.access_token = null;
		Store.valid_until = 0;
	} else if (details.reason === "update" && Number(details.previousVersion.split(".")[0]) < 2) {
		chrome.storage.local.remove("expired");
		Store.scale_capture = false;
		Store.no_focus = false;
		Store.clipboard_only = false;

		Store.valid_until = 0;
	}

	chrome.storage.sync.get('albums', syncStore => {
		if (!syncStore.hasOwnProperty('albums')) {
			Store.albums = {};
			Store.to_albums = false;
		}
	});

	populateAlbumMenu();
});

Store.listener(chrome.contextMenus.onClicked, (info, tab) => {
	let uploadType = info.menuItemId.split(" ");
	if (uploadType[0] === 'area') {
		let albumId = uploadType[1];
		fetch(chrome.runtime.getURL("capture.html"))
			.then(response => response.text())
			.then(html => {
				return chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['js/captureArea.js'] }, _ => {
					chrome.tabs.sendMessage(tab.id, { type: "capture init", html, albumId });
				});
			});
	} else if (uploadType[0] === 'rehost') {
		uploadImage(tab.id, info.srcUrl, uploadType[1]);
	}
});

Store.listener(chrome.runtime.onMessage, (message, sender) => {
	if (message.type === "capture ready") {
		let pixelRatio = message.devicePixelRatio;

		let width = Math.round(message.rect.width * pixelRatio);
		let height = Math.round(message.rect.height * pixelRatio);
		let x = Math.round(message.rect.x * pixelRatio);
		let y = Math.round(message.rect.y * pixelRatio);

		let scaled_width = Store.scale_capture ? message.rect.width : width;
		let scaled_height = Store.scale_capture ? message.rect.height : height;

		let albumId = message.albumId;

		if (width > 0 && height > 0) {
			chrome.tabs.captureVisibleTab(null, { format: 'png' })
				.then(imageData => imageToDataURL(sender.tab.id, imageData, { x, y, width, height }, { width: scaled_width, height: scaled_height }))
				.then(dataURL => uploadImage(sender.tab.id, dataURL, albumId));
		}
	}
});

Store.listener(chrome.windows.onFocusChanged, windowId => {
	if (windowId != chrome.windows.WINDOW_ID_NONE && !Store.incognito && Store.to_albums) {
		chrome.windows.getCurrent(function (window) {
			if (window.incognito) {
				resetMenu();
			} else {
				populateAlbumMenu();
			}
		});
	}
});
