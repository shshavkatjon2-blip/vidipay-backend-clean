Emergency Render build fix.

Upload these files to the Render Web Service repository root:

server.js
package.json
render.yaml
render-build-fix.cjs
scripts/
README_UPLOAD_THIS_EXACTLY.txt

Do not upload package-lock.json for this emergency deploy.
Do not upload node_modules.

Render settings:

Root Directory: empty
Build Command: node render-build-fix.cjs && npm install --omit=dev
Start Command: npm start

If Render still shows EJSONPARSE after this, the service is not building this repository/root.
