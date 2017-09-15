(function () {
	"use strict";

	function clamp(x, min, max) {
		return (x < min) ? min
			 : (x > max) ? max
			 : 				x;
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
	}

	function onMouseMove(event) {
		if (animationFrameRequest) {
			cancelAnimationFrame(animationFrameRequest);
		}

		animationFrameRequest = requestAnimationFrame(_ => {
			let rect = rectBounds(clickX, clickY, event.clientX, event.clientY);

			if (selecting) {
				let rectElement = iframe.contentDocument.querySelector("rect");
				let drawnWidth = Math.max(0, rect.width - 1);
				let drawnHeight = Math.max(0, rect.height - 1);

				rectElement.setAttribute("x", `${rect.x}px`);
				rectElement.setAttribute("y", `${rect.y}px`);
				rectElement.setAttribute("width", `${drawnWidth}px`);
				rectElement.setAttribute("height", `${drawnHeight}px`);
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
			let rectElement = iframe.contentDocument.querySelector("rect");

			rectElement.classList.add("removing");
			rectElement.addEventListener("transitionend", _ => {
				chrome.runtime.sendMessage(null, { type: "capture ready", rect: rect });
				dispose();
			});
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

	iframe.addEventListener("load", _ => {
		chrome.runtime.sendMessage(null, { type: "capture init" }, response => {
			let parsedDocument = (new DOMParser()).parseFromString(response.html, "text/html");
			iframe.contentDocument.replaceChild(iframe.contentDocument.adoptNode(parsedDocument.documentElement), iframe.contentDocument.documentElement);

			icon = iframe.contentDocument.querySelector(".icon");

			window.addEventListener("keyup", onKeyUp);
			window.addEventListener("mousemove", onMouseMove);
			iframe.contentWindow.addEventListener("keyup", onKeyUp);
			iframe.contentWindow.addEventListener("mousedown", onMouseDown);
			iframe.contentWindow.addEventListener("mouseup", onMouseUp);
			iframe.contentWindow.addEventListener("mousemove", onMouseMove);
		});
	});

	document.documentElement.append(iframe);
})();