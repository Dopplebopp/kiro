// DTF Halftone Pro - UXP Plugin v2 (Photoshop 23.0+)
// Live adjustment layers, real-time sliders, eyedropper color picker

let debounceTimers = {};
let logContainer;
let curvesLayerId = null;
let levelsLayerId = null;
let thresholdLayerId = null;
let isApplying = false;

function debounce(key, fn, delay) {
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay || 150);
}
function pad(n) { return n < 10 ? "0" + n : String(n); }
function escapeHTML(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function componentToHex(c) { const h = c.toString(16); return h.length === 1 ? "0" + h : h; }

function logActivity(msg, type) {
    if (!logContainer) logContainer = document.getElementById("activity-log");
    if (!logContainer) return;
    const now = new Date();
    const t = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    const el = document.createElement("div");
    el.className = "log-entry log-" + (type || "info");
    el.innerHTML = '<span class="log-time">' + t + "</span> " + escapeHTML(msg);
    logContainer.appendChild(el);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ============ CANVAS INSPECTOR ============
async function refreshCanvasInfo() {
    try {
        const app = require("photoshop").app;
        const doc = app.activeDocument;
        document.getElementById("info-size").textContent = doc.width + " x " + doc.height + " px";
        document.getElementById("info-resolution").textContent = doc.resolution + " DPI";
        document.getElementById("info-color-mode").textContent = doc.mode;
        document.getElementById("info-bit-depth").textContent = doc.bitsPerChannel + " bit";
        const w = document.getElementById("dpi-warning");
        if (doc.resolution < 300) { w.classList.remove("hidden"); } else { w.classList.add("hidden"); }
        logActivity("Canvas: " + doc.width + "x" + doc.height + " @ " + doc.resolution + " DPI", "info");
    } catch(e) {
        document.getElementById("info-size").textContent = "--";
        document.getElementById("info-resolution").textContent = "--";
        document.getElementById("info-color-mode").textContent = "--";
        document.getElementById("info-bit-depth").textContent = "--";
        document.getElementById("dpi-warning").classList.add("hidden");
    }
}

// ============ SHIRT PREVIEW (always live) ============
function getAdjustedShirtColor() {
    const hex = document.getElementById("shirt-color-picker").value;
    const brightness = parseInt(document.getElementById("shirt-brightness").value);
    let r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16);
    const factor = brightness / 50;
    if (factor <= 1) { r = Math.round(r*factor); g = Math.round(g*factor); b = Math.round(b*factor); }
    else { const ex = factor-1; r = Math.min(255,Math.round(r+(255-r)*ex)); g = Math.min(255,Math.round(g+(255-g)*ex)); b = Math.min(255,Math.round(b+(255-b)*ex)); }
    return {r, g, b};
}

async function applyShirtPreview() {
    if (isApplying) return;
    isApplying = true;
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;
    const color = getAdjustedShirtColor();
    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            let found = false;
            for (let i = 0; i < doc.layers.length; i++) { if (doc.layers[i].name === "DTF_Shirt_Preview") { found = true; break; } }
            if (!found) {
                await action.batchPlay([{_obj:"make",_target:[{_ref:"layer"}],using:{_obj:"layer",name:"DTF_Shirt_Preview"}}], {});
                await action.batchPlay([{_obj:"move",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"layer",_enum:"ordinal",_value:"back"}}], {});
            } else {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Shirt_Preview"}]}], {});
            }
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"}}], {});
            await action.batchPlay([{_obj:"fill",using:{_enum:"fillContents",_value:"color"},color:{_obj:"RGBColor",red:color.r,grain:color.g,blue:color.b},opacity:{_unit:"percentUnit",_value:100},mode:{_enum:"blendMode",_value:"normal"}}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"}}], {});
        }, {commandName:"Shirt Preview"});
        logActivity("Shirt: rgb(" + color.r + "," + color.g + "," + color.b + ")", "success");
    } catch(e) { logActivity("Shirt error: " + e.message, "error"); }
    isApplying = false;
}

async function removeShirtPreview() {
    const {action, core} = require("photoshop");
    try {
        await core.executeAsModal(async () => {
            await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Shirt_Preview"}]}], {});
            await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
        }, {commandName:"Remove Shirt"});
        logActivity("Shirt layer removed.", "success");
    } catch(e) { logActivity("No shirt layer found.", "warn"); }
}

