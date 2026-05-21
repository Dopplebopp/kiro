/**
 * DTF Halftone Pro - UXP Plugin Main Script
 * Uses Photoshop UXP API with batchPlay for all PS operations
 */

const { app, action, core } = require("photoshop");
const { entrypoints } = require("uxp");

// ============================================================
// UXP PANEL SETUP
// ============================================================

entrypoints.setup({
    panels: {
        dtfHalftonePanel: {
            show() {},
            hide() {},
            create() {
                initPanel();
            },
            destroy() {}
        }
    }
});

// ============================================================
// STATE
// ============================================================

let liveModeEnabled = false;
let debounceTimers = {};

// ============================================================
// INITIALIZATION
// ============================================================

function initPanel() {
    initCollapsibleSections();
    initCanvasInspector();
    initLiveMode();
    initShirtPreview();
    initColorKnockout();
    initCurves();
    initLevels();
    initThreshold();
    initGrayscale();
    initHalftone();
    initDuplicateLayer();
    initOneClickPipeline();
    initActivityLog();
    initResetAll();
    initColorWheel();
    logActivity("Plugin loaded successfully.", "info");
    refreshCanvasInfo();
}

// Wait for DOM
document.addEventListener("DOMContentLoaded", () => {
    initPanel();
});

// ============================================================
// HELPERS
// ============================================================

function debounce(key, fn, delay) {
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay || 300);
}

async function executeBatchPlay(commands, options) {
    try {
        const result = await action.batchPlay(commands, options || { synchronousExecution: false });
        return result;
    } catch (e) {
        logActivity("Error: " + e.message, "error");
        return null;
    }
}

async function executeAsModal(fn, label) {
    try {
        return await core.executeAsModal(fn, { commandName: label || "DTF Halftone Pro" });
    } catch (e) {
        logActivity("Error: " + e.message, "error");
        return null;
    }
}

// ============================================================
// COLLAPSIBLE SECTIONS
// ============================================================

function initCollapsibleSections() {
    const headers = document.querySelectorAll(".section-header[data-toggle]");
    headers.forEach((header) => {
        header.addEventListener("click", () => {
            const targetId = header.getAttribute("data-toggle");
            const body = document.getElementById(targetId);
            const icon = header.querySelector(".collapse-icon");
            if (body.classList.contains("collapsed")) {
                body.classList.remove("collapsed");
                icon.innerHTML = "&#9660;";
            } else {
                body.classList.add("collapsed");
                icon.innerHTML = "&#9654;";
            }
        });
    });
}

// ============================================================
// CANVAS INSPECTOR
// ============================================================

function initCanvasInspector() {
    document.getElementById("btn-refresh-canvas").addEventListener("click", refreshCanvasInfo);
}

async function refreshCanvasInfo() {
    try {
        const doc = app.activeDocument;
        if (!doc) {
            setCanvasInfoEmpty();
            logActivity("No document open.", "warn");
            return;
        }
        document.getElementById("info-size").textContent = `${doc.width} x ${doc.height} px`;
        document.getElementById("info-resolution").textContent = `${doc.resolution} DPI`;
        document.getElementById("info-color-mode").textContent = doc.mode;
        document.getElementById("info-bit-depth").textContent = `${doc.bitsPerChannel} bit`;

        const warningEl = document.getElementById("dpi-warning");
        if (doc.resolution < 300) {
            warningEl.classList.remove("hidden");
        } else {
            warningEl.classList.add("hidden");
        }
        logActivity(`Canvas: ${doc.width}x${doc.height} @ ${doc.resolution} DPI`, "info");
    } catch (e) {
        setCanvasInfoEmpty();
        logActivity("No document open.", "warn");
    }
}

function setCanvasInfoEmpty() {
    document.getElementById("info-size").textContent = "--";
    document.getElementById("info-resolution").textContent = "--";
    document.getElementById("info-color-mode").textContent = "--";
    document.getElementById("info-bit-depth").textContent = "--";
    document.getElementById("dpi-warning").classList.add("hidden");
}

// ============================================================
// LIVE MODE
// ============================================================

function initLiveMode() {
    document.getElementById("toggle-live-mode").addEventListener("change", function () {
        liveModeEnabled = this.checked;
        logActivity(liveModeEnabled ? "Live mode enabled." : "Live mode disabled.", "info");
    });
}

// ============================================================
// SHIRT PREVIEW
// ============================================================

