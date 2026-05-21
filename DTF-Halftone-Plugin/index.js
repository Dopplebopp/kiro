// DTF Halftone Pro v3.1 - Fixed color picker, canvas info, and halftoning
// Uses UXP DOM API (doc.changeMode) for halftone + HTML color inputs for swatches

const ps = require("photoshop");
const app = ps.app;
const {action, core} = ps;
const constants = ps.constants;

let knockoutHex = "#000000";
let shirtHex = "#000000";
let isProcessing = false;
let currentPreviewMode = "original";

// ============ CANVAS INFO ============
async function refreshCanvasInfo() {
    try {
        const doc = app.activeDocument;
        if (!doc) { document.getElementById("info-print-size").textContent = "--"; return; }
        // doc.width/height are in pixels, doc.resolution is PPI
        const widthPx = doc.width;
        const heightPx = doc.height;
        const res = doc.resolution;
        const wInch = (widthPx / res).toFixed(2);
        const hInch = (heightPx / res).toFixed(2);
        document.getElementById("info-print-size").textContent =
            res + " DPI  " + wInch + " x " + hInch + " in  (" + widthPx + " x " + heightPx + " px)";
        document.getElementById("scale-width").value = Math.round(parseFloat(wInch));
        document.getElementById("scale-height").value = Math.round(parseFloat(hInch));
    } catch(e) {
        document.getElementById("info-print-size").textContent = "No document open";
    }
}

// ============ COLOR HANDLING ============
// Using HTML <input type="color"> which works in UXP and gives a proper picker
function hexToRgb(hex) {
    return {
        r: parseInt(hex.substr(1,2),16),
        g: parseInt(hex.substr(3,2),16),
        b: parseInt(hex.substr(5,2),16)
    };
}

// ============ RUN DTPREP ============
async function runDTPrep() {
    if (isProcessing) return;
    isProcessing = true;

    const enableHalftone = document.getElementById("enable-halftone").checked;
    const enableKnockout = document.getElementById("enable-knockout").checked;
    const frequency = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const angle = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shape = document.getElementById("halftone-shape").value;
    const koColor = hexToRgb(knockoutHex);
    const bgColor = hexToRgb(shirtHex);

    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;

            // 1. Duplicate active layer
            await action.batchPlay([{
                _obj: "duplicate",
                _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}],
                name: "DTF_Working"
            }], {});

            // 2. Color Knockout
            if (enableKnockout) {
                // Make sure layer supports transparency
                try {
                    await action.batchPlay([{
                        _obj: "set",
                        _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}],
                        to: {_obj: "layer", name: "DTF_Working"}
                    }], {});
                } catch(e) {}

                // Color range select
                await action.batchPlay([{
                    _obj: "colorRange",
                    fuzziness: 30,
                    minimum: {_obj: "RGBColor", red: koColor.r, grain: koColor.g, blue: koColor.b},
                    maximum: {_obj: "RGBColor", red: koColor.r, grain: koColor.g, blue: koColor.b}
                }], {});

                // Delete selected
                await action.batchPlay([{_obj: "delete"}], {});

                // Deselect
                await action.batchPlay([{
                    _obj: "set",
                    _target: [{_ref: "channel", _property: "selection"}],
                    to: {_enum: "ordinal", _value: "none"}
                }], {});
            }

            // 3. Create shirt BG layer at bottom
            await action.batchPlay([{
                _obj: "make",
                _target: [{_ref: "layer"}],
                using: {_obj: "layer", name: "DTF_Shirt_BG"}
            }], {});
            await action.batchPlay([{
                _obj: "move",
                _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}],
                to: {_ref: "layer", _enum: "ordinal", _value: "back"}
            }], {});
            await action.batchPlay([{
                _obj: "set",
                _target: [{_ref: "channel", _property: "selection"}],
                to: {_enum: "ordinal", _value: "allEnum"}
            }], {});
            await action.batchPlay([{
                _obj: "fill",
                using: {_enum: "fillContents", _value: "color"},
                color: {_obj: "RGBColor", red: bgColor.r, grain: bgColor.g, blue: bgColor.b},
                opacity: {_unit: "percentUnit", _value: 100},
                mode: {_enum: "blendMode", _value: "normal"}
            }], {});
            await action.batchPlay([{
                _obj: "set",
                _target: [{_ref: "channel", _property: "selection"}],
                to: {_enum: "ordinal", _value: "none"}
            }], {});

            // 4. Select working layer and add Levels adjustment
            await action.batchPlay([{_obj: "select", _target: [{_ref: "layer", _name: "DTF_Working"}]}], {});

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
                            input: [0, 255],
                            output: [0, 255],
                            gamma: 1.0
                        }]
                    }
                }
            }], {});

        }, {commandName: "Run DTPREP"});

        // Show adjustment view
        document.getElementById("view-main").style.display = "none";
        document.getElementById("view-adjust").style.display = "block";
    } catch(e) {
        console.error("DTPREP error:", e.message);
    }
    isProcessing = false;
}