// ============ EYEDROPPER / COLOR PICKER ============
async function pickColorFromDocument() {
    const {action, core} = require("photoshop");
    try {
        const result = await core.executeAsModal(async () => {
            const r = await action.batchPlay([{
                _obj: "pick",
                _target: [{_ref: "colorSampler"}],
                samplePoint: {_obj: "paint", horizontal: {_unit: "pixelsUnit", _value: 0}, vertical: {_unit: "pixelsUnit", _value: 0}}
            }], {});
            return r;
        }, {commandName:"Pick Color"});
        // Fallback: read foreground color after user picks
        const fg = await core.executeAsModal(async () => {
            const r = await action.batchPlay([{
                _obj: "get",
                _target: [{_ref:"property",_property:"foregroundColor"},{_ref:"application"}]
            }], {});
            return r;
        }, {commandName:"Get FG Color"});
        if (fg && fg[0] && fg[0].foregroundColor) {
            const c = fg[0].foregroundColor;
            const r = Math.round(c.red || 0);
            const g = Math.round(c.grain || c.green || 0);
            const b = Math.round(c.blue || 0);
            const hex = "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
            document.getElementById("shirt-color-picker").value = hex;
            document.getElementById("shirt-color-hex").value = hex;
            logActivity("Picked color: " + hex, "success");
            debounce("shirt-pick", applyShirtPreview, 100);
        }
    } catch(e) { logActivity("Color pick error: " + e.message, "error"); }
}

// ============ COLOR KNOCKOUT ============
async function applyKnockout() {
    if (isApplying) return;
    isApplying = true;
    const {action, core} = require("photoshop");
    const hex = document.getElementById("knockout-color").value;
    const threshold = parseInt(document.getElementById("knockout-threshold").value);
    const r = parseInt(hex.substr(1,2),16), g = parseInt(hex.substr(3,2),16), b = parseInt(hex.substr(5,2),16);
    try {
        await core.executeAsModal(async () => {
            try { await action.batchPlay([{_obj:"set",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_obj:"layer",name:"Layer 0"}}], {}); } catch(e){}
            await action.batchPlay([{_obj:"colorRange",fuzziness:threshold,minimum:{_obj:"RGBColor",red:r,grain:g,blue:b},maximum:{_obj:"RGBColor",red:r,grain:g,blue:b}}], {});
            await action.batchPlay([{_obj:"delete"}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"}}], {});
        }, {commandName:"Color Knockout"});
        logActivity("Knockout: " + hex + " (thresh:" + threshold + ")", "success");
    } catch(e) { logActivity("Knockout error: " + e.message, "error"); }
    isApplying = false;
}

// ============ CURVES - Adjustment Layer (live) ============
async function applyCurvesLive() {
    if (isApplying) return;
    isApplying = true;
    const {action, core} = require("photoshop");
    const shadows = parseInt(document.getElementById("curves-shadows").value);
    const midtones = parseInt(document.getElementById("curves-midtones").value);
    const highlights = parseInt(document.getElementById("curves-highlights").value);
    const sPt = Math.max(0,Math.min(255, 64 + Math.round(shadows*0.5)));
    const mPt = Math.max(0,Math.min(255, 128 + Math.round(midtones*0.8)));
    const hPt = Math.max(0,Math.min(255, 192 + Math.round(highlights*0.5)));
    try {
        await core.executeAsModal(async () => {
            // Delete existing DTF curves layer if present
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Curves"}]}], {});
                await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
            } catch(e) {}
            // Create new curves adjustment layer
            await action.batchPlay([{
                _obj: "make",
                _target: [{_ref: "adjustmentLayer"}],
                using: {
                    _obj: "adjustmentLayer",
                    name: "DTF_Curves",
                    type: {
                        _obj: "curves",
                        presetKind: {_enum: "presetKindType", _value: "presetKindCustom"},
                        adjustment: [{
                            _obj: "curvesAdjustment",
                            channel: {_ref: "channel", _enum: "channel", _value: "composite"},
                            curve: [
                                {_obj: "point", horizontal: 0, vertical: 0},
                                {_obj: "point", horizontal: 64, vertical: sPt},
                                {_obj: "point", horizontal: 128, vertical: mPt},
                                {_obj: "point", horizontal: 192, vertical: hPt},
                                {_obj: "point", horizontal: 255, vertical: 255}
                            ]
                        }]
                    }
                }
            }], {});
        }, {commandName:"Curves Adjustment"});
        logActivity("Curves layer: S=" + shadows + " M=" + midtones + " H=" + highlights, "success");
    } catch(e) { logActivity("Curves error: " + e.message, "error"); }
    isApplying = false;
}

