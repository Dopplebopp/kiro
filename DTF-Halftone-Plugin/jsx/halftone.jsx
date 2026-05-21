/*
 * DTF Halftone Pro - ExtendScript Backend
 * All Photoshop document manipulation logic
 */

// ============================================================
// UTILITY HELPERS
// ============================================================

function jsonStringify(obj) {
    // Simple JSON stringify for ExtendScript (no native JSON in older PS)
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (typeof obj === 'string') return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    if (obj instanceof Array) {
        var items = [];
        for (var i = 0; i < obj.length; i++) items.push(jsonStringify(obj[i]));
        return '[' + items.join(',') + ']';
    }
    if (typeof obj === 'object') {
        var pairs = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                pairs.push('"' + key + '":' + jsonStringify(obj[key]));
            }
        }
        return '{' + pairs.join(',') + '}';
    }
    return 'null';
}

function ensureDocument() {
    if (!app.documents.length) {
        return false;
    }
    return true;
}

// ============================================================
// CANVAS INSPECTOR
// ============================================================

function getCanvasInfo() {
    if (!ensureDocument()) {
        return jsonStringify({ error: 'No document open' });
    }
    var doc = app.activeDocument;
    var info = {
        width: doc.width.as('px'),
        height: doc.height.as('px'),
        resolution: doc.resolution,
        colorMode: String(doc.mode).replace('DocumentMode.', ''),
        bitDepth: doc.bitsPerChannel.toString().replace('BitsPerChannelType.', ''),
        name: doc.name
    };
    return jsonStringify(info);
}

// ============================================================
// SHIRT PREVIEW LAYER
// ============================================================

function addShirtPreviewLayer(hexColor) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;
    var color = new SolidColor();
    var r = parseInt(hexColor.substr(1, 2), 16);
    var g = parseInt(hexColor.substr(3, 2), 16);
    var b = parseInt(hexColor.substr(5, 2), 16);
    color.rgb.red = r;
    color.rgb.green = g;
    color.rgb.blue = b;

    // Check if shirt layer already exists
    var shirtLayer = null;
    try {
        shirtLayer = doc.artLayers.getByName('DTF_Shirt_Preview');
    } catch (e) {
        // Layer doesn't exist
    }

    if (shirtLayer) {
        // Update existing layer
        doc.activeLayer = shirtLayer;
        // Select all and fill
        doc.selection.selectAll();
        app.foregroundColor = color;
        doc.selection.fill(app.foregroundColor);
        doc.selection.deselect();
    } else {
        // Create new layer at bottom
        var newLayer = doc.artLayers.add();
        newLayer.name = 'DTF_Shirt_Preview';
        newLayer.move(doc.layers[doc.layers.length - 1], ElementPlacement.PLACEAFTER);
        doc.activeLayer = newLayer;
        doc.selection.selectAll();
        app.foregroundColor = color;
        doc.selection.fill(app.foregroundColor);
        doc.selection.deselect();
    }

    return jsonStringify({ success: true, action: 'shirt_preview', color: hexColor });
}

function removeShirtPreviewLayer() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;
    try {
        var shirtLayer = doc.artLayers.getByName('DTF_Shirt_Preview');
        shirtLayer.remove();
        return jsonStringify({ success: true, action: 'remove_shirt' });
    } catch (e) {
        return jsonStringify({ error: 'Shirt preview layer not found' });
    }
}

// ============================================================
// COLOR KNOCKOUT
// ============================================================

function knockoutColor(hexColor, threshold) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;
    var r = parseInt(hexColor.substr(1, 2), 16);
    var g = parseInt(hexColor.substr(3, 2), 16);
    var b = parseInt(hexColor.substr(5, 2), 16);

    var targetColor = new SolidColor();
    targetColor.rgb.red = r;
    targetColor.rgb.green = g;
    targetColor.rgb.blue = b;

    // Use Color Range selection via Action Manager for better threshold control
    var idClrR = charIDToTypeID('ClrR');
    var desc = new ActionDescriptor();
    var idFzns = charIDToTypeID('Fzns');
    desc.putInteger(idFzns, threshold);

    var idMnm = charIDToTypeID('Mnm ');
    var descColor = new ActionDescriptor();
    var idRd = charIDToTypeID('Rd  ');
    descColor.putDouble(idRd, r);
    var idGrn = charIDToTypeID('Grn ');
    descColor.putDouble(idGrn, g);
    var idBl = charIDToTypeID('Bl  ');
    descColor.putDouble(idBl, b);
    var idRGBC = charIDToTypeID('RGBC');
    desc.putObject(idMnm, idRGBC, descColor);

    var idMxm = charIDToTypeID('Mxm ');
    desc.putObject(idMxm, idRGBC, descColor);

    executeAction(idClrR, desc, DialogModes.NO);

    // Delete selected pixels (make transparent)
    try {
        // Ensure layer supports transparency
        if (doc.activeLayer.isBackgroundLayer) {
            doc.activeLayer.isBackgroundLayer = false;
        }
        doc.selection.clear();
        doc.selection.deselect();
    } catch (e) {
        doc.selection.deselect();
        return jsonStringify({ error: 'Could not delete selection: ' + e.message });
    }

    return jsonStringify({ success: true, action: 'knockout', color: hexColor, threshold: threshold });
}