// ============ LIVE LEVELS UPDATE ============
async function updateLevelsAdjustment() {
    if (isProcessing) return;
    isProcessing = true;

    const whitePoint = parseInt(document.getElementById("adj-white-point").value);
    const blackPoint = parseInt(document.getElementById("adj-black-point").value);
    const grayPoint = parseFloat(document.getElementById("adj-gray-point").value);
    const boostShadow = parseInt(document.getElementById("adj-boost-shadow").value);
    const outBlack = Math.min(255, boostShadow);

    try {
        await core.executeAsModal(async () => {
            // Delete old levels layer
            try {
                await action.batchPlay([{_obj: "select", _target: [{_ref: "layer", _name: "DTF_Levels"}]}], {});
                await action.batchPlay([{_obj: "delete", _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}]}], {});
            } catch(e) {}

            // Position above working layer
            try {
                await action.batchPlay([{_obj: "select", _target: [{_ref: "layer", _name: "DTF_Working"}]}], {});
            } catch(e) {}

            // Create new levels
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
                            input: [blackPoint, whitePoint],
                            output: [outBlack, 255],
                            gamma: grayPoint
                        }]
                    }
                }
            }], {});
        }, {commandName: "Update Levels"});
    } catch(e) { console.error("Levels error:", e.message); }
    isProcessing = false;
}

// ============ PREVIEW MODES ============
async function setPreviewMode(mode) {
    currentPreviewMode = mode;
    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            for (let i = 0; i < doc.layers.length; i++) {
                const layer = doc.layers[i];
                switch(mode) {
                    case "original": layer.visible = true; break;
                    case "shirt": layer.visible = true; break;
                    case "alpha":
                        layer.visible = (layer.name !== "DTF_Shirt_BG");
                        break;
                    case "mask":
                        layer.visible = (layer.name === "DTF_Working" || layer.name === "DTF_Levels");
                        break;
                }
            }
        }, {commandName: "Preview Mode"});
    } catch(e) {}
}

// ============ CANCEL ============
async function cancelDTPrep() {
    try {
        await core.executeAsModal(async () => {
            for (const name of ["DTF_Levels", "DTF_Working", "DTF_Shirt_BG"]) {
                try {
                    await action.batchPlay([{_obj: "select", _target: [{_ref: "layer", _name: name}]}], {});
                    await action.batchPlay([{_obj: "delete", _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}]}], {});
                } catch(e) {}
            }
        }, {commandName: "Cancel"});
    } catch(e) {}
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
}

