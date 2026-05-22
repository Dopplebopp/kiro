// DTF Halftone Pro v6 - Light/Dark shirt knockout via brightness
// Run DTPREP: snapshot -> dup -> fill BG -> flatten -> grayscale -> levels -> halftone -> [invert] -> mask
const {app, action, core} = require("photoshop");

let shirtColor = {r: 0, g: 0, b: 0};

function rgbToHex(r,g,b) { return "#"+[r,g,b].map(c=>Math.round(c).toString(16).padStart(2,"0")).join(""); }

// Opens PS native color picker, pre-loaded with starting color
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

// ============ CORE PIPELINE ============
// Runs the full halftone pipeline. Used by both Run DTPREP and slider re-runs.
async function runFullPipeline(isFirstRun) {
    const doKnockout = document.getElementById("enable-knockout").checked;
    const isLight = document.getElementById("shirt-mode").value === "light";
    const doHalftone = document.getElementById("enable-halftone").checked;
    const freq = parseInt(document.getElementById("halftone-frequency").value) || 20;
    const ang = parseInt(document.getElementById("halftone-angle").value) || 33;
    const shp = document.getElementById("halftone-shape").value;
    const wPt = parseInt(document.getElementById("adj-white-point").value);
    const bPt = parseInt(document.getElementById("adj-black-point").value);
    const gamma = parseFloat(document.getElementById("adj-gray-point").value);
    const boost = parseInt(document.getElementById("adj-boost-shadow").value);

    // For light shirt: fill transparency with WHITE so it gets knocked out as no-print
    // For dark shirt: fill transparency with BLACK so it stays as no-print
    const bgFill = isLight ? "white" : "black";

    await core.executeAsModal(async () => {
        if (isFirstRun) {
            // First run: take a snapshot for revert
            console.log("snapshot");
            await action.batchPlay([{_obj:"make",_target:[{_ref:"snapshotClass"}],from:{_ref:"historyState",_enum:"ordinal",_value:"targetEnum"},name:"DTF_Snapshot",using:{_enum:"historyState",_value:"fullDocument"},_options:{dialogOptions:"dontDisplay"}}], {});
        } else {
            // Subsequent runs: revert to snapshot first
            console.log("revert to snapshot");
            await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});
        }

        // Duplicate the active layer so we work on a copy
        console.log("duplicate");
        await action.batchPlay([{_obj:"duplicate",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],name:"DTF_Working",_options:{dialogOptions:"dontDisplay"}}], {});

        // Create a background layer below filled with bgFill color
        console.log("create bg layer fill="+bgFill);
        await action.batchPlay([
            {_obj:"make",_target:[{_ref:"layer"}],_options:{dialogOptions:"dontDisplay"}},
            {_obj:"move",_target:[{_ref:"layer",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"layer",_enum:"ordinal",_value:"back"},_options:{dialogOptions:"dontDisplay"}},
            {_obj:"fill",using:{_enum:"fillContents",_value:bgFill},opacity:{_unit:"percentUnit",_value:100},mode:{_enum:"blendMode",_value:"normal"},_options:{dialogOptions:"dontDisplay"}}
        ], {});

        // Flatten everything
        console.log("flatten");
        await action.batchPlay([{_obj:"flattenImage",_options:{dialogOptions:"dontDisplay"}}], {});

        // Convert to grayscale
        console.log("grayscale");
        await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});

        // Apply levels
        console.log("levels b="+bPt+" w="+wPt+" g="+gamma+" boost="+boost);
        await action.batchPlay([{_obj:"levels",presetKind:{_enum:"presetKindType",_value:"presetKindCustom"},adjustment:[{_obj:"levelsAdjustment",channel:{_ref:"channel",_enum:"channel",_value:"composite"},input:[bPt,wPt],output:[Math.min(255,boost),255],gamma:gamma}],_options:{dialogOptions:"dontDisplay"}}], {});

        // Halftone via bitmap conversion
        if (doHalftone) {
            const d = await action.batchPlay([{_obj:"get",_target:[{_ref:"document",_enum:"ordinal",_value:"targetEnum"}],_options:{dialogOptions:"dontDisplay"}}], {});
            const res = d[0].resolution._value || d[0].resolution || 300;
            console.log("halftone f="+freq+" a="+ang+" s="+shp+" res="+res);
            await action.batchPlay([{_obj:"convertMode",to:{_class:"bitmapMode"},resolution:{_unit:"densityUnit",_value:res},method:{_enum:"method",_value:"halftoneScreen"},frequency:{_unit:"densityUnit",_value:freq},angle:{_unit:"angleUnit",_value:ang},shape:{_enum:"halftoneShape",_value:shp},_options:{dialogOptions:"dontDisplay"}}], {});
            // Back to grayscale so we can copy
            await action.batchPlay([{_obj:"convertMode",to:{_class:"grayscaleMode"},_options:{dialogOptions:"dontDisplay"}}], {});
        }

        // For light shirt, INVERT the halftone: dark areas of original become white in mask = visible
        // For dark shirt, no invert: bright areas of original become white in mask = visible
        if (doKnockout && isLight) {
            console.log("invert (light shirt)");
            await action.batchPlay([{_obj:"invert",_options:{dialogOptions:"dontDisplay"}}], {});
        }

        // Select all and copy the halftone
        console.log("select all + copy");
        await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"allEnum"},_options:{dialogOptions:"dontDisplay"}}], {});
        await action.batchPlay([{_obj:"copyEvent",_options:{dialogOptions:"dontDisplay"}}], {});

        // Revert to snapshot to get back the original artwork
        console.log("revert");
        await action.batchPlay([{_obj:"select",_target:[{_ref:"snapshotClass",_name:"DTF_Snapshot"}],_options:{dialogOptions:"dontDisplay"}}], {});

        // Add a layer mask
        console.log("add mask");
        await action.batchPlay([{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"},_options:{dialogOptions:"dontDisplay"}}], {});

        // Activate the mask channel
        await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_enum:"ordinal",_value:"targetEnum"}],to:{_ref:"channel",_enum:"channel",_value:"mask"},_options:{dialogOptions:"dontDisplay"}}], {});

        // Paste the halftone into the mask
        console.log("paste into mask");
        await action.batchPlay([{_obj:"paste",antiAlias:{_enum:"antiAliasType",_value:"none"},as:{_class:"pixel"},_options:{dialogOptions:"dontDisplay"}}], {});

        // Deselect and re-select the layer (not the mask) so user can keep working
        await action.batchPlay([{_obj:"set",_target:[{_ref:"channel",_property:"selection"}],to:{_enum:"ordinal",_value:"none"},_options:{dialogOptions:"dontDisplay"}}], {});

        console.log("=== PIPELINE DONE ===");
    }, {commandName: isFirstRun ? "DTPREP" : "Update Halftone"});
}