// ============================================================
// CURVES ADJUSTMENT
// ============================================================

function applyCurves(shadows, midtones, highlights) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    // Map -100..100 values to curve points
    // Shadows affect quarter-tone, midtones affect center, highlights affect three-quarter-tone
    var shadowPt = Math.max(0, Math.min(255, 64 + Math.round(shadows * 0.5)));
    var midPt = Math.max(0, Math.min(255, 128 + Math.round(midtones * 0.8)));
    var highPt = Math.max(0, Math.min(255, 192 + Math.round(highlights * 0.5)));

    var idCrvs = charIDToTypeID('Crvs');
    var desc = new ActionDescriptor();

    var idpresetKind = stringIDToTypeID('presetKind');
    var idpresetKindType = stringIDToTypeID('presetKindType');
    var idpresetKindCustom = stringIDToTypeID('presetKindCustom');
    desc.putEnumerated(idpresetKind, idpresetKindType, idpresetKindCustom);

    var idAdjs = charIDToTypeID('Adjs');
    var listAdjs = new ActionList();
    var descCurve = new ActionDescriptor();

    var idChnl = charIDToTypeID('Chnl');
    var idChnC = charIDToTypeID('ChnC');
    var idCmps = charIDToTypeID('Cmps');
    descCurve.putEnumerated(idChnl, idChnC, idCmps); // Composite

    var idCrv = charIDToTypeID('Crv ');
    var listPoints = new ActionList();

    // Point 0: Black point
    var descPt0 = new ActionDescriptor();
    descPt0.putDouble(charIDToTypeID('Hrzn'), 0);
    descPt0.putDouble(charIDToTypeID('Vrtc'), 0);
    listPoints.putObject(charIDToTypeID('Pnt '), descPt0);

    // Point 1: Shadows (quarter tone)
    var descPt1 = new ActionDescriptor();
    descPt1.putDouble(charIDToTypeID('Hrzn'), 64);
    descPt1.putDouble(charIDToTypeID('Vrtc'), shadowPt);
    listPoints.putObject(charIDToTypeID('Pnt '), descPt1);

    // Point 2: Midtones
    var descPt2 = new ActionDescriptor();
    descPt2.putDouble(charIDToTypeID('Hrzn'), 128);
    descPt2.putDouble(charIDToTypeID('Vrtc'), midPt);
    listPoints.putObject(charIDToTypeID('Pnt '), descPt2);

    // Point 3: Highlights (three-quarter tone)
    var descPt3 = new ActionDescriptor();
    descPt3.putDouble(charIDToTypeID('Hrzn'), 192);
    descPt3.putDouble(charIDToTypeID('Vrtc'), highPt);
    listPoints.putObject(charIDToTypeID('Pnt '), descPt3);

    // Point 4: White point
    var descPt4 = new ActionDescriptor();
    descPt4.putDouble(charIDToTypeID('Hrzn'), 255);
    descPt4.putDouble(charIDToTypeID('Vrtc'), 255);
    listPoints.putObject(charIDToTypeID('Pnt '), descPt4);

    descCurve.putList(idCrv, listPoints);
    listAdjs.putObject(charIDToTypeID('CrvA'), descCurve);
    desc.putList(idAdjs, listAdjs);

    executeAction(idCrvs, desc, DialogModes.NO);

    return jsonStringify({ success: true, action: 'curves', shadows: shadows, midtones: midtones, highlights: highlights });
}

// ============================================================
// LEVELS ADJUSTMENT
// ============================================================