// ============ APPLY (flatten + halftone using DOM API) ============
async function applyDTPrep() {
    if (isProcessing) return;
    isProcessing = true;

    const enableHalftone = document.getElementById("enable-halftone").checked;
    const frequency = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const angle = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shapeVal = document.getElementById("halftone-shape").value;

    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;

            // Remove shirt BG
            try {
                await action.batchPlay([{_obj: "select", _target: [{_ref: "layer", _name: "DTF_Shirt_BG"}]}], {});
                await action.batchPlay([{_obj: "delete", _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}]}], {});
            } catch(e) {}

            // Flatten
            await action.batchPlay([{_obj: "flattenImage"}], {});

            // Halftone conversion using DOM API
            if (enableHalftone) {
                // Convert to grayscale first
                doc.changeMode(constants.ChangeMode.GRAYSCALE);

                // Build bitmap options
                const bmpOpts = new ps.objects.BitmapConversionOptions();
                bmpOpts.method = constants.BitmapConversionType.HALFTONESCREEN;
                bmpOpts.resolution = doc.resolution;
                bmpOpts.frequency = frequency;
                bmpOpts.angle = angle;

                // Map shape string to constant
                const shapeMap = {
                    "round": constants.BitmapHalfToneType.ROUND,
                    "diamond": constants.BitmapHalfToneType.DIAMOND,
                    "ellipse": constants.BitmapHalfToneType.ELLIPSE,
                    "line": constants.BitmapHalfToneType.LINE,
                    "square": constants.BitmapHalfToneType.SQUARE,
                    "cross": constants.BitmapHalfToneType.CROSS
                };
                bmpOpts.shape = shapeMap[shapeVal] || constants.BitmapHalfToneType.ROUND;

                doc.changeMode(constants.ChangeMode.BITMAP, bmpOpts);
            }
        }, {commandName: "Apply"});
    } catch(e) {
        // DOM API might not be available for bitmap - fallback to batchPlay
        console.error("DOM halftone failed, trying batchPlay:", e.message);
        try {
            await core.executeAsModal(async () => {
                const doc = app.activeDocument;
                // batchPlay fallback for halftone
                await action.batchPlay([{
                    _obj: "convertMode",
                    to: {_enum: "convertModeType", _value: "grayscaleMode"}
                }], {});

                await action.batchPlay([{
                    _obj: "convertMode",
                    to: {_enum: "convertModeType", _value: "bitmapMode"},
                    resolution: {_unit: "densityUnit", _value: doc.resolution},
                    method: {_enum: "method", _value: "halftoneScreen"},
                    frequency: {_unit: "densityUnit", _value: parseInt(document.getElementById("halftone-frequency").value) || 20},
                    angle: {_unit: "angleUnit", _value: parseInt(document.getElementById("halftone-angle").value) || 33},
                    shape: {_enum: "shape", _value: document.getElementById("halftone-shape").value || "round"}
                }], {});
            }, {commandName: "Apply Halftone Fallback"});
        } catch(e2) { console.error("Halftone fallback also failed:", e2.message); }
    }

    isProcessing = false;
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
    refreshCanvasInfo();
}

// ============ DEFAULT SLIDERS ============
function resetSliders() {
    document.getElementById("adj-white-point").value = 255;
    document.getElementById("adj-white-point-val").value = 255;
    document.getElementById("adj-black-point").value = 0;
    document.getElementById("adj-black-point-val").value = 0;
    document.getElementById("adj-gray-point").value = 2;
    document.getElementById("adj-gray-point-val").value = 2;
    document.getElementById("adj-boost-shadow").value = 0;
    document.getElementById("adj-boost-shadow-val").value = 0;
    updateLevelsAdjustment();
}

// ============ EDIT HALFTONE DIALOG ============
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

// ============ DEBOUNCE ============
let debounceTimer = null;
function debouncedLevels() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateLevelsAdjustment, 250);
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", function() {
    refreshCanvasInfo();

    // Color swatches use HTML color inputs (works in UXP!)
    document.getElementById("swatch-knockout").addEventListener("click", function() {
        // Create a hidden color input and trigger it
        const input = document.getElementById("hidden-knockout-picker");
        input.click();
    });
    document.getElementById("hidden-knockout-picker").addEventListener("input", function() {
        knockoutHex = this.value;
        document.getElementById("swatch-knockout-color").style.background = knockoutHex;
    });

    document.getElementById("swatch-shirt").addEventListener("click", function() {
        const input = document.getElementById("hidden-shirt-picker");
        input.click();
    });
    document.getElementById("hidden-shirt-picker").addEventListener("input", function() {
        shirtHex = this.value;
        document.getElementById("swatch-shirt-color").style.background = shirtHex;
    });

    // Run DTPREP
    document.getElementById("btn-run-dtprep").addEventListener("click", runDTPrep);

    // Adjustment sliders
    const sliderPairs = [
        ["adj-white-point", "adj-white-point-val"],
        ["adj-black-point", "adj-black-point-val"],
        ["adj-gray-point", "adj-gray-point-val"],
        ["adj-boost-shadow", "adj-boost-shadow-val"]
    ];
    sliderPairs.forEach(function(pair) {
        const range = document.getElementById(pair[0]);
        const num = document.getElementById(pair[1]);
        range.addEventListener("input", function() { num.value = range.value; debouncedLevels(); });
        num.addEventListener("change", function() { range.value = num.value; debouncedLevels(); });
    });

    // Preview tabs
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
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
