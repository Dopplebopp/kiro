// DTF Halftone Pro v5 - Correct DTF workflow
// Run DTPREP: dup → knockout → grayscale → levels (live adjust)
// Apply: flatten → bitmap halftone → copy → paste as mask on original
const {app, action, core} = require("photoshop");

let knockoutColor = {r: 255, g: 255, b: 255};
let shirtColor = {r: 0, g: 0, b: 0};
let originalDocState = null; // snapshot name for undo

function hsbToRgb(h, s, b) {
    const hi = Math.floor(h/60)%6; const f = h/60-Math.floor(h/60);
    const v = b/100; const p = v*(1-s/100); const q = v*(1-f*s/100); const t = v*(1-(1-f)*s/100);
    let r,g,bl;
    if(hi===0){r=v;g=t;bl=p;}else if(hi===1){r=q;g=v;bl=p;}else if(hi===2){r=p;g=v;bl=t;}
    else if(hi===3){r=p;g=q;bl=v;}else if(hi===4){r=t;g=p;bl=v;}else{r=v;g=p;bl=q;}
    return {r:Math.round(r*255),g:Math.round(g*255),b:Math.round(bl*255)};
}
function rgbToHex(r,g,b) { return "#"+[r,g,b].map(c=>Math.round(c).toString(16).padStart(2,"0")).join(""); }

async function grabForegroundColor() {
    let color = null;
    await core.executeAsModal(async () => {
        const fg = await action.batchPlay([{_obj:"get",_target:[{_ref:"property",_property:"foregroundColor"},{_ref:"application"}],_options:{dialogOptions:"dontDisplay"}}], {});
        const c = fg[0].foregroundColor;
        if (c._obj === "RGBColor") { color = {r:Math.round(c.red),g:Math.round(c.grain),b:Math.round(c.blue)}; }
        else if (c._obj === "HSBColorClass") { const h=c.hue._value||c.hue; color = hsbToRgb(h, c.saturation, c.brightness); }
        else if (c._obj === "CMYKColorClass") { color = {r:Math.round(255*(1-c.cyan/100)*(1-c.black/100)),g:Math.round(255*(1-c.magenta/100)*(1-c.black/100)),b:Math.round(255*(1-c.yellowColor/100)*(1-c.black/100))}; }
        if (color) console.log("Got color:", color.r, color.g, color.b);
    }, {commandName: "Grab Color"});
    return color;
}