function applyLevels(inputBlack, inputWhite, outputBlack, outputWhite) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var idLvls = charIDToTypeID('Lvls');
    var desc = new ActionDescriptor();

    var idpresetKind = stringIDToTypeID('presetKind');
    var idpresetKindType = stringIDToTypeID('presetKindType');
    var idpresetKindCustom = stringIDToTypeID('presetKindCustom');
    desc.putEnumerated(idpresetKind, idpresetKindType, idpresetKindCustom);

    var idAdjs = charIDToTypeID('Adjs');
    var listAdjs = new ActionList();
    var descLvl = new ActionDescriptor();

    var idChnl = charIDToTypeID('Chnl');
    var idChnC = charIDToTypeID('ChnC');
    var idCmps = charIDToTypeID('Cmps');
    descLvl.putEnumerated(idChnl, idChnC, idCmps); // Composite

    // Input levels
    var idInpt = charIDToTypeID('Inpt');
    var listInput = new ActionList();
    listInput.putInteger(inputBlack);
    listInput.putInteger(inputWhite);
    descLvl.putList(idInpt, listInput);

    // Output levels
    var idOutp = charIDToTypeID('Otpt');
    var listOutput = new ActionList();
    listOutput.putInteger(outputBlack);
    listOutput.putInteger(outputWhite);
    descLvl.putList(idOutp, listOutput);

    // Gamma (midtone) — keep at 1.0
    var idGmm = charIDToTypeID('Gmm ');
    descLvl.putDouble(idGmm, 1.0);

    listAdjs.putObject(charIDToTypeID('LvlA'), descLvl);
    desc.putList(idAdjs, listAdjs);

    executeAction(idLvls, desc, DialogModes.NO);

    return jsonStringify({ success: true, action: 'levels', inputBlack: inputBlack, inputWhite: inputWhite, outputBlack: outputBlack, outputWhite: outputWhite });
}

// ============================================================
// THRESHOLD
// ============================================================

function applyThreshold(level) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var idThrh = charIDToTypeID('Thrh');
    var desc = new ActionDescriptor();
    var idLvl = charIDToTypeID('Lvl ');
    desc.putInteger(idLvl, level);
    executeAction(idThrh, desc, DialogModes.NO);

    return jsonStringify({ success: true, action: 'threshold', level: level });
}

// ============================================================
// GRAYSCALE CONVERSION
// ============================================================

function convertToGrayscale() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;

    // Check if already grayscale
    if (doc.mode === DocumentMode.GRAYSCALE) {
        return jsonStringify({ success: true, action: 'grayscale', note: 'Already in Grayscale mode' });
    }

    // Flatten if needed to avoid layer issues
    // doc.flatten(); // Let user decide — we'll just convert

    doc.changeMode(ChangeMode.GRAYSCALE);

    return jsonStringify({ success: true, action: 'grayscale' });
}

// ============================================================
// BITMAP / HALFTONE CONVERSION
// ============================================================

function convertToHalftone(lpi, angle, shape) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;

    // Must be in Grayscale first
    if (doc.mode !== DocumentMode.GRAYSCALE) {
        doc.changeMode(ChangeMode.GRAYSCALE);
    }

    // Map shape string to Photoshop constant
    var shapeMap = {
        'round': 'Rnd',
        'diamond': 'Dmnd',
        'ellipse': 'Elps',
        'line': 'Ln  ',
        'square': 'Sqr ',
        'cross': 'Crs '
    };

    var shapeID = shapeMap[shape] || 'Rnd';

    // Convert to Bitmap with Halftone Screen
    var idCnvM = charIDToTypeID('CnvM');
    var desc = new ActionDescriptor();

    // Resolution — use document resolution
    var idRslt = charIDToTypeID('Rslt');
    var idRsl = charIDToTypeID('#Rsl');
    desc.putUnitDouble(idRslt, idRsl, doc.resolution);

    // Method: Halftone Screen
    var idMthd = charIDToTypeID('Mthd');
    desc.putEnumerated(idMthd, charIDToTypeID('Mthd'), charIDToTypeID('HlfS'));

    // Frequency
    var idFrqn = charIDToTypeID('Frqn');
    var idLns = charIDToTypeID('#Lns');
    desc.putUnitDouble(idFrqn, idLns, lpi);

    // Angle
    var idAngl = charIDToTypeID('Angl');
    var idAng = charIDToTypeID('#Ang');
    desc.putUnitDouble(idAngl, idAng, angle);

    // Shape
    var idShp = charIDToTypeID('Shp ');
    desc.putEnumerated(idShp, charIDToTypeID('Shp '), charIDToTypeID(shapeID));

    executeAction(idCnvM, desc, DialogModes.NO);

    return jsonStringify({ success: true, action: 'halftone', lpi: lpi, angle: angle, shape: shape });
}

// ============================================================
// DUPLICATE LAYER
// ============================================================

function duplicateActiveLayer() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;
    var originalName = doc.activeLayer.name;
    var dup = doc.activeLayer.duplicate();
    dup.name = originalName + ' (Halftone Copy)';
    doc.activeLayer = dup;

    return jsonStringify({ success: true, action: 'duplicate', layerName: dup.name });
}

// ============================================================
// FLATTEN IMAGE
// ============================================================

