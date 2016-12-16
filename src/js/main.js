"use strict";

var	captureAreaAlbumId;

const Store = new SynchronousStore();

function getStore() {
	return Store;
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

function uploadImage(image, albumId) {
	return new Promise(resolve => chrome.windows.getCurrent(resolve))
		.then(currentWindow => {
			if (Store.valid_until < Date.now()) {
				return refreshToken().then(_ => currentWindow);
			}

			return currentWindow;
		})
		.then(currentWindow => {
			let anonymous = isAnonymous(currentWindow/incognito);

			var body = `image=${image}`;

			if (albumId) {
				body += `&album=${albumId}`;
			}

			return imageUploadRequest(body, anonymous)
				.catch(error => {
					if (error.hasJSONResponse && error.info.status === 403) {
						return refreshToken().then(_ => imageUploadRequest(body, anonymous));
					} else {
						return Promise.reject(error);
					}
				});
		})
		.then(response => open(response.data, albumId))
		.catch(error => {
			console.error("Failed upload", error.info || error);

			if (error.info && error.info.url === Imgur_OAuth2URL && error.info.status === 403) {
				return notify("Upload Failure", `Do not have permission to upload as ${Store.username}.`);
			} else {
				return notify("Upload Failure", "That didn't work. You might want to try again.");
			}
		});
}

function open(data, albumId) {
	let imageLink = data.link.replace("http:", "https:");

	if (Store.to_clipboard) {
		let textAreaElement = document.createElement('textarea');
		document.body.appendChild(textAreaElement);
		textAreaElement.value = imageLink;
		textAreaElement.select();
		document.execCommand('copy', false, null);
		document.body.removeChild(textAreaElement);
	}

	if (Store.to_clipboard && Store.clipboard_only) {
		notify("Image uploaded", "The URL has been copied to your clipboard.");
	} else if (Store.to_direct_link) {
		chrome.tabs.create({ url: imageLink, active: !Store.no_focus });
	} else if (albumId) {
		let imageId = /^([a-zA-Z0-9]+)$/.exec(data.id)[0];

		let albumUrl = `https://imgur.com/a/${albumId}`;
		let albumUrlWithHash = albumUrl + "#" + imageId;

		chrome.tabs.query({ url: albumUrl + "*" }, tabs => {
			let tab = tabs[0];

			// If we want to show the image in its album we have to do this song and dance
			// where the page will load images as it scrolls down
			let scrollToImage =
				`var bail = 0;

				function kill() {
					bail = 999;
				}

				function centerElement(element) {
					window.scroll(0, (element.offsetTop + element.offsetHeight / 2) - (window.innerHeight / 2));
				}

				// Frickin infinite scrolling, my god
				function scrollToImage() {
					let element = document.getElementById("${imageId}");

					if (!element) {
						bail++;

						if (bail < 64) {
							window.scroll(0, window.scrollY + ((window.scrollY + document.body.clientHeight) / 8));

							setTimeout(scrollToImage, 64);
						}
					} else {
						let imageElement = element.querySelector("img");

						if (imageElement.complete) {
							centerElement(element);
						} else {
							imageElement.addEventListener("load", _ => centerElement(element));
						}

						window.removeEventListener("wheel", kill);
					}
				}

				window.addEventListener("wheel", kill);

				if (document.readyState === "complete") {
					scrollToImage();
				} else {
					window.addEventListener("load", scrollToImage);
				}`;

			if (tab) {
				chrome.tabs.reload(tab.id, { }, _ => {
					chrome.tabs.executeScript(tab.id, { code: scrollToImage }, _ => {
						if (!Store.no_focus) {
							 chrome.tabs.update(tab.id, { active: true });
						}
					});
				});
			} else {
				chrome.tabs.create({ url: albumUrlWithHash, active: !Store.no_focus }, newTab => {
					chrome.tabs.executeScript(newTab.id, { code: scrollToImage });
				});
			}
		});
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
		captureAreaAlbumId = uploadType[1];
		chrome.tabs.executeScript(tab.id, { file: 'js/captureArea.js' });
	} else if (uploadType[0] === 'rehost') {
		uploadImage(encodeURIComponent(info.srcUrl), uploadType[1]);
	}
});

// uses the sendResponse function, does not use Store. Store.listener consumes
// the return value, so this is a separate listener.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === "capture init") {
			request("capture.html")
				.then(response => sendResponse({ html: response }));

		return true;
	}
});

Store.listener(chrome.runtime.onMessage, message => {
	if (message.type === "capture ready") {
		chrome.tabs.captureVisibleTab(null, { format: 'png' }, imageData => {
			let canvas = document.createElement('canvas');
			let context = canvas.getContext('2d');

			var width = Math.round(message.rect.width * window.devicePixelRatio);
			var height = Math.round(message.rect.height * window.devicePixelRatio);
			var x = Math.round(message.rect.x * window.devicePixelRatio);
			var y = Math.round(message.rect.y * window.devicePixelRatio);

			if (width > 0 && height > 0) {
				if (Store.scale_capture) {
					canvas.width = message.rect.width;
					canvas.height = message.rect.height;
				} else {
					canvas.width = width;
					canvas.height = height;
				}

				let imageElement = new Image();
				imageElement.src = imageData;
				imageElement.onload = _ => {
					context.drawImage(imageElement, x, y, width, height, 0, 0, canvas.width, canvas.height);

					let dataUrl = encodeURIComponent(canvas.toDataURL('image/png').split(',')[1]);
					assert(dataUrl);

					uploadImage(dataUrl, captureAreaAlbumId);
					captureAreaAlbumId = null;
				};
			};
		});
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