// ============ LEVELS - Adjustment Layer (live) ============
async function applyLevelsLive() {
    if (isApplying) return;
    isApplying = true;
    const {action, core} = require("photoshop");
    const inB = parseInt(document.getElementById("levels-input-black").value);
    const inW = parseInt(document.getElementById("levels-input-white").value);
    const outB = parseInt(document.getElementById("levels-output-black").value);
    const outW = parseInt(document.getElementById("levels-output-white").value);
    try {
        await core.executeAsModal(async () => {
            // Delete existing DTF levels layer
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Levels"}]}], {});
                await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
            } catch(e) {}
            // Create levels adjustment layer
            await action.batchPlay([{
                _obj: "make",
                _target: [{_ref: "adjustmentLayer"}],
                using: {
                    _obj: "adjustmentLayer",
                    name: "DTF_Levels",
                    type: {
                        _obj: "levels",
                        presetKind: {_enum: "presetKindType", _value: "presetKindCustom"},
                        adjustment: [{
                            _obj: "levelsAdjustment",
                            channel: {_ref: "channel", _enum: "channel", _value: "composite"},
                            input: [inB, inW],
                            output: [outB, outW],
                            gamma: 1.0
                        }]
                    }
                }
            }], {});
        }, {commandName:"Levels Adjustment"});
        logActivity("Levels layer: In[" + inB + "-" + inW + "] Out[" + outB + "-" + outW + "]", "success");
    } catch(e) { logActivity("Levels error: " + e.message, "error"); }
    isApplying = false;
}

// ============ THRESHOLD - Adjustment Layer (live) ============
async function applyThresholdLive() {
    if (isApplying) return;
    isApplying = true;
    const {action, core} = require("photoshop");
    const level = parseInt(document.getElementById("threshold-level").value);
    try {
        await core.executeAsModal(async () => {
            // Delete existing
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Threshold"}]}], {});
                await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
            } catch(e) {}
            // Create threshold adjustment layer
            await action.batchPlay([{
                _obj: "make",
                _target: [{_ref: "adjustmentLayer"}],
                using: {
                    _obj: "adjustmentLayer",
                    name: "DTF_Threshold",
                    type: {
                        _obj: "threshold",
                        level: level
                    }
                }
            }], {});
        }, {commandName:"Threshold Adjustment"});
        logActivity("Threshold layer: " + level, "success");
    } catch(e) { logActivity("Threshold error: " + e.message, "error"); }
    isApplying = false;
}

// ============ GRAYSCALE ============
async function convertToGrayscale() {
    const {action, core} = require("photoshop");
    try {
        await core.executeAsModal(async () => {
            await action.batchPlay([{_obj:"convertMode",to:{_enum:"convertModeType",_value:"grayscaleMode"}}], {});
        }, {commandName:"Grayscale"});
        logActivity("Converted to Grayscale.", "success");
        refreshCanvasInfo();
    } catch(e) { logActivity("Grayscale error: " + e.message, "error"); }
}

// ============ HALFTONE ============
async function convertToHalftone() {
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;
    const lpi = parseInt(document.getElementById("halftone-lpi").value);
    const angle = parseInt(document.getElementById("halftone-angle").value);
    const shape = document.getElementById("halftone-shape").value;
    try {
        await core.executeAsModal(async () => {
            try { await action.batchPlay([{_obj:"convertMode",to:{_enum:"convertModeType",_value:"grayscaleMode"}}], {}); } catch(e){}
            const doc = app.activeDocument;
            await action.batchPlay([{_obj:"convertMode",to:{_enum:"convertModeType",_value:"bitmapMode"},resolution:{_unit:"densityUnit",_value:doc.resolution},method:{_enum:"method",_value:"halftoneScreen"},frequency:{_unit:"densityUnit",_value:lpi},angle:{_unit:"angleUnit",_value:angle},shape:{_enum:"shape",_value:shape}}], {});
        }, {commandName:"Halftone"});
        logActivity("Halftone: " + lpi + " LPI, " + angle + " deg, " + shape, "success");
        refreshCanvasInfo();
    } catch(e) { logActivity("Halftone error: " + e.message, "error"); }
}

// ============ DUPLICATE LAYER ============
async function duplicateActiveLayer() {
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;
    try {
        await core.executeAsModal(async () => {
            const name = app.activeDocument.activeLayers[0].name + " (Halftone Copy)";
            await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:name}], {});
        }, {commandName:"Duplicate"});
        logActivity("Layer duplicated.", "success");
    } catch(e) { logActivity("Duplicate error: " + e.message, "error"); }
}

