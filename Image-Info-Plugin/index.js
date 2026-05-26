// Image Info Pro - simple panel showing & editing DPI/width/height in real time
const { app, action, core } = require("photoshop");

// Cached doc info so we can detect what the user changed
let current = {
    docId: null,
    pxWidth: 0,
    pxHeight: 0,
    resolution: 0,   // dpi
    width: 0,        // in current units
    height: 0,
    units: "in"
};

let isApplying = false;       // re-entrancy guard for change events
let pollTimer = null;

// ---------- helpers ----------
function pxToUnits(px, dpi, units) {
    const inches = px / dpi;
    switch (units) {
        case "in": return inches;
        case "cm": return inches * 2.54;
        case "mm": return inches * 25.4;
        case "px": return px;
    }
    return inches;
}

function unitsToPx(val, dpi, units) {
    switch (units) {
        case "in": return val * dpi;
        case "cm": return (val / 2.54) * dpi;
        case "mm": return (val / 25.4) * dpi;
        case "px": return val;
    }
    return val * dpi;
}

function fmt(n) {
    return Math.round(n * 100) / 100;
}

// ---------- read active doc ----------
async function readDoc() {
    const doc = app.activeDocument;
    if (!doc) return null;

    // doc.width / doc.height are in pixels; doc.resolution is dpi
    return {
        docId: doc.id,
        pxWidth: doc.width,
        pxHeight: doc.height,
        resolution: doc.resolution
    };
}

function setEnabled(enabled) {
    document.getElementById("dpi").disabled = !enabled;
    document.getElementById("width").disabled = !enabled;
    document.getElementById("height").disabled = !enabled;
    document.getElementById("units").disabled = !enabled;
    document.getElementById("resample").disabled = !enabled;
}

function renderUI() {
    const status = document.getElementById("status");
    const pixelInfo = document.getElementById("pixel-info");

    if (!current.docId) {
        status.textContent = "No document open";
        status.classList.remove("ok");
        pixelInfo.textContent = "";
        document.getElementById("dpi").value = "";
        document.getElementById("width").value = "";
        document.getElementById("height").value = "";
        setEnabled(false);
        return;
    }

    setEnabled(true);
    status.textContent = "Document active";
    status.classList.add("ok");

    isApplying = true;
    document.getElementById("dpi").value = fmt(current.resolution);
    document.getElementById("width").value = fmt(current.width);
    document.getElementById("height").value = fmt(current.height);
    document.getElementById("units").value = current.units;
    isApplying = false;

    pixelInfo.textContent =
        `Pixels: ${current.pxWidth} \u00d7 ${current.pxHeight}  \u2022  ` +
        `${(current.pxWidth * current.pxHeight / 1_000_000).toFixed(2)} MP`;
}

async function refresh() {
    try {
        const info = await readDoc();
        if (!info) {
            current.docId = null;
            renderUI();
            return;
        }
        const units = document.getElementById("units").value || "in";
        current = {
            docId: info.docId,
            pxWidth: info.pxWidth,
            pxHeight: info.pxHeight,
            resolution: info.resolution,
            width: pxToUnits(info.pxWidth, info.resolution, units),
            height: pxToUnits(info.pxHeight, info.resolution, units),
            units: units
        };
        renderUI();
    } catch (e) {
        console.error("refresh err:", e.message);
    }
}

// ---------- apply changes back to Photoshop ----------
async function applyResolution(newDpi, resample) {
    await core.executeAsModal(async () => {
        await action.batchPlay([{
            _obj: "imageSize",
            resolution: { _unit: "densityUnit", _value: newDpi },
            scaleStyles: true,
            constrainProportions: true,
            interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "automaticInterpolation" },
            _options: { dialogOptions: "dontDisplay" }
        }], {});
    }, { commandName: "Change Resolution" });

    // If not resampling, the imageSize op above with no width/height keeps pixels
    // and changes resolution -> physical size adjusts automatically.
    // If resampling, caller should use applyDimensions instead.
}