function flattenImage() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });
    app.activeDocument.flatten();
    return jsonStringify({ success: true, action: 'flatten' });
}

// ============================================================
// UNDO (for live mode revert)
// ============================================================

function undoLastAction() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });
    try {
        var idUndo = charIDToTypeID('undo');
        var desc = new ActionDescriptor();
        executeAction(idUndo, desc, DialogModes.NO);
        return jsonStringify({ success: true, action: 'undo' });
    } catch (e) {
        return jsonStringify({ error: 'Cannot undo: ' + e.message });
    }
}

// ============================================================
// HISTORY STATE MANAGEMENT (for live mode)
// ============================================================

function saveHistoryState() {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });
    var doc = app.activeDocument;
    var stateName = 'DTF_Snapshot_' + new Date().getTime();

    // Create a snapshot
    var idMk = charIDToTypeID('Mk  ');
    var desc = new ActionDescriptor();
    var idnull = charIDToTypeID('null');
    var ref = new ActionReference();
    var idSnpS = charIDToTypeID('SnpS');
    ref.putClass(idSnpS);
    desc.putReference(idnull, ref);
    var idFrom = charIDToTypeID('From');
    var refFrom = new ActionReference();
    var idHstS = charIDToTypeID('HstS');
    var idCrnH = charIDToTypeID('CrnH');
    refFrom.putProperty(idHstS, idCrnH);
    desc.putReference(idFrom, refFrom);
    var idNm = charIDToTypeID('Nm  ');
    desc.putString(idNm, stateName);
    var idUsng = charIDToTypeID('Usng');
    var idHstS2 = charIDToTypeID('HstS');
    var idFllD = charIDToTypeID('FllD');
    desc.putEnumerated(idUsng, idHstS2, idFllD);
    executeAction(idMk, desc, DialogModes.NO);

    return jsonStringify({ success: true, action: 'save_state', name: stateName });
}

function revertToState(stateName) {
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var doc = app.activeDocument;
    var states = doc.historyStates;
    for (var i = states.length - 1; i >= 0; i--) {
        if (states[i].name === stateName) {
            doc.activeHistoryState = states[i];
            return jsonStringify({ success: true, action: 'revert_state', name: stateName });
        }
    }
    return jsonStringify({ error: 'History state not found: ' + stateName });
}

// ============================================================
// FULL PIPELINE
// ============================================================

function runFullPipeline(options) {
    /*
     * options is a string like: "duplicate,knockout,curves,levels,threshold,grayscale,halftone"
     * Additional params passed as: "steps|knockoutColor|knockoutThreshold|shadowsVal|midVal|highVal|inBlack|inWhite|outBlack|outWhite|threshLevel|lpi|angle|shape"
     */
    if (!ensureDocument()) return jsonStringify({ error: 'No document open' });

    var parts = options.split('|');
    var steps = parts[0].split(',');
    var knockoutColor = parts[1] || '#FFFFFF';
    var knockoutThreshold = parseInt(parts[2]) || 30;
    var curveShadows = parseInt(parts[3]) || 0;
    var curveMidtones = parseInt(parts[4]) || 0;
    var curveHighlights = parseInt(parts[5]) || 0;
    var levInBlack = parseInt(parts[6]) || 0;
    var levInWhite = parseInt(parts[7]) || 255;
    var levOutBlack = parseInt(parts[8]) || 0;
    var levOutWhite = parseInt(parts[9]) || 255;
    var threshLevel = parseInt(parts[10]) || 128;
    var htLpi = parseInt(parts[11]) || 45;
    var htAngle = parseInt(parts[12]) || 45;
    var htShape = parts[13] || 'round';

    var results = [];

    for (var i = 0; i < steps.length; i++) {
        var step = steps[i].replace(/\s/g, '');
        try {
            switch (step) {
                case 'duplicate':
                    results.push(duplicateActiveLayer());
                    break;
                case 'knockout':
                    results.push(knockoutColor(knockoutColor, knockoutThreshold));
                    break;
                case 'curves':
                    results.push(applyCurves(curveShadows, curveMidtones, curveHighlights));
                    break;
                case 'levels':
                    results.push(applyLevels(levInBlack, levInWhite, levOutBlack, levOutWhite));
                    break;
                case 'threshold':
                    results.push(applyThreshold(threshLevel));
                    break;
                case 'grayscale':
                    results.push(convertToGrayscale());
                    break;
                case 'halftone':
                    results.push(convertToHalftone(htLpi, htAngle, htShape));
                    break;
            }
        } catch (e) {
            results.push(jsonStringify({ error: step + ' failed: ' + e.message }));
        }
    }

    return jsonStringify({ success: true, action: 'pipeline', results: results });
}