// ============ PIPELINE ============
async function runPipeline() {
    const steps = [];
    if (document.getElementById("pipe-duplicate").checked) steps.push("duplicate");
    if (document.getElementById("pipe-knockout").checked) steps.push("knockout");
    if (document.getElementById("pipe-curves").checked) steps.push("curves");
    if (document.getElementById("pipe-levels").checked) steps.push("levels");
    if (document.getElementById("pipe-threshold").checked) steps.push("threshold");
    if (document.getElementById("pipe-grayscale").checked) steps.push("grayscale");
    if (document.getElementById("pipe-halftone").checked) steps.push("halftone");
    if (steps.length === 0) { logActivity("No steps selected.", "warn"); return; }
    logActivity("Pipeline: " + steps.join(" > "), "info");
    for (const step of steps) {
        try {
            switch(step) {
                case "duplicate": await duplicateActiveLayer(); break;
                case "knockout": await applyKnockout(); break;
                case "curves": await applyCurvesLive(); break;
                case "levels": await applyLevelsLive(); break;
                case "threshold": await applyThresholdLive(); break;
                case "grayscale": await convertToGrayscale(); break;
                case "halftone": await convertToHalftone(); break;
            }
        } catch(e) { logActivity("Pipeline failed: " + step, "error"); return; }
    }
    logActivity("Pipeline done!", "success");
}

// ============ COLOR WHEEL ============
function drawColorWheel() {
    const canvas = document.getElementById("color-wheel");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const radius = canvas.width / 2;
    for (let angle = 0; angle < 360; angle++) {
        const start = (angle - 1) * Math.PI / 180;
        const end = (angle + 1) * Math.PI / 180;
        ctx.beginPath(); ctx.moveTo(radius, radius);
        ctx.arc(radius, radius, radius, start, end); ctx.closePath();
        const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
        grad.addColorStop(0, "white");
        grad.addColorStop(1, "hsl(" + angle + ", 100%, 50%)");
        ctx.fillStyle = grad; ctx.fill();
    }
    canvas.addEventListener("click", function(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const hex = "#" + componentToHex(pixel[0]) + componentToHex(pixel[1]) + componentToHex(pixel[2]);
        document.getElementById("shirt-color-picker").value = hex;
        document.getElementById("shirt-color-hex").value = hex;
        debounce("wheel-shirt", applyShirtPreview, 100);
    });
}

// ============ COLLAPSIBLE SECTIONS ============
function initCollapsible() {
    document.querySelectorAll(".section-header[data-toggle]").forEach(function(header) {
        header.addEventListener("click", function() {
            const id = header.getAttribute("data-toggle");
            const body = document.getElementById(id);
            const icon = header.querySelector(".collapse-icon");
            if (body.style.display === "none") {
                body.style.display = "block";
                icon.textContent = "\u25BC"; // down arrow
            } else {
                body.style.display = "none";
                icon.textContent = "\u25B6"; // right arrow
            }
        });
    });
}

