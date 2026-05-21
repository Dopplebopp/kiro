// DTF Halftone Pro v3 - Matches reference UI
// Clickable swatches open PS color picker, Run DTPREP does full pipeline,
// Adjustment view with live sliders + preview modes

let knockoutColor = {r:0, g:0, b:0};
let shirtColor = {r:0, g:0, b:0};
let isProcessing = false;
let currentPreviewMode = "original";

// ============ HELPERS ============
function pad(n) { return n < 10 ? "0" + n : String(n); }
function rgbToHex(r,g,b) { return "#" + [r,g,b].map(c => c.toString(16).padStart(2,"0")).join(""); }
function hexToRgb(hex) {
    return { r: parseInt(hex.substr(1,2),16), g: parseInt(hex.substr(3,2),16), b: parseInt(hex.substr(5,2),16) };
}

// ============ COLOR PICKER (opens PS native color picker) ============
async function openColorPicker(initialR, initialG, initialB) {
    const {action, core} = require("photoshop");
    try {
        const result = await core.executeAsModal(async () => {
            // Set foreground to initial color first
            await action.batchPlay([{
                _obj: "set",
                _target: [{_ref: "color", _property: "foregroundColor"}],
                to: {_obj: "RGBColor", red: initialR, grain: initialG, blue: initialB}
            }], {});
            // Open the color picker dialog
            const r = await action.batchPlay([{
                _obj: "showColorPicker",
                context: "foreground"
            }], {});
            // Read the new foreground color
            const fg = await action.batchPlay([{
                _obj: "get",
                _target: [{_ref: "property", _property: "foregroundColor"}, {_ref: "application"}]
            }], {});
            if (fg && fg[0] && fg[0].foregroundColor) {
                const c = fg[0].foregroundColor;
                return {r: Math.round(c.red || 0), g: Math.round(c.grain || c.green || 0), b: Math.round(c.blue || 0)};
            }
            return null;
        }, {commandName: "Color Picker"});
        return result;
    } catch(e) {
        // If showColorPicker isn't available, try alternative
        try {
            const result2 = await core.executeAsModal(async () => {
                const fg = await action.batchPlay([{
                    _obj: "get",
                    _target: [{_ref: "property", _property: "foregroundColor"}, {_ref: "application"}]
                }], {});
                if (fg && fg[0] && fg[0].foregroundColor) {
                    const c = fg[0].foregroundColor;
                    return {r: Math.round(c.red || 0), g: Math.round(c.grain || c.green || 0), b: Math.round(c.blue || 0)};
                }
                return null;
            }, {commandName: "Get FG Color"});
            return result2;
        } catch(e2) { return null; }
    }
}

// ============ CANVAS INFO ============
async function refreshCanvasInfo() {
    try {
        const app = require("photoshop").app;
        const doc = app.activeDocument;
        const wInch = (doc.width / doc.resolution).toFixed(2);
        const hInch = (doc.height / doc.resolution).toFixed(2);
        document.getElementById("info-print-size").textContent = wInch + " x " + hInch + " in";
        document.getElementById("scale-width").value = parseFloat(wInch).toFixed(0);
        document.getElementById("scale-height").value = parseFloat(hInch).toFixed(0);
    } catch(e) {
        document.getElementById("info-print-size").textContent = "--";
    }
}

