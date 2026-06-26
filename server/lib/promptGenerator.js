import { fetchWithTimeout, redactSecrets } from './http.js';

export const PROMPT_VERSION = 'v18.3-safe-publisher';

export function safeTrim(value, max = 1200){
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize('NFKC')
    .trim()
    .slice(0, max);
}

export function validateArticlePrompt(prompt){
  const text = String(prompt || '');
  const warnings = [];
  if (!text.trim()) warnings.push('Prompt is empty.');
  if (text.length > 20000) warnings.push('Prompt is too long. Max 20000 characters.');
  if (!/(\$topic|\{\{topic\}\}|\{topic\})/.test(text)) warnings.push('Missing topic variable: use $topic or {{topic}}.');
  if (!/(\$keyword|\{\{keyword\}\}|\{keyword\})/.test(text)) warnings.push('Missing keyword variable: use $keyword or {{keyword}}.');
  if (!/(html|<h1>|<h2>|<p>)/i.test(text)) warnings.push('Prompt should clearly request clean HTML output.');
  if (!/(no markdown|do not use markdown|markdown)/i.test(text)) warnings.push('Add a no-markdown rule to avoid ```html blocks.');
  if (!/(meta description|meta)/i.test(text)) warnings.push('Add meta description instruction.');
  if (!/(backlink|\$backlink|\{\{backlink\}\})/i.test(text)) warnings.push('Backlink variable is optional, but recommended for CSV backlink use.');
  if (/(guaranteed returns?|sure profit|assured profit|get rich quick)/i.test(text)) warnings.push('Prompt contains risky financial guarantee wording. Remove it.');
  return warnings;
}

export function buildSafePromptTemplate(input = {}){
  const focus = safeTrim(input.focus || 'SEO blog article', 160);
  const businessType = safeTrim(input.businessType || 'the selected WordPress site', 160);
  const audience = safeTrim(input.audience || 'readers and potential customers', 240);
  const language = safeTrim(input.language || 'English', 80);
  const tone = safeTrim(input.tone || 'professional, helpful, trustworthy and easy to understand', 180);
  const requestedWordCount = Number(input.wordCount || 1500);
  const wordCount = Number.isFinite(requestedWordCount) ? Math.max(700, Math.min(5000, requestedWordCount)) : 1500;
  const extraRules = safeTrim(input.extraRules || '', 2000);
  const compliance = String(input.compliance || 'general').toLowerCase();
  const includeFaq = input.includeFaq !== false;
  const includeTable = input.includeTable === true;
  const includeConclusion = input.includeConclusion !== false;
  const includeBacklink = input.includeBacklink !== false;

  const complianceBlock = compliance === 'finance' ? `\nFinancial / SEBI-safe restrictions:\n- Write educational information only. Do not give personalised investment advice.\n- Do not promise, guarantee, or imply assured returns, sure profit, zero risk, or future performance.\n- Mention risk, volatility, costs, taxes, eligibility, and that readers should verify details or consult a qualified adviser where relevant.\n- Do not tell readers to buy, sell, hold, or trade any specific stock, fund, or security.\n- Use Indian context only when it is relevant, such as SEBI, NSE, BSE, demat, brokerage, SIP, mutual funds, taxation, and INR (₹).` :
  compliance === 'medical' ? `\nHealth content restrictions:\n- Write educational information only. Do not diagnose, prescribe, or claim guaranteed results.\n- Tell readers to consult a qualified professional for personal medical decisions.\n- Avoid unsafe dosage, treatment, or emergency claims.` :
  `\nSafety restrictions:\n- Do not invent facts, statistics, awards, prices, legal claims, medical claims, or financial guarantees.\n- If exact data is unknown, use cautious wording and avoid fake numbers.\n- Avoid adult, hateful, illegal, deceptive, or harmful content.`;

  return `You are an expert SEO blog writer and careful content editor for ${businessType}.\n\nTask:\nWrite a complete, high-quality ${focus} about "$topic". The primary SEO keyword is "$keyword".\n\nAudience and tone:\n- Audience: ${audience}.\n- Language: ${language}.\n- Tone: ${tone}.\n\nSEO requirements:\n- Target length: ${wordCount}+ words unless the topic needs a shorter direct answer.\n- Use "$keyword" naturally in the SEO title, introduction, at least one subheading, and conclusion.\n- Include semantic related terms naturally. Do not keyword-stuff.\n- Create a clear search-intent structure that answers the topic fully.\n- Add practical examples, steps, benefits, mistakes to avoid, and decision guidance where relevant.\n\nRequired output format:\n- Return clean HTML only.\n- Start with exactly one <p> containing the meta description, 150-160 characters.\n- Then output exactly one <h1> SEO title, ideally 50-60 characters.\n- Then write the article using these tags: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>${includeTable ? ', <table>, <thead>, <tbody>, <tr>, <th>, <td>' : ''}.\n- Do not output markdown, JSON, code fences, CSS, JavaScript, tables of contents with anchor scripts, emojis, or labels like "Title:" or "Meta Description:".\n${includeTable ? '- Include one simple comparison table only if it genuinely helps the reader. Use clean HTML table tags.\n' : '- Do not use HTML tables unless absolutely necessary.\n'}${includeFaq ? '- Include a helpful FAQ section near the end with 4-6 questions and direct answers.\n' : ''}${includeConclusion ? '- End with a useful conclusion and a soft, non-misleading call to action.\n' : ''}${includeBacklink ? '- If $backlink is provided and it is a valid URL, include it naturally exactly once as a contextual link. If no backlink is provided, do not mention it.\n' : ''}${complianceBlock}\n\nQuality control before final answer:\n- Check that the content matches "$topic" and "$keyword".\n- Check that there is one meta description paragraph and one H1.\n- Check that no restricted or fake claim is included.\n- Check that the HTML is clean and ready for WordPress publishing.\n${extraRules ? `\nExtra site-specific rules:\n${extraRules}\n` : ''}`;
}

