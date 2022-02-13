# imgur uploader
[Google Chrome extension](https://chrome.google.com/webstore/detail/imgur-uploader/lcpkicdemehhmkjolekhlglljnkggfcf) to upload images to imgur

# Changelog

Version 2.4: Update to Manifest V3. Fix capture area bug when the browser's
default zoom level was not 1.0, caused by incorrectly applying a zoom correction
factor when the browser had already applied that correction for us. 

Version 2.3.1: Fix bug caused by improper use of a browser API, which are more strict nowadays.

Version 2.3: Relaxed permission requirements as made possible by updates to Chrome's extension API (or, possibly, just their documentation).

Version 2.2: Inverted the selection rectangle. This won't ever cause the selection rectangle to be in the captured image, which affected some users. Also, uploading images should work with more kinds of images now, including data urls and SVGs.

Version 2.1: I was lying in bed last night and it occurred to me I'd added support for higher dpis but not different zoom levels. This was fortunate as when I went to muck around with it I discovered I'd introduced a bug that affected many if not most users. You can take captures while zoomed in or out now.

Version 2.0: This update removes all 3rd party code and so the code for imgur Uploader is now in the public domain. Additionally:
 - Rewrite of capture area to fix various bugs, work in more websites, and respect high dpi displays.
 - Added requested features: not focusing tabs of uploaded images; copying to clipboard without opening images
 - Uses https all of the time
 - Opens album page when uploading into albums

Version 1.2: Added uploading directly into albums.
