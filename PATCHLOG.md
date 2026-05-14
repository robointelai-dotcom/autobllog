# AutoBlog Pro v10 Plugin Manager Final

## Added

- Dashboard Plugin Manager tab.
- Upload WordPress plugin ZIP from dashboard.
- Activate inactive plugins remotely.
- Deactivate active plugins remotely.
- Reactivate plugins safely with one click.
- Remove/delete plugins remotely with confirmation and force-deactivate safety.
- Remote Bridge self-protection so the dashboard cannot deactivate/delete its own bridge plugin.
- Bridge `/wp-json/grb/v1/plugins` endpoint for plugin inventory.
- Bridge `/wp-json/grb/v1/plugins/action` endpoint for activate/deactivate/reactivate/delete.
- Bridge `/wp-json/grb/v1/plugins/upload` endpoint for ZIP install/update.
- Node proxy routes `/api/sites/:id/plugins`, `/plugins/action`, and `/plugins/upload`.
- Bigger dashboard JSON limit for plugin ZIP uploads.
- Plugin action logs in Reliability Logs.

## Retained

- Smart CSV sync.
- API key manager.
- Gemini test/save.
- Prompt Studio.
- Blog history.
- Queue diagnostics.
- World-class dashboard UI themes.
