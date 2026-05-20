AutoBlog Pro v15 - Client Delete + Proxy Fix

What is fixed:
- Adds permanent Delete button/API for client apps created from the main dashboard.
- Main Dashboard is protected and cannot be deleted.
- Restart now force-restarts the client backend process instead of only checking health.
- Delete stops the client backend, removes runtime files, removes dashboard record, and attempts to drop the client Mongo database.
- Keeps fresh client architecture: /global1 runs through its own backend process and database.

Important Nginx note for /global1 blank/white screen:
Nginx must proxy ALL paths to the main Node backend on port 4000. Do not serve only /api from Node and static files directly from Nginx. The main Node app must receive /global1/, /global1/assets/*, and /global1/api/* so it can proxy to the dedicated client backend.

Correct public checks:
- Root health: https://domaincontroller.in/api/healthz
- Client health: https://domaincontroller.in/global1/api/healthz