function initShirtPreview() {
    const colorPicker = document.getElementById("shirt-color-picker");
    const hexInput = document.getElementById("shirt-color-hex");
    const brightnessSlider = document.getElementById("shirt-brightness");
    const brightnessVal = document.getElementById("shirt-brightness-val");

    colorPicker.addEventListener("input", () => {
        hexInput.value = colorPicker.value;
        if (liveModeEnabled) debounce("shirt", () => applyShirtPreview(), 250);
    });

    hexInput.addEventListener("change", () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) {
            colorPicker.value = hexInput.value;
            if (liveModeEnabled) applyShirtPreview();
        }
    });

    brightnessSlider.addEventListener("input", () => {
        brightnessVal.textContent = brightnessSlider.value;
        if (liveModeEnabled) debounce("shirt-bright", () => applyShirtPreview(), 250);
    });

    document.getElementById("btn-add-shirt-layer").addEventListener("click", () => applyShirtPreview());
    document.getElementById("btn-remove-shirt-layer").addEventListener("click", () => removeShirtPreview());
}

function getAdjustedShirtColor() {
    const hex = document.getElementById("shirt-color-picker").value;
    const brightness = parseInt(document.getElementById("shirt-brightness").value);
    let r = parseInt(hex.substr(1, 2), 16);
    let g = parseInt(hex.substr(3, 2), 16);
    let b = parseInt(hex.substr(5, 2), 16);
    const factor = brightness / 50;
    if (factor <= 1) {
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
    } else {
        const excess = factor - 1;
        r = Math.min(255, Math.round(r + (255 - r) * excess));
        g = Math.min(255, Math.round(g + (255 - g) * excess));
        b = Math.min(255, Math.round(b + (255 - b) * excess));
    }
    return { r, g, b };
}

async function applyShirtPreview() {
    const color = getAdjustedShirtColor();
    await executeAsModal(async () => {
        const doc = app.activeDocument;
        // Try to find existing shirt layer
        let shirtLayer = null;
        for (let i = 0; i < doc.layers.length; i++) {
            if (doc.layers[i].name === "DTF_Shirt_Preview") {
                shirtLayer = doc.layers[i];
                break;
            }
        }

        if (!shirtLayer) {
            // Create new layer at bottom
            await action.batchPlay([
                {
                    _obj: "make",
                    _target: [{ _ref: "layer" }],
                    using: {
                        _obj: "layer",
                        name: "DTF_Shirt_Preview"
                    }
                }
            ], {});

            // Move to bottom
            const newLayer = doc.layers[0];
            await action.batchPlay([
                {
                    _obj: "move",
                    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                    to: { _ref: "layer", _enum: "ordinal", _value: "back" }
                }
            ], {});
        } else {
            // Select the existing shirt layer
            await action.batchPlay([
                {
                    _obj: "select",
                    _target: [{ _ref: "layer", _name: "DTF_Shirt_Preview" }]
                }
            ], {});
        }

        // Select all
        await action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "allEnum" } }], {});

        // Fill with color
        await action.batchPlay([
            {
                _obj: "fill",
                using: { _enum: "fillContents", _value: "color" },
                color: {
                    _obj: "RGBColor",
                    red: color.r,
                    grain: color.g,
                    blue: color.b
                },
                opacity: { _unit: "percentUnit", _value: 100 },
                mode: { _enum: "blendMode", _value: "normal" }
            }
        ], {});

        // Deselect
        await action.batchPlay([{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }], {});

    }, "Add Shirt Preview");

    logActivity(`Shirt layer: rgb(${color.r}, ${color.g}, ${color.b})`, "success");
}

async function removeShirtPreview() {
    await executeAsModal(async () => {
        try {
            await action.batchPlay([
                {
                    _obj: "select",
                    _target: [{ _ref: "layer", _name: "DTF_Shirt_Preview" }]
                }
            ], {});
            await action.batchPlay([
                {
                    _obj: "delete",
                    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
                }
            ], {});
            logActivity("Shirt preview layer removed.", "success");
        } catch (e) {
            logActivity("Shirt layer not found.", "warn");
        }
    }, "Remove Shirt Preview");
}

// ============================================================
// COLOR WHEEL
// ============================================================

