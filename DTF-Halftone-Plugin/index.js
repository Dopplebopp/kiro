// DTF Halftone Pro v8 - Preview tabs (Original/Shirt/Alpha/Mask) working
const {app, action, core} = require("photoshop");
const imaging = require("photoshop").imaging;

let knockoutColor = {r: 255, g: 255, b: 255};
let shirtColor = {r: 128, g: 128, b: 128};
let currentPreviewMode = "alpha";

function rgbToHex(r,g,b) { return "#"+[r,g,b].map(c=>Math.round(c).toString(16).padStart(2,"0")).join(""); }

async function openColorPicker(startColor) {
    let color = null;
    await core.executeAsModal(async () => {
        await action.batchPlay([{
            _obj: "set",
            _target: [{_ref: "color", _property: "foregroundColor"}],
            to: {_obj: "RGBColor", red: startColor.r, grain: startColor.g, blue: startColor.b},
            source: "photoshopPicker",
            _options: {dialogOptions: "dontDisplay"}
        }], {});
        const result = await action.batchPlay([{
            _obj: "showColorPicker",
            _target: [{_ref: "application"}]
        }], {});
        if (result && result[0] && result[0].RGBFloatColor) {
            const c = result[0].RGBFloatColor;
            color = {r: Math.round(c.red), g: Math.round(c.grain), b: Math.round(c.blue)};
        } else {
            const fg = await action.batchPlay([{_obj:"get",_target:[{_ref:"property",_property:"foregroundColor"},{_ref:"application"}],_options:{dialogOptions:"dontDisplay"}}], {});
            const c = fg[0].foregroundColor;
            if (c._obj === "RGBColor") color = {r: Math.round(c.red), g: Math.round(c.grain), b: Math.round(c.blue)};
        }
        if (color) console.log("Picked color:", color.r, color.g, color.b);
    }, {commandName: "Color Picker"});
    return color;
}

async function refreshCanvasInfo() {
    try {
        await core.executeAsModal(async () => {
            const r = await action.batchPlay([{_obj:"get",_target:[{_ref:"document",_enum:"ordinal",_value:"targetEnum"}],_options:{dialogOptions:"dontDisplay"}}], {});
            const w=r[0].width._value||r[0].width, h=r[0].height._value||r[0].height, res=r[0].resolution._value||r[0].resolution;
            document.getElementById("info-print-size").textContent = "Current "+Math.round(res)+" DPI Print Size: "+(w/res).toFixed(2)+" x "+(h/res).toFixed(2)+" in";
            document.getElementById("scale-width").value = Math.round(w/res);
            document.getElementById("scale-height").value = Math.round(h/res);
        }, {commandName:"DocInfo"});
    } catch(e) { document.getElementById("info-print-size").textContent = "No document open"; }
}

// Color knockout via direct pixel manipulation (imaging API)
async function colorKnockoutOnActiveLayer(r, g, b, fuzz) {
    try {
        const layer = app.activeDocument.activeLayers[0];
        if (!layer) return;
        const layerId = layer.id;
        const docId = app.activeDocument.id;
        const docW = app.activeDocument.width;
        const docH = app.activeDocument.height;
        const sourceBounds = { left: 0, top: 0, right: docW, bottom: docH };

        const pd = await imaging.getPixels({
            documentID: docId,
            layerID: layerId,
            sourceBounds: sourceBounds,
            componentSize: 8,
            applyAlpha: false
        });

        const comp = pd.imageData.components;
        const w = pd.imageData.width;
        const h = pd.imageData.height;
        const data = await pd.imageData.getData();

        if (comp < 4) { console.log("Knockout: no alpha channel"); pd.imageData.dispose(); return; }

        const fuzzThresh = fuzz * 3;
        let knocked = 0;
        for (let i = 0; i < data.length; i += comp) {
            const dr = Math.abs(data[i] - r);
            const dg = Math.abs(data[i+1] - g);
            const db = Math.abs(data[i+2] - b);
            if ((dr + dg + db) <= fuzzThresh) { data[i+3] = 0; knocked++; }
        }
        console.log("Knockout: "+knocked+" pixels made transparent");

        const newImg = await imaging.createImageDataFromBuffer(data, {
            width: w, height: h, components: comp,
            colorSpace: pd.imageData.colorSpace || "RGB",
            chunky: true,
            colorProfile: pd.imageData.colorProfile
        });
        await imaging.putPixels({
            documentID: docId, layerID: layerId,
            imageData: newImg, targetBounds: sourceBounds
        });
        newImg.dispose();
        pd.imageData.dispose();
    } catch (e) { console.error("Knockout error:", e.message, e); }
}