async function applyDimensions(newPxWidth, newPxHeight, newDpi, resample) {
    await core.executeAsModal(async () => {
        const desc = {
            _obj: "imageSize",
            width: { _unit: "pixelsUnit", _value: Math.max(1, Math.round(newPxWidth)) },
            height: { _unit: "pixelsUnit", _value: Math.max(1, Math.round(newPxHeight)) },
            resolution: { _unit: "densityUnit", _value: newDpi },
            scaleStyles: true,
            constrainProportions: false,
            _options: { dialogOptions: "dontDisplay" }
        };
        if (resample) {
            desc.interfaceIconFrameDimmed = {
                _enum: "interpolationType",
                _value: "automaticInterpolation"
            };
        }
        await action.batchPlay([desc], {});
    }, { commandName: "Change Image Size" });
}

// Debounced apply per field
let applyTimer = null;
function scheduleApply(fn, delay = 350) {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(fn, delay);
}

async function onDpiChange() {
    if (isApplying || !current.docId) return;
    const newDpi = parseFloat(document.getElementById("dpi").value);
    if (!newDpi || newDpi <= 0) return;
    const resample = document.getElementById("resample").checked;

    scheduleApply(async () => {
        try {
            if (resample) {
                // Keep physical size, change pixels: newPx = currentPhysicalIn * newDpi
                const physW = current.pxWidth / current.resolution;
                const physH = current.pxHeight / current.resolution;
                await applyDimensions(physW * newDpi, physH * newDpi, newDpi, true);
            } else {
                await applyResolution(newDpi, false);
            }
            await refresh();
        } catch (e) { console.error("dpi apply:", e.message); }
    });
}

async function onDimensionChange() {
    if (isApplying || !current.docId) return;
    const w = parseFloat(document.getElementById("width").value);
    const h = parseFloat(document.getElementById("height").value);
    const units = document.getElementById("units").value;
    const dpi = parseFloat(document.getElementById("dpi").value) || current.resolution;
    const resample = document.getElementById("resample").checked;
    if (!w || !h || w <= 0 || h <= 0) return;

    scheduleApply(async () => {
        try {
            const newPxW = unitsToPx(w, dpi, units);
            const newPxH = unitsToPx(h, dpi, units);
            await applyDimensions(newPxW, newPxH, dpi, resample);
            await refresh();
        } catch (e) { console.error("dim apply:", e.message); }
    });
}

function onUnitsChange() {
    if (!current.docId) return;
    current.units = document.getElementById("units").value;
    current.width = pxToUnits(current.pxWidth, current.resolution, current.units);
    current.height = pxToUnits(current.pxHeight, current.resolution, current.units);
    renderUI();
}

// ---------- live updates ----------
// Listen for Photoshop events that change the doc, and also poll lightly
// so external changes (Image > Image Size, etc.) reflect in our panel.
function startListeners() {
    try {
        action.addNotificationListener(
            [
                { event: "select" },
                { event: "open" },
                { event: "close" },
                { event: "imageSize" },
                { event: "set" }
            ],
            async () => { await refresh(); }
        );
    } catch (e) { console.log("listener:", e.message); }

    // light polling fallback (every 1.5s) - cheap, just reads doc props
    pollTimer = setInterval(async () => {
        if (!app.activeDocument) {
            if (current.docId) { current.docId = null; renderUI(); }
            return;
        }
        const d = app.activeDocument;
        if (d.id !== current.docId ||
            d.width !== current.pxWidth ||
            d.height !== current.pxHeight ||
            d.resolution !== current.resolution) {
            await refresh();
        }
    }, 1500);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("dpi").addEventListener("input", onDpiChange);
    document.getElementById("width").addEventListener("input", onDimensionChange);
    document.getElementById("height").addEventListener("input", onDimensionChange);
    document.getElementById("units").addEventListener("change", onUnitsChange);
    document.getElementById("resample").addEventListener("change", () => {
        document.getElementById("hint").textContent = document.getElementById("resample").checked
            ? "Resample ON: changing values will add or remove pixels."
            : "Resample OFF: changing DPI keeps pixels and rescales print size.";
    });
    document.getElementById("refresh").addEventListener("click", refresh);

    refresh();
    startListeners();
});