function initColorWheel() {
    const canvas = document.getElementById("color-wheel");
    const ctx = canvas.getContext("2d");
    const radius = canvas.width / 2;
    drawColorWheel(ctx, radius);

    canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const hex = "#" + componentToHex(pixel[0]) + componentToHex(pixel[1]) + componentToHex(pixel[2]);
        document.getElementById("shirt-color-picker").value = hex;
        document.getElementById("shirt-color-hex").value = hex;
        if (liveModeEnabled) debounce("wheel", () => applyShirtPreview(), 150);
    });
}

function drawColorWheel(ctx, radius) {
    const cx = radius, cy = radius;
    for (let angle = 0; angle < 360; angle++) {
        const startAngle = (angle - 1) * Math.PI / 180;
        const endAngle = (angle + 1) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, "white");
        gradient.addColorStop(1, `hsl(${angle}, 100%, 50%)`);
        ctx.fillStyle = gradient;
        ctx.fill();
    }
}

function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
}

// ============================================================
// COLOR KNOCKOUT
// ============================================================

function initColorKnockout() {
    const colorPicker = document.getElementById("knockout-color");
    const hexInput = document.getElementById("knockout-color-hex");
    const thresholdSlider = document.getElementById("knockout-threshold");
    const thresholdVal = document.getElementById("knockout-threshold-val");

    colorPicker.addEventListener("input", () => { hexInput.value = colorPicker.value; });
    hexInput.addEventListener("change", () => {
        if (/^#[0-9A-Fa-f]{6}$/.test(hexInput.value)) colorPicker.value = hexInput.value;
    });
    thresholdSlider.addEventListener("input", () => { thresholdVal.textContent = thresholdSlider.value; });

    document.getElementById("btn-knockout").addEventListener("click", () => applyKnockout());
}

async function applyKnockout() {
    const hex = document.getElementById("knockout-color").value;
    const threshold = parseInt(document.getElementById("knockout-threshold").value);
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);

    await executeAsModal(async () => {
        // Ensure layer is not background
        try {
            await action.batchPlay([
                {
                    _obj: "set",
                    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                    to: { _obj: "layer", name: "Layer 0" }
                }
            ], {});
        } catch (e) { /* already not background */ }

        // Color Range selection
        await action.batchPlay([
            {
                _obj: "colorRange",
                fuzziness: threshold,
                minimum: {
                    _obj: "RGBColor",
                    red: r,
                    grain: g,
                    blue: b
                },
                maximum: {
                    _obj: "RGBColor",
                    red: r,
                    grain: g,
                    blue: b
                }
            }
        ], {});

        // Delete selection
        await action.batchPlay([{ _obj: "delete" }], {});

        // Deselect
        await action.batchPlay([
            { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }
        ], {});

    }, "Color Knockout");

    logActivity(`Knockout: ${hex} (threshold: ${threshold})`, "success");
}

// ============================================================
// CURVES
// ============================================================

function initCurves() {
    const sliders = ["curves-shadows", "curves-midtones", "curves-highlights"];
    const vals = ["curves-shadows-val", "curves-midtones-val", "curves-highlights-val"];

    sliders.forEach((id, idx) => {
        const slider = document.getElementById(id);
        const valSpan = document.getElementById(vals[idx]);
        slider.addEventListener("input", () => {
            valSpan.textContent = slider.value;
            if (liveModeEnabled) debounce("curves", () => applyCurves(), 400);
        });
    });

    document.getElementById("btn-apply-curves").addEventListener("click", () => applyCurves());
}

async function applyCurves() {
    const shadows = parseInt(document.getElementById("curves-shadows").value);
    const midtones = parseInt(document.getElementById("curves-midtones").value);
    const highlights = parseInt(document.getElementById("curves-highlights").value);

    const shadowPt = Math.max(0, Math.min(255, 64 + Math.round(shadows * 0.5)));
    const midPt = Math.max(0, Math.min(255, 128 + Math.round(midtones * 0.8)));
    const highPt = Math.max(0, Math.min(255, 192 + Math.round(highlights * 0.5)));

    await executeAsModal(async () => {
        await action.batchPlay([
            {
                _obj: "curves",
                presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
                adjustment: [
                    {
                        _obj: "curvesAdjustment",
                        channel: { _ref: "channel", _enum: "channel", _value: "composite" },
                        curve: [
                            { _obj: "point", horizontal: 0, vertical: 0 },
                            { _obj: "point", horizontal: 64, vertical: shadowPt },
                            { _obj: "point", horizontal: 128, vertical: midPt },
                            { _obj: "point", horizontal: 192, vertical: highPt },
                            { _obj: "point", horizontal: 255, vertical: 255 }
                        ]
                    }
                ]
            }
        ], {});
    }, "Apply Curves");

    logActivity(`Curves: S=${shadows} M=${midtones} H=${highlights}`, "success");
}

