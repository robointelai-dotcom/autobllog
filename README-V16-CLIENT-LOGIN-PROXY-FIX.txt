AutoBlog Pro v16 - Client Login Proxy Fix

Fixes the client dashboard 502/504 Bad Gateway issue during login.

Root cause fixed:
- v15 accidentally had a recursive proxy function for /api/_client/:slug/*.
- Client login like /api/_client/new/auth/login could crash or fail through the main backend proxy.

V16 changes:
- Fixed proxyHttpToPort implementation.
- Client app login/API requests now proxy correctly to the dedicated child backend process.
- Keeps fresh client backend process, separate port, separate Mongo database, delete client button, and main dashboard protection.

Version:
- v16-client-login-proxy-fix
