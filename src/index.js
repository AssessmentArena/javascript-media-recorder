'use strict';

var ERRORS = require('./errors');

/**
 * @constructor qbMediaRecorder
 * @param {Object}  [opts] - Object of parameters.
 * @param {String}      [opts.mimeType = 'video'] - Set mime type of record media or only type of media: 'video'/'audio'. By default if 'video'
 * @param {Number}      [opts.timeSlice = 1000] - A timeslice argument with a value in milliseconds (fire 'ondataavaible' callback).
 * @param {Boolean}     [opts.ignoreMutedMedia = true] - What to do with a muted input MediaStreamTrack, e.g. insert black frames/zero audio volume in the recording or ignore altogether.
 * @param {Object}      [opts.callbacks] - Object of callbacks.
 * @param {Function}        [opts.callbacks.onStart] - Callback when recording is started.
 * @param {Function}        [opts.callbacks.onError] - Callback when recording is failed.
 * @param {Function}        [opts.callbacks.onPause] - Callback when recording is paused.
 * @param {Function}        [opts.callbacks.onResume] - Callback when recording is stoped.
 * @param {Function}        [opts.callbacks.onStop] - Callback when recording is stoped.
 * @param {Function}        [opts.callbacks.ondataavailable] - Slice a blob by timeSlice and return event object.
 */
function qbMediaRecorder(opts) {
    var self = this;

    if(!qbMediaRecorder.isAvailable()) {
        throw new Error(ERRORS.unsupport);
    }

    self._stream = null;
    self._mediaRecorder = null;
    self._recordedChunks = [];
    self._recordedBlobs = [];
    self._keepRecording = false; // uses for method change(stream)

    self._timeSlice = opts && opts.timeSlice ? opts.timeSlice : 1000;
    self._userCallbacks = opts && opts.callbacks ? opts.callbacks : null; 

    var typeMediaRecorded = 'video', // by default
        prefferedMimeType = opts && opts.mimeType;

    if(prefferedMimeType) {
        typeMediaRecorded = prefferedMimeType.toString().toLowerCase().indexOf('audio') === -1 ? 'video' : 'audio';
    }

    self._options = {
        mimeType: qbMediaRecorder.getSupportedMimeTypes(typeMediaRecorded, prefferedMimeType)[0],
        ignoreMutedMedia: opts && typeof opts.ignoreMutedMedia !== undefined ? opts.ignoreMutedMedia : true
    };
}

/**
 * @access private
 * 
 * All available mime types in a browser environment.
 * @type {Object}
 */
qbMediaRecorder._mimeTypes = require('./mimeTypes');

/**
 * It checks capability of recording in the current environment.
 * @return {Boolean} Returns true if the qbMediaRecorder is available and can run, or false otherwise.
 */
qbMediaRecorder.isAvailable = function(){
    return !!(window && window.MediaRecorder && typeof window.MediaRecorder.isTypeSupported === 'function');
};

/**
 * Checking all mime types for support in browser enviroment. Recommended mime type has 0 index.
 * 
 * @param  {string} prefferedTypeMedia 'audio' or 'video'. What type of media you want to check support.
 *                                     By default is 'video'.
 * @return {array}                     Array of supported mimetypes.
 */
qbMediaRecorder.getSupportedMimeTypes = function(prefferedTypeMedia) {
    var typeMedia = prefferedTypeMedia || 'video';

    if(!qbMediaRecorder.isAvailable()) {
        throw new Error(ERRORS.unsupport);
    }

    return qbMediaRecorder._mimeTypes[typeMedia].filter(function(mimeType) {
        return window.MediaRecorder.isTypeSupported(mimeType);
    });
};

/**
 * Return a [state of recording](https://w3c.github.io/mediacapture-record/MediaRecorder.html#idl-def-recordingstate).
 * Possibly states: **inactive**, **recording**, **paused**
 * @return {String} Name of a state.
 */
qbMediaRecorder.prototype.getState = function() {
    return this._mediaRecorder ? this._mediaRecorder.state : 'inactive';
};

qbMediaRecorder.prototype._setEvents = function() {
    var self = this;

    function fireCallback(name, args) {
        if(self._userCallbacks && typeof self._userCallbacks[name] === 'function') {
            try {
                self._userCallbacks[name](args);
            } catch(e) {
                console.error('Founded an error in callback:' + name, e);
            }
        }
    }

    self._mediaRecorder.ondataavailable = function(e) {
        if(e.data && e.data.size > 0) {
            self._recordedChunks.push(e.data);
            fireCallback('ondataavailable', e);
        }
    };

    self._mediaRecorder.onpause = function() {
        fireCallback('onPause');
    };

    self._mediaRecorder.onresume = function() {
        fireCallback('onResume');
    };

    self._mediaRecorder.onerror = function(error) {
        switch(error.name) {
            case 'InvalidState':
                console.error(ERRORS[error.name]);
                break;

            case 'OutOfMemory':
                console.error(ERRORS[error.name]);
                break;

            case 'IllegalStreamModification':
                console.error(ERRORS[error.name]);
                break;

            case 'OtherRecordingError':
                console.error(ERRORS[error.name]);
                break;

            case 'GenericError':
                console.error(ERRORS[error.name]);
                break;

            default:
                console.error('MediaRecorder Error', error);
                break;
        }

        if(self._mediaRecorder.state !== 'inactive' && self._mediaRecorder.state !== 'stopped') {
            self._mediaRecorder.stop();
        }

        if(self._userCallbacks && typeof self._userCallbacks.onErrorRecording === 'function') {
            fireCallback('onError', error);
        }
    };

    self._mediaRecorder.onstop = function() {
        // console.info()
        var blob = new Blob(self._recordedChunks, {
            'type' : self._options.mimeType
        });

        self._recordedBlobs.push(blob);

        if(!self._keepRecording) {
            console.info('self._recordedBlobs', self._recordedBlobs);

            if(self._recordedBlobs.length > 1) {
                fireCallback('onStop', new Blob(self._recordedBlobs, {type: self._options.mimeType}));
            } else {
                fireCallback('onStop', self._recordedBlobs[0]);
            }
        }

        self._keepRecording = false;
    };

    self._mediaRecorder.start(self._timeSlice);

    fireCallback('onStart');
};

