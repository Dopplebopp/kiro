/**
 * DTF Halftone Pro - Main JavaScript Bridge
 * Connects panel UI to ExtendScript backend via CSInterface
 */

(function () {
    'use strict';

    // ============================================================
    // INITIALIZATION
    // ============================================================

    var csInterface = new CSInterface();
    var liveModeEnabled = false;
    var liveStateSnapshot = null;
    var debounceTimers = {};

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', function () {
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

        logActivity('Plugin loaded successfully.', 'info');
        refreshCanvasInfo();
    });

    // ============================================================
    // HELPER: EVAL SCRIPT
    // ============================================================

    function runJSX(functionCall, callback) {
        csInterface.evalScript(functionCall, function (result) {
            var parsed = null;
            try {
                parsed = JSON.parse(result);
            } catch (e) {
                parsed = { error: 'Failed to parse result', raw: result };
            }
            if (callback) callback(parsed);
        });
    }

    function debounce(key, fn, delay) {
        if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(fn, delay || 300);
    }

    // ============================================================
    // COLLAPSIBLE SECTIONS
    // ============================================================

    function initCollapsibleSections() {
        var headers = document.querySelectorAll('.section-header[data-toggle]');
        for (var i = 0; i < headers.length; i++) {
            headers[i].addEventListener('click', function () {
                var targetId = this.getAttribute('data-toggle');
                var body = document.getElementById(targetId);
                var icon = this.querySelector('.collapse-icon');
                if (body.classList.contains('collapsed')) {
                    body.classList.remove('collapsed');
                    icon.innerHTML = '&#9660;';
                } else {
                    body.classList.add('collapsed');
                    icon.innerHTML = '&#9654;';
                }
            });
        }
    }

    // ============================================================
    // CANVAS INSPECTOR
    // ============================================================

    function initCanvasInspector() {
        document.getElementById('btn-refresh-canvas').addEventListener('click', refreshCanvasInfo);
    }

    function refreshCanvasInfo() {
        runJSX('getCanvasInfo()', function (info) {
            if (info.error) {
                document.getElementById('info-size').textContent = '—';
                document.getElementById('info-resolution').textContent = '—';
                document.getElementById('info-color-mode').textContent = '—';
                document.getElementById('info-bit-depth').textContent = '—';
                document.getElementById('dpi-warning').classList.add('hidden');
                logActivity('No document open.', 'warn');
                return;
            }
            document.getElementById('info-size').textContent = info.width + ' × ' + info.height + ' px';
            document.getElementById('info-resolution').textContent = info.resolution + ' DPI';
            document.getElementById('info-color-mode').textContent = info.colorMode;
            document.getElementById('info-bit-depth').textContent = info.bitDepth;

            // DPI Warning
            var warningEl = document.getElementById('dpi-warning');
            if (info.resolution < 300) {
                warningEl.classList.remove('hidden');
            } else {
                warningEl.classList.add('hidden');
            }
            logActivity('Canvas info refreshed: ' + info.width + '×' + info.height + ' @ ' + info.resolution + ' DPI', 'info');
        });
    }

    // ============================================================
    // LIVE MODE
    // ============================================================

    function initLiveMode() {
        document.getElementById('toggle-live-mode').addEventListener('change', function () {
            liveModeEnabled = this.checked;
            if (liveModeEnabled) {
                // Save a snapshot for reverting
                runJSX('saveHistoryState()', function (result) {
                    if (result.success) {
                        liveStateSnapshot = result.name;
                        logActivity('Live mode enabled. Snapshot saved.', 'info');
                    }
                });
            } else {
                liveStateSnapshot = null;
                logActivity('Live mode disabled.', 'info');
            }
        });
    }

    function liveApply(jsxCall) {
        if (!liveModeEnabled) return;
        // Revert to snapshot first, then apply
        if (liveStateSnapshot) {
            runJSX('revertToState("' + liveStateSnapshot + '")', function () {
                runJSX(jsxCall, function () { });
            });
        } else {
            runJSX(jsxCall, function () { });
        }
    }

    // ============================================================
    // SHIRT PREVIEW
    // ============================================================

    function initShirtPreview() {
        var colorPicker = document.getElementById('shirt-color-picker');
        var hexInput = document.getElementById('shirt-color-hex');
        var brightnessSlider = document.getElementById('shirt-brightness');
        var brightnessVal = document.getElementById('shirt-brightness-val');

        colorPicker.addEventListener('input', function () {
            hexInput.value = this.value;
            if (liveModeEnabled) {
                debounce('shirt', function () {
                    liveApplyShirt();
                }, 200);
            }
        });

        hexInput.addEventListener('change', function () {
            var hex = this.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                colorPicker.value = hex;
                if (liveModeEnabled) liveApplyShirt();
            }
        });

        brightnessSlider.addEventListener('input', function () {
            brightnessVal.textContent = this.value;
            if (liveModeEnabled) {
                debounce('shirt-bright', function () {
                    liveApplyShirt();
                }, 200);
            }
        });

        document.getElementById('btn-add-shirt-layer').addEventListener('click', function () {
            var color = getAdjustedShirtColor();
            runJSX('addShirtPreviewLayer("' + color + '")', function (result) {
                if (result.success) {
                    logActivity('Shirt preview layer added: ' + color, 'success');
                } else {
                    logActivity('Error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });

        document.getElementById('btn-remove-shirt-layer').addEventListener('click', function () {
            runJSX('removeShirtPreviewLayer()', function (result) {
                if (result.success) {
                    logActivity('Shirt preview layer removed.', 'success');
                } else {
                    logActivity('Error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    function getAdjustedShirtColor() {
        var hex = document.getElementById('shirt-color-picker').value;
        var brightness = parseInt(document.getElementById('shirt-brightness').value);
        // Adjust brightness: 50 = no change, 0 = black, 100 = white
        var r = parseInt(hex.substr(1, 2), 16);
        var g = parseInt(hex.substr(3, 2), 16);
        var b = parseInt(hex.substr(5, 2), 16);

        var factor = brightness / 50; // 0-2 range
        if (factor <= 1) {
            r = Math.round(r * factor);
            g = Math.round(g * factor);
            b = Math.round(b * factor);
        } else {
            var excess = factor - 1;
            r = Math.min(255, Math.round(r + (255 - r) * excess));
            g = Math.min(255, Math.round(g + (255 - g) * excess));
            b = Math.min(255, Math.round(b + (255 - b) * excess));
        }

        return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
    }

    function componentToHex(c) {
        var hex = c.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }

    function liveApplyShirt() {
        var color = getAdjustedShirtColor();
        runJSX('addShirtPreviewLayer("' + color + '")', function () { });
    }

    // ============================================================
    // COLOR WHEEL (Canvas-based)
    // ============================================================

    function initColorWheel() {
        var canvas = document.getElementById('color-wheel');
        var ctx = canvas.getContext('2d');
        var radius = canvas.width / 2;

        // Draw the color wheel
        drawColorWheel(ctx, radius);

        canvas.addEventListener('click', function (e) {
            var rect = canvas.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var pixel = ctx.getImageData(x, y, 1, 1).data;
            var hex = '#' + componentToHex(pixel[0]) + componentToHex(pixel[1]) + componentToHex(pixel[2]);
            document.getElementById('shirt-color-picker').value = hex;
            document.getElementById('shirt-color-hex').value = hex;
            if (liveModeEnabled) {
                debounce('wheel', function () { liveApplyShirt(); }, 150);
            }
        });
    }

    function drawColorWheel(ctx, radius) {
        var cx = radius, cy = radius;
        for (var angle = 0; angle < 360; angle++) {
            var startAngle = (angle - 1) * Math.PI / 180;
            var endAngle = (angle + 1) * Math.PI / 180;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.closePath();
            var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(1, 'hsl(' + angle + ', 100%, 50%)');
            ctx.fillStyle = gradient;
            ctx.fill();
        }
    }

    // ============================================================
    // COLOR KNOCKOUT
    // ============================================================

    function initColorKnockout() {
        var colorPicker = document.getElementById('knockout-color');
        var hexInput = document.getElementById('knockout-color-hex');
        var thresholdSlider = document.getElementById('knockout-threshold');
        var thresholdVal = document.getElementById('knockout-threshold-val');

        colorPicker.addEventListener('input', function () {
            hexInput.value = this.value;
        });

        hexInput.addEventListener('change', function () {
            if (/^#[0-9A-Fa-f]{6}$/.test(this.value)) {
                colorPicker.value = this.value;
            }
        });

        thresholdSlider.addEventListener('input', function () {
            thresholdVal.textContent = this.value;
            if (liveModeEnabled) {
                debounce('knockout', function () {
                    var color = document.getElementById('knockout-color').value;
                    var thresh = document.getElementById('knockout-threshold').value;
                    liveApply('knockoutColor("' + color + '", ' + thresh + ')');
                }, 400);
            }
        });

        document.getElementById('btn-knockout').addEventListener('click', function () {
            var color = colorPicker.value;
            var threshold = parseInt(thresholdSlider.value);
            runJSX('knockoutColor("' + color + '", ' + threshold + ')', function (result) {
                if (result.success) {
                    logActivity('Color knockout applied: ' + color + ' (threshold: ' + threshold + ')', 'success');
                } else {
                    logActivity('Knockout error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // CURVES
    // ============================================================

    function initCurves() {
        var sliders = ['curves-shadows', 'curves-midtones', 'curves-highlights'];
        var vals = ['curves-shadows-val', 'curves-midtones-val', 'curves-highlights-val'];

        for (var i = 0; i < sliders.length; i++) {
            (function (idx) {
                var slider = document.getElementById(sliders[idx]);
                var valSpan = document.getElementById(vals[idx]);
                slider.addEventListener('input', function () {
                    valSpan.textContent = this.value;
                    if (liveModeEnabled) {
                        debounce('curves', function () {
                            var s = document.getElementById('curves-shadows').value;
                            var m = document.getElementById('curves-midtones').value;
                            var h = document.getElementById('curves-highlights').value;
                            liveApply('applyCurves(' + s + ', ' + m + ', ' + h + ')');
                        }, 400);
                    }
                });
            })(i);
        }

        document.getElementById('btn-apply-curves').addEventListener('click', function () {
            var s = document.getElementById('curves-shadows').value;
            var m = document.getElementById('curves-midtones').value;
            var h = document.getElementById('curves-highlights').value;
            runJSX('applyCurves(' + s + ', ' + m + ', ' + h + ')', function (result) {
                if (result.success) {
                    logActivity('Curves applied: S=' + s + ' M=' + m + ' H=' + h, 'success');
                } else {
                    logActivity('Curves error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // LEVELS
    // ============================================================

    function initLevels() {
        var sliders = ['levels-input-black', 'levels-input-white', 'levels-output-black', 'levels-output-white'];
        var vals = ['levels-input-black-val', 'levels-input-white-val', 'levels-output-black-val', 'levels-output-white-val'];

        for (var i = 0; i < sliders.length; i++) {
            (function (idx) {
                var slider = document.getElementById(sliders[idx]);
                var valSpan = document.getElementById(vals[idx]);
                slider.addEventListener('input', function () {
                    valSpan.textContent = this.value;
                    if (liveModeEnabled) {
                        debounce('levels', function () {
                            var ib = document.getElementById('levels-input-black').value;
                            var iw = document.getElementById('levels-input-white').value;
                            var ob = document.getElementById('levels-output-black').value;
                            var ow = document.getElementById('levels-output-white').value;
                            liveApply('applyLevels(' + ib + ', ' + iw + ', ' + ob + ', ' + ow + ')');
                        }, 400);
                    }
                });
            })(i);
        }

        document.getElementById('btn-apply-levels').addEventListener('click', function () {
            var ib = document.getElementById('levels-input-black').value;
            var iw = document.getElementById('levels-input-white').value;
            var ob = document.getElementById('levels-output-black').value;
            var ow = document.getElementById('levels-output-white').value;
            runJSX('applyLevels(' + ib + ', ' + iw + ', ' + ob + ', ' + ow + ')', function (result) {
                if (result.success) {
                    logActivity('Levels applied: In[' + ib + '-' + iw + '] Out[' + ob + '-' + ow + ']', 'success');
                } else {
                    logActivity('Levels error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // THRESHOLD
    // ============================================================

    function initThreshold() {
        var slider = document.getElementById('threshold-level');
        var valSpan = document.getElementById('threshold-level-val');

        slider.addEventListener('input', function () {
            valSpan.textContent = this.value;
            if (liveModeEnabled) {
                debounce('threshold', function () {
                    var lvl = document.getElementById('threshold-level').value;
                    liveApply('applyThreshold(' + lvl + ')');
                }, 400);
            }
        });

        document.getElementById('btn-apply-threshold').addEventListener('click', function () {
            var level = slider.value;
            runJSX('applyThreshold(' + level + ')', function (result) {
                if (result.success) {
                    logActivity('Threshold applied: ' + level, 'success');
                } else {
                    logActivity('Threshold error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // GRAYSCALE
    // ============================================================

    function initGrayscale() {
        document.getElementById('btn-convert-grayscale').addEventListener('click', function () {
            runJSX('convertToGrayscale()', function (result) {
                if (result.success) {
                    logActivity('Converted to Grayscale.' + (result.note ? ' (' + result.note + ')' : ''), 'success');
                    refreshCanvasInfo();
                } else {
                    logActivity('Grayscale error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // BITMAP / HALFTONE
    // ============================================================

    function initHalftone() {
        var lpiSlider = document.getElementById('halftone-lpi');
        var lpiVal = document.getElementById('halftone-lpi-val');
        var angleSlider = document.getElementById('halftone-angle');
        var angleVal = document.getElementById('halftone-angle-val');

        lpiSlider.addEventListener('input', function () {
            lpiVal.textContent = this.value;
        });

        angleSlider.addEventListener('input', function () {
            angleVal.textContent = this.value + '°';
        });

        document.getElementById('btn-apply-halftone').addEventListener('click', function () {
            var lpi = lpiSlider.value;
            var angle = angleSlider.value;
            var shape = document.getElementById('halftone-shape').value;
            runJSX('convertToHalftone(' + lpi + ', ' + angle + ', "' + shape + '")', function (result) {
                if (result.success) {
                    logActivity('Bitmap halftone applied: ' + lpi + ' LPI, ' + angle + '°, ' + shape, 'success');
                    refreshCanvasInfo();
                } else {
                    logActivity('Halftone error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // DUPLICATE LAYER
    // ============================================================

    function initDuplicateLayer() {
        document.getElementById('btn-duplicate-now').addEventListener('click', function () {
            runJSX('duplicateActiveLayer()', function (result) {
                if (result.success) {
                    logActivity('Layer duplicated: ' + result.layerName, 'success');
                } else {
                    logActivity('Duplicate error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // ONE-CLICK PIPELINE
    // ============================================================

    function initOneClickPipeline() {
        document.getElementById('btn-run-pipeline').addEventListener('click', function () {
            var steps = [];
            if (document.getElementById('pipe-duplicate').checked) steps.push('duplicate');
            if (document.getElementById('pipe-knockout').checked) steps.push('knockout');
            if (document.getElementById('pipe-curves').checked) steps.push('curves');
            if (document.getElementById('pipe-levels').checked) steps.push('levels');
            if (document.getElementById('pipe-threshold').checked) steps.push('threshold');
            if (document.getElementById('pipe-grayscale').checked) steps.push('grayscale');
            if (document.getElementById('pipe-halftone').checked) steps.push('halftone');

            if (steps.length === 0) {
                logActivity('Pipeline: No steps selected.', 'warn');
                return;
            }

            // Gather all parameter values
            var knockoutColor = document.getElementById('knockout-color').value;
            var knockoutThreshold = document.getElementById('knockout-threshold').value;
            var curveShadows = document.getElementById('curves-shadows').value;
            var curveMidtones = document.getElementById('curves-midtones').value;
            var curveHighlights = document.getElementById('curves-highlights').value;
            var levInBlack = document.getElementById('levels-input-black').value;
            var levInWhite = document.getElementById('levels-input-white').value;
            var levOutBlack = document.getElementById('levels-output-black').value;
            var levOutWhite = document.getElementById('levels-output-white').value;
            var threshLevel = document.getElementById('threshold-level').value;
            var htLpi = document.getElementById('halftone-lpi').value;
            var htAngle = document.getElementById('halftone-angle').value;
            var htShape = document.getElementById('halftone-shape').value;

            var pipelineArg = steps.join(',') + '|' +
                knockoutColor + '|' + knockoutThreshold + '|' +
                curveShadows + '|' + curveMidtones + '|' + curveHighlights + '|' +
                levInBlack + '|' + levInWhite + '|' + levOutBlack + '|' + levOutWhite + '|' +
                threshLevel + '|' +
                htLpi + '|' + htAngle + '|' + htShape;

            logActivity('Pipeline started: ' + steps.join(' → '), 'info');

            runJSX('runFullPipeline("' + pipelineArg + '")', function (result) {
                if (result.success) {
                    logActivity('Pipeline completed successfully!', 'success');
                    refreshCanvasInfo();
                } else {
                    logActivity('Pipeline error: ' + (result.error || 'Unknown'), 'error');
                }
            });
        });
    }

    // ============================================================
    // ACTIVITY LOG
    // ============================================================

    var logContainer = null;

    function initActivityLog() {
        logContainer = document.getElementById('activity-log');
        document.getElementById('btn-clear-log').addEventListener('click', function () {
            logContainer.innerHTML = '';
            logActivity('Log cleared.', 'info');
        });
    }

    function logActivity(message, type) {
        if (!logContainer) logContainer = document.getElementById('activity-log');
        var now = new Date();
        var timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        var entry = document.createElement('div');
        entry.className = 'log-entry log-' + (type || 'info');
        entry.innerHTML = '<span class="log-time">' + timeStr + '</span> ' + escapeHTML(message);
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function pad(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function escapeHTML(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ============================================================
    // RESET ALL
    // ============================================================

    function initResetAll() {
        document.getElementById('btn-reset-all').addEventListener('click', function () {
            // Reset all sliders and inputs to defaults
            document.getElementById('shirt-color-picker').value = '#000000';
            document.getElementById('shirt-color-hex').value = '#000000';
            document.getElementById('shirt-brightness').value = 50;
            document.getElementById('shirt-brightness-val').textContent = '50';

            document.getElementById('knockout-color').value = '#FFFFFF';
            document.getElementById('knockout-color-hex').value = '#FFFFFF';
            document.getElementById('knockout-threshold').value = 30;
            document.getElementById('knockout-threshold-val').textContent = '30';

            document.getElementById('curves-shadows').value = 0;
            document.getElementById('curves-shadows-val').textContent = '0';
            document.getElementById('curves-midtones').value = 0;
            document.getElementById('curves-midtones-val').textContent = '0';
            document.getElementById('curves-highlights').value = 0;
            document.getElementById('curves-highlights-val').textContent = '0';

            document.getElementById('levels-input-black').value = 0;
            document.getElementById('levels-input-black-val').textContent = '0';
            document.getElementById('levels-input-white').value = 255;
            document.getElementById('levels-input-white-val').textContent = '255';
            document.getElementById('levels-output-black').value = 0;
            document.getElementById('levels-output-black-val').textContent = '0';
            document.getElementById('levels-output-white').value = 255;
            document.getElementById('levels-output-white-val').textContent = '255';

            document.getElementById('threshold-level').value = 128;
            document.getElementById('threshold-level-val').textContent = '128';

            document.getElementById('halftone-lpi').value = 45;
            document.getElementById('halftone-lpi-val').textContent = '45';
            document.getElementById('halftone-angle').value = 45;
            document.getElementById('halftone-angle-val').textContent = '45°';
            document.getElementById('halftone-shape').value = 'round';

            document.getElementById('toggle-live-mode').checked = false;
            liveModeEnabled = false;
            liveStateSnapshot = null;

            document.getElementById('toggle-duplicate').checked = true;

            // Reset pipeline checkboxes
            document.getElementById('pipe-duplicate').checked = true;
            document.getElementById('pipe-knockout').checked = true;
            document.getElementById('pipe-curves').checked = true;
            document.getElementById('pipe-levels').checked = true;
            document.getElementById('pipe-threshold').checked = false;
            document.getElementById('pipe-grayscale').checked = true;
            document.getElementById('pipe-halftone').checked = true;

            logActivity('All settings reset to defaults.', 'info');
        });
    }

})();