// Opens PS native color picker, pre-loaded with a starting color, returns picked RGB or null if cancelled
async function openColorPicker(startColor) {
    let color = null;
    await core.executeAsModal(async () => {
        // Set the foreground to the starting color so the picker opens with it
        await action.batchPlay([{
            _obj: "set",
            _target: [{_ref: "color", _property: "foregroundColor"}],
            to: {_obj: "RGBColor", red: startColor.r, grain: startColor.g, blue: startColor.b},
            source: "photoshopPicker",
            _options: {dialogOptions: "dontDisplay"}
        }], {});

        // Open the native color picker dialog
        const result = await action.batchPlay([{
            _obj: "showColorPicker",
            _target: [{_ref: "application"}]
        }], {});

        // Read the picked color from the result
        if (result && result[0] && result[0].RGBFloatColor) {
            const c = result[0].RGBFloatColor;
            color = {r: Math.round(c.red), g: Math.round(c.grain), b: Math.round(c.blue)};
        } else {
            // Fallback: read foreground color (picker may have changed it)
            const fg = await action.batchPlay([{_obj:"get",_target:[{_ref:"property",_property:"foregroundColor"},{_ref:"application"}],_options:{dialogOptions:"dontDisplay"}}], {});
            const c = fg[0].foregroundColor;
            if (c._obj === "RGBColor") {
                color = {r: Math.round(c.red), g: Math.round(c.grain), b: Math.round(c.blue)};
            }
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

// ============ RUN DTPREP ============
// Full pipeline: snapshot → knockout → flatten → grayscale → levels → halftone → copy → revert → paste as mask
// The halftone is applied immediately using the current settings.
// After running, the adjustment view is shown so the user can tweak levels and re-apply.
async function runDTPrep() {
    console.log("=== DTPREP START ===");
    const doKnockout = document.getElementById("enable-knockout").checked;
    const fuzz = parseInt(document.getElementById("knockout-fuzziness").value) || 40;
    const doHalftone = document.getElementById("enable-halftone").checked;
    const freq = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const ang = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shp = document.getElementById("halftone-shape").value;
    const wPt = parseInt(document.getElementById("adj-white-point").value);
    const bPt = parseInt(document.getElementById("adj-black-point").value);
    const gamma = parseFloat(document.getElementById("adj-gray-point").value);
    const boost = parseInt(document.getElementById("adj-boost-shadow").value);

    try {
        await core.executeAsModal(async () => {
            // Save snapshot for cancel/undo
            console.log("0-snapshot");
            await action.batchPlay([{_obj:"make",_target:[{_ref:"snapshotClass"}],from:{_ref:"historyState",_enum:"ordinal",_value:"targetEnum"},name:"DTF_Snapshot",using:{_enum:"historyState",_value:"fullDocument"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Duplicate layer
            console.log("1-dup");
            await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:"DTF_Working",_options:{dialogOptions:"dontDisplay"}}], {});

            // Color knockout
            if (doKnockout) {
                console.log("2-unlock");
                try { await action.batchPlay([{_obj:"set",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_obj:"layer",name:"DTF_Working"},_options:{dialogOptions:"dontDisplay"}}], {}); } catch(e){}
                console.log("2-knockout r="+knockoutColor.r+" g="+knockoutColor.g+" b="+knockoutColor.b+" fuzz="+fuzz);
                await action.batchPlay([{_obj:"colorRange",fuzziness:fuzz,minimum:{_obj:"RGBColor",red:knockoutColor.r,grain:knockoutColor.g,blue:knockoutColor.b},maximum:{_obj:"RGBColor",red:knockoutColor.r,grain:knockoutColor.g,blue:knockoutColor.b},_options:{dialogOptions:"dontDisplay"}}], {});
                await action.batchPlay([{_obj:"delete",_options:{dialogOptions:"dontDisplay"}}], {});
                await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});
            }

            // Flatten
            console.log("3-flatten");
            await action.batchPlay([{_obj:"flattenImage",_options:{dialogOptions:"dontDisplay"}}], {});

            // Convert to grayscale
            console.log("4-grayscale");
            await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Apply levels adjustment (using current slider values)
            console.log("5-levels bPt="+bPt+" wPt="+wPt+" gamma="+gamma+" boost="+boost);
            await action.batchPlay([{_obj:"levels",presetKind:{_enum:"presetKindType",_value:"presetKindCustom"},adjustment:[{_obj:"levelsAdjustment",channel:{_ref:"channel",_enum:"channel",_value:"composite"},input:[bPt,wPt],output:[Math.min(255,boost),255],gamma:gamma}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Apply halftone
            if (doHalftone) {
                const d = await action.batchPlay([{_obj:"get",_target:[{_ref:"document",_enum:"ordinal",_value:"targetEnum"}],_options:{dialogOptions:"dontDisplay"}}], {});
                const res = d[0].resolution._value || d[0].resolution || 300;

                console.log("6-halftone f="+freq+" a="+ang+" s="+shp+" res="+res);
                await action.batchPlay([{_obj:"convertMode",to:{_class:"bitmapMode"},resolution:{_unit:"densityUnit",_value:res},method:{_enum:"method",_value:"halftoneScreen"},frequency:{_unit:"densityUnit",_value:freq},angle:{_unit:"angleUnit",_value:ang},shape:{_enum:"halftoneShape",_value:shp},_options:{dialogOptions:"dontDisplay"}}], {});

                // Convert back to grayscale so we can copy
                console.log("7-back to gray");
                await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});
            }

            // Select all and copy
            console.log("8-select all + copy");
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"copyEvent",_options:{dialogOptions:"dontDisplay"}}], {});

            // Revert to original snapshot
            console.log("9-revert to snapshot");
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Add layer mask to active layer
            console.log("10-add mask");
            await action.batchPlay([{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Select the mask channel
            console.log("11-select mask");
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"channel",_enum:"channel",_value:"mask"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Paste the halftone into the mask
            console.log("12-paste into mask");
            await action.batchPlay([{_obj:"paste",antiAlias:{_enum:"antiAliasType",_value:"none"},as:{_class:"pixel"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Deselect
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("=== DTPREP DONE - halftone applied as mask ===");
        }, {commandName:"DTPREP"});

        // Switch to adjustment view so user can tweak and re-apply
        document.getElementById("view-main").style.display = "none";
        document.getElementById("view-adjust").style.display = "block";
    } catch(e) { console.error("DTPREP ERROR:", e.message); }
}

// ============ LIVE LEVELS UPDATE ============
// When sliders change, re-run the entire halftone pipeline with new values
async function updateLevels() {
    const wPt = parseInt(document.getElementById("adj-white-point").value);
    const bPt = parseInt(document.getElementById("adj-black-point").value);
    const gamma = parseFloat(document.getElementById("adj-gray-point").value);
    const boost = parseInt(document.getElementById("adj-boost-shadow").value);
    const doKnockout = document.getElementById("enable-knockout").checked;
    const fuzz = parseInt(document.getElementById("knockout-fuzziness").value) || 40;
    const doHalftone = document.getElementById("enable-halftone").checked;
    const freq = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const ang = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shp = document.getElementById("halftone-shape").value;

    try {
        await core.executeAsModal(async () => {
            // Revert to snapshot (undo previous halftone result)
            console.log("RE-RUN: reverting to snapshot");
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Duplicate layer
            await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:"DTF_Working",_options:{dialogOptions:"dontDisplay"}}], {});

            // Color knockout
            if (doKnockout) {
                try { await action.batchPlay([{_obj:"set",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_obj:"layer",name:"DTF_Working"},_options:{dialogOptions:"dontDisplay"}}], {}); } catch(e){}
                await action.batchPlay([{_obj:"colorRange",fuzziness:fuzz,minimum:{_obj:"RGBColor",red:knockoutColor.r,grain:knockoutColor.g,blue:knockoutColor.b},maximum:{_obj:"RGBColor",red:knockoutColor.r,grain:knockoutColor.g,blue:knockoutColor.b},_options:{dialogOptions:"dontDisplay"}}], {});
                await action.batchPlay([{_obj:"delete",_options:{dialogOptions:"dontDisplay"}}], {});
                await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});
            }

            // Flatten
            await action.batchPlay([{_obj:"flattenImage",_options:{dialogOptions:"dontDisplay"}}], {});

            // Convert to grayscale
            await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});

            // Apply levels with current slider values
            console.log("RE-RUN: levels bPt="+bPt+" wPt="+wPt+" gamma="+gamma);
            await action.batchPlay([{_obj:"levels",presetKind:{_enum:"presetKindType",_value:"presetKindCustom"},adjustment:[{_obj:"levelsAdjustment",channel:{_ref:"channel",_enum:"channel",_value:"composite"},input:[bPt,wPt],output:[Math.min(255,boost),255],gamma:gamma}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Halftone
            if (doHalftone) {
                const d = await action.batchPlay([{_obj:"get",_target:[{_ref:"document",_enum:"ordinal",_value:"targetEnum"}],_options:{dialogOptions:"dontDisplay"}}], {});
                const res = d[0].resolution._value || d[0].resolution || 300;
                await action.batchPlay([{_obj:"convertMode",to:{_class:"bitmapMode"},resolution:{_unit:"densityUnit",_value:res},method:{_enum:"method",_value:"halftoneScreen"},frequency:{_unit:"densityUnit",_value:freq},angle:{_unit:"angleUnit",_value:ang},shape:{_enum:"halftoneShape",_value:shp},_options:{dialogOptions:"dontDisplay"}}], {});
                await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});
            }

            // Copy result
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"copyEvent",_options:{dialogOptions:"dontDisplay"}}], {});

            // Revert to snapshot
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});

            // Add mask + paste
            await action.batchPlay([{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"channel",_enum:"channel",_value:"mask"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"paste",antiAlias:{_enum:"antiAliasType",_value:"none"},as:{_class:"pixel"},_options:{dialogOptions:"dontDisplay"}}], {});
            await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});

            console.log("RE-RUN: halftone updated with new levels");
        }, {commandName:"Levels"});
    } catch(e) { console.error("Levels err:", e.message); }
}