// ============ RUN DTPREP (main pipeline) ============
async function runDTPrep() {
    if (isProcessing) return;
    isProcessing = true;
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;

    const enableHalftone = document.getElementById("enable-halftone").checked;
    const enableKnockout = document.getElementById("enable-knockout").checked;
    const frequency = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const angle = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shape = document.getElementById("halftone-shape").value;

    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;

            // 1. Duplicate layer for non-destructive work
            await action.batchPlay([{
                _obj: "duplicate",
                _target: [{_ref: "layer", _enum: "ordinal", _value: "targetEnum"}],
                name: "DTF_Working"
            }], {});

            // 2. Color Knockout (if enabled)
            if (enableKnockout) {
                // Convert background layer if needed
                try {
                    await action.batchPlay([{_obj:"set",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_obj:"layer",name:"DTF_Working"}}], {});
                } catch(e){}

                await action.batchPlay([{
                    _obj: "colorRange",
                    fuzziness: 30,
                    minimum: {_obj: "RGBColor", red: knockoutColor.r, grain: knockoutColor.g, blue: knockoutColor.b},
                    maximum: {_obj: "RGBColor", red: knockoutColor.r, grain: knockoutColor.g, blue: knockoutColor.b}
                }], {});
                await action.batchPlay([{_obj: "delete"}], {});
                await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"}}], {});
            }

            // 3. Add shirt preview layer at bottom
            await action.batchPlay([{_obj:"make",_target:[{_ref:"layer"}],using:{_obj:"layer",name:"DTF_Shirt_BG"}}], {});
            await action.batchPlay([{_obj:"move",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"layer",_enum:"ordinal",_value:"back"}}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"}}], {});
            await action.batchPlay([{_obj:"fill",using:{_enum:"fillContents",_value:"color"},color:{_obj:"RGBColor",red:shirtColor.r,grain:shirtColor.g,blue:shirtColor.b},opacity:{_unit:"percentUnit",_value:100},mode:{_enum:"blendMode",_value:"normal"}}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"}}], {});

            // Select working layer again
            await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Working"}]}], {});

            // 4. Create Levels adjustment layer (for white/black/gray point control)
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
        console.error("DTPREP error:", e);
    }
    isProcessing = false;
}

// ============ LIVE ADJUSTMENT SLIDERS ============
async function updateLevelsAdjustment() {
    if (isProcessing) return;
    isProcessing = true;
    const {action, core} = require("photoshop");

    const whitePoint = parseInt(document.getElementById("adj-white-point").value);
    const blackPoint = parseInt(document.getElementById("adj-black-point").value);
    const grayPoint = parseFloat(document.getElementById("adj-gray-point").value);
    const boostShadow = parseInt(document.getElementById("adj-boost-shadow").value);

    // Remap: output black is boosted by shadow amount
    const outBlack = Math.min(255, boostShadow);

    try {
        await core.executeAsModal(async () => {
            // Select and delete existing levels layer, recreate
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Levels"}]}], {});
                await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
            } catch(e){}

            // Select working layer to position adjustment above it
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Working"}]}], {});
            } catch(e){}

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
    } catch(e) { console.error("Levels update error:", e); }
    isProcessing = false;
}

// ============ PREVIEW MODES ============
async function setPreviewMode(mode) {
    currentPreviewMode = mode;
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;

    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;

            // Show/hide layers based on mode
            switch(mode) {
                case "original":
                    // Show all layers normally
                    for (let i = 0; i < doc.layers.length; i++) {
                        doc.layers[i].visible = true;
                    }
                    break;
                case "shirt":
                    // Show working + shirt BG
                    for (let i = 0; i < doc.layers.length; i++) {
                        doc.layers[i].visible = true;
                    }
                    break;
                case "alpha":
                    // Hide shirt BG to show transparency
                    for (let i = 0; i < doc.layers.length; i++) {
                        if (doc.layers[i].name === "DTF_Shirt_BG") {
                            doc.layers[i].visible = false;
                        } else {
                            doc.layers[i].visible = true;
                        }
                    }
                    break;
                case "mask":
                    // Show only working layer (B&W view)
                    for (let i = 0; i < doc.layers.length; i++) {
                        if (doc.layers[i].name === "DTF_Working" || doc.layers[i].name === "DTF_Levels") {
                            doc.layers[i].visible = true;
                        } else {
                            doc.layers[i].visible = false;
                        }
                    }
                    break;
            }
        }, {commandName: "Preview Mode"});
    } catch(e) { console.error("Preview error:", e); }
}

// ============ CANCEL (undo all DTPREP work) ============
async function cancelDTPrep() {
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;
    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            // Delete DTF layers
            const layersToDelete = ["DTF_Levels", "DTF_Working", "DTF_Shirt_BG"];
            for (const name of layersToDelete) {
                try {
                    await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:name}]}], {});
                    await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
                } catch(e){}
            }
        }, {commandName: "Cancel DTPREP"});
    } catch(e) {}
    // Switch back to main view
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
}

