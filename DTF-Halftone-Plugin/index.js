// DTF Halftone Pro v3.2
// Color: uses VISIBLE <input type="color"> (no hidden hack)
// Canvas: uses batchPlay "get" on document for reliable info
// Halftone: uses charIDToTypeID-style batchPlay descriptors

const {app, action, core} = require("photoshop");
let isProcessing = false;

function hexToRgb(hex) {
    return {
        r: parseInt(hex.substr(1, 2), 16),
        g: parseInt(hex.substr(3, 2), 16),
        b: parseInt(hex.substr(5, 2), 16)
    };
}

// ============ CANVAS INFO via batchPlay ============
async function refreshCanvasInfo() {
    try {
        await core.executeAsModal(async () => {
            const result = await action.batchPlay([{
                _obj: "get",
                _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }],
                _options: { dialogOptions: "dontDisplay" }
            }], { synchronousExecution: false });

            if (result && result[0]) {
                const info = result[0];
                const w = info.width._value || info.width;
                const h = info.height._value || info.height;
                const res = info.resolution._value || info.resolution;
                const wInch = (w / res).toFixed(2);
                const hInch = (h / res).toFixed(2);
                document.getElementById("info-print-size").textContent =
                    "Current " + Math.round(res) + " DPI Print Size: " + wInch + " x " + hInch + " in";
                document.getElementById("scale-width").value = Math.round(parseFloat(wInch));
                document.getElementById("scale-height").value = Math.round(parseFloat(hInch));
            }
        }, { commandName: "Get Doc Info" });
    } catch (e) {
        document.getElementById("info-print-size").textContent = "No document open";
    }
}

// ============ RUN DTPREP ============
async function runDTPrep() {
    if (isProcessing) return;
    isProcessing = true;

    const enableKnockout = document.getElementById("enable-knockout").checked;
    const koHex = document.getElementById("knockout-color-input").value;
    const shirtHex = document.getElementById("shirt-color-input").value;
    const koColor = hexToRgb(koHex);
    const bgColor = hexToRgb(shirtHex);

    try {
        await core.executeAsModal(async () => {
            // 1. Duplicate active layer
            await action.batchPlay([{
                _obj: "duplicate",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                name: "DTF_Working"
            }], {});

            // 2. Color Knockout
            if (enableKnockout) {
                // Ensure not background
                try {
                    await action.batchPlay([{
                        _obj: "set",
                        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                        to: { _obj: "layer", name: "DTF_Working" }
                    }], {});
                } catch (e) { }

                // Select by color range
                await action.batchPlay([{
                    _obj: "colorRange",
                    fuzziness: 40,
                    minimum: { _obj: "RGBColor", red: koColor.r, grain: koColor.g, blue: koColor.b },
                    maximum: { _obj: "RGBColor", red: koColor.r, grain: koColor.g, blue: koColor.b }
                }], {});

                // Delete
                await action.batchPlay([{ _obj: "delete" }], {});

                // Deselect
                await action.batchPlay([{
                    _obj: "set",
                    _target: [{ _ref: "channel", _property: "selection" }],
                    to: { _enum: "ordinal", _value: "none" }
                }], {});
            }

            // 3. Create shirt BG at bottom
            await action.batchPlay([{
                _obj: "make", _target: [{ _ref: "layer" }],
                using: { _obj: "layer", name: "DTF_Shirt_BG" }
            }], {});
            await action.batchPlay([{
                _obj: "move",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                to: { _ref: "layer", _enum: "ordinal", _value: "back" }
            }], {});
            await action.batchPlay([{
                _obj: "set",
                _target: [{ _ref: "channel", _property: "selection" }],
                to: { _enum: "ordinal", _value: "allEnum" }
            }], {});
            await action.batchPlay([{
                _obj: "fill",
                using: { _enum: "fillContents", _value: "color" },
                color: { _obj: "RGBColor", red: bgColor.r, grain: bgColor.g, blue: bgColor.b },
                opacity: { _unit: "percentUnit", _value: 100 },
                mode: { _enum: "blendMode", _value: "normal" }
            }], {});
            await action.batchPlay([{
                _obj: "set",
                _target: [{ _ref: "channel", _property: "selection" }],
                to: { _enum: "ordinal", _value: "none" }
            }], {});

            // 4. Select working layer, add levels adjustment
            await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: "DTF_Working" }] }], {});
            await action.batchPlay([{
                _obj: "make",
                _target: [{ _ref: "adjustmentLayer" }],
                using: {
                    _obj: "adjustmentLayer",
                    name: "DTF_Levels",
                    type: {
                        _obj: "levels",
                        presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
                        adjustment: [{
                            _obj: "levelsAdjustment",
                            channel: { _ref: "channel", _enum: "channel", _value: "composite" },
                            input: [0, 255], output: [0, 255], gamma: 1.0
                        }]
                    }
                }
            }], {});

        }, { commandName: "Run DTPREP" });

        document.getElementById("view-main").style.display = "none";
        document.getElementById("view-adjust").style.display = "block";
    } catch (e) { console.error("DTPREP error:", e.message); }
    isProcessing = false;
}

