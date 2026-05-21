# DTF Halftone Pro — Photoshop CEP Plugin

A streamlined Photoshop panel for DTF (Direct-to-Film) halftoning workflows. One panel to handle the entire process from color knockout to bitmap halftone conversion.

---

## Features

| Feature | Description |
|---------|-------------|
| **Canvas Inspector** | Auto-reads size, resolution, color mode — warns if not 300 DPI |
| **Live Mode** | Real-time slider updates applied to document as you drag |
| **Shirt Preview** | Color picker + full color wheel + hex input + brightness slider |
| **Preview Layer** | Adds a shirt-colored fill layer behind your artwork |
| **Color Knockout** | Knocks out white (or any color) by threshold — DTF transparency ready |
| **Curves** | Shadows / Midtones / Highlights control |
| **Levels** | Input & output black/white points |
| **Threshold** | Pure B&W conversion slider |
| **Grayscale** | One-step mode conversion |
| **Bitmap/Halftone** | LPI frequency, angle, shape (Round/Diamond/Ellipse/Line/Square/Cross) |
| **Duplicate Layer** | Non-destructive workflow toggle |
| **One-Click Process** | Runs the full pipeline in order |
| **Activity Log** | Timestamped, color-coded action log |
| **Reset All** | Back to defaults in one click |

---

## Installation

### Method 1: Manual Install (Recommended)

1. **Close Photoshop** completely.

2. **Copy the plugin folder** to the CEP extensions directory:

   **Windows:**
   ```
   C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\com.dtf.halftone.panel
   ```
   
   **macOS:**
   ```
   /Library/Application Support/Adobe/CEP/extensions/com.dtf.halftone.panel
   ```

   Or per-user:
   
   **Windows:**
   ```
   %APPDATA%\Adobe\CEP\extensions\com.dtf.halftone.panel
   ```
   
   **macOS:**
   ```
   ~/Library/Application Support/Adobe/CEP/extensions/com.dtf.halftone.panel
   ```

3. **Enable unsigned extensions** (required for development/unsigned panels):

   **Windows** — Open Registry Editor and set:
   ```
   HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11
   PlayerDebugMode = "1" (String value)
   ```
   *(Change `CSXS.11` to match your version: CSXS.8 for CC 2018, CSXS.9 for CC 2019, CSXS.10 for 2020-2021, CSXS.11 for 2022+)*

   **macOS** — Open Terminal and run:
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```

4. **Launch Photoshop** and go to **Window → Extensions → DTF Halftone Pro**

### Method 2: ZXP Installer

Package as a `.zxp` file using ZXPSignCmd and install via:
- [Anastasiy's Extension Manager](https://install.anastasiy.com/)
- [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/)

---

## Requirements

- Adobe Photoshop CC 2015 or later
- CEP (Common Extensibility Platform) support

---

## Development

### Debug Mode

The `.debug` file enables Chrome DevTools debugging on port **8088**.

1. Launch Photoshop with the extension loaded
2. Open Chrome and navigate to: `http://localhost:8088`
3. Click the panel name to open DevTools

### CSInterface.js

The included `lib/CSInterface.js` is a **development stub**. For production, replace it with the official library from:
- https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_11.x

---

## Workflow Guide

### Typical DTF Halftone Process:

1. Open your design in Photoshop (300 DPI recommended)
2. Use **Shirt Preview** to see how it looks on the target garment color
3. Use **Color Knockout** to remove white/background for transparency
4. Adjust **Curves** and **Levels** for optimal tonal range
5. Optionally apply **Threshold** for pure B&W
6. Convert to **Grayscale**
7. Apply **Bitmap/Halftone** with your preferred LPI, angle, and dot shape

Or simply configure your settings and hit **One-Click Process** to run all steps automatically!

---

## File Structure

```
DTF-Halftone-Plugin/
├── CSXS/
│   └── manifest.xml          # CEP extension manifest
├── css/
│   └── styles.css            # Panel styling (dark theme)
├── icons/
│   ├── icon-dark.png         # Panel icon (dark UI)
│   └── icon-light.png        # Panel icon (light UI)
├── js/
│   └── main.js               # UI logic & CSInterface bridge
├── jsx/
│   └── halftone.jsx          # ExtendScript backend (PS operations)
├── lib/
│   └── CSInterface.js        # Adobe CEP interface library
├── .debug                    # Debug configuration
├── index.html                # Panel HTML
└── README.md                 # This file
```

---

## License

MIT — Free to use, modify, and distribute.