// ============ APPLY (flatten and convert to halftone if enabled) ============
async function applyDTPrep() {
    if (isProcessing) return;
    isProcessing = true;
    const {action, core} = require("photoshop");
    const app = require("photoshop").app;

    const enableHalftone = document.getElementById("enable-halftone").checked;
    const frequency = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const angle = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shape = document.getElementById("halftone-shape").value;
    const cleanup = document.querySelector('input[name="cleanup"]:checked').value;

    try {
        await core.executeAsModal(async () => {
            // Remove shirt BG layer before final
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"layer",_name:"DTF_Shirt_BG"}]}], {});
                await action.batchPlay([{_obj:"delete",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}]}], {});
            } catch(e){}

            // Flatten
            const doc = app.activeDocument;
            await action.batchPlay([{_obj: "flattenImage"}], {});

            // Convert to halftone if enabled
            if (enableHalftone) {
                // Grayscale first
                await action.batchPlay([{_obj:"convertMode",to:{_enum:"convertModeType",_value:"grayscaleMode"}}], {});

                // Bitmap halftone
                await action.batchPlay([{
                    _obj: "convertMode",
                    to: {_enum: "convertModeType", _value: "bitmapMode"},
                    resolution: {_unit: "densityUnit", _value: doc.resolution},
                    method: {_enum: "method", _value: "halftoneScreen"},
                    frequency: {_unit: "densityUnit", _value: frequency},
                    angle: {_unit: "angleUnit", _value: angle},
                    shape: {_enum: "shape", _value: shape}
                }], {});
            }

            // Post cleanup
            if (cleanup === "standard" || cleanup === "high") {
                // Despeckle (remove noise)
                const iterations = cleanup === "high" ? 3 : 1;
                for (let i = 0; i < iterations; i++) {
                    try {
                        await action.batchPlay([{_obj: "despeckle"}], {});
                    } catch(e){}
                }
            }
        }, {commandName: "Apply DTPREP"});
    } catch(e) { console.error("Apply error:", e); }

    isProcessing = false;
    // Switch back to main view
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
    // Save back
    document.getElementById("enable-halftone").checked = document.getElementById("dialog-enable-halftone").checked;
    document.getElementById("halftone-shape").value = document.getElementById("dialog-halftone-shape").value;
    document.getElementById("halftone-frequency").value = document.getElementById("dialog-frequency").value;
    document.getElementById("halftone-angle").value = document.getElementById("dialog-angle").value;
    document.getElementById("dialog-halftone").style.display = "none";
}

// ============ DEBOUNCE FOR SLIDERS ============
let debounceTimer = null;
function debouncedUpdate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateLevelsAdjustment, 300);
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", function() {
    refreshCanvasInfo();

    // Knockout swatch click
    document.getElementById("swatch-knockout").addEventListener("click", async function() {
        const result = await openColorPicker(knockoutColor.r, knockoutColor.g, knockoutColor.b);
        if (result) {
            knockoutColor = result;
            document.getElementById("swatch-knockout-color").style.background = rgbToHex(result.r, result.g, result.b);
        }
    });

    // Shirt swatch click
    document.getElementById("swatch-shirt").addEventListener("click", async function() {
        const result = await openColorPicker(shirtColor.r, shirtColor.g, shirtColor.b);
        if (result) {
            shirtColor = result;
            document.getElementById("swatch-shirt-color").style.background = rgbToHex(result.r, result.g, result.b);
        }
    });

    // Run DTPREP
    document.getElementById("btn-run-dtprep").addEventListener("click", runDTPrep);

    // Adjustment sliders - sync range <-> number and live update
    const sliderPairs = [
        ["adj-white-point", "adj-white-point-val"],
        ["adj-black-point", "adj-black-point-val"],
        ["adj-gray-point", "adj-gray-point-val"],
        ["adj-boost-shadow", "adj-boost-shadow-val"]
    ];
    sliderPairs.forEach(function(pair) {
        const range = document.getElementById(pair[0]);
        const num = document.getElementById(pair[1]);
        range.addEventListener("input", function() { num.value = range.value; debouncedUpdate(); });
        num.addEventListener("change", function() { range.value = num.value; debouncedUpdate(); });
    });

    // Preview tabs
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            setPreviewMode(btn.getAttribute("data-mode"));
        });
    });

    // Default Sliders
    document.getElementById("btn-default-sliders").addEventListener("click", resetSliders);

    // Edit Halftones dialog
    document.getElementById("btn-edit-halftones").addEventListener("click", openHalftoneDialog);
    document.getElementById("btn-close-dialog").addEventListener("click", closeHalftoneDialog);
    document.getElementById("btn-dialog-ok").addEventListener("click", closeHalftoneDialog);

    // Cancel / Apply
    document.getElementById("btn-cancel").addEventListener("click", cancelDTPrep);
    document.getElementById("btn-apply").addEventListener("click", applyDTPrep);
});
