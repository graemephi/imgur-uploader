{

// This script is part of imgur uploader.

// Extensions as of Manifest V3 run background code in service workers, which
// means the extension core no longer has access to the DOM. But we only ever
// need it when we've been given the active tab permission, so we inject
// ourselves into that tab and use the DOM there.

function truncate(string) {
    if (string.length < 60) {
        return string;
    } else {
        return string.substring(0, 58) + "...";
    }
}

function listener(message, sender, sendResponse) {
    let asynchronous = false;
    if (message.type === "dom op") {
        switch (message.op) {
            case "imageToDataURL": {
                let img = new Image();
                img.setAttribute("crossorigin", "Anonymous");
                img.src = message.src;
                img.onload = _ => {
                    try {
                        // Can't use OffscreenCanvas here as it does not have toDataURL.
                        let { x, y, width, height } = message.clipRect || { x: 0, y: 0, width: img.width, height: img.height };
                        let dim = message.dimensions || { width: width, height: height };
                        let canvas = document.createElement("canvas");
                        canvas.width = dim.width;
                        canvas.height = dim.height;
                        let ctx = canvas.getContext("2d");
                        ctx.imageSmoothingQuality = "high";
                        ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);

                        let result = canvas.toDataURL("image/png");
                        sendResponse({ ok: true, result });
                    } catch (e) {
                        let result = "Failed to create data URL from " + truncate(message.src);
                        console.error(e || result);
                        sendResponse({ ok: false, result });
                    }
                };

                asynchronous = true;
            } break;
            case "clipboardWrite": {
                // Can't use navigator.clipboard here as interacting with the extension takes focus away from the document.
                let textAreaElement = document.createElement('textarea');
                textAreaElement.style.opacity = "0%";
                textAreaElement.style.position = "absolute";
                document.body.appendChild(textAreaElement);
                textAreaElement.value = message.src;
                textAreaElement.select();
                document.execCommand('copy', false, null);
                document.body.removeChild(textAreaElement);
                sendResponse({ ok: true })
            } break;
        }
    };

    chrome.runtime.onMessage.removeListener(listener);
    return asynchronous;
}

chrome.runtime.onMessage.addListener(listener);

}