function extractGeminiText(data){
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim() || '';
}

export async function generatePromptWithGemini(input = {}){
  const apiKey = safeTrim(input.geminiApiKey, 3000);
  if (!apiKey) { const err = new Error('Gemini API key is required to generate with AI.'); err.status = 400; throw err; }
  const model = safeTrim(input.geminiModel || 'gemini-2.5-flash', 120) || 'gemini-2.5-flash';
  const base = buildSafePromptTemplate(input);
  const master = `You are building a reusable WordPress Gemini article-generation prompt.\n\nReturn ONLY the final prompt text. Do not write an article. Do not use markdown fences.\n\nThe final prompt MUST:\n- Keep variables exactly as variables: $topic, $keyword, and $backlink.\n- Be safe for automatic blog generation.\n- Force clean HTML output.\n- Include strict restrictions against fake facts, guarantees, harmful claims, markdown, scripts, styles, and keyword stuffing.\n- Be suitable for every post generated from a CSV queue.\n- Include optional per-post overrides when a CSV row has a Prompt/CustomPrompt value.\n\nUse and improve this draft prompt without removing the safety rules:\n\n${base}`;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const body = JSON.stringify({ contents: [{ parts: [{ text: master }] }], generationConfig: { temperature: 0.35, topP: 0.8, maxOutputTokens: 4096 } });
  const geminiTimeoutValue = Number(process.env.GEMINI_TIMEOUT_MS || 60000);
  const geminiTimeout = Number.isFinite(geminiTimeoutValue) && geminiTimeoutValue > 0 ? geminiTimeoutValue : 60000;
  const r = await fetchWithTimeout(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body }, geminiTimeout);
  const raw = await r.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!r.ok) {
    const msg = redactSecrets(data?.error?.message || raw || r.statusText);
    const err = new Error('Gemini HTTP '+r.status+': '+msg);
    err.status = 400;
    err.payload = redactSecrets(data);
    throw err;
  }
  let prompt = extractGeminiText(data);
  prompt = prompt.replace(/^```(?:text|markdown)?/i, '').replace(/```$/,'').trim();
  if (!prompt) { const err = new Error('Gemini returned empty prompt.'); err.status = 502; throw err; }
  const warnings = validateArticlePrompt(prompt);
  return { ok:true, prompt, warnings, model, promptVersion: PROMPT_VERSION, source:'dashboard-gemini' };
}
