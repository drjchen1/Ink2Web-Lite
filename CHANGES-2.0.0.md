# Ink2Web Lite 2.0.0: Re-read from image

Replace these files in the 1.9.5 project (same paths):
src/App.tsx, src/styles.css, src/components/PageView.tsx, src/components/CropCanvas.tsx,
src/lib/pipeline.ts, src/lib/prompts.ts, package.json

## How to use
1. In Preview, click the paragraph/equation that came out wrong (opens the block editor).
2. Under the editor, click **Re-read from image…**
3. On the original page (left), drag a box around that handwriting (purple).
4. Click **Re-read this region**. The model reads only that crop.
5. Review/edit the proposal, then **Use this** (puts it in the editor), **Try another box**, or **Keep mine**.
6. Press **Done** in the block editor to keep it. Nothing changes without that.

While re-reading, figure boxes are inert, so drawing can't move a figure crop.
Closing the block (Done/Cancel) also closes and stops any re-read.