// ============ LIVE LEVELS ============
async function updateLevels() {
    if (isProcessing) return;
    isProcessing = true;
    const wPt = parseInt(document.getElementById("adj-white-point").value);
    const bPt = parseInt(document.getElementById("adj-black-point").value);
    const gamma = parseFloat(document.getElementById("adj-gray-point").value);
    const boost = parseInt(document.getElementById("adj-boost-shadow").value);

    try {
        await core.executeAsModal(async () => {
            try {
                await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: "DTF_Levels" }] }], {});
                await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }], {});
            } catch (e) { }
            try {
                await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: "DTF_Working" }] }], {});
            } catch (e) { }
            await action.batchPlay([{
                _obj: "make",
                _target: [{ _ref: "adjustmentLayer" }],
                using: {
                    _obj: "adjustmentLayer",
                    name: "DTF_Levels",
                    type: {
                        _obj: "levels",
                        presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
                        adjustment: [{
                            _obj: "levelsAdjustment",
                            channel: { _ref: "channel", _enum: "channel", _value: "composite" },
                            input: [bPt, wPt],
                            output: [Math.min(255, boost), 255],
                            gamma: gamma
                        }]
                    }
                }
            }], {});
        }, { commandName: "Update Levels" });
    } catch (e) { }
    isProcessing = false;
}

// ============ PREVIEW MODES ============
async function setPreviewMode(mode) {
    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            for (let i = 0; i < doc.layers.length; i++) {
                const l = doc.layers[i];
                if (mode === "original" || mode === "shirt") l.visible = true;
                else if (mode === "alpha") l.visible = (l.name !== "DTF_Shirt_BG");
                else if (mode === "mask") l.visible = (l.name === "DTF_Working" || l.name === "DTF_Levels");
            }
        }, { commandName: "Preview" });
    } catch (e) { }
}

// ============ CANCEL ============
async function cancelDTPrep() {
    try {
        await core.executeAsModal(async () => {
            for (const n of ["DTF_Levels", "DTF_Working", "DTF_Shirt_BG"]) {
                try {
                    await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: n }] }], {});
                    await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }], {});
                } catch (e) { }
            }
        }, { commandName: "Cancel" });
    } catch (e) { }
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
}