// ============================================================
// LEVELS
// ============================================================

function initLevels() {
    const sliders = ["levels-input-black", "levels-input-white", "levels-output-black", "levels-output-white"];
    const vals = ["levels-input-black-val", "levels-input-white-val", "levels-output-black-val", "levels-output-white-val"];

    sliders.forEach((id, idx) => {
        const slider = document.getElementById(id);
        const valSpan = document.getElementById(vals[idx]);
        slider.addEventListener("input", () => {
            valSpan.textContent = slider.value;
            if (liveModeEnabled) debounce("levels", () => applyLevels(), 400);
        });
    });

    document.getElementById("btn-apply-levels").addEventListener("click", () => applyLevels());
}

async function applyLevels() {
    const inBlack = parseInt(document.getElementById("levels-input-black").value);
    const inWhite = parseInt(document.getElementById("levels-input-white").value);
    const outBlack = parseInt(document.getElementById("levels-output-black").value);
    const outWhite = parseInt(document.getElementById("levels-output-white").value);

    await executeAsModal(async () => {
        await action.batchPlay([
            {
                _obj: "levels",
                presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
                adjustment: [
                    {
                        _obj: "levelsAdjustment",
                        channel: { _ref: "channel", _enum: "channel", _value: "composite" },
                        input: [inBlack, inWhite],
                        output: [outBlack, outWhite],
                        gamma: 1.0
                    }
                ]
            }
        ], {});
    }, "Apply Levels");

    logActivity(`Levels: In[${inBlack}-${inWhite}] Out[${outBlack}-${outWhite}]`, "success");
}

// ============================================================
// THRESHOLD
// ============================================================

function initThreshold() {
    const slider = document.getElementById("threshold-level");
    const valSpan = document.getElementById("threshold-level-val");

    slider.addEventListener("input", () => {
        valSpan.textContent = slider.value;
        if (liveModeEnabled) debounce("threshold", () => applyThreshold(), 400);
    });

    document.getElementById("btn-apply-threshold").addEventListener("click", () => applyThreshold());
}

async function applyThreshold() {
    const level = parseInt(document.getElementById("threshold-level").value);

    await executeAsModal(async () => {
        await action.batchPlay([
            {
                _obj: "threshold",
                level: level
            }
        ], {});
    }, "Apply Threshold");

    logActivity(`Threshold: ${level}`, "success");
}

// ============================================================
// GRAYSCALE
// ============================================================

function initGrayscale() {
    document.getElementById("btn-convert-grayscale").addEventListener("click", () => convertToGrayscale());
}

async function convertToGrayscale() {
    await executeAsModal(async () => {
        await action.batchPlay([
            {
                _obj: "convertMode",
                to: { _enum: "convertModeType", _value: "grayscaleMode" }
            }
        ], {});
    }, "Convert to Grayscale");

    logActivity("Converted to Grayscale.", "success");
    refreshCanvasInfo();
}

// ============================================================
// BITMAP / HALFTONE
// ============================================================

function initHalftone() {
    const lpiSlider = document.getElementById("halftone-lpi");
    const lpiVal = document.getElementById("halftone-lpi-val");
    const angleSlider = document.getElementById("halftone-angle");
    const angleVal = document.getElementById("halftone-angle-val");

    lpiSlider.addEventListener("input", () => { lpiVal.textContent = lpiSlider.value; });
    angleSlider.addEventListener("input", () => { angleVal.textContent = angleSlider.value; });

    document.getElementById("btn-apply-halftone").addEventListener("click", () => convertToHalftone());
}

