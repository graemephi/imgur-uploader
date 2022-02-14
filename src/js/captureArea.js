"use strict";

{

var albumId = null;

function clamp(x, min, max) {
	return (x < min) ? min
		 : (x > max) ? max
		 : 				 x;
}

function rectBounds(x1, y1, x2, y2) {
	x1 = clamp(x1, 0, iframe.clientWidth);
	y1 = clamp(y1, 0, iframe.clientHeight);
	x2 = clamp(x2, 0, iframe.clientWidth);
	y2 = clamp(y2, 0, iframe.clientHeight);

	return {
		x: (x1 < x2) ? x1 : x2,
		y: (y1 < y2) ? y1 : y2,
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1),
	};
}

function onMouseDown(event) {
	clickX = event.clientX;
	clickY = event.clientY;
	selecting = true;

	area.style.opacity = 1;
}

function onMouseMove(event) {
	if (animationFrameRequest) {
		cancelAnimationFrame(animationFrameRequest);
	}

	animationFrameRequest = requestAnimationFrame(_ => {
		let rect = rectBounds(clickX, clickY, event.clientX, event.clientY);

		if (selecting) {
			let x = rect.x;
			let y = rect.y;
			let drawnWidth = Math.max(1, rect.width);
			let drawnHeight = Math.max(1, rect.height);

			area.style.left = x;
			area.style.top = y;
			area.style.width = drawnWidth;
			area.style.height = drawnHeight;
		}

		let x = Math.max(clickX, event.clientX);
		let y = Math.min(clickY, event.clientY);
		let distanceFromTopRightCorner = Math.sqrt(Math.pow(x - iframe.clientWidth, 2) + (y * y));

		if (distanceFromTopRightCorner > 150) {
			icon.style.opacity = 1;
			icon.style.display = "";
		} else if (distanceFromTopRightCorner > 50) {
			icon.style.opacity = Math.min(1., Math.tanh((distanceFromTopRightCorner - 50) / 150) * 3.);
			icon.style.display = "";
		} else {
			// Using opacity: 0 here would make the cursor behave
			// differently over the icon
			icon.style.display = "none";
		}

		animationFrameRequest = null;
	});
}

function onMouseUp(event) {
	if (selecting) {
		let rect = rectBounds(clickX, clickY, event.clientX, event.clientY);
		chrome.runtime.sendMessage(null, { type: "capture ready", rect, devicePixelRatio: window.devicePixelRatio, albumId });
		dispose();
	}
}

function onKeyUp(event) {
	dispose();
}

function dispose() {
	window.removeEventListener("keyup", onKeyUp);
	window.removeEventListener("mousemove", onMouseMove);
	iframe.contentWindow.removeEventListener("keyup", onKeyUp);
	iframe.contentWindow.removeEventListener("mousedown", onMouseDown);
	iframe.contentWindow.removeEventListener("mouseup", onMouseUp);
	iframe.contentWindow.removeEventListener("mousemove", onMouseMove);

	iframe.remove();
	iframe = null;
	icon = null;
	selecting = false;

	if (animationFrameRequest) {
		cancelAnimationFrame(animationFrameRequest);
		animationFrameRequest = null;
	}
}

let iframe = document.createElement("iframe");
var icon = null;
var area = null;

var selecting = false;
var clickX = 0;
var clickY = 2147483647;

var animationFrameRequest = null;

iframe.setAttribute("style", `
	height: 100%;
	width: 100%;
	background: transparent;
	z-index: 2147483647;
	border: 0;
	position: fixed;
	left: 0;
	top: 0;
	cursor: crosshair
`);

function setupIframe(ready, body) {
	if (ready && body) {
		let parsedDocument = (new DOMParser()).parseFromString(body, "text/html");
		iframe.contentDocument.replaceChild(iframe.contentDocument.adoptNode(parsedDocument.documentElement), iframe.contentDocument.documentElement);

		icon = iframe.contentDocument.querySelector(".icon");

		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("mousemove", onMouseMove);
		iframe.contentWindow.addEventListener("keyup", onKeyUp);
		iframe.contentWindow.addEventListener("mousedown", onMouseDown);
		iframe.contentWindow.addEventListener("mouseup", onMouseUp);
		iframe.contentWindow.addEventListener("mousemove", onMouseMove);

		area = iframe.contentDocument.getElementById("area");
	}
}

var iframeReady = false;
var iframeHTML = null;

function listener(message) {
	if (message.type == "capture init") {
		iframeHTML = message.html;
		albumId = message.albumId;
		setupIframe(iframeReady, iframeHTML);
		chrome.runtime.onMessage.removeListener(listener);
	}
}

chrome.runtime.onMessage.addListener(listener);

iframe.addEventListener("load", _ => {
	iframeReady = true;
	setupIframe(iframeReady, iframeHTML);
});

document.documentElement.append(iframe);

}
