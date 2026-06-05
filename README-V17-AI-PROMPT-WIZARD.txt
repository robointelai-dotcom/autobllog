AutoBlog Pro v17 - AI Prompt Wizard

Version: v17-ai-prompt-wizard

What is added:
- AI Prompt Wizard inside Prompt Studio.
- Generate a safe reusable Gemini article prompt per WordPress site.
- Save Prompt Only or Save + Activate AI Auto Generate.
- Uses saved WordPress Gemini key through the updated Bridge v17 endpoint /wp-json/grb/v1/prompt/generate.
- If the Bridge is not updated, the dashboard can still use a temporary pasted Gemini key or create a safe local template.
- Strong validation for required variables: $topic and $keyword. Optional: $backlink.
- Compliance templates: Finance / SEBI-safe, General business safe, Medical/health safe.
- CSV per-post prompt support: add a column named Prompt, CustomPrompt, PostPrompt, or AI Prompt.
- Per-post prompt cannot override hard safety/HTML/no-fake-facts rules.
- Updated WordPress bridge plugin: wp-gamini-remote-bridge-1.4-ai-prompt-v17.zip
- Updated SEM SEO BLOGER plugin: sem-seo-bloger-v3.3-ai-prompt-v17.zip

Important workflow:
1. Upload and activate both updated WordPress plugins on each target site.
2. In dashboard: API Keys -> select site -> set Gemini API key/model -> Save + Test.
3. Prompt Studio -> AI Generate Prompt -> review warnings -> Save + Activate AI Auto Generate.
4. Queue -> CSV can optionally include Prompt column for post-by-post custom instruction.

Default dashboard login remains:
admin / admin@2020

Security:
- Gemini keys are not shown back in full.
- Dashboard prompt generator first tries the WordPress Bridge, so it can use the key saved on that site.
- Temporary pasted Gemini key in Prompt Studio is not stored by the dashboard unless you click Save + Activate and include it.