// ============ APPLY + HALFTONE ============
async function applyDTPrep() {
    if (isProcessing) return;
    isProcessing = true;
    const doHalftone = document.getElementById("enable-halftone").checked;
    const freq = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const ang = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shp = document.getElementById("halftone-shape").value;

    // Map shape to PS internal enum value
    const shapeMap = {
        round: "ellipse", diamond: "diamond", ellipse: "ellipse",
        line: "line", square: "square", cross: "cross"
    };

    try {
        await core.executeAsModal(async () => {
            // Remove shirt BG
            try {
                await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: "DTF_Shirt_BG" }] }], {});
                await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }], {});
            } catch (e) { }

            // Flatten
            await action.batchPlay([{ _obj: "flattenImage" }], {});

            if (doHalftone) {
                // Get resolution
                const docInfo = await action.batchPlay([{
                    _obj: "get",
                    _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }]
                }], {});
                const res = (docInfo[0].resolution && docInfo[0].resolution._value) || docInfo[0].resolution || 300;

                // Convert to Grayscale
                await action.batchPlay([{
                    _obj: "convertMode",
                    to: { _class: "grayscaleMode" }
                }], {});

                // Convert to Bitmap with Halftone Screen
                await action.batchPlay([{
                    _obj: "convertMode",
                    to: { _class: "bitmapMode" },
                    resolution: { _unit: "densityUnit", _value: res },
                    method: { _enum: "method", _value: "halftoneScreen" },
                    frequency: { _unit: "densityUnit", _value: freq },
                    angle: { _unit: "angleUnit", _value: ang },
                    shape: { _enum: "halftoneShape", _value: shapeMap[shp] || "ellipse" }
                }], {});
            }
        }, { commandName: "Apply" });
    } catch (e) { console.error("Apply error:", e.message); }

    isProcessing = false;
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
    refreshCanvasInfo();
}

// ============ DEFAULTS ============
function resetSliders() {
    document.getElementById("adj-white-point").value = 255;
    document.getElementById("adj-white-point-val").value = 255;
    document.getElementById("adj-black-point").value = 0;
    document.getElementById("adj-black-point-val").value = 0;
    document.getElementById("adj-gray-point").value = 1.0;
    document.getElementById("adj-gray-point-val").value = 1.0;
    document.getElementById("adj-boost-shadow").value = 0;
    document.getElementById("adj-boost-shadow-val").value = 0;
    updateLevels();
}

// ============ HALFTONE DIALOG ============
function openHalftoneDialog() {
    document.getElementById("dialog-enable-halftone").checked = document.getElementById("enable-halftone").checked;
    document.getElementById("dialog-halftone-shape").value = document.getElementById("halftone-shape").value;
    document.getElementById("dialog-frequency").value = document.getElementById("halftone-frequency").value;
    document.getElementById("dialog-angle").value = document.getElementById("halftone-angle").value;
    document.getElementById("dialog-halftone").style.display = "flex";
}
function closeHalftoneDialog() {
    document.getElementById("enable-halftone").checked = document.getElementById("dialog-enable-halftone").checked;
    document.getElementById("halftone-shape").value = document.getElementById("dialog-halftone-shape").value;
    document.getElementById("halftone-frequency").value = document.getElementById("dialog-frequency").value;
    document.getElementById("halftone-angle").value = document.getElementById("dialog-angle").value;
    document.getElementById("dialog-halftone").style.display = "none";
}

// ============ INIT ============
let debounceTimer = null;
document.addEventListener("DOMContentLoaded", function () {
    refreshCanvasInfo();

    // Run
    document.getElementById("btn-run-dtprep").addEventListener("click", runDTPrep);

    // Sliders
    [["adj-white-point", "adj-white-point-val"],
     ["adj-black-point", "adj-black-point-val"],
     ["adj-gray-point", "adj-gray-point-val"],
     ["adj-boost-shadow", "adj-boost-shadow-val"]].forEach(function (p) {
        const r = document.getElementById(p[0]);
        const n = document.getElementById(p[1]);
        r.addEventListener("input", function () {
            n.value = r.value;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(updateLevels, 250);
        });
        n.addEventListener("change", function () {
            r.value = n.value;
            updateLevels();
        });
    });

    // Preview tabs
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            setPreviewMode(btn.getAttribute("data-mode"));
        });
    });

    // Buttons
    document.getElementById("btn-default-sliders").addEventListener("click", resetSliders);
    document.getElementById("btn-edit-halftones").addEventListener("click", openHalftoneDialog);
    document.getElementById("btn-close-dialog").addEventListener("click", closeHalftoneDialog);
    document.getElementById("btn-dialog-ok").addEventListener("click", closeHalftoneDialog);
    document.getElementById("btn-cancel").addEventListener("click", cancelDTPrep);
    document.getElementById("btn-apply").addEventListener("click", applyDTPrep);
});