/**
 * Start to recording a stream.
 * Fire the method `stop` if record has state `inprogress`.
 * @param {Object} [stream] - Stream object representing a flux of audio- or video-related data.
 * @returns {void}
 */
qbMediaRecorder.prototype.start = function(stream) {
    var self = this;

    var mediaRecorderState = self.getState();

    if(mediaRecorderState === 'recording' || mediaRecorderState === 'paused'){
        self._mediaRecorder.stop();
    }

    if(self._stream) {
        self._stream = null;
    }

    self._stream = stream;

    /* Clear data from previously recording */ 
    self._mediaRecorder = null;
    self._recordedChunks.length = 0;

    try {
        self._mediaRecorder = new window.MediaRecorder(self._stream, self._options);
    } catch(e) {
        console.warn(ERRORS.unsupportMediaRecorderWithOptions, e);

        self._mediaRecorder = new window.MediaRecorder(self._stream);
    }

    self._setEvents();
};

qbMediaRecorder.prototype.change = function(stream) {
    var self = this;

    self._keepRecording = true; // don't stop a record
    self.stop();

     self._stream = null;
     self._mediaRecorder = null;

    self._stream = stream;
    self._mediaRecorder = new window.MediaRecorder(self._stream, self._options);
    self._setEvents();
};

/**
 * Stop to recording a stream.
 * @return {Blob} Blob of recorded chuncks.
 */
qbMediaRecorder.prototype.stop = function() {
    var mediaRecorder = this._mediaRecorder,
        mediaRecorderState = mediaRecorder && mediaRecorder.state ? mediaRecorder.state : 'inactive';

    if(mediaRecorder && mediaRecorderState === 'recording'){
        mediaRecorder.stop();
    } else {
        console.warn(ERRORS.actionFailed);
    }
};

/**
 * Pause to recording a stream.
 * @returns {void}
 */
qbMediaRecorder.prototype.pause = function() {
    var self = this;

    if(self._mediaRecorder && self._mediaRecorder.state === 'recording') {
        self._mediaRecorder.pause();
    } else {
        console.warn(ERRORS.actionFailed);
    }
};

/**
 * Resume to recording a stream.
 * @returns {void}
 */
qbMediaRecorder.prototype.resume = function() {
    var self = this;

    if(self._mediaRecorder && self._mediaRecorder.state === 'paused') {
        self._mediaRecorder.resume();
    } else {
        console.warn(ERRORS.actionFailed);
    }
};

/**
 * Create a file from blob and download as the file. Its method will fire 'stop' if recording in progress.
 * @param  {Strint} fileName Name of file. You can set `false` and we are generate name of file based on Date.now().
 * @param  {Blob}   blob     You can set blob which you get from the method `stop` or don't set anything and
 *                           we will get recorded chuncks.
 * @returns {void}
 */
qbMediaRecorder.prototype.download = function(fileName, blob) {
    var self = this;

    var mediaRecorder = this._mediaRecorder,
        mediaRecorderState = mediaRecorder && mediaRecorder.state ? mediaRecorder.state : 'inactive';

    if(mediaRecorder && mediaRecorderState === 'recording') {
        mediaRecorder.stop();
    }

    var url = URL.createObjectURL(blob || self._getBlobRecorded()),
        a = document.createElement('a');

    a.style.display = 'none';
    a.href = url;
    a.download = (fileName || Date.now()) + '.' + self._getExtension();

    document.body.appendChild(a);

    /* Start dowloading */
    a.click();
    
    /* Remove link */
    setTimeout(function() {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
};

/**
 * Create a Blob from recorded chunks.
 * @access private
 * @param {Object} [data] - Recorded data.
 * @return {Object} - Blob of recorded media or what you set in data
 */
qbMediaRecorder.prototype._getBlobRecorded = function(data) {
    var self = this,
        chunks = data || self._recordedChunks;

    if(!chunks.length) {
        console.warn(ERRORS.no_recorded_chunks);
        return false;
    }

    return new Blob(chunks, { 'type' : self._options.mimeType });
};

/**
 * Return a extension of a file. Based on available mimeType.
 * @access private
 * @return {String} For example, 'webm' / 'mp4' / 'ogg'
 */
qbMediaRecorder.prototype._getExtension = function() {
    var self = this;

    var endTypeMedia = self._options.mimeType.indexOf('/'),
        extension = self._options.mimeType.substring(endTypeMedia + 1),
        startCodecsInfo = extension.indexOf(';');

    if(startCodecsInfo !== -1) {
        extension = extension.substring(0, startCodecsInfo);
    }

    return extension;
};

module.exports = qbMediaRecorder;