// Find a layer by name using DOM (returns null if not found)
function findLayerByName(name) {
    const doc = app.activeDocument;
    if (!doc) return null;
    for (const layer of doc.layers) {
        if (layer.name === name) return layer;
    }
    return null;
}

// Cleans up preview-mode artifacts safely - checks existence before operating
async function cleanupPreviewArtifacts() {
    // 1. Delete DTF_ShirtBG if it exists (DOM check first, no error spam)
    const shirtBg = findLayerByName("DTF_ShirtBG");
    if (shirtBg) {
        try { await shirtBg.delete(); } catch(e) { console.log("delete shirtBG:", e.message); }
    }

    // 2. Find and select the DTF_Working layer
    const workingLayer = findLayerByName("DTF_Working");
    if (!workingLayer) return; // Nothing more to do

    try {
        await action.batchPlay([{
            _obj:"select",
            _target:[{_ref:"layer",_id:workingLayer.id}],
            makeVisible: false,
            _options:{dialogOptions:"dontDisplay"}
        }], {});
    } catch(e) { console.log("select working:", e.message); }

    // 3. Switch back to composite channel view (covers RGB or Grayscale modes)
    const docMode = app.activeDocument.mode;
    const compositeChannel = (docMode === "Grayscale") ? "gray" : "RGB";
    try {
        await action.batchPlay([{
            _obj:"select",
            _target:[{_ref:"channel",_enum:"channel",_value:compositeChannel}],
            makeVisible: false,
            _options:{dialogOptions:"dontDisplay"}
        }], {});
    } catch(e) { console.log("select channel:", e.message); }

    // 4. Re-enable mask (in case Original mode disabled it)
    try {
        await action.batchPlay([{
            _obj:"set",
            _target:[
                {_ref:"property",_property:"userMaskEnabled"},
                {_ref:"layer",_id:workingLayer.id}
            ],
            to: true,
            _options:{dialogOptions:"dontDisplay"}
        }], {});
    } catch(e) { console.log("enable mask:", e.message); }
}

