import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const API = import.meta.env.VITE_API_BASE || ''
const DEFAULT_CSV = 'Keyword,Topic,Category,Tags,image,Backlink\n'
const RESERVED_CLIENT_PATHS = new Set(['api','assets','static','client','clients','admin','login','logout','healthz','favicon.ico'])

function detectClientSlug(){
  const first = (window.location.pathname || '/').split('/').filter(Boolean)[0] || ''
  if (!first || RESERVED_CLIENT_PATHS.has(first.toLowerCase())) return 'main'
  return /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$/.test(first) ? first.toLowerCase() : 'main'
}
const CLIENT_SLUG = detectClientSlug()
const CLIENT_BASE_PATH = CLIENT_SLUG === 'main' ? '' : `/${CLIENT_SLUG}`
const API_PREFIX = CLIENT_SLUG === 'main' ? '/api' : `${CLIENT_BASE_PATH}/api`
function apiPath(path){
  const clean = String(path || '')
  if (clean.startsWith('/api/')) return API_PREFIX + clean.slice(4)
  return API_PREFIX + (clean.startsWith('/') ? clean : `/${clean}`)
}
function appUrl(slug='main'){
  return `${window.location.origin}${slug === 'main' ? '/' : `/${slug}/`}`
}

function getAdminKey(){ return localStorage.getItem('ab_admin_key') || '' }
function setAdminKey(v){ localStorage.setItem('ab_admin_key', v || '') }
function randomBridgeKey(){
  const bytes = new Uint8Array(24)
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes)
  else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256)
  return Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('')
}

function arrayBufferToBase64(buffer){
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

async function req(path, options={}){
  const headers = new Headers(options.headers || {})
  const adminKey = getAdminKey()
  if (adminKey) headers.set('x-admin-key', adminKey)
  const r = await fetch(API+apiPath(path), { credentials: 'include', ...options, headers })
  const ct = r.headers.get('content-type') || ''
  const raw = await r.text().catch(()=> '')
  let payload = raw
  if (ct.includes('json')) {
    try { payload = raw ? JSON.parse(raw) : {} } catch { payload = raw }
  } else if (raw && raw.trim().startsWith('{')) {
    try { payload = JSON.parse(raw) } catch {}
  }
  if(!r.ok){
    let message = typeof payload === 'object' ? (payload.error || payload.message || JSON.stringify(payload)) : String(payload || '')
    if (/Cannot\s+(GET|POST|PUT|DELETE)\s+\/api\//i.test(message) || /<!doctype html/i.test(message)) {
      message = 'Dashboard backend is still old or not restarted. API route missing: '+apiPath(path)+'. Restart the Node server from /opt/autoblog/server and clear browser cache.'
    }
    throw new Error(message || r.statusText)
  }
  return payload
}

function detectDelimiter(line){
  const candidates = [',',';','\t','|']
  let best = ',', bestCount = -1
  for (const d of candidates){
    let count = 0, inQuotes = false
    for (let i=0;i<line.length;i++){
      const c=line[i]
      if (c === '"') {
        if (inQuotes && line[i+1] === '"') i++
        else inQuotes = !inQuotes
      } else if (!inQuotes && c === d) count++
    }
    if (count > bestCount){ best = d; bestCount = count }
  }
  return bestCount > 0 ? best : ','
}

function parseCsv(text){
  const clean = (s) => (s ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize('NFKC')

  text = clean(text)
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '')
  const delimiter = detectDelimiter(firstLine)
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === delimiter) { row.push(field.trim()); field = '' }
      else if (c === '\n') { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = '' }
      else if (c !== '\r') field += c
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  if (!rows.length) return []

  let headerRow = rows[0].map(h => clean(h).trim())
  const hasHeader = headerRow.some(h => /^(keyword|keywords|title)$/i.test(h.replace(/[\s_\-]+/g,'')))
  if (!hasHeader) headerRow = ['Keyword','Topic','Category','Tags','image','Backlink']

  const alias = {
    keyword: 'Keyword', keywords: 'Keyword', title: 'Keyword',
    topic: 'Topic', subject: 'Topic', category: 'Category', categories: 'Category',
    tags: 'Tags', tag: 'Tags', image: 'image', imageurl: 'image', image_url: 'image', featuredimage: 'image', images: 'image',
    backlink: 'Backlink', backlinkurl: 'Backlink', backlink_url: 'Backlink', url: 'Backlink', link: 'Backlink'
  }
  const normHeader = headerRow.map(h => alias[h.replace(/[\s_\-]+/g,'').toLowerCase()] || h)
  const idx = name => normHeader.findIndex(h => h.toLowerCase() === name.toLowerCase())
  const value = (r, name) => {
    const i = idx(name)
    return i >= 0 ? clean(r[i] || '').trim() : ''
  }

  return (hasHeader ? rows.slice(1) : rows).map(r => ({
    Keyword: value(r, 'Keyword'),
    Topic: value(r, 'Topic'),
    Category: value(r, 'Category'),
    Tags: value(r, 'Tags'),
    image: value(r, 'image'),
    Backlink: value(r, 'Backlink')
  })).filter(r => r.Keyword)
}


function csvRowKey(row){
  return String(row?.Keyword || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()
}

function analyzeCsv(preview, current){
  const seen = new Set(), existing = new Set((current || []).map(csvRowKey).filter(Boolean))
  const stats = { rows: preview.length, duplicateCsv: 0, existing: 0, newRows: 0 }
  for (const row of preview){
    const key = csvRowKey(row)
    if (!key) continue
    if (seen.has(key)) stats.duplicateCsv++
    else seen.add(key)
    if (existing.has(key)) stats.existing++
    else stats.newRows++
  }
  return stats
}

function Icon({name}){
  const paths={
    dash:'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
    sites:'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14H4V5Zm4 2v2h8V7H8Zm0 4v2h8v-2H8Zm0 4v2h5v-2H8Z',
    queue:'M5 5h14v4H5V5Zm0 6h14v4H5v-4Zm0 6h14v2H5v-2Z',
    logs:'M7 3h10l4 4v14H7V3Zm9 1.5V8h3.5L16 4.5ZM3 7h2v16h12v-2H5V7H3Z',
    history:'M13 3a9 9 0 1 1-8.5 6H2l3.3-3.3L8.7 9H6.6A7 7 0 1 0 13 5V3Zm-1 4h2v6l5 3-1 1.7-6-3.6V7Z',
    key:'M7 14a4 4 0 1 1 3.5-2.1L21 12v3h-3v3h-3v3h-3v-4.1L10.5 15A4 4 0 0 1 7 14Zm0-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    prompt:'M4 4h16v12H7.5L4 19.5V4Zm3 4v2h10V8H7Zm0 4v2h7v-2H7Z',
    plugins:'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 5.9 3.3L12 10.9 6.1 7.6 12 4.3ZM5 9.2l6 3.3v6.7l-6-3.3V9.2Zm14 0v6.7l-6 3.3v-6.7l6-3.3Z'
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={paths[name]||paths.dash}/></svg>
}

function Toast({toast,onClose}){
  useEffect(()=>{ if(!toast) return; const t=setTimeout(onClose, 4500); return ()=>clearTimeout(t) },[toast,onClose])
  if(!toast) return null
  return <div className={'toast '+(toast.type||'')}>{toast.message}</div>
}

function useSites(notify){
  const [sites,setSites]=useState([])
  const [loading,setLoading]=useState(false)
  const refresh = async()=>{
    setLoading(true)
    try { setSites(await req('/api/sites')) }
    catch(e){ notify(e.message, 'error') }
    finally { setLoading(false) }
  }
  useEffect(()=>{ refresh() },[])
  return { sites, loading, refresh }
}

function AdminKeyBox({notify}){
  const [key,setKey] = useState(getAdminKey())
  function save(){ setAdminKey(key.trim()); notify('Admin key saved in this browser.', 'success') }
  return <div className="secure-box">
    <div className="secure-title"><Icon name="key"/> Admin Key</div>
    <input type="password" placeholder="Only needed when API_KEY is enabled" value={key} onChange={e=>setKey(e.target.value)} />
    <button className="btn small-btn" onClick={save}>Save</button>
  </div>
}

function ThemeStudio({theme,setTheme}){
  const palettes = [
    {id:'aurora', name:'Aurora', hint:'Cyan + violet'},
    {id:'royal', name:'Royal', hint:'Blue + gold'},
    {id:'emerald', name:'Emerald', hint:'Green + teal'},
    {id:'sunset', name:'Sunset', hint:'Pink + orange'}
  ]
  return <div className="theme-studio">
    <div className="secure-title"><Icon name="dash"/> Theme Studio</div>
    <div className="palette-grid">
      {palettes.map(p=><button key={p.id} className={theme===p.id?'palette active':'palette'} onClick={()=>setTheme(p.id)} title={p.hint}>
        <span className={'swatch '+p.id}></span><b>{p.name}</b>
      </button>)}
    </div>
    <small>Saved in this browser. Use this to match your brand color.</small>
  </div>
}


function LoginScreen({themeValue,setTheme,onLogin,notify}){
  const [form,setForm]=useState({username:'admin',password:''})
  const [busy,setBusy]=useState(false)
  async function submit(e){
    e.preventDefault()
    setBusy(true)
    try{
      const data = await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)})
      notify('Dashboard unlocked.', 'success')
      onLogin(data.user)
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }
  return <div className={"login-shell theme-"+themeValue}>
    <div className="login-bg"></div>
    <div className="login-panel">
      <div className="brand login-brand"><span className="brand-mark">✦</span><div><b>Remote Controller Pro</b><small>Protected dashboard</small></div></div>
      <form className="card login-card" onSubmit={submit}>
        <span className="eyebrow">Dashboard Lock</span>
        <h1>Sign in to unlock your application.</h1>
        <p className="muted">Your WordPress automation dashboard, plugin manager, Gemini key manager, CSV queue and prompt studio stay hidden until login.</p>
        <label>User name<input autoFocus required value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="admin" autoComplete="username" /></label>
        <label>Password<input required type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Enter password" autoComplete="current-password" /></label>
        <button className="btn primary login-btn" disabled={busy}>{busy?'Checking...':'Unlock Dashboard'}</button>
        <small className="login-note">After first login, open Security and change the temporary password.</small>
      </form>
      <ThemeStudio theme={themeValue} setTheme={setTheme}/>
    </div>
  </div>
}

