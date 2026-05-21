/**
 * CSInterface - Adobe Common Extensibility Platform Library
 * Minimal implementation for CEP panels.
 * In production, use the official Adobe CSInterface.js from:
 * https://github.com/Adobe-CEP/CEP-Resources
 *
 * This is a placeholder stub. Replace with the full CSInterface.js
 * from Adobe's CEP-Resources repository for production use.
 */

function CSInterface() {}

CSInterface.prototype.getSystemPath = function(pathType) {
    // SystemPath constants
    var SystemPath = {
        USER_DATA: "userData",
        COMMON_FILES: "commonFiles",
        MY_DOCUMENTS: "myDocuments",
        APPLICATION: "application",
        EXTENSION: "extension",
        HOST_APPLICATION: "hostApplication"
    };
    // This would be replaced by native implementation
    return "";
};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    // In a real CEP environment, this calls into ExtendScript
    // This stub is for development reference only
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.evalScript(script, callback);
    } else {
        console.warn('[CSInterface] evalScript called outside CEP environment:', script.substring(0, 80));
        callback('{"error":"Not in CEP environment"}');
    }
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.addEventListener(type, listener, obj);
    }
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.removeEventListener(type, listener, obj);
    }
};

CSInterface.prototype.requestOpenExtension = function(extensionId, startUrl) {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.requestOpenExtension(extensionId, startUrl);
    }
};

CSInterface.prototype.getHostEnvironment = function() {
    if (typeof __adobe_cep__ !== 'undefined') {
        var hostEnv = JSON.parse(__adobe_cep__.getHostEnvironment());
        return hostEnv;
    }
    return { appSkinInfo: { panelBackgroundColor: { color: { red: 50, green: 50, blue: 50 } } } };
};

CSInterface.prototype.closeExtension = function() {
    if (typeof __adobe_cep__ !== 'undefined') {
        __adobe_cep__.closeExtension();
    }
};

CSInterface.prototype.getExtensionID = function() {
    if (typeof __adobe_cep__ !== 'undefined') {
        return __adobe_cep__.getExtensionId();
    }
    return "com.dtf.halftone.panel";
};

// Event types
var CSEvent = function(type, scope) {
    this.type = type;
    this.scope = scope || "APPLICATION";
    this.data = "";
};

// System path constants
var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};