// ============ CORE PIPELINE ============
async function runFullPipeline(isFirstRun) {
    const doKnockout = document.getElementById("enable-knockout").checked;
    const fuzz = parseInt(document.getElementById("knockout-fuzziness").value) || 40;
    const isLight = document.getElementById("shirt-mode").value === "light";
    const doHalftone = document.getElementById("enable-halftone").checked;
    const freq = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const ang = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shp = document.getElementById("halftone-shape").value;
    const wPt = parseInt(document.getElementById("adj-white-point").value);
    const bPt = parseInt(document.getElementById("adj-black-point").value);
    const gamma = parseFloat(document.getElementById("adj-gray-point").value);
    const boost = parseInt(document.getElementById("adj-boost-shadow").value);
    const bgFill = isLight ? "white" : "black";

    await core.executeAsModal(async (ctx) => {
        const susp = await ctx.hostControl.suspendHistory({
            documentID: app.activeDocument.id,
            name: isFirstRun ? "DTF Render" : "DTF Update"
        });

        try {
            if (isFirstRun) {
                try { await action.batchPlay([{_obj:"delete",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {}); } catch(e) {}
                console.log("snapshot");
                await action.batchPlay([{_obj:"make",_target:[{_ref:"snapshotClass"}],from:{_ref:"historyState",_enum:"ordinal",_value:"targetEnum"},name:"DTF_Snapshot",using:{_enum:"historyState",_value:"fullDocument"},_options:{dialogOptions:"dontDisplay"}}], {});
            } else {
                console.log("revert to snapshot");
                await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});
            }

            console.log("duplicate");
            await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:"DTF_Working",_options:{dialogOptions:"dontDisplay"}}], {});

            if (doKnockout) {
                console.log("color knockout r="+knockoutColor.r+" g="+knockoutColor.g+" b="+knockoutColor.b+" fuzz="+fuzz);
                await colorKnockoutOnActiveLayer(knockoutColor.r, knockoutColor.g, knockoutColor.b, fuzz);
            }

            console.log("create bg layer fill="+bgFill);
            await action.batchPlay([{_obj:"make",_target:[{_ref:"layer"}],_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"move",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"layer",_enum:"ordinal",_value:"back"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"fill",using:{_enum:"fillContents",_value:bgFill},opacity:{_unit:"percentUnit",_value:100},mode:{_enum:"blendMode",_value:"normal"},_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("flatten");
            await action.batchPlay([{_obj:"flattenImage",_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("grayscale");
            await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},merge:false,_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("levels b="+bPt+" w="+wPt+" g="+gamma+" boost="+boost);
            await action.batchPlay([{_obj:"levels",presetKind:{_enum:"presetKindType",_value:"presetKindCustom"},adjustment:[{_obj:"levelsAdjustment",channel:{_ref:"channel",_enum:"channel",_value:"composite"},input:[bPt,wPt],output:[Math.min(255,boost),255],gamma:gamma}],_options:{dialogOptions:"dontDisplay"}}], {});

            if (doHalftone) {
                const d = await action.batchPlay([{_obj:"get",_target:[{_ref:"document",_enum:"ordinal",_value:"targetEnum"}],_options:{dialogOptions:"dontDisplay"}}], {});
                const res = d[0].resolution._value || d[0].resolution || 300;
                console.log("halftone f="+freq+" a="+ang+" s="+shp+" res="+res);
                await action.batchPlay([{_obj:"convertMode",to:{_class:"bitmapMode"},resolution:{_unit:"densityUnit",_value:res},method:{_enum:"method",_value:"halftoneScreen"},frequency:{_unit:"densityUnit",_value:freq},angle:{_unit:"angleUnit",_value:ang},shape:{_enum:"halftoneShape",_value:shp},_options:{dialogOptions:"dontDisplay"}}], {});
                console.log("bitmap to gray");
                await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},sizeRatio:1,_options:{dialogOptions:"dontDisplay"}}], {});
            }

            if (isLight) {
                console.log("invert (light shirt)");
                await action.batchPlay([{_obj:"invert",_options:{dialogOptions:"dontDisplay"}}], {});
            }

            console.log("select all + copy");
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"copyEvent",_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("revert");
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Duplicate so we keep the original layer untouched and put the mask on a copy
            await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:"DTF_Working",_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("add mask");
            try {
                await action.batchPlay([{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"},_options:{dialogOptions:"dontDisplay"}}], {});
            } catch(e) { console.log("mask make:", e.message); }

            try {
                await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"channel",_enum:"channel",_value:"mask"},_options:{dialogOptions:"dontDisplay"}}], {});
            } catch(e) {}

            console.log("paste");
            await action.batchPlay([{_obj:"paste",antiAlias:{_enum:"antiAliasType",_value:"none"},as:{_class:"pixel"},_options:{dialogOptions:"dontDisplay"}}], {});

            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Switch back to RGB composite view (not mask)
            try {
                await action.batchPlay([{_obj:"select",_target:[{_ref:"channel",_enum:"channel",_value:"RGB"}],makeVisible:false,_options:{dialogOptions:"dontDisplay"}}], {});
            } catch(e) {}

            console.log("=== PIPELINE DONE ===");
        } finally {
            await ctx.hostControl.resumeHistory(susp);
        }
    }, {commandName: isFirstRun ? "DTPREP" : "Update Halftone"});

    // Re-apply current preview mode after re-render
    await applyPreviewMode(currentPreviewMode);
}

