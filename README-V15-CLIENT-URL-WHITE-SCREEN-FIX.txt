AutoBlog Pro v15 - Client URL white screen fix

Fixes the blank white screen at /new/, /global1/, etc.

Root cause fixed:
- V14 built React assets with relative ./assets paths.
- If Nginx served /new/ statically instead of proxying all paths to Node, the browser requested /new/assets/... and received the wrong file/HTML, causing a blank page.

V15 changes:
- Vite build base is now /. Assets load from /assets/... for root and client URLs.
- Client dashboards use /api/_client/<slug>/... so existing Nginx /api proxy works.
- Fresh backend instances remain separate per client.
- Delete/restart client features retained.

Test:
https://domaincontroller.in/new/?v=15
curl -s https://domaincontroller.in/api/_client/new/healthz