// ============ APPLY ============
// The halftone is already applied as a mask. "Apply" just accepts the current result and closes the adjustment view.
async function applyDTPrep() {
    console.log("=== APPLY - accepting current halftone result ===");
    document.getElementById("view-adjust").style.display = "none";
    document.getElementById("view-main").style.display = "block";
    refreshCanvasInfo();
}

// ============ CANCEL (revert to snapshot) ============
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

// ============ PREVIEW MODES ============
async function setPreviewMode(mode) {
    // In this version, we're in grayscale mode during adjustment
    // Original/Shirt/Alpha/Mask toggles don't fully apply here
    // But we can at least toggle the levels layer visibility
    try {
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (mode === "mask") {
                // Show with levels applied (what will become halftone)
                for (let i=0;i<doc.layers.length;i++) doc.layers[i].visible = true;
            } else if (mode === "original") {
                // Hide levels to see grayscale without adjustment
                for (let i=0;i<doc.layers.length;i++) {
                    doc.layers[i].visible = (doc.layers[i].name !== "DTF_Levels");
                }
            }
        }, {commandName:"Preview"});
    } catch(e){}
}

function resetSliders() {
    document.getElementById("adj-white-point").value=255; document.getElementById("adj-white-point-val").value=255;
    document.getElementById("adj-black-point").value=0; document.getElementById("adj-black-point-val").value=0;
    document.getElementById("adj-gray-point").value=1.0; document.getElementById("adj-gray-point-val").value=1.0;
    document.getElementById("adj-boost-shadow").value=0; document.getElementById("adj-boost-shadow-val").value=0;
    updateLevels();
}

