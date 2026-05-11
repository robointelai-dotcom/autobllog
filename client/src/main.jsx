import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const API = import.meta.env.VITE_API_BASE || ''
const DEFAULT_CSV = 'Keyword,Topic,Category,Tags,image,Backlink\n'

function getAdminKey(){ return localStorage.getItem('ab_admin_key') || '' }
function setAdminKey(v){ localStorage.setItem('ab_admin_key', v || '') }

async function req(path, options={}){
  const headers = new Headers(options.headers || {})
  const adminKey = getAdminKey()
  if (adminKey) headers.set('x-admin-key', adminKey)
  const r = await fetch(API+path, { ...options, headers })
  const ct = r.headers.get('content-type') || ''
  const payload = ct.includes('json') ? await r.json().catch(()=>({})) : await r.text().catch(()=> '')
  if(!r.ok){
    const message = typeof payload === 'object' ? (payload.error || payload.message || JSON.stringify(payload)) : payload
    throw new Error(message || r.statusText)
  }
  return payload
}

function parseCsv(text){
  const clean = (s) => (s ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .normalize('NFKC')

  text = clean(text)
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
      else if (c === ',') { row.push(field.trim()); field = '' }
      else if (c === '\n') { row.push(field.trim()); rows.push(row); row = []; field = '' }
      else if (c !== '\r') field += c
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  if (!rows.length) return []

  let headerRow = rows[0].map(h => clean(h).trim())
  const hasHeader = headerRow.some(h => /^keyword$/i.test(h.replace(/\s+/g,'')))
  if (!hasHeader) headerRow = ['Keyword','Topic','Category','Tags','image','Backlink']

  const alias = {
    keyword: 'Keyword', keywords: 'Keyword', title: 'Keyword',
    topic: 'Topic', subject: 'Topic', category: 'Category', categories: 'Category',
    tags: 'Tags', tag: 'Tags', image: 'image', imageurl: 'image', image_url: 'image', images: 'image',
    backlink: 'Backlink', backlinkurl: 'Backlink', backlink_url: 'Backlink', url: 'Backlink'
  }
  const normHeader = headerRow.map(h => alias[h.replace(/\s+/g,'').toLowerCase()] || h)
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
    key:'M7 14a4 4 0 1 1 3.5-2.1L21 12v3h-3v3h-3v3h-3v-4.1L10.5 15A4 4 0 0 1 7 14Zm0-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'
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
        <span className="eyebrow">AutoBlog Control Center</span>
        <h1>Reliable WordPress auto-posting from one dashboard.</h1>
        <p>Manage sites, trigger posts, upload CSV queues, check the bridge, and review logs with safer scheduling and better error handling.</p>
        <div className="hero-actions">
          <button className="btn primary" onClick={()=>onTab('sites')}>Add / manage sites</button>
          <button className="btn" onClick={()=>onTab('queue')}>Upload queue</button>
        </div>
      </div>
      <KPIs sites={sites}/>
    </section>
    <div className="grid two">
      <div className="card">
        <h2>Reliability checklist</h2>
        <ul className="checklist">
          <li>Rows stay in WordPress queue until a post is created successfully.</li>
          <li>Dashboard API uses timeouts, retries, request validation, and protected admin key support.</li>
          <li>Schedules are unique per site, with daily limits and timezone-safe reset logic.</li>
          <li>Logs now support success, error, and skipped states without crashing validation.</li>
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
  const [skipPublished,setSkipPublished]=useState(true)
  const [autoUpload,setAutoUpload]=useState(false)
  const [lastSync,setLastSync]=useState(null)

  useEffect(()=>{ setPreview(parseCsv(csv)) },[csv])
  useEffect(()=>{ if(siteId) load(siteId) },[siteId])
  const stats = useMemo(()=>analyzeCsv(preview, list.items || []),[preview,list])

  async function syncRows(rows=parseCsv(csv), selectedMode=mode){
    if(!siteId) return notify('Select site first.', 'error')
    if(!rows.length) return notify('CSV has no valid rows with Keyword.', 'error')
    setBusy(true)
    try {
      const r = await req('/api/queue/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId, items:rows, mode:selectedMode, skipPublished})})
      setLastSync(r)
      notify(`CSV synced: +${r.added ?? 0} added, ${r.updated ?? 0} updated, ${r.removed ?? 0} removed. Queue ${r.queueCount ?? '-'}.`, 'success')
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
      <div className="card-head"><div><h2>Advanced CSV Auto Update</h2><p>Smart Sync fixes the update problem: changed CSV rows update existing queue rows, new keywords are appended, duplicates are cleaned by Keyword.</p></div></div>
      <div className="sync-panel">
        <label>Target site<select value={siteId} onChange={e=>setSite(e.target.value)}><option value="">-- select site --</option>{sites.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
        <div className="mode-grid">
          <label className={mode==='smart'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='smart'} onChange={()=>setMode('smart')}/><b>Smart Sync</b><span>Update + append, never wipes old queue rows.</span></label>
          <label className={mode==='append'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='append'} onChange={()=>setMode('append')}/><b>Append New</b><span>Add only new keywords.</span></label>
          <label className={mode==='mirror'?'mode-card active':'mode-card'}><input type="radio" checked={mode==='mirror'} onChange={()=>setMode('mirror')}/><b>Mirror CSV</b><span>Queue becomes exactly this CSV.</span></label>
          <label className={mode==='replace'?'mode-card active danger-mode':'mode-card danger-mode'}><input type="radio" checked={mode==='replace'} onChange={()=>setMode('replace')}/><b>Replace</b><span>Clear queue and load CSV.</span></label>
        </div>
        <div className="sync-toggles">
          <label className="inline-check"><input type="checkbox" checked={skipPublished} onChange={e=>setSkipPublished(e.target.checked)}/> Skip already published keywords</label>
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
      <div className="right"><button disabled={busy} className="btn primary" onClick={upload}>{busy?'Syncing...':'Sync CSV to WordPress'}</button><button className="btn" onClick={()=>load()}>Refresh Queue</button><button className="btn danger" onClick={clearAll}>Clear Queue</button></div>
      {lastSync && <div className="sync-result"><b>Last sync:</b> added {lastSync.added ?? 0}, updated {lastSync.updated ?? 0}, removed {lastSync.removed ?? 0}, skipped published {lastSync.skippedPublished ?? 0}, duplicates fixed {lastSync.duplicatesInCsv ?? 0}, queue {lastSync.queueCount ?? '-'}.</div>}
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
    <div className="filters"><input placeholder="Filter siteId" value={filter.siteId} onChange={e=>set(f=>({...f,siteId:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')load()}}/><select value={filter.action} onChange={e=>set(f=>({...f,action:e.target.value}))}><option value="">Any action</option><option value="run">run</option><option value="ping">ping</option><option value="schedule">schedule</option><option value="queue-bulk">queue-bulk</option><option value="queue-sync">queue-sync</option></select><select value={filter.status} onChange={e=>set(f=>({...f,status:e.target.value}))}><option value="">Any status</option><option value="success">success</option><option value="error">error</option><option value="skipped">skipped</option></select></div>
    <div className="table-wrap"><table><thead><tr><th>When</th><th>Site</th><th>Action</th><th>Status</th><th>Message</th></tr></thead><tbody>{logs.map(l=><tr key={l._id}><td><small>{new Date(l.createdAt).toLocaleString()}</small></td><td className="small">{l.siteId}</td><td>{l.action}</td><td><span className={'badge '+(l.status==='success'?'success':l.status==='skipped'?'neutral':'error')}>{l.status}</span></td><td className="small log-message">{l.message}</td></tr>)}</tbody></table></div>
  </div>
}

function App(){
  const [tab,setTab]=useState('dash')
  const [toast,setToast]=useState(null)
  const notify=(message,type='success')=>setToast({message,type})
  const {sites,loading,refresh}=useSites(notify)
  const title = tab==='dash'?'Overview':tab==='sites'?'Sites':tab==='queue'?'Queue':'Logs'

  return <div className="layout">
    <aside>
      <div className="brand"><span className="brand-mark">A</span><div><b>AutoBlog</b><small>Market Content Engine</small></div></div>
      <nav><button className={tab==='dash'?'active':''} onClick={()=>setTab('dash')}><Icon name="dash"/> Dashboard</button><button className={tab==='sites'?'active':''} onClick={()=>setTab('sites')}><Icon name="sites"/> Sites</button><button className={tab==='queue'?'active':''} onClick={()=>setTab('queue')}><Icon name="queue"/> Queue</button><button className={tab==='logs'?'active':''} onClick={()=>setTab('logs')}><Icon name="logs"/> Logs</button></nav>
      <AdminKeyBox notify={notify}/>
      <footer>v3.0 smart CSV build</footer>
    </aside>
    <main>
      <header><div><span className="small">{loading?'Refreshing...':'Ready'}</span><h1>{title}</h1></div><button className="btn" onClick={refresh}>Refresh sites</button></header>
      <div className="wrap">
        {tab==='dash' && <Dashboard sites={sites} onTab={setTab}/>} 
        {tab==='sites' && <><AddSite onAdded={refresh} notify={notify}/><Sites sites={sites} refresh={refresh} notify={notify}/></>}
        {tab==='queue' && <Queue sites={sites} notify={notify}/>} 
        {tab==='logs' && <Logs notify={notify}/>} 
      </div>
    </main>
    <Toast toast={toast} onClose={()=>setToast(null)}/>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>)