async function convertToHalftone() {
    const lpi = parseInt(document.getElementById("halftone-lpi").value);
    const angle = parseInt(document.getElementById("halftone-angle").value);
    const shape = document.getElementById("halftone-shape").value;

    const shapeMap = {
        "round": "round",
        "diamond": "diamond",
        "ellipse": "ellipse",
        "line": "line",
        "square": "square",
        "cross": "cross"
    };

    await executeAsModal(async () => {
        // First ensure we're in grayscale
        try {
            await action.batchPlay([
                {
                    _obj: "convertMode",
                    to: { _enum: "convertModeType", _value: "grayscaleMode" }
                }
            ], {});
        } catch (e) { /* might already be grayscale */ }

        // Convert to bitmap with halftone screen
        const doc = app.activeDocument;
        await action.batchPlay([
            {
                _obj: "convertMode",
                to: { _enum: "convertModeType", _value: "bitmapMode" },
                resolution: { _unit: "densityUnit", _value: doc.resolution },
                method: { _enum: "method", _value: "halftoneScreen" },
                frequency: { _unit: "densityUnit", _value: lpi },
                angle: { _unit: "angleUnit", _value: angle },
                shape: { _enum: "shape", _value: shapeMap[shape] || "round" }
            }
        ], {});
    }, "Convert to Halftone");

    logActivity(`Halftone: ${lpi} LPI, ${angle} deg, ${shape}`, "success");
    refreshCanvasInfo();
}

// ============================================================
// DUPLICATE LAYER
// ============================================================

function initDuplicateLayer() {
    document.getElementById("btn-duplicate-now").addEventListener("click", () => duplicateActiveLayer());
}

async function duplicateActiveLayer() {
    await executeAsModal(async () => {
        await action.batchPlay([
            {
                _obj: "duplicate",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                name: app.activeDocument.activeLayers[0].name + " (Halftone Copy)"
            }
        ], {});
    }, "Duplicate Layer");

    logActivity("Layer duplicated.", "success");
}

// ============================================================
// ONE-CLICK PIPELINE
// ============================================================

function initOneClickPipeline() {
    document.getElementById("btn-run-pipeline").addEventListener("click", () => runPipeline());
}

async function runPipeline() {
    const steps = [];
    if (document.getElementById("pipe-duplicate").checked) steps.push("duplicate");
    if (document.getElementById("pipe-knockout").checked) steps.push("knockout");
    if (document.getElementById("pipe-curves").checked) steps.push("curves");
    if (document.getElementById("pipe-levels").checked) steps.push("levels");
    if (document.getElementById("pipe-threshold").checked) steps.push("threshold");
    if (document.getElementById("pipe-grayscale").checked) steps.push("grayscale");
    if (document.getElementById("pipe-halftone").checked) steps.push("halftone");

    if (steps.length === 0) {
        logActivity("Pipeline: No steps selected.", "warn");
        return;
    }

    logActivity("Pipeline started: " + steps.join(" -> "), "info");

    for (const step of steps) {
        try {
            switch (step) {
                case "duplicate": await duplicateActiveLayer(); break;
                case "knockout": await applyKnockout(); break;
                case "curves": await applyCurves(); break;
                case "levels": await applyLevels(); break;
                case "threshold": await applyThreshold(); break;
                case "grayscale": await convertToGrayscale(); break;
                case "halftone": await convertToHalftone(); break;
            }
        } catch (e) {
            logActivity(`Pipeline failed at ${step}: ${e.message}`, "error");
            return;
        }
    }

    logActivity("Pipeline completed!", "success");
}

// ============================================================
// ACTIVITY LOG
// ============================================================

let logContainer = null;

function initActivityLog() {
    logContainer = document.getElementById("activity-log");
    document.getElementById("btn-clear-log").addEventListener("click", () => {
        logContainer.innerHTML = "";
        logActivity("Log cleared.", "info");
    });
}

function logActivity(message, type) {
    if (!logContainer) logContainer = document.getElementById("activity-log");
    const now = new Date();
    const timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    const entry = document.createElement("div");
    entry.className = "log-entry log-" + (type || "info");
    entry.innerHTML = `<span class="log-time">${timeStr}</span> ${escapeHTML(message)}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function pad(n) { return n < 10 ? "0" + n : String(n); }
function escapeHTML(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ============================================================
// RESET ALL
// ============================================================

function initResetAll() {
    document.getElementById("btn-reset-all").addEventListener("click", () => {
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

        document.getElementById("toggle-live-mode").checked = false;
        liveModeEnabled = false;
        document.getElementById("toggle-duplicate").checked = true;

        document.getElementById("pipe-duplicate").checked = true;
        document.getElementById("pipe-knockout").checked = true;
        document.getElementById("pipe-curves").checked = true;
        document.getElementById("pipe-levels").checked = true;
        document.getElementById("pipe-threshold").checked = false;
        document.getElementById("pipe-grayscale").checked = true;
        document.getElementById("pipe-halftone").checked = true;

        logActivity("All settings reset to defaults.", "info");
    });
}