// ============ PREVIEW MODES ============
async function applyPreviewMode(mode) {
    currentPreviewMode = mode;
    try {
        await core.executeAsModal(async () => {
            // Always clean up preview artifacts and reset to a known state first
            await cleanupPreviewArtifacts();

            const workingLayer = findLayerByName("DTF_Working");
            if (!workingLayer) {
                console.log("Preview: no DTF_Working layer (run DTPREP first)");
                return;
            }

            if (mode === "original") {
                console.log("preview: original (mask disabled)");
                try {
                    await action.batchPlay([{
                        _obj:"set",
                        _target:[
                            {_ref:"property",_property:"userMaskEnabled"},
                            {_ref:"layer",_id:workingLayer.id}
                        ],
                        to: false,
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) { console.log("disable mask:", e.message); }
            } else if (mode === "shirt") {
                console.log("preview: shirt (BG="+shirtColor.r+","+shirtColor.g+","+shirtColor.b+")");
                // Make a new layer (becomes the active layer)
                try {
                    await action.batchPlay([{_obj:"make",_target:[{_ref:"layer"}],_options:{dialogOptions:"dontDisplay"}}], {});
                } catch(e) { console.log("make BG layer:", e.message); return; }

                // Rename to DTF_ShirtBG
                try {
                    await action.batchPlay([{
                        _obj:"set",
                        _target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],
                        to:{_obj:"layer",name:"DTF_ShirtBG"},
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) { console.log("rename BG:", e.message); }

                // Move to bottom
                try {
                    await action.batchPlay([{
                        _obj:"move",
                        _target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],
                        to:{_ref:"layer",_enum:"ordinal",_value:"back"},
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) { console.log("move BG:", e.message); }

                // Set foreground color and fill
                try {
                    await action.batchPlay([{
                        _obj:"set",
                        _target:[{_ref:"color",_property:"foregroundColor"}],
                        to:{_obj:"RGBColor",red:shirtColor.r,grain:shirtColor.g,blue:shirtColor.b},
                        source:"photoshopPicker",
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                    await action.batchPlay([{
                        _obj:"fill",
                        using:{_enum:"fillContents",_value:"foregroundColor"},
                        opacity:{_unit:"percentUnit",_value:100},
                        mode:{_enum:"blendMode",_value:"normal"},
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) { console.log("fill BG:", e.message); }

                // Re-select working layer
                try {
                    await action.batchPlay([{
                        _obj:"select",
                        _target:[{_ref:"layer",_id:workingLayer.id}],
                        makeVisible: false,
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) {}
            } else if (mode === "alpha") {
                console.log("preview: alpha (transparent)");
                // Default state - mask is enabled, no BG, transparent shows through
            } else if (mode === "mask") {
                console.log("preview: mask channel");
                try {
                    await action.batchPlay([{
                        _obj:"select",
                        _target:[{_ref:"channel",_enum:"channel",_value:"mask"}],
                        makeVisible: true,
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) { console.log("select mask channel:", e.message); }
            }
        }, {commandName:"Preview Mode"});
    } catch(e) { console.error("Preview mode error:", e.message); }
}

async function runDTPrep() {
    console.log("=== DTPREP START ===");
    try {
        await runFullPipeline(true);
        document.getElementById("view-main").style.display = "none";
        document.getElementById("view-adjust").style.display = "block";
        // Reset preview mode UI to alpha (default)
        document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
        const alphaBtn = document.querySelector('.tab-btn[data-mode="alpha"]');
        if (alphaBtn) alphaBtn.classList.add("active");
        currentPreviewMode = "alpha";
    } catch(e) { console.error("DTPREP ERROR:", e.message, e); }
}

async function updateLevels() {
    try { await runFullPipeline(false); }
    catch(e) { console.error("Update err:", e.message, e); }
}

async function applyDTPrep() {
    console.log("=== APPLY ===");
    // Just clean up any preview-only artifacts (DTF_ShirtBG layer); keep the halftone result
    try {
        await core.executeAsModal(async () => {
            const shirtBg = findLayerByName("DTF_ShirtBG");
            if (shirtBg) {
                try { await shirtBg.delete(); } catch(e) {}
            }
            // Re-enable mask in case Original mode was active
            const workingLayer = findLayerByName("DTF_Working");
            if (workingLayer) {
                try {
                    await action.batchPlay([{
                        _obj:"set",
                        _target:[
                            {_ref:"property",_property:"userMaskEnabled"},
                            {_ref:"layer",_id:workingLayer.id}
                        ],
                        to: true,
                        _options:{dialogOptions:"dontDisplay"}
                    }], {});
                } catch(e) {}
            }
        }, {commandName:"Apply"});
    } catch(e) { console.error("Apply err:", e.message); }
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
    refreshCanvasInfo();
}

async function cancelDTPrep() {
    console.log("=== CANCEL ===");
    try {
        await core.executeAsModal(async () => {
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});
        }, {commandName:"Cancel"});
    } catch(e) { console.error("Cancel err:", e.message); }
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
}

function resetSliders() {
    document.getElementById("adj-white-point").value=255; document.getElementById("adj-white-point-val").value=255;
    document.getElementById("adj-black-point").value=0; document.getElementById("adj-black-point-val").value=0;
    document.getElementById("adj-gray-point").value=1.0; document.getElementById("adj-gray-point-val").value=1.0;
    document.getElementById("adj-boost-shadow").value=0; document.getElementById("adj-boost-shadow-val").value=0;
    updateLevels();
}

function openHalftoneDialog() { document.getElementById("dialog-enable-halftone").checked=document.getElementById("enable-halftone").checked; document.getElementById("dialog-halftone-shape").value=document.getElementById("halftone-shape").value; document.getElementById("dialog-frequency").value=document.getElementById("halftone-frequency").value; document.getElementById("dialog-angle").value=document.getElementById("halftone-angle").value; document.getElementById("dialog-halftone").style.display="flex"; }
function closeHalftoneDialog() { document.getElementById("enable-halftone").checked=document.getElementById("dialog-enable-halftone").checked; document.getElementById("halftone-shape").value=document.getElementById("dialog-halftone-shape").value; document.getElementById("halftone-frequency").value=document.getElementById("dialog-frequency").value; document.getElementById("halftone-angle").value=document.getElementById("dialog-angle").value; document.getElementById("dialog-halftone").style.display="none"; updateLevels(); }

let debounceTimer = null;
document.addEventListener("DOMContentLoaded", function() {
    console.log("=== DTF v8 LOADED ===");
    refreshCanvasInfo();

    // Knockout color swatch
    document.getElementById("swatch-knockout").addEventListener("click", async ()=>{
        const c = await openColorPicker(knockoutColor);
        if(c){ knockoutColor=c; document.getElementById("swatch-knockout-fill").style.backgroundColor=rgbToHex(c.r,c.g,c.b); }
    });
    document.getElementById("swatch-knockout-fill").style.backgroundColor=rgbToHex(knockoutColor.r,knockoutColor.g,knockoutColor.b);

    // Shirt preview swatch
    document.getElementById("swatch-shirt").addEventListener("click", async ()=>{
        const c = await openColorPicker(shirtColor);
        if(c){
            shirtColor=c;
            document.getElementById("swatch-shirt-fill").style.backgroundColor=rgbToHex(c.r,c.g,c.b);
            // If currently in shirt preview, refresh with new color
            if (currentPreviewMode === "shirt") await applyPreviewMode("shirt");
        }
    });
    document.getElementById("swatch-shirt-fill").style.backgroundColor=rgbToHex(shirtColor.r,shirtColor.g,shirtColor.b);

    // Buttons
    document.getElementById("btn-run-dtprep").addEventListener("click", ()=>{ runDTPrep(); });
    document.getElementById("btn-apply").addEventListener("click", ()=>{ applyDTPrep(); });
    document.getElementById("btn-cancel").addEventListener("click", ()=>{ cancelDTPrep(); });
    document.getElementById("btn-default-sliders").addEventListener("click", resetSliders);
    document.getElementById("btn-edit-halftones").addEventListener("click", openHalftoneDialog);
    document.getElementById("btn-close-dialog").addEventListener("click", closeHalftoneDialog);
    document.getElementById("btn-dialog-ok").addEventListener("click", closeHalftoneDialog);

    // Sliders
    [["adj-white-point","adj-white-point-val"],["adj-black-point","adj-black-point-val"],["adj-gray-point","adj-gray-point-val"],["adj-boost-shadow","adj-boost-shadow-val"]].forEach(p=>{
        const r=document.getElementById(p[0]),n=document.getElementById(p[1]);
        r.addEventListener("input",()=>{n.value=r.value; if(debounceTimer)clearTimeout(debounceTimer); debounceTimer=setTimeout(updateLevels,250);});
        r.addEventListener("mouseup",()=>{ if(debounceTimer)clearTimeout(debounceTimer); updateLevels(); });
        n.addEventListener("change",()=>{r.value=n.value; updateLevels();});
    });

    // Shirt mode and knockout toggle
    document.getElementById("shirt-mode").addEventListener("change", ()=>{ updateLevels(); });
    document.getElementById("enable-knockout").addEventListener("change", ()=>{ updateLevels(); });

    // Fuzziness slider
    const fuzzR=document.getElementById("knockout-fuzziness"), fuzzN=document.getElementById("knockout-fuzziness-val");
    fuzzR.addEventListener("input",()=>{fuzzN.value=fuzzR.value;});
    fuzzR.addEventListener("mouseup",()=>{ updateLevels(); });
    fuzzN.addEventListener("change",()=>{ fuzzR.value=fuzzN.value; updateLevels(); });

    // Preview tabs
    document.querySelectorAll(".tab-btn").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
            document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
            btn.classList.add("active");
            const mode = btn.getAttribute("data-mode");
            await applyPreviewMode(mode);
        });
    });
});