// ============ RESET ALL ============
function resetAll() {
    document.getElementById("shirt-color-picker").value = "#000000";
    document.getElementById("shirt-color-hex").value = "#000000";
    document.getElementById("shirt-brightness").value = 50;
    document.getElementById("shirt-brightness-val").textContent = "50";
    document.getElementById("knockout-color").value = "#FFFFFF";
    document.getElementById("knockout-color-hex").value = "#FFFFFF";
    document.getElementById("knockout-threshold").value = 30;
    document.getElementById("knockout-threshold-val").textContent = "30";
    document.getElementById("curves-shadows").value = 0;
    document.getElementById("curves-shadows-val").textContent = "0";
    document.getElementById("curves-midtones").value = 0;
    document.getElementById("curves-midtones-val").textContent = "0";
    document.getElementById("curves-highlights").value = 0;
    document.getElementById("curves-highlights-val").textContent = "0";
    document.getElementById("levels-input-black").value = 0;
    document.getElementById("levels-input-black-val").textContent = "0";
    document.getElementById("levels-input-white").value = 255;
    document.getElementById("levels-input-white-val").textContent = "255";
    document.getElementById("levels-output-black").value = 0;
    document.getElementById("levels-output-black-val").textContent = "0";
    document.getElementById("levels-output-white").value = 255;
    document.getElementById("levels-output-white-val").textContent = "255";
    document.getElementById("threshold-level").value = 128;
    document.getElementById("threshold-level-val").textContent = "128";
    document.getElementById("halftone-lpi").value = 45;
    document.getElementById("halftone-lpi-val").textContent = "45";
    document.getElementById("halftone-angle").value = 45;
    document.getElementById("halftone-angle-val").textContent = "45";
    document.getElementById("halftone-shape").value = "round";
    document.getElementById("toggle-duplicate").checked = true;
    document.getElementById("pipe-duplicate").checked = true;
    document.getElementById("pipe-knockout").checked = true;
    document.getElementById("pipe-curves").checked = true;
    document.getElementById("pipe-levels").checked = true;
    document.getElementById("pipe-threshold").checked = false;
    document.getElementById("pipe-grayscale").checked = true;
    document.getElementById("pipe-halftone").checked = true;
    logActivity("All reset.", "info");
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", function() {
    logContainer = document.getElementById("activity-log");
    initCollapsible();
    drawColorWheel();

    // Helper: bind slider to display AND live action
    function liveSlider(sliderId, valId, actionFn, delay) {
        const s = document.getElementById(sliderId);
        const v = document.getElementById(valId);
        if (!s || !v) return;
        s.addEventListener("input", function() {
            v.textContent = s.value;
            debounce(sliderId, actionFn, delay || 300);
        });
    }

    // Shirt color - always live
    document.getElementById("shirt-color-picker").addEventListener("input", function() {
        document.getElementById("shirt-color-hex").value = this.value;
        debounce("shirt", applyShirtPreview, 200);
    });
    document.getElementById("shirt-color-hex").addEventListener("change", function() {
        if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) {
            document.getElementById("shirt-color-picker").value = this.value;
            debounce("shirt", applyShirtPreview, 100);
        }
    });
    liveSlider("shirt-brightness", "shirt-brightness-val", applyShirtPreview, 200);

    // Knockout color sync
    document.getElementById("knockout-color").addEventListener("input", function() {
        document.getElementById("knockout-color-hex").value = this.value;
    });
    document.getElementById("knockout-color-hex").addEventListener("change", function() {
        if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) document.getElementById("knockout-color").value = this.value;
    });
    // Knockout threshold display only (not live - destructive)
    var ktSlider = document.getElementById("knockout-threshold");
    var ktVal = document.getElementById("knockout-threshold-val");
    ktSlider.addEventListener("input", function() { ktVal.textContent = ktSlider.value; });

    // Curves - LIVE adjustment layers
    liveSlider("curves-shadows", "curves-shadows-val", applyCurvesLive, 400);
    liveSlider("curves-midtones", "curves-midtones-val", applyCurvesLive, 400);
    liveSlider("curves-highlights", "curves-highlights-val", applyCurvesLive, 400);

    // Levels - LIVE adjustment layers
    liveSlider("levels-input-black", "levels-input-black-val", applyLevelsLive, 400);
    liveSlider("levels-input-white", "levels-input-white-val", applyLevelsLive, 400);
    liveSlider("levels-output-black", "levels-output-black-val", applyLevelsLive, 400);
    liveSlider("levels-output-white", "levels-output-white-val", applyLevelsLive, 400);

    // Threshold - LIVE adjustment layer
    liveSlider("threshold-level", "threshold-level-val", applyThresholdLive, 400);

    // Halftone sliders (display only - not live because destructive mode change)
    var lpiS = document.getElementById("halftone-lpi"), lpiV = document.getElementById("halftone-lpi-val");
    var angS = document.getElementById("halftone-angle"), angV = document.getElementById("halftone-angle-val");
    lpiS.addEventListener("input", function() { lpiV.textContent = lpiS.value; });
    angS.addEventListener("input", function() { angV.textContent = angS.value; });

    // Buttons
    document.getElementById("btn-refresh-canvas").addEventListener("click", refreshCanvasInfo);
    document.getElementById("btn-add-shirt-layer").addEventListener("click", applyShirtPreview);
    document.getElementById("btn-remove-shirt-layer").addEventListener("click", removeShirtPreview);
    document.getElementById("btn-eyedropper").addEventListener("click", pickColorFromDocument);
    document.getElementById("btn-knockout").addEventListener("click", applyKnockout);
    document.getElementById("btn-apply-curves").addEventListener("click", applyCurvesLive);
    document.getElementById("btn-apply-levels").addEventListener("click", applyLevelsLive);
    document.getElementById("btn-apply-threshold").addEventListener("click", applyThresholdLive);
    document.getElementById("btn-convert-grayscale").addEventListener("click", convertToGrayscale);
    document.getElementById("btn-apply-halftone").addEventListener("click", convertToHalftone);
    document.getElementById("btn-duplicate-now").addEventListener("click", duplicateActiveLayer);
    document.getElementById("btn-run-pipeline").addEventListener("click", runPipeline);
    document.getElementById("btn-reset-all").addEventListener("click", resetAll);
    document.getElementById("btn-clear-log").addEventListener("click", function() {
        logContainer.innerHTML = "";
        logActivity("Log cleared.", "info");
    });

    logActivity("DTF Halftone Pro v2 loaded.", "info");
    refreshCanvasInfo();
});