function SecuritySettings({user,onLogout,onChangedUser,notify}){
  const [form,setForm]=useState({currentPassword:'',newUsername:user?.username || 'admin',newPassword:'',confirmPassword:''})
  const [busy,setBusy]=useState(false)
  useEffect(()=>{ setForm(f=>({...f,newUsername:user?.username || 'admin'})) },[user?.username])
  async function save(e){
    e.preventDefault()
    if(form.newPassword && form.newPassword !== form.confirmPassword) return notify('New password and confirm password do not match.', 'error')
    setBusy(true)
    try{
      const data = await req('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:form.currentPassword,newUsername:form.newUsername,newPassword:form.newPassword})})
      onChangedUser(data.user)
      setForm(f=>({...f,currentPassword:'',newPassword:'',confirmPassword:'',newUsername:data.user?.username || f.newUsername}))
      notify(data.passwordChanged ? 'Dashboard username/password updated.' : 'Dashboard username updated.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }
  return <div className="security-page">
    <section className="hero security-hero">
      <div>
        <span className="eyebrow">Security</span>
        <h1>Dashboard lock is active.</h1>
        <p>Only logged-in users can access dashboard API routes. Use this screen to change the temporary username/password after deployment.</p>
        <div className="hero-actions"><button className="btn danger" onClick={onLogout}>Logout</button></div>
      </div>
      <div className="metric"><span>Signed in as</span><strong className="metric-date">{user?.username || '-'}</strong><small>Session protected with HttpOnly cookie</small></div>
    </section>
    <div className="grid two security-grid">
      <form className="card" onSubmit={save}>
        <div className="card-head"><div><h2>Change login details</h2><p>Enter the current password, then save a new user name and password.</p></div></div>
        <div className="form-grid">
          <label>Current password<input required type="password" value={form.currentPassword} onChange={e=>setForm({...form,currentPassword:e.target.value})} autoComplete="current-password" /></label>
          <label>New user name<input required minLength="3" value={form.newUsername} onChange={e=>setForm({...form,newUsername:e.target.value})} autoComplete="username" /></label>
          <label>New password<input type="password" minLength="8" value={form.newPassword} onChange={e=>setForm({...form,newPassword:e.target.value})} placeholder="Leave blank to keep current password" autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" minLength="8" value={form.confirmPassword} onChange={e=>setForm({...form,confirmPassword:e.target.value})} placeholder="Repeat new password" autoComplete="new-password" /></label>
        </div>
        <div className="right"><button className="btn primary" disabled={busy}>{busy?'Saving...':'Save Security Settings'}</button></div>
      </form>
      <div className="card">
        <div className="card-head"><div><h2>Important deploy notes</h2><p>For first deploy only, the temporary login is created automatically.</p></div></div>
        <ul className="checklist">
          <li>Default user name: <b>admin</b></li>
          <li>Default temporary password: <b>admin@2020</b></li>
          <li>Password hash is stored in <b>server/data/dashboard-auth.json</b>.</li>
          <li>Do not commit the runtime auth file after changing the password on the server.</li>
          <li>If you lose access, stop the server and delete that auth file to recreate the temporary login.</li>
        </ul>
      </div>
    </div>
  </div>
}


function ClientApps({notify}){
  const [items,setItems]=useState([])
  const [form,setForm]=useState({slug:'',name:''})
  const [busy,setBusy]=useState(false)
  async function load(){
    try { setItems(await req('/clients')) }
    catch(e){ notify(e.message, 'error') }
  }
  useEffect(()=>{ load() },[])
  function cleanSlug(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,60) }
  async function create(e){
    e.preventDefault()
    const slug = cleanSlug(form.slug)
    if(!slug || slug === 'main') return notify('Add a client page name like global1, client-a, or demo1.', 'error')
    setBusy(true)
    try{
      const data = await req('/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,name:form.name || slug})})
      notify(`Client app created: ${data.client?.url || appUrl(slug)}`, 'success')
      setForm({slug:'',name:''})
      await load()
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }
  async function copyUrl(url){
    try { await navigator.clipboard.writeText(url); notify('Client URL copied.', 'success') }
    catch { notify(url, 'success') }
  }
  async function deleteClient(c){
    if(!c || c.slug === 'main') return notify('Main dashboard cannot be deleted.', 'error')
    const first = window.confirm(`Delete client /${c.slug}?\n\nThis stops its backend, removes it from the main dashboard, deletes runtime files, and attempts to drop its client database. This cannot be undone.`)
    if(!first) return
    const typed = window.prompt(`Type DELETE ${c.slug} to confirm permanent deletion:`)
    if(typed !== `DELETE ${c.slug}`) return notify('Delete cancelled. Confirmation text did not match.', 'error')
    try{
      await req('/clients/'+c.slug,{method:'DELETE'})
      notify(`Client /${c.slug} deleted.`, 'success')
      await load()
    }catch(e){ notify(e.message, 'error') }
  }
  return <div className="clients-page">
    <section className="hero">
      <div>
        <span className="eyebrow">Fresh Client Instance Builder</span>
        <h1>Create a fresh new app instance for every client.</h1>
        <p>Add a page name like <b>global1</b>. The system creates <b>/global1</b> as a fresh dashboard with its own Node backend process, own port, own login, own sites, own logs, own schedules, and own Mongo database.</p>
        <div className="hero-actions"><a className="btn primary" href={appUrl('global1')} target="_blank" rel="noreferrer">Example /global1</a><button className="btn" onClick={load}>Refresh clients</button></div>
      </div>
      <div className="metric"><span>Current app</span><strong>{CLIENT_SLUG}</strong><small>{CLIENT_SLUG==='main'?'Root database':'Isolated client database'}</small></div>
    </section>
    <div className="grid two">
      <form className="card" onSubmit={create}>
        <div className="card-head"><div><h2>Add new client page</h2><p>This creates a fresh backend instance and private database for the client.</p></div></div>
        <div className="form-grid">
          <label>Page name / slug<input required value={form.slug} onChange={e=>setForm({...form,slug:cleanSlug(e.target.value)})} placeholder="global1" /></label>
          <label>Client display name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Global Client 1" /></label>
        </div>
        <div className="preview-url"><span>New URL</span><b>{appUrl(cleanSlug(form.slug) || 'global1')}</b></div>
        <div className="right"><button className="btn primary" disabled={busy}>{busy?'Creating...':'Create Client App'}</button></div>
      </form>
      <div className="card">
        <div className="card-head"><div><h2>How isolation works</h2><p>Good performance: main app only routes traffic; every client runs its own backend process and DB.</p></div></div>
        <ul className="checklist">
          <li><b>/</b> keeps your main dashboard and current data.</li>
          <li><b>/global1</b>, <b>/client2</b> etc. each get a separate Node backend process and Mongo database.</li>
          <li>Each client starts with temporary login <b>admin / admin@2020</b>.</li>
          <li>Each client has its own Security tab to change username/password.</li>
          <li>No shared dashboard data. The main app only works as a lightweight router to the client instance.</li>
        </ul>
      </div>
    </div>
    <div className="card">
      <div className="card-head"><div><h2>Client apps</h2><p>Open, restart, or delete client URLs. Main Dashboard is protected and cannot be deleted.</p></div><button className="btn" onClick={load}>Refresh</button></div>
      <div className="table-wrap"><table><thead><tr><th>Client</th><th>URL</th><th>Database</th><th>Port</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map(c=><tr key={c.slug}>
        <td><strong>{c.name}</strong><div className="small">/{c.slug}</div></td>
        <td className="small"><a href={c.url} target="_blank" rel="noreferrer">{c.url}</a></td>
        <td className="small log-message">{c.databaseName}</td>
        <td className="small">{c.port || '-'}</td>
        <td><span className={'badge '+(c.processStatus==='running'?'success':c.enabled?'neutral':'neutral')}>{c.processStatus || (c.enabled?'Active':'Disabled')}</span></td>
        <td><div className="action-stack"><a className="btn primary" href={c.url} target="_blank" rel="noreferrer">Open</a><button className="btn" onClick={()=>copyUrl(c.url)}>Copy URL</button>{c.slug !== 'main' && <button className="btn" onClick={async()=>{try{await req('/clients/'+c.slug+'/restart',{method:'POST'}); notify('Client restarted with a fresh backend process.', 'success'); await load()}catch(e){notify(e.message,'error')}}}>Restart</button>}{c.slug !== 'main' && <button className="btn danger" onClick={()=>deleteClient(c)}>Delete</button>}</div></td>
      </tr>)}</tbody></table></div>
      {!items.length && <p className="muted empty-state">No clients yet. Add your first client page name above.</p>}
    </div>
  </div>
}

function KPIs({sites}){
  const t = useMemo(()=>{
    const s={count:sites.length,enabled:0,sent:0,failed:0,lastOk:null}
    for(const x of sites){
      if(x.enabled) s.enabled++
      s.sent += x.counters?.sent||0
      s.failed += x.counters?.failed||0
      if(x.lastSuccessAt){ const v=+new Date(x.lastSuccessAt); s.lastOk = s.lastOk? Math.max(s.lastOk,v) : v }
    }
    return s
  },[sites])
  return <div className="kpi-grid">
    <div className="metric"><span>Sites</span><strong>{t.count}</strong><small>{t.enabled} enabled</small></div>
    <div className="metric"><span>Published</span><strong>{t.sent}</strong><small>success count</small></div>
    <div className="metric"><span>Failed</span><strong>{t.failed}</strong><small>needs attention</small></div>
    <div className="metric"><span>Last success</span><strong className="metric-date">{t.lastOk?new Date(t.lastOk).toLocaleString():'-'}</strong><small>local time</small></div>
  </div>
}

function Dashboard({sites,onTab}){
  const failing = sites.filter(s => (s.counters?.failed || 0) > 0).slice(0, 5)
  return <>
    <section className="hero">
      <div>
        <span className="eyebrow">Remote Controller Command Center</span>
        <h1>World-class WordPress automation control room.</h1>
        <p>Control CSV auto updates, Gemini API keys, Prompt Studio, WordPress plugin upload/activation/removal, post history, queue health, schedules and bridge checks from one premium dashboard.</p>
        <div className="hero-actions">
          {CLIENT_SLUG==='main' && <button className="btn primary" onClick={()=>onTab('clients')}>Client Apps</button>}<button className="btn" onClick={()=>onTab('sites')}>Manage sites</button>
          <button className="btn" onClick={()=>onTab('queue')}>Smart CSV sync</button>
          <button className="btn glow" onClick={()=>onTab('prompt')}>Prompt Studio</button>
          <button className="btn" onClick={()=>onTab('keys')}>Gemini API keys</button>
          <button className="btn" onClick={()=>onTab('history')}>Blog history</button>
          <button className="btn" onClick={()=>onTab('plugins')}>Plugin Manager</button>
        </div>
      </div>
      <KPIs sites={sites}/>
    </section>
    <div className="command-grid">
      {CLIENT_SLUG==='main' && <button className="command-card" onClick={()=>onTab('clients')}><span>00</span><b>Client App Builder</b><small>Create /global1, /client2 as fresh backend instances.</small></button>}
      <button className="command-card" onClick={()=>onTab('queue')}><span>01</span><b>Smart CSV Auto Update</b><small>Update changed rows, add new keywords and keep WordPress queue verified.</small></button>
      <button className="command-card" onClick={()=>onTab('keys')}><span>02</span><b>Gemini Key Manager</b><small>Change, test, save and mask Gemini API settings from the dashboard.</small></button>
      <button className="command-card" onClick={()=>onTab('prompt')}><span>03</span><b>Prompt Studio</b><small>Edit Gemini article prompts with variables, preview, save and reset controls.</small></button>
      <button className="command-card" onClick={()=>onTab('history')}><span>04</span><b>Blog Update History</b><small>Open published posts, edit links, warnings and queue remaining count.</small></button>
      <button className="command-card" onClick={()=>onTab('plugins')}><span>05</span><b>Plugin Manager</b><small>Upload plugin ZIPs, activate, deactivate, reactivate and remove plugins remotely.</small></button>
      <button className="command-card" onClick={()=>onTab('logs')}><span>06</span><b>Reliability Logs</b><small>Catch bridge, queue, prompt, Gemini and WordPress failures before they repeat.</small></button>
    </div>
    <div className="grid two">
      <div className="card">
        <h2>Reliability checklist</h2>
        <ul className="checklist">
          <li>CSV rows are written to the WordPress queue instantly and stay there until a post is published successfully.</li>
          <li>Dashboard API key manager updates Bridge/Gemini settings safely with masked status checks.</li>
          <li>Prompt Studio updates the WordPress Gemini prompt with $topic, $keyword and $backlink variables.</li>
          <li>Plugin Manager uploads ZIP files and manages activate, deactivate, reactivate and remove actions through the secure bridge.</li>
          <li>Schedules are unique per site, with daily limits and timezone-safe reset logic.</li>
          <li>Blog History and API key actions now log cleanly without validation crashes.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Sites needing review</h2>
        {failing.length === 0 ? <p className="muted">No failed site counters yet.</p> : failing.map(s => <div className="mini-row" key={s._id}><b>{s.name}</b><span className="badge error">{s.counters?.failed || 0} failed</span></div>)}
      </div>
    </div>
  </>
}

function AddSite({onAdded,notify}){
  const [f,set]=useState({name:'',url:'',apiKey:''})
  const [busy,setBusy]=useState(false)
  async function submit(e){
    e.preventDefault(); setBusy(true)
    try {
      await req('/api/sites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)})
      set({name:'',url:'',apiKey:''}); notify('Site added.', 'success'); onAdded()
    } catch(e){ notify(e.message, 'error') }
    finally { setBusy(false) }
  }
  return <div className="card">
    <div className="card-head"><div><h2>Add WordPress site</h2><p>Use the same API key saved in the WP Remote Bridge plugin.</p></div></div>
    <form onSubmit={submit} className="form-grid add-site-form">
      <label>Site name<input required placeholder="Example: Main Blog" value={f.name} onChange={e=>set({...f,name:e.target.value})}/></label>
      <label>Site URL<input required placeholder="https://example.com" value={f.url} onChange={e=>set({...f,url:e.target.value})}/></label>
      <label>Bridge API key<input required type="password" placeholder="x-api-key" value={f.apiKey} onChange={e=>set({...f,apiKey:e.target.value})}/></label>
      <button disabled={busy} className="btn primary">{busy?'Adding...':'Add site'}</button>
    </form>
  </div>
}

function Sites({sites,refresh,notify}){
  const [query,setQuery]=useState('')
  const shown = sites.filter(s => `${s.name} ${s.url}`.toLowerCase().includes(query.toLowerCase()))

  async function update(id,patch){
    try { await req('/api/sites/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); await refresh(); notify('Saved.', 'success') }
    catch(e){ notify(e.message, 'error') }
  }
  async function ping(s){
    try { const r = await req('/api/sites/'+s._id+'/ping',{method:'POST'}); notify('Ping OK: '+JSON.stringify(r), 'success') }
    catch(e){ notify(e.message, 'error') }
  }
  async function remove(s){
    if(!confirm('Delete site '+s.name+'?'))return
    try { await req('/api/sites/'+s._id,{method:'DELETE'}); await refresh(); notify('Site deleted.', 'success') }
    catch(e){ notify(e.message, 'error') }
  }
  async function postNow(s){
    try { await req('/api/jobs/trigger',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:s._id})}); notify('Post job queued.', 'success') }
    catch(e){ notify(e.message, 'error') }
  }

  return <div className="card">
    <div className="card-head"><div><h2>Sites, schedules and limits</h2><p>Change mode, fill only the matching schedule field, then enable the site.</p></div><input className="compact-input" placeholder="Search sites" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Site</th><th>Mode</th><th>Schedule</th><th>Enabled</th><th>Sent / Fail</th><th>Daily limit</th><th>Actions</th></tr></thead>
        <tbody>{shown.map(s=>(
          <tr key={s._id}>
            <td><strong>{s.name}</strong><div className="small">{s.url}</div>{s.apiKeySet && <span className="tiny">API key saved</span>}</td>
            <td>
              <select defaultValue={s.scheduleMode||'manual'} onChange={e=>update(s._id,{scheduleMode:e.target.value})}>
                <option value="manual">Manual</option><option value="everySeconds">Every seconds</option><option value="everyHours">Every hours</option><option value="dailyTime">Daily</option><option value="cron">Cron</option><option value="once">Once</option>
              </select>
            </td>
            <td><div className="schedule-grid">
              <input type="number" title="Every seconds" placeholder="seconds" defaultValue={s.everySeconds || ''} min="1" max="100000000" step="1" onBlur={e=>update(s._id,{everySeconds:e.target.value?Number(e.target.value):null})}/>
              <input type="number" title="Every hours" placeholder="hours" defaultValue={s.everyHours || ''} min="1" max="8760" step="1" onBlur={e=>update(s._id,{everyHours:e.target.value?Number(e.target.value):null})}/>
              <input type="time" title="Daily time" defaultValue={s.dailyAt || ''} onBlur={e=>update(s._id,{dailyAt:e.target.value||null})}/>
              <input title="Timezone" placeholder="Asia/Colombo" defaultValue={s.timezone || ''} onBlur={e=>update(s._id,{timezone:e.target.value||null})}/>
              <input title="Cron" placeholder="0 9 * * *" defaultValue={s.scheduleCron || ''} onBlur={e=>update(s._id,{scheduleCron:e.target.value||null})}/>
              <input title="Once" type="datetime-local" defaultValue={s.onceAt?new Date(s.onceAt).toISOString().slice(0,16):''} onBlur={e=>update(s._id,{onceAt:e.target.value||null})}/>
            </div></td>
            <td><label className="switch"><input type="checkbox" defaultChecked={s.enabled} onChange={e=>update(s._id,{enabled:e.target.checked})}/><span></span></label></td>
            <td><span className="badge success">{s.counters?.sent||0}</span> <span className="badge error">{s.counters?.failed||0}</span></td>
            <td><div className="limit-cell"><span>{s.todayCount||0} /</span><input type="number" min="0" max="100000" defaultValue={s.dailyLimit||0} onBlur={e=>update(s._id,{dailyLimit:Number(e.target.value||0)})}/></div></td>
            <td><div className="action-stack"><button className="btn primary" onClick={()=>postNow(s)}>Post now</button><button className="btn" onClick={()=>ping(s)}>Ping</button><button className="btn danger" onClick={()=>remove(s)}>Delete</button></div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </div>
}

function Queue({sites,notify}){
  const [siteId,setSite]=useState('')
  const [csv,setCsv]=useState(DEFAULT_CSV)
  const [preview,setPreview]=useState([])
  const [list,setList]=useState({items:[]})
  const [busy,setBusy]=useState(false)
  const [mode,setMode]=useState('smart')
  const [skipPublished,setSkipPublished]=useState(false)
  const [autoUpload,setAutoUpload]=useState(false)
  const [lastSync,setLastSync]=useState(null)

  useEffect(()=>{ setPreview(parseCsv(csv)) },[csv])
  useEffect(()=>{ if(siteId) load(siteId) },[siteId])
  const stats = useMemo(()=>analyzeCsv(preview, list.items || []),[preview,list])

  async function syncRows(rows=parseCsv(csv), selectedMode=mode, selectedSkipPublished=skipPublished){
    if(!siteId) return notify('Select site first.', 'error')
    if(!rows.length) return notify('CSV has no valid rows with Keyword.', 'error')
    setBusy(true)
    try {
      const r = await req('/api/queue/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId, items:rows, mode:selectedMode, skipPublished:selectedSkipPublished})})
      setLastSync(r)
      notify(`CSV synced: +${r.added ?? 0} added, ${r.updated ?? 0} updated, ${r.removed ?? 0} removed, ${r.skippedPublished ?? 0} skipped. Queue ${r.queueCount ?? '-'}.`, (r.skippedPublished ? 'warning' : 'success'))
      await load(siteId)
    }
    catch(e){ notify(e.message, 'error') }
    finally { setBusy(false) }
  }
  async function upload(){ return syncRows(parseCsv(csv), mode) }
  async function load(id=siteId){
    if(!id) return
    try { setList(await req('/api/queue?siteId='+encodeURIComponent(id))) }
    catch(e){ notify(e.message, 'error') }
  }
  async function clearAll(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!confirm('Clear queue for this site?')) return
    try { await req('/api/queue/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId, all:true})}); notify('Queue cleared.', 'success'); setLastSync(null); await load(siteId) }
    catch(e){ notify(e.message, 'error') }
  }
  async function handleFile(file){
    if(!file) return
    const text = await file.text()
    const rows = parseCsv(text)
    setCsv(text)
    if(autoUpload){
      if(!siteId) return notify('CSV loaded, but select a site before auto upload.', 'error')
      if(rows.length && confirm(`Auto update ${rows.length} CSV rows to WordPress using ${mode} mode?`)) await syncRows(rows, mode)
    }
  }

  return <div className="grid two queue-layout advanced-queue">
    <div className="card csv-master-card">
      <div className="card-head"><div><h2>Advanced CSV Auto Update v9</h2><p>Upload CSV, sync to WordPress, and verify exact rows saved. v9 detects comma, semicolon, tab and pipe CSV, plus Prompt Studio backend health checks.</p></div></div>
      <div className="sync-panel">
        <label>Target site<select value={siteId} onChange={e=>setSite(e.target.value)}><option value="">-- select site --</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        <div className="mode-grid">
          <label className={mode==='smart'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='smart'} onChange={()=>setMode('smart')}/><b>Smart Sync</b><span>Update + append, never wipes old queue rows.</span></label>
          <label className={mode==='append'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='append'} onChange={()=>setMode('append')}/><b>Append New</b><span>Add only new keywords.</span></label>
          <label className={mode==='mirror'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='mirror'} onChange={()=>setMode('mirror')}/><b>Mirror CSV</b><span>Queue becomes exactly this CSV.</span></label>
          <label className={mode==='replace'?'mode-card active danger-mode':'mode-card danger-mode'}><input type="radio" checked={mode==='replace'} onChange={()=>setMode('replace')}/><b>Replace</b><span>Clear queue and load CSV.</span></label>
        </div>
        <div className="sync-toggles">
          <label className="inline-check"><input type="checkbox" checked={skipPublished} onChange={e=>setSkipPublished(e.target.checked)}/> Skip already published keywords <span className="small">(off = show every CSV row in WordPress queue)</span></label>
          <label className="inline-check"><input type="checkbox" checked={autoUpload} onChange={e=>setAutoUpload(e.target.checked)}/> Auto upload after selecting CSV</label>
        </div>
      </div>
      <input className="file-input" type="file" accept=".csv,text/csv" onChange={e=>handleFile(e.target.files?.[0])} />
      <textarea placeholder="Paste CSV rows" value={csv} onChange={e=>setCsv(e.target.value)}></textarea>
      <div className="csv-stats">
        <div><span>Valid rows</span><b>{stats.rows}</b></div>
        <div><span>New</span><b>{stats.newRows}</b></div>
        <div><span>Will update</span><b>{stats.existing}</b></div>
        <div><span>CSV duplicates</span><b>{stats.duplicateCsv}</b></div>
      </div>
      <div className="right"><button disabled={busy} className="btn primary" onClick={upload}>{busy?'Syncing...':'Sync CSV to WordPress'}</button><button disabled={busy} className="btn glow" onClick={()=>syncRows(parseCsv(csv), mode, false)}>Force Sync / Show All Rows</button><button className="btn" onClick={()=>load()}>Refresh Queue</button><button className="btn danger" onClick={clearAll}>Clear Queue</button></div>
      {lastSync && <div className="sync-result"><b>Last sync:</b> added {lastSync.added ?? 0}, updated {lastSync.updated ?? 0}, removed {lastSync.removed ?? 0}, skipped published {lastSync.skippedPublished ?? 0}, duplicates fixed {lastSync.duplicatesInCsv ?? 0}, queue {lastSync.queueCount ?? '-'}. {lastSync.skippedPublished ? <span className="warn-text"> If rows are missing in WordPress, turn off Skip already published or click Force Sync.</span> : null}</div>}
    </div>
    <div className="card">
      <div className="card-head"><div><h2>Current WordPress Queue</h2><p>Showing first 100 rows. Rows are removed only after a post is published successfully.</p></div><span className="badge neutral">{list.items?.length||0} rows</span></div>
      <div className="table-wrap"><table><thead><tr><th>Keyword</th><th>Topic</th><th>Category</th><th>Tags</th><th>Backlink</th></tr></thead><tbody>{(list.items||[]).slice(0,100).map((r,i)=><tr key={i}><td>{r.Keyword}</td><td>{r.Topic}</td><td>{r.Category}</td><td>{r.Tags}</td><td className="small">{r.Backlink || r.BacklinkURL}</td></tr>)}</tbody></table></div>
      <div className="csv-preview-card">
        <h3>CSV Preview</h3>
        <div className="table-wrap mini-table"><table><thead><tr><th>Keyword</th><th>Topic</th><th>Category</th></tr></thead><tbody>{preview.slice(0,8).map((r,i)=><tr key={i}><td>{r.Keyword}</td><td>{r.Topic}</td><td>{r.Category}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  </div>
}


function ApiKeys({sites,refresh,notify}){
  const [siteId,setSiteId]=useState('')
  const [settings,setSettings]=useState(null)
  const [busy,setBusy]=useState(false)
  const [bridgeKey,setBridgeKey]=useState('')
  const [dashboardOnlyKey,setDashboardOnlyKey]=useState('')
  const [verifyDashboardKey,setVerifyDashboardKey]=useState(true)
  const [geminiKey,setGeminiKey]=useState('')
  const [geminiModel,setGeminiModel]=useState('gemini-2.0-flash')
  const [cronEnabled,setCronEnabled]=useState(false)
  const selected = sites.find(s=>s._id===siteId)

  useEffect(()=>{
    setSettings(null); setBridgeKey(''); setDashboardOnlyKey(''); setGeminiKey('')
    if(siteId) loadSettings(false)
  },[siteId])

  async function loadSettings(showToast=true){
    if(!siteId) return notify('Select site first.', 'error')
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/wp-settings')
      setSettings(r)
      setGeminiModel(r.geminiModel || 'gemini-2.0-flash')
      setCronEnabled(!!r.cronEnabled)
      if(showToast) notify('Remote API status loaded.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function pingSelected(){
    if(!selected) return notify('Select site first.', 'error')
    setBusy(true)
    try{ const r = await req('/api/sites/'+siteId+'/ping',{method:'POST'}); notify('Ping OK: '+JSON.stringify(r), 'success') }
    catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function saveBridgeKeyToWp(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!bridgeKey || bridgeKey.trim().length < 12) return notify('Enter a new Bridge API key with at least 12 characters.', 'error')
    if(!confirm('This will update the WordPress Bridge key and the dashboard saved key together. Continue?')) return
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/wp-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bridgeApiKey:bridgeKey.trim()})})
      setSettings(r); setBridgeKey(''); await refresh(); notify('Bridge API key updated in WordPress and dashboard.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function saveDashboardKeyOnly(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!dashboardOnlyKey || dashboardOnlyKey.trim().length < 12) return notify('Enter the Bridge API key saved in WordPress.', 'error')
    setBusy(true)
    try{
      await req('/api/sites/'+siteId+'/api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:dashboardOnlyKey.trim(),verify:verifyDashboardKey})})
      setDashboardOnlyKey(''); await refresh(); notify(verifyDashboardKey?'Dashboard key saved and verified.':'Dashboard key saved without verification.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  function geminiPayload(includeKey=true){
    const payload = { geminiModel: geminiModel || 'gemini-2.0-flash', cronEnabled }
    if(includeKey && geminiKey.trim()) payload.geminiApiKey = geminiKey.trim()
    return payload
  }

  async function saveGemini(){
    if(!siteId) return notify('Select site first.', 'error')
    const payload = geminiPayload(true)
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/wp-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      setSettings(r); setGeminiKey(''); notify('Gemini/API settings updated on WordPress.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function testGemini(){
    if(!siteId) return notify('Select site first.', 'error')
    const payload = geminiPayload(true)
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/gemini-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      notify(r.message || 'Gemini key test passed.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function saveGeminiAndTest(){
    if(!siteId) return notify('Select site first.', 'error')
    const payload = geminiPayload(true)
    setBusy(true)
    try{
      const saved = await req('/api/sites/'+siteId+'/wp-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      setSettings(saved)
      const tested = await req('/api/sites/'+siteId+'/gemini-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ geminiModel: payload.geminiModel })})
      setGeminiKey('')
      notify((tested.message || 'Gemini key test passed') + ' after save.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function clearGemini(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!confirm('Clear Gemini API key from the selected WordPress site?')) return
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/wp-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clearGeminiApiKey:true})})
      setSettings(r); setGeminiKey(''); notify('Gemini API key cleared on WordPress.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  return <div className="api-page">
    <section className="hero api-hero">
      <div>
        <span className="eyebrow">API Key Manager</span>
        <h1>Update WordPress Bridge and Gemini keys from the dashboard.</h1>
        <p>Keys are never shown back in full. The dashboard sends new keys only when you save, then stores only the Bridge key needed for future secure requests.</p>
        <div className="hero-actions"><button className="btn primary" disabled={!siteId||busy} onClick={()=>loadSettings(true)}>Load remote status</button><button className="btn" disabled={!siteId||busy} onClick={pingSelected}>Ping Bridge</button></div>
      </div>
      <div className="card api-selector-card">
        <label>Select WordPress site<select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">-- select site --</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        {selected && <div className="selected-site"><b>{selected.name}</b><span>{selected.url}</span><small>{selected.apiKeySet?'Dashboard bridge key saved':'No dashboard bridge key saved'}</small></div>}
      </div>
    </section>

    <div className="api-status-grid">
      <div className="metric"><span>Bridge key</span><strong className="metric-date">{settings? (settings.bridgeKeySet?'Saved':'Missing') : '-'}</strong><small>{settings?.bridgeKeyMasked || 'masked after load'}</small></div>
      <div className="metric"><span>Gemini key</span><strong className="metric-date">{settings? (settings.geminiKeySet?'Saved':'Missing') : '-'}</strong><small>{settings?.geminiKeyMasked || 'masked after load'}</small></div>
      <div className="metric"><span>Gemini model</span><strong className="metric-date">{settings?.geminiModel || '-'}</strong><small>Remote WP setting</small></div>
      <div className="metric"><span>Queue</span><strong>{settings?.queueCount ?? '-'}</strong><small>rows in WordPress</small></div>
    </div>

    <div className="grid two">
      <div className="card key-card">
        <div className="card-head"><div><h2>Change Bridge API key</h2><p>Best option: update WordPress Bridge key and dashboard key together. The old saved key must still work one time for this change.</p></div></div>
        <label>New Bridge API key<input type="password" value={bridgeKey} placeholder="Paste or generate new bridge key" onChange={e=>setBridgeKey(e.target.value)} /></label>
        <div className="right"><button className="btn" type="button" onClick={()=>setBridgeKey(randomBridgeKey())}>Generate key</button><button className="btn primary" disabled={!siteId||busy} onClick={saveBridgeKeyToWp}>Update WP + Dashboard</button></div>
        <hr className="soft-line" />
        <h3>Dashboard-only key update</h3>
        <p className="muted">Use this when you already changed the key inside WordPress manually and only need to update the dashboard copy.</p>
        <label>Existing WordPress Bridge key<input type="password" value={dashboardOnlyKey} placeholder="Key already saved in WordPress" onChange={e=>setDashboardOnlyKey(e.target.value)} /></label>
        <label className="inline-check verify-check"><input type="checkbox" checked={verifyDashboardKey} onChange={e=>setVerifyDashboardKey(e.target.checked)} /> Verify by ping before saving</label>
        <div className="right"><button className="btn" disabled={!siteId||busy} onClick={saveDashboardKeyOnly}>Save dashboard key only</button></div>
      </div>

      <div className="card key-card">
        <div className="card-head"><div><h2>Update Gemini API settings</h2><p>This updates the SEM SEO BLOGER Gemini key/model on the selected WordPress site through the Bridge.</p></div></div>
        <label>New Gemini API key<input type="password" value={geminiKey} placeholder="Leave blank to keep existing key" onChange={e=>setGeminiKey(e.target.value)} /></label>
        <label>Gemini model<input value={geminiModel} placeholder="gemini-2.0-flash" onChange={e=>setGeminiModel(e.target.value)} /></label>
        <label className="inline-check verify-check"><input type="checkbox" checked={cronEnabled} onChange={e=>setCronEnabled(e.target.checked)} /> Enable WordPress internal cron fallback</label>
        <div className="right"><button className="btn" disabled={!siteId||busy} onClick={testGemini}>Test key</button><button className="btn primary" disabled={!siteId||busy} onClick={saveGemini}>Save Gemini settings</button><button className="btn glow" disabled={!siteId||busy} onClick={saveGeminiAndTest}>Save + Test</button><button className="btn danger" disabled={!siteId||busy} onClick={clearGemini}>Clear Gemini key</button></div>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><div><h2>Remote settings status</h2><p>Safe masked view only; no full secret is returned from WordPress.</p></div><button className="btn" disabled={!siteId||busy} onClick={()=>loadSettings(true)}>Refresh status</button></div>
      <div className="settings-json"><pre>{settings ? JSON.stringify(settings, null, 2) : 'Select a site and click Load remote status.'}</pre></div>
    </div>
  </div>
}



function PromptStudio({sites,notify}){
  const [siteId,setSiteId]=useState('')
  const [prompt,setPrompt]=useState('')
  const [defaultPrompt,setDefaultPrompt]=useState('')
  const [preview,setPreview]=useState('')
  const [warnings,setWarnings]=useState([])
  const [status,setStatus]=useState(null)
  const [busy,setBusy]=useState(false)
  const [sample,setSample]=useState({topic:'open demat account', keyword:'open demat account'})
  const selected = sites.find(s=>s._id===siteId)

  useEffect(()=>{ if(siteId) loadPrompt() },[siteId])

  async function loadPrompt(){
    if(!siteId) return notify('Select site first.', 'error')
    setBusy(true)
    try{
      const data = await req('/api/sites/'+siteId+'/prompt?previewTopic='+encodeURIComponent(sample.topic)+'&previewKeyword='+encodeURIComponent(sample.keyword))
      setStatus(data)
      setPrompt(data.customPrompt || '')
      setDefaultPrompt(data.defaultPrompt || '')
      setPreview(data.activePromptPreview || '')
      setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
      notify(data.fallback ? 'Prompt status loaded. Update Bridge plugin to v9 for full prompt read/write.' : 'Prompt Studio loaded.', data.fallback ? 'warning' : 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  function validateLocal(text){
    const out=[]
    if(!text.trim()) return out
    if(!text.includes('$topic') && !text.includes('{{topic}}') && !text.includes('{topic}')) out.push('Missing $topic / {{topic}} variable.')
    if(!text.includes('$keyword') && !text.includes('{{keyword}}') && !text.includes('{keyword}')) out.push('Missing $keyword / {{keyword}} variable.')
    if(!/html/i.test(text)) out.push('Recommended: mention HTML output format.')
    if(text.length > 20000) out.push('Prompt is too long. Max 20000 characters.')
    return out
  }

  function localPreview(text){
    const active = text.trim() ? text : (defaultPrompt || '')
    return active
      .replaceAll('$topic', sample.topic).replaceAll('{{topic}}', sample.topic).replaceAll('{topic}', sample.topic)
      .replaceAll('$keyword', sample.keyword).replaceAll('{{keyword}}', sample.keyword).replaceAll('{keyword}', sample.keyword)
      .replaceAll('$backlink', 'https://example.com').replaceAll('{{backlink}}', 'https://example.com').replaceAll('{backlink}', 'https://example.com')
  }

  useEffect(()=>{ setWarnings(validateLocal(prompt)); setPreview(localPreview(prompt)) },[prompt, sample.topic, sample.keyword, defaultPrompt])

  async function savePrompt(){
    if(!siteId) return notify('Select site first.', 'error')
    if(prompt.length > 20000) return notify('Prompt too long. Max 20000 characters.', 'error')
    setBusy(true)
    try{
      const data = await req('/api/sites/'+siteId+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customPrompt:prompt, previewTopic:sample.topic, previewKeyword:sample.keyword})})
      setStatus(data)
      setPrompt(data.customPrompt || prompt)
      setDefaultPrompt(data.defaultPrompt || defaultPrompt)
      setPreview(data.activePromptPreview || localPreview(prompt))
      setWarnings(Array.isArray(data.warnings) ? data.warnings : validateLocal(prompt))
      notify('Prompt saved to WordPress plugin.', (data.warnings && data.warnings.length) ? 'warning' : 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function resetPrompt(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!confirm('Reset this site to the built-in default Gemini prompt?')) return
    setBusy(true)
    try{
      const data = await req('/api/sites/'+siteId+'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clearCustomPrompt:true, previewTopic:sample.topic, previewKeyword:sample.keyword})})
      setStatus(data); setPrompt(''); setDefaultPrompt(data.defaultPrompt || defaultPrompt); setPreview(data.activePromptPreview || data.defaultPrompt || ''); setWarnings(Array.isArray(data.warnings)?data.warnings:[])
      notify('Prompt reset to default.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  function insertSnippet(snippet){
    setPrompt(p => (p ? p + '\n\n' : '') + snippet)
  }

  const promptChars = prompt.length
  const variableOk = !prompt.trim() || (prompt.includes('$topic') || prompt.includes('{{topic}}') || prompt.includes('{topic}')) && (prompt.includes('$keyword') || prompt.includes('{{keyword}}') || prompt.includes('{keyword}'))

  return <div className="prompt-page">
    <section className="hero prompt-hero">
      <div>
        <span className="eyebrow">Prompt Studio</span>
        <h1>Change your Gemini blog prompt from the Remote Controller.</h1>
        <p>Edit the article generation prompt used by SEM SEO BLOGER. Use variables like <b>$topic</b>, <b>$keyword</b> and <b>$backlink</b>, preview the final prompt, then save it directly into WordPress through the Bridge.</p>
        <div className="hero-actions"><button className="btn primary" disabled={!siteId||busy} onClick={loadPrompt}>{busy?'Loading...':'Load prompt'}</button><button className="btn glow" disabled={!siteId||busy} onClick={savePrompt}>Save prompt</button><button className="btn danger" disabled={!siteId||busy} onClick={resetPrompt}>Reset default</button></div>
      </div>
      <div className="card api-selector-card">
        <label>Select WordPress site<select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">-- select site --</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        {selected && <div className="selected-site"><b>{selected.name}</b><span>{selected.url}</span><small>{status?.customPromptSet?'Custom prompt active':'Built-in prompt active'}</small></div>}
      </div>
    </section>

    <div className="api-status-grid">
      <div className="metric"><span>Prompt mode</span><strong className="metric-date">{status? (status.customPromptSet?'Custom':'Default') : '-'}</strong><small>Remote WordPress setting</small></div>
      <div className="metric"><span>Characters</span><strong>{promptChars}</strong><small>Max 20000</small></div>
      <div className="metric"><span>Variables</span><strong className="metric-date">{variableOk?'OK':'Check'}</strong><small>$topic + $keyword recommended</small></div>
      <div className="metric"><span>Bridge</span><strong className="metric-date">{status?.bridgeVersion || '-'}</strong><small>Prompt endpoint</small></div>
    </div>

    <div className="grid two prompt-grid">
      <div className="card prompt-editor-card">
        <div className="card-head"><div><h2>Prompt editor</h2><p>Leave empty to use default prompt. Save only when you want custom generation logic.</p></div></div>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={'Example:\nWrite a 1500+ word SEO article about "$topic". Include "$keyword" naturally. Return clean HTML only.'}></textarea>
        <div className="prompt-toolbar">
          <button className="btn small-btn" onClick={()=>insertSnippet('Use Indian market examples, SEBI-safe educational wording, and avoid investment advice guarantees.')}>Add compliance line</button>
          <button className="btn small-btn" onClick={()=>insertSnippet('Return clean HTML only with one <p> meta description, one <h1> title, then <h2>, <h3>, <p>, <ul>, <li>.')}>Add HTML format</button>
          <button className="btn small-btn" onClick={()=>insertSnippet('Naturally include this backlink once if provided: $backlink')}>Add backlink rule</button>
        </div>
        {warnings.length>0 && <div className="notice danger-notice"><b>Prompt warnings:</b><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
        <div className="right"><button className="btn" disabled={!siteId||busy} onClick={loadPrompt}>Reload</button><button className="btn primary" disabled={!siteId||busy} onClick={savePrompt}>Save Prompt</button></div>
      </div>

      <div className="card prompt-preview-card">
        <div className="card-head"><div><h2>Live preview</h2><p>Preview with sample topic and keyword before saving.</p></div></div>
        <div className="form-grid sample-grid"><label>Sample topic<input value={sample.topic} onChange={e=>setSample({...sample,topic:e.target.value})}/></label><label>Sample keyword<input value={sample.keyword} onChange={e=>setSample({...sample,keyword:e.target.value})}/></label></div>
        <pre className="prompt-preview">{preview || 'Select a site and load prompt.'}</pre>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><div><h2>Default prompt backup</h2><p>Use this if you want to copy the built-in default into your custom prompt and edit it.</p></div><button className="btn" disabled={!defaultPrompt} onClick={()=>setPrompt(defaultPrompt)}>Copy default to editor</button></div>
      <pre className="prompt-preview compact">{defaultPrompt || 'Default prompt appears after loading a site.'}</pre>
    </div>
  </div>
}

function BlogHistory({sites,notify}){
  const [siteId,setSiteId]=useState('')
  const [rows,setRows]=useState([])
  const [summary,setSummary]=useState(null)
  const [busy,setBusy]=useState(false)
  const [search,setSearch]=useState('')
  const [limit,setLimit]=useState(100)
  const selected = sites.find(s=>s._id===siteId)

  useEffect(()=>{ if(siteId) load() },[siteId])

  async function load(){
    if(!siteId) return notify('Select site first.', 'error')
    setBusy(true)
    try{
      const data = await req('/api/history?siteId='+encodeURIComponent(siteId)+'&limit='+encodeURIComponent(limit))
      setRows(Array.isArray(data.history) ? data.history : [])
      setSummary(data)
      notify('Blog update history loaded.', 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  const shown = rows.filter(r => `${r.title||''} ${r.keyword||''} ${r.status||''} ${r.warning||''}`.toLowerCase().includes(search.toLowerCase()))
  const published = rows.filter(r => String(r.status||r.post_status||'').toLowerCase().includes('publish')).length
  const warnings = rows.filter(r => r.warning).length

  return <div className="history-page">
    <section className="hero history-hero">
      <div>
        <span className="eyebrow">Blog Update History</span>
        <h1>Check every blog published by the Remote Controller.</h1>
        <p>View WordPress posting history, published URLs, edit links, keywords, warnings, queue remaining count and latest CSV sync status from one dashboard.</p>
        <div className="hero-actions"><button className="btn primary" disabled={!siteId||busy} onClick={load}>{busy?'Loading...':'Refresh history'}</button></div>
      </div>
      <div className="card api-selector-card">
        <label>Select WordPress site<select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">-- select site --</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        {selected && <div className="selected-site"><b>{selected.name}</b><span>{selected.url}</span><small>{summary?.bridgeVersion ? 'Bridge '+summary.bridgeVersion : 'Remote history endpoint'}</small></div>}
      </div>
    </section>

    <div className="api-status-grid">
      <div className="metric"><span>Total loaded</span><strong>{rows.length}</strong><small>{summary?.historyCount ?? rows.length} stored in WordPress</small></div>
      <div className="metric"><span>Published</span><strong>{published}</strong><small>successful rows</small></div>
      <div className="metric"><span>Warnings</span><strong>{warnings}</strong><small>image or content warnings</small></div>
      <div className="metric"><span>Queue now</span><strong>{summary?.queueCount ?? '-'}</strong><small>WordPress queue rows</small></div>
    </div>

    <div className="card">
      <div className="card-head">
        <div><h2>Published blog history</h2><p>Search by title, keyword, status, or warning. Open WordPress post/edit links directly.</p></div>
        <div className="history-tools"><input placeholder="Search history" value={search} onChange={e=>setSearch(e.target.value)}/><select value={limit} onChange={e=>setLimit(Number(e.target.value))}><option value="50">50 rows</option><option value="100">100 rows</option><option value="250">250 rows</option><option value="500">500 rows</option></select><button className="btn" disabled={!siteId||busy} onClick={load}>Reload</button></div>
      </div>
      {summary?.lastError && <div className="notice danger-notice"><b>Last WordPress error:</b> {summary.lastError}</div>}
      <div className="table-wrap history-table"><table><thead><tr><th>Time</th><th>Blog</th><th>Keyword</th><th>Status</th><th>Queue</th><th>Links</th><th>Warning</th></tr></thead><tbody>{shown.map((h,i)=><tr key={(h.post_id||'row')+'-'+i}><td><small>{h.timestamp || h.created || '-'}</small></td><td><strong>{h.title || '-'}</strong><div className="small">Post ID: {h.post_id || '-'}</div></td><td>{h.keyword || '-'}</td><td><span className={'badge '+((h.status||h.post_status||'').toLowerCase().includes('publish')?'success':'neutral')}>{h.status || h.post_status || '-'}</span></td><td>{h.queue_remaining ?? '-'}</td><td><div className="action-stack history-actions">{h.post_url && <a className="btn small-btn" href={h.post_url} target="_blank" rel="noreferrer">View</a>}{h.edit_url && <a className="btn small-btn" href={h.edit_url} target="_blank" rel="noreferrer">Edit</a>}</div></td><td className="small log-message">{h.warning || '-'}</td></tr>)}</tbody></table></div>
      {!shown.length && <p className="muted empty-state">No history rows found. Publish one post from Queue/Sites, then click Refresh history.</p>}
    </div>
  </div>
}


function PluginManager({sites,notify}){
  const [siteId,setSiteId]=useState('')
  const [data,setData]=useState(null)
  const [busy,setBusy]=useState(false)
  const [query,setQuery]=useState('')
  const [file,setFile]=useState(null)
  const [activateAfter,setActivateAfter]=useState(true)
  const selected = sites.find(s=>s._id===siteId)

  useEffect(()=>{ setData(null); if(siteId) loadPlugins(false) },[siteId])

  async function loadPlugins(showToast=true){
    if(!siteId) return notify('Select site first.', 'error')
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/plugins')
      setData(r)
      if(showToast) notify(`Loaded ${r.count ?? 0} plugins from WordPress.`, 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function runAction(plugin, action){
    if(!siteId) return notify('Select site first.', 'error')
    const labels = {activate:'activate', deactivate:'deactivate', reactivate:'reactivate', delete:'delete permanently'}
    if(['deactivate','reactivate','delete'].includes(action) && !confirm(`Are you sure you want to ${labels[action]} ${plugin.name}?`)) return
    setBusy(true)
    try{
      const r = await req('/api/sites/'+siteId+'/plugins/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plugin:plugin.plugin, action, forceDeactivate: action==='delete'})})
      setData(r)
      notify(`${plugin.name} ${action} completed.`, 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  async function uploadPlugin(){
    if(!siteId) return notify('Select site first.', 'error')
    if(!file) return notify('Choose a plugin ZIP first.', 'error')
    if(!file.name.toLowerCase().endsWith('.zip')) return notify('Only .zip plugin files are allowed.', 'error')
    if(file.size > 60 * 1024 * 1024) return notify('Plugin ZIP is too large. Keep it under 60 MB.', 'error')
    if(!confirm(`Upload ${file.name} to ${selected?.name || 'selected site'}${activateAfter ? ' and activate it' : ''}?`)) return
    setBusy(true)
    try{
      const contentBase64 = arrayBufferToBase64(await file.arrayBuffer())
      const r = await req('/api/sites/'+siteId+'/plugins/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name, contentBase64, activate:activateAfter})})
      setData(r); setFile(null)
      notify(`Plugin uploaded${r.activated ? ' and activated' : ''}.`, 'success')
    }catch(e){ notify(e.message, 'error') }
    finally{ setBusy(false) }
  }

  const plugins = (data?.plugins || []).filter(p => `${p.name} ${p.plugin} ${p.author}`.toLowerCase().includes(query.toLowerCase()))
  const updates = data?.updateCount ?? plugins.filter(p=>p.updateAvailable).length

  return <div className="plugin-page">
    <section className="hero prompt-hero">
      <div>
        <span className="eyebrow">Plugin Manager</span>
        <h1>Upload, activate, reactivate and remove WordPress plugins remotely.</h1>
        <p>Manage plugins through the secure Remote Bridge API key. The bridge plugin protects itself so the dashboard connection cannot accidentally remove its own access.</p>
        <div className="hero-actions"><button className="btn primary" disabled={!siteId||busy} onClick={()=>loadPlugins()}>{busy?'Working...':'Load plugins'}</button><button className="btn glow" disabled={!siteId||busy} onClick={uploadPlugin}>Upload plugin ZIP</button></div>
      </div>
      <div className="selected-site plugin-selected">
        <label>WordPress site<select value={siteId} onChange={e=>setSiteId(e.target.value)}><option value="">Select site</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        {selected && <><b>{selected.name}</b><span>{selected.url}</span><small>Bridge key saved: {selected.apiKeySet?'yes':'no'}</small></>}
      </div>
    </section>

    <div className="kpi-grid plugin-kpis">
      <div className="metric"><span>Total plugins</span><strong>{data?.count ?? '-'}</strong><small>remote WordPress</small></div>
      <div className="metric"><span>Active</span><strong>{data?.activeCount ?? '-'}</strong><small>currently enabled</small></div>
      <div className="metric"><span>Inactive</span><strong>{data?.inactiveCount ?? '-'}</strong><small>available to activate</small></div>
      <div className="metric"><span>Updates</span><strong>{updates ?? '-'}</strong><small>WordPress update check</small></div>
    </div>

    <div className="grid two plugin-grid">
      <div className="card">
        <div className="card-head"><div><h2>Upload plugin ZIP</h2><p>Install a WordPress plugin ZIP from your computer. Keep “activate after upload” on when replacing/adding the bridge or SEM SEO BLOGER plugin.</p></div></div>
        <input className="file-input" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={e=>setFile(e.target.files?.[0] || null)} />
        {file && <div className="upload-file"><b>{file.name}</b><span>{(file.size/1024/1024).toFixed(2)} MB</span></div>}
        <label className="inline-check"><input type="checkbox" checked={activateAfter} onChange={e=>setActivateAfter(e.target.checked)}/> Activate after upload</label>
        <div className="right"><button className="btn primary" disabled={!siteId||!file||busy} onClick={uploadPlugin}>{busy?'Uploading...':'Upload / Install'}</button></div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Safety rules</h2><p>High-risk operations are blocked or confirmed before running.</p></div></div>
        <ul className="checklist">
          <li>Remote Bridge plugin cannot deactivate or delete itself.</li>
          <li>Delete action deactivates first only after dashboard confirmation.</li>
          <li>ZIP upload accepts valid WordPress plugin archives only.</li>
          <li>Every plugin action is written into Reliability Logs.</li>
        </ul>
      </div>
    </div>

    <div className="card">
      <div className="card-head"><div><h2>Installed plugins</h2><p>Search and manage all plugins detected by WordPress.</p></div><input className="compact-input" placeholder="Search plugin" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="table-wrap plugin-table"><table><thead><tr><th>Plugin</th><th>Status</th><th>Version</th><th>Update</th><th>File</th><th>Actions</th></tr></thead><tbody>{plugins.map(p=><tr key={p.plugin}>
        <td><strong>{p.name}</strong><div className="small">{p.description || p.author || '-'}</div>{p.protected && <span className="tiny">Bridge protected</span>}</td>
        <td><span className={'badge '+(p.active?'success':'neutral')}>{p.active?'Active':'Inactive'}</span></td>
        <td>{p.version || '-'}</td>
        <td>{p.updateAvailable ? <span className="badge neutral">{p.updateVersion || 'Available'}</span> : <span className="small">-</span>}</td>
        <td className="small log-message">{p.plugin}</td>
        <td><div className="action-stack plugin-actions">
          {!p.active && <button className="btn primary" disabled={busy} onClick={()=>runAction(p,'activate')}>Activate</button>}
          {p.active && <button className="btn" disabled={busy||p.protected} onClick={()=>runAction(p,'deactivate')}>Deactivate</button>}
          {!p.protected && <button className="btn glow" disabled={busy} onClick={()=>runAction(p,'reactivate')}>Reactivate</button>}
          {!p.protected && <button className="btn danger" disabled={busy} onClick={()=>runAction(p,'delete')}>Remove</button>}
        </div></td>
      </tr>)}</tbody></table></div>
      {!plugins.length && <p className="muted empty-state">Select a site and click Load plugins.</p>}
    </div>
  </div>
}

function Logs({notify}){
  const [logs,setLogs]=useState([])
  const [filter,set]=useState({siteId:'',status:'',action:''})
  async function load(){
    const p=new URLSearchParams()
    Object.entries(filter).forEach(([k,v])=>{ if(v) p.set(k,v) })
    try { setLogs(await req('/api/logs'+(p.toString()?'?'+p.toString():''))) }
    catch(e){ notify(e.message, 'error') }
  }
  useEffect(()=>{ load() },[filter.status, filter.action])
  return <div className="card">
    <div className="card-head"><div><h2>Execution logs</h2><p>Use logs to catch bridge, queue, Gemini, or WordPress errors fast.</p></div><button className="btn" onClick={load}>Refresh</button></div>
    <div className="filters"><input placeholder="Filter siteId" value={filter.siteId} onChange={e=>set(f=>({...f,siteId:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')load()}}/><select value={filter.action} onChange={e=>set(f=>({...f,action:e.target.value}))}><option value="">Any action</option><option value="run">run</option><option value="ping">ping</option><option value="schedule">schedule</option><option value="queue-bulk">queue-bulk</option><option value="queue-sync">queue-sync</option><option value="settings">settings</option><option value="history">history</option><option value="gemini-test">gemini-test</option><option value="prompt">prompt</option><option value="plugins">plugins</option><option value="plugin-upload">plugin-upload</option><option value="plugin-activate">plugin-activate</option><option value="plugin-deactivate">plugin-deactivate</option><option value="plugin-reactivate">plugin-reactivate</option><option value="plugin-delete">plugin-delete</option></select><select value={filter.status} onChange={e=>set(f=>({...f,status:e.target.value}))}><option value="">Any status</option><option value="success">success</option><option value="error">error</option><option value="skipped">skipped</option></select></div>
    <div className="table-wrap"><table><thead><tr><th>When</th><th>Site</th><th>Action</th><th>Status</th><th>Message</th></tr></thead><tbody>{logs.map(l=><tr key={l._id}><td><small>{new Date(l.createdAt).toLocaleString()}</small></td><td className="small">{l.siteId}</td><td>{l.action}</td><td><span className={'badge '+(l.status==='success'?'success':l.status==='skipped'?'neutral':'error')}>{l.status}</span></td><td className="small log-message">{l.message}</td></tr>)}</tbody></table></div>
  </div>
}

function DashboardApp({user,onLogout,onChangedUser,themeValue,setTheme,notify}){
  const [tab,setTab]=useState('dash')
  const {sites,loading,refresh}=useSites(notify)
  const title = tab==='dash'?'Overview':tab==='clients'?'Client Apps':tab==='sites'?'Sites':tab==='queue'?'Queue':tab==='prompt'?'Prompt Studio':tab==='history'?'Blog History':tab==='plugins'?'Plugin Manager':tab==='security'?'Security':tab==='keys'?'API Keys':'Logs'

  return <div className={"layout theme-"+themeValue}>
    <aside>
      <div className="brand"><span className="brand-mark">✦</span><div><b>Remote Controller Pro v14</b><small>{CLIENT_SLUG==='main'?'Main App':'Client: /'+CLIENT_SLUG}</small></div></div>
      <ThemeStudio theme={themeValue} setTheme={setTheme}/>
      <nav><button className={tab==='dash'?'active':''} onClick={()=>setTab('dash')}><Icon name="dash"/> Dashboard</button>{CLIENT_SLUG==='main' && <button className={tab==='clients'?'active':''} onClick={()=>setTab('clients')}><Icon name="sites"/> Clients</button>}<button className={tab==='sites'?'active':''} onClick={()=>setTab('sites')}><Icon name="sites"/> Sites</button><button className={tab==='queue'?'active':''} onClick={()=>setTab('queue')}><Icon name="queue"/> Queue</button><button className={tab==='prompt'?'active':''} onClick={()=>setTab('prompt')}><Icon name="prompt"/> Prompt Studio</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}><Icon name="history"/> Blog History</button><button className={tab==='plugins'?'active':''} onClick={()=>setTab('plugins')}><Icon name="plugins"/> Plugins</button><button className={tab==='keys'?'active':''} onClick={()=>setTab('keys')}><Icon name="key"/> API Keys</button><button className={tab==='security'?'active':''} onClick={()=>setTab('security')}><Icon name="key"/> Security</button><button className={tab==='logs'?'active':''} onClick={()=>setTab('logs')}><Icon name="logs"/> Logs</button></nav>
      <AdminKeyBox notify={notify}/>
      <footer>v14 Client Delete + Proxy Fix • Separate backend + DB</footer>
    </aside>
    <main>
      <header><div><span className="small">{loading?'Refreshing...':'Ready'} • {user?.username}</span><h1>{title}</h1></div><div className="header-actions"><button className="btn" onClick={refresh}>Refresh sites</button><button className="btn danger" onClick={onLogout}>Logout</button></div></header>
      <div className="wrap">
        {tab==='dash' && <Dashboard sites={sites} onTab={setTab}/>} 
        {tab==='clients' && <ClientApps notify={notify}/>} 
        {tab==='sites' && <><AddSite onAdded={refresh} notify={notify}/><Sites sites={sites} refresh={refresh} notify={notify}/></>}
        {tab==='queue' && <Queue sites={sites} notify={notify}/>} 
        {tab==='prompt' && <PromptStudio sites={sites} notify={notify}/>} 
        {tab==='history' && <BlogHistory sites={sites} notify={notify}/>} 
        {tab==='plugins' && <PluginManager sites={sites} notify={notify}/>} 
        {tab==='keys' && <ApiKeys sites={sites} refresh={refresh} notify={notify}/>} 
        {tab==='security' && <SecuritySettings user={user} onLogout={onLogout} onChangedUser={onChangedUser} notify={notify}/>} 
        {tab==='logs' && <Logs notify={notify}/>} 
      </div>
    </main>
  </div>
}

function App(){
  const [themeValue,setThemeValue]=useState(()=>localStorage.getItem('ab_theme') || 'aurora')
  const setTheme=(v)=>{ setThemeValue(v); localStorage.setItem('ab_theme', v) }
  useEffect(()=>{ document.documentElement.setAttribute('data-theme', themeValue) },[themeValue])
  const [toast,setToast]=useState(null)
  const notify=(message,type='success')=>setToast({message,type})
  const [user,setUser]=useState(null)
  const [checking,setChecking]=useState(true)

  useEffect(()=>{
    let alive = true
    req('/api/auth/me')
      .then(data=>{ if(alive) setUser(data.user) })
      .catch(()=>{ if(alive) setUser(null) })
      .finally(()=>{ if(alive) setChecking(false) })
    return ()=>{ alive = false }
  },[])

  async function logout(){
    await req('/api/auth/logout',{method:'POST'}).catch(()=>{})
    setUser(null)
    notify('Logged out.', 'success')
  }

  let content
  if(checking){
    content = <div className={"login-shell theme-"+themeValue}><div className="login-panel"><div className="card login-card"><span className="eyebrow">Dashboard Lock</span><h1>Checking session...</h1><p className="muted">Verifying your saved login.</p></div></div></div>
  } else if(!user){
    content = <LoginScreen themeValue={themeValue} setTheme={setTheme} onLogin={setUser} notify={notify}/>
  } else {
    content = <DashboardApp user={user} onLogout={logout} onChangedUser={setUser} themeValue={themeValue} setTheme={setTheme} notify={notify}/>
  }

  return <>
    {content}
    <Toast toast={toast} onClose={()=>setToast(null)}/>
  </>
}

createRoot(document.getElementById('root')).render(<App/>)