async function runDTPrep() {
    console.log("=== DTPREP START ===");
    try {
        await runFullPipeline(true);
        document.getElementById("view-main").style.display = "none";
        document.getElementById("view-adjust").style.display = "block";
    } catch(e) { console.error("DTPREP ERROR:", e.message); }
}

async function updateLevels() {
    try { await runFullPipeline(false); }
    catch(e) { console.error("Update err:", e.message); }
}

async function applyDTPrep() {
    console.log("=== APPLY (accept current result) ===");
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
    console.log("=== DTF v6 LOADED ===");
    refreshCanvasInfo();

    // Shirt preview color swatch
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

    // Sliders trigger live re-run
    [["adj-white-point","adj-white-point-val"],["adj-black-point","adj-black-point-val"],["adj-gray-point","adj-gray-point-val"],["adj-boost-shadow","adj-boost-shadow-val"]].forEach(p=>{
        const r=document.getElementById(p[0]),n=document.getElementById(p[1]);
        r.addEventListener("input",()=>{n.value=r.value; if(debounceTimer)clearTimeout(debounceTimer); debounceTimer=setTimeout(updateLevels,200);});
        r.addEventListener("mouseup",()=>{ if(debounceTimer)clearTimeout(debounceTimer); updateLevels(); });
        n.addEventListener("change",()=>{r.value=n.value; updateLevels();});
    });

    // Shirt mode change triggers re-run
    document.getElementById("shirt-mode").addEventListener("change", ()=>{ updateLevels(); });
    document.getElementById("enable-knockout").addEventListener("change", ()=>{ updateLevels(); });
});
