Upload these files to GitHub repo root:

vidipay-backend

Render is cloning this repo for the live API:

https://github.com/shshavkatjon2-blip/vidipay-backend

Required root files:

server.js
package.json
render.yaml
render-build-fix.cjs
scripts/

Do not upload this folder itself as a nested folder.
Do not upload node_modules.
Do not upload an old package-lock.json.

Render settings:

Build Command: node render-build-fix.cjs && npm install --omit=dev --no-audit --no-fund
Start Command: npm start