function openHalftoneDialog() { document.getElementById("dialog-enable-halftone").checked=document.getElementById("enable-halftone").checked; document.getElementById("dialog-halftone-shape").value=document.getElementById("halftone-shape").value; document.getElementById("dialog-frequency").value=document.getElementById("halftone-frequency").value; document.getElementById("dialog-angle").value=document.getElementById("halftone-angle").value; document.getElementById("dialog-halftone").style.display="flex"; }
function closeHalftoneDialog() { document.getElementById("enable-halftone").checked=document.getElementById("dialog-enable-halftone").checked; document.getElementById("halftone-shape").value=document.getElementById("dialog-halftone-shape").value; document.getElementById("halftone-frequency").value=document.getElementById("dialog-frequency").value; document.getElementById("halftone-angle").value=document.getElementById("dialog-angle").value; document.getElementById("dialog-halftone").style.display="none"; }

// ============ INIT ============
let debounceTimer = null;
document.addEventListener("DOMContentLoaded", function() {
    console.log("=== DTF v5 LOADED ===");
    refreshCanvasInfo();

    // Color swatches - open native PS color picker on click
    document.getElementById("swatch-knockout").addEventListener("click", async ()=>{
        const c = await openColorPicker(knockoutColor);
        if(c){ knockoutColor=c; document.getElementById("swatch-knockout-fill").style.backgroundColor=rgbToHex(c.r,c.g,c.b); }
    });
    document.getElementById("swatch-shirt").addEventListener("click", async ()=>{
        const c = await openColorPicker(shirtColor);
        if(c){ shirtColor=c; document.getElementById("swatch-shirt-fill").style.backgroundColor=rgbToHex(c.r,c.g,c.b); }
    });

    // Buttons
    document.getElementById("btn-run-dtprep").addEventListener("click", ()=>{ runDTPrep(); });
    document.getElementById("btn-apply").addEventListener("click", ()=>{ applyDTPrep(); });
    document.getElementById("btn-cancel").addEventListener("click", ()=>{ cancelDTPrep(); });
    document.getElementById("btn-default-sliders").addEventListener("click", resetSliders);
    document.getElementById("btn-edit-halftones").addEventListener("click", openHalftoneDialog);
    document.getElementById("btn-close-dialog").addEventListener("click", closeHalftoneDialog);
    document.getElementById("btn-dialog-ok").addEventListener("click", closeHalftoneDialog);

    // Sliders - update on input (debounced) AND on mouseup (immediate)
    [["adj-white-point","adj-white-point-val"],["adj-black-point","adj-black-point-val"],["adj-gray-point","adj-gray-point-val"],["adj-boost-shadow","adj-boost-shadow-val"]].forEach(p=>{
        const r=document.getElementById(p[0]),n=document.getElementById(p[1]);
        r.addEventListener("input",()=>{n.value=r.value; if(debounceTimer)clearTimeout(debounceTimer); debounceTimer=setTimeout(updateLevels,150);});
        r.addEventListener("mouseup",()=>{ if(debounceTimer)clearTimeout(debounceTimer); updateLevels(); });
        n.addEventListener("change",()=>{r.value=n.value; updateLevels();});
    });

    // Fuzziness slider sync
    const fuzzR=document.getElementById("knockout-fuzziness"), fuzzN=document.getElementById("knockout-fuzziness-val");
    fuzzR.addEventListener("input",()=>{fuzzN.value=fuzzR.value;});
    fuzzN.addEventListener("change",()=>{fuzzR.value=fuzzN.value;});

    // Preview tabs
    document.querySelectorAll(".tab-btn").forEach(btn=>{ btn.addEventListener("click",()=>{ document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); setPreviewMode(btn.getAttribute("data-mode")); }); });
});
