# AutoBlog Remote Controller Pro v12 — Multi Client Isolated DB

This version adds dashboard lock plus multi-client app URLs.

## New feature

Create a client page name such as `global1` from the **Clients** tab.

Example:

- Main app: `https://domaincontroller.in/`
- Client app: `https://domaincontroller.in/global1/`

Every client app is the same full dashboard, but with isolated data:

- Separate Mongo database
- Separate sites list
- Separate queue/log/history records
- Separate schedules
- Separate dashboard username/password file
- Same optimized codebase, so no heavy full-file duplication and no performance drop

## Default login

For root and every newly created client app:

- User name: `admin`
- Password: `admin@2020`

Open **Security** and change it after first login.

## Important paths

- Root auth file: `server/data/dashboard-auth.json`
- Client auth file: `server/data/tenants/<slug>/dashboard-auth.json`
- Root DB: your `MONGO_URI` database
- Client DB: `<prefix>_client_<slug>`

Do not commit `server/data` to GitHub.
