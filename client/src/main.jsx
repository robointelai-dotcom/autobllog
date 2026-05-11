import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
const API = import.meta.env.VITE_API_BASE || ''

async function req(path, options={}){
  const r = await fetch(API+path, options)
  if(!r.ok){ const t = await r.text().catch(()=>r.statusText); throw new Error(t || r.statusText) }
  const ct = r.headers.get('content-type')||''
  return ct.includes('json') ? r.json() : r.text()
}

function useSites(){
  const [sites,setSites]=useState([])
  const refresh = async()=> setSites(await req('/api/sites'))
  useEffect(()=>{ refresh() },[])
  return { sites, refresh }
}

function Icon({name}){
  const paths={
    home:"M3 12L12 3l9 9v9h-6v-6H9v6H3z",
    sites:"M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    queue:"M4 6h16M4 12h16M4 18h16",
    logs:"M5 4h14v4H5zM5 10h14v10H5zM9 14h6"
  }
  const d=paths[name]||paths.home
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d={d}/></svg>
}

function KPIs({sites}){
  const t = useMemo(()=>{
    const s={count:sites.length,sent:0,failed:0,lastOk:null}
    for(const x of sites){
      s.sent += x.counters?.sent||0
      s.failed += x.counters?.failed||0
      if(x.lastSuccessAt){ const v=+new Date(x.lastSuccessAt); s.lastOk = s.lastOk? Math.max(s.lastOk,v) : v }
    }
    return s
  },[sites])
  return (<div className='grid'>
    <div className='card'><div className='kpi'>Sites: {t.count}</div><div className='small'>Multi-site remote controller</div></div>
    <div className='card'><div className='kpi'>Sent: {t.sent}</div><div className='small'>Successful posts</div></div>
    <div className='card'><div className='kpi'>Failed: {t.failed}</div><div className='small'>Errors recorded</div></div>
    <div className='card'><div className='kpi'>Last OK: {t.lastOk?new Date(t.lastOk).toLocaleString():'-'}</div><div className='small'>UTC</div></div>
  </div>)
}

function AddSite({onAdded}){
  const [f,set]=useState({name:'',url:'',apiKey:''})
  async function submit(e){ e.preventDefault(); await req('/api/sites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}); set({name:'',url:'',apiKey:''}); onAdded() }
  return (<div className='card'>
    <strong>Add a site</strong>
    <form onSubmit={submit}>
      <div className='row' style={{marginTop:12}}>
        <input placeholder='Name' value={f.name} onChange={e=>set({...f,name:e.target.value})}/>
        <input placeholder='Site URL (https://example.com)' value={f.url} onChange={e=>set({...f,url:e.target.value})}/>
        <input placeholder='API Key' value={f.apiKey} onChange={e=>set({...f,apiKey:e.target.value})}/>
      </div>
      <div className='right' style={{marginTop:10}}><button className='btn primary'>Add</button></div>
    </form>
  </div>)
}

function Sites(){
  const [sites,setSites]=useState([])
  const refresh=async()=>setSites(await req('/api/sites'))
  useEffect(()=>{ refresh() },[])

  async function update(id,patch){ await req('/api/sites/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); refresh() }
  async function ping(s){ const r=await fetch(API+'/api/sites/'+s._id+'/ping',{method:'POST'}); alert(await r.text()) }
  async function remove(s){ if(!confirm('Delete site '+s.name+'?'))return; await req('/api/sites/'+s._id,{method:'DELETE'}); refresh() }
  async function postNow(s){ await req('/api/jobs/trigger',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId:s._id})}); alert('Queued'); }

  return (<div className='card'>
    <strong>Sites (Start / Stop / Schedule)</strong>
    <div className='divider'/>
    <table>
      <thead><tr><th>Site</th><th>Mode</th><th>Schedule</th><th>Enabled</th><th>Sent/Fail</th><th>Today</th><th>Actions</th></tr></thead>
      <tbody>{sites.map(s=>(
        <tr key={s._id}>
          <td><div><strong>{s.name}</strong><div className='small'>{s.url}</div></div></td>
          <td>
            <select defaultValue={s.scheduleMode||'manual'} onChange={e=>update(s._id,{scheduleMode:e.target.value})}>
              <option value='manual'>Manual</option>
              <option value='everySeconds'>Every seconds</option>
              <option value='everyHours'>Every hours</option>
              <option value='dailyTime'>Daily</option>
              <option value='cron'>Cron</option>
              <option value='once'>Once</option>
            </select>
          </td>
          <td>
            <div className='row'>
              <input type="number" placeholder="seconds" defaultValue={s.everySeconds || ""} min={1} max={100000000} step={1} onBlur={e => { const v = e.target.value ? Number(e.target.value) : null; const clamped = v == null ? null : Math.max(1, Math.min(100000000, v)); update(s._id, { everySeconds: clamped }); }} />
              <input placeholder='hours' defaultValue={s.everyHours||''} onBlur={e=>update(s._id,{everyHours:e.target.value?Number(e.target.value):null})}/>
              <input type='time' defaultValue={s.dailyAt||''} onBlur={e=>update(s._id,{dailyAt:e.target.value||null})}/>
              <input placeholder='tz' defaultValue={s.timezone||''} onBlur={e=>update(s._id,{timezone:e.target.value||null})}/>
              <input placeholder='cron' defaultValue={s.scheduleCron||''} onBlur={e=>update(s._id,{scheduleCron:e.target.value||null})}/>
              <input type='datetime-local' defaultValue={s.onceAt?new Date(s.onceAt).toISOString().slice(0,16):''} onBlur={e=>update(s._id,{onceAt:e.target.value||null})}/>
            </div>
          </td>
          <td><input type='checkbox' defaultChecked={s.enabled} onChange={e=>update(s._id,{enabled:e.target.checked})}/></td>
          <td><span className='badge success'>{s.counters?.sent||0}</span> / <span className='badge error'>{s.counters?.failed||0}</span></td>
          <td><span className='badge neutral'>{s.todayCount||0}</span> / <span className='badge neutral'>{s.dailyLimit||0}</span></td>
          <td className='row'>
            <button className='btn primary' onClick={()=>postNow(s)}>Post now</button>
            <button className='btn' onClick={()=>ping(s)}>Ping</button>
            <button className='btn danger' onClick={()=>remove(s)}>Delete</button>
          </td>
        </tr>
      ))}</tbody>
    </table>
    <div className='small' style={{marginTop:8}}>Tip: choose a mode and fill fields; toggle Enabled to Start/Stop.</div>
  </div>)
}

function Queue({sites}){
  const [siteId,setSite]=useState('')
  const [csv,setCsv]=useState('Keyword,Topic,Category,Tags,image,Backlink\n')
  const [preview,setPreview]=useState([])
  const [list,setList]=useState([])

    function parseCsv(text){
    // normalize input: remove BOM, normalize unicode & spaces
    const clean = (s) => (s ?? "")
      .replace(/^\uFEFF/, "")
      .replace(/\u00A0/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .normalize('NFKC');

    text = clean(text);

    // RFC4180-ish CSV parser
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field.trim()); field = ""; }
        else if (c === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ""; }
        else if (c === '\r') { /* skip */ }
        else { field += c; }
      }
    }
    // flush last field/row
    row.push(field.trim()); rows.push(row);

    if (!rows.length) return [];

    // detect header
    let headerRow = rows[0].map(h => h.trim());
    const hasHeader = /keyword/i.test(headerRow.join(','));
    if (!hasHeader) headerRow = ['Keyword','Topic','Category','Tags','image','Backlink'];

    // normalize header + aliases
    const alias = {
      backlinkurl: 'Backlink',
      backlink_url: 'Backlink',
      image_url: 'image',
      images: 'image',
    };
    const normHeader = headerRow.map(h => {
      const key = h.replace(/\s+/g,'').toLowerCase();
      return alias[key] || h;
    });

    const idx = (name) => normHeader.findIndex(h => h.toLowerCase() === name.toLowerCase());

    const data = (hasHeader ? rows.slice(1) : rows);
    const out = [];
    for (const r of data) {
      const rec = {
        Keyword:  r[idx('Keyword')]  ?? '',
        Topic:    r[idx('Topic')]    ?? '',
        Category: r[idx('Category')] ?? '',
        Tags:     r[idx('Tags')]     ?? '',
        image:    r[idx('image')]    ?? '',
        Backlink: (r[idx('Backlink')] ?? r[idx('BacklinkURL')] ?? '')
      };
      for (const k in rec) rec[k] = clean(rec[k]).trim();
      if (rec.Keyword) out.push(rec);
    }
    return out;
  }

  async function upload(){
    if(!siteId) return alert('Select site')
    const items=parseCsv(csv).filter(x=>x.Keyword)
    await req('/api/queue/append',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId, items})})
    alert('Uploaded '+items.length+' rows')
    load()
  }
  async function load(){
    if(!siteId) return
    setList(await req('/api/queue?siteId='+siteId))
  }
  async function clearAll(){
    if(!siteId) return alert('Select site')
    if(!confirm('Clear queue for this site?')) return
    await req('/api/queue/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId, all:true})})
    load()
  }

  return (<div className='card'>
    <strong>Queue (CSV loader)</strong>
    <div className='row' style={{marginTop:12}}>
      <select value={siteId} onChange={e=>{setSite(e.target.value); setTimeout(load,0)}}>
        <option value=''>-- select site --</option>
        {sites.map(s=>(<option key={s._id} value={s._id}>{s.name}</option>))}
      </select>
    </div>
    <div className='row' style={{marginTop:12}}>
      <input type="file" accept=".csv,text/csv" onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; const text=await f.text(); setCsv(text); setPreview(parseCsv(text)); }} style={{marginBottom:8}} />
      <textarea placeholder='CSV rows' style={{height:160}} value={csv} onChange={e=>{setCsv(e.target.value); setPreview(parseCsv(e.target.value))}}></textarea>
    </div>
    <div className='right'><button className='btn primary' onClick={upload}>Upload</button><button className='btn' onClick={clearAll}>Clear</button><button className='btn' onClick={load}>Refresh</button></div>
    <div className='small' style={{marginTop:10}}>Preview: {preview.length} rows</div>
    <table style={{marginTop:12}}>
      <thead><tr><th>Keyword</th><th>Topic</th><th>Category</th><th>Tags</th><th>Backlink</th></tr></thead>
      <tbody>{list.items?.slice(0,50).map((r,i)=>(<tr key={i}><td>{r.Keyword}</td><td>{r.Topic}</td><td>{r.Category}</td><td>{r.Tags}</td><td className='small'>{r.Backlink}</td></tr>))}</tbody>
    </table>
  </div>)
}

function Logs(){
  const [logs,setLogs]=useState([])
  const [filter,set]=useState({siteId:'',status:'',action:''})
  async function load(){
    const p=new URLSearchParams()
    if(filter.siteId)p.set('siteId',filter.siteId)
    if(filter.status)p.set('status',filter.status)
    if(filter.action)p.set('action',filter.action)
    setLogs(await req('/api/logs'+(p.toString()?'?'+p.toString():'')))
  }
  useEffect(()=>{ load() },[filter])

  return (<div className='card'>
    <strong>Execution Log</strong>
    <div className='row' style={{margin:'12px 0'}}>
      <input placeholder='Filter: siteId' value={filter.siteId} onChange={e=>set(f=>({...f,siteId:e.target.value}))}/>
      <select value={filter.action} onChange={e=>set(f=>({...f,action:e.target.value}))}><option value=''>Any action</option><option value='run'>run</option><option value='ping'>ping</option><option value='queue-bulk'>queue-bulk</option></select>
      <select value={filter.status} onChange={e=>set(f=>({...f,status:e.target.value}))}><option value=''>Any status</option><option value='success'>success</option><option value='error'>error</option></select>
      <div className='right'><button className='btn' onClick={load}>Refresh</button></div>
    </div>
    <table>
      <thead><tr><th>When</th><th>Site</th><th>Action</th><th>Status</th><th>Message</th></tr></thead>
      <tbody>{logs.map(l=>(
        <tr key={l._id}>
          <td><small>{new Date(l.createdAt).toLocaleString()}</small></td>
          <td className='small'>{l.siteId}</td>
          <td>{l.action}</td>
          <td><span className={'badge '+(l.status==='success'?'success':'error')}>{l.status}</span></td>
          <td className='small'>{l.message}</td>
        </tr>
      ))}</tbody>
    </table>
  </div>)
}

function App(){
  const [tab,setTab]=useState('dash')
  const {sites,refresh}=useSites()

  return (<div className='layout'>
    <aside>
      <div className='brand'><span className='dot'></span> Remote Controller</div>
      <div className='search'><input placeholder='Search (Ctrl+/ coming soon)' /></div>
      <nav>
        <div className='group'>Main</div>
        <button className={tab==='dash'?'active':''} onClick={()=>setTab('dash')}><Icon name='home'/> Dashboard</button>
        <button className={tab==='sites'?'active':''} onClick={()=>setTab('sites')}><Icon name='sites'/> Sites</button>
        <button className={tab==='queue'?'active':''} onClick={()=>setTab('queue')}><Icon name='queue'/> Queue</button>
        <button className={tab==='logs'?'active':''} onClick={()=>setTab('logs')}><Icon name='logs'/> Logs</button>
      </nav>
      <footer>v1.1 • modern UI</footer>
    </aside>
    <main>
      <header><strong>{tab==='dash'?'Overview':tab==='sites'?'Sites':tab==='queue'?'Queue':'Logs'}</strong></header>
      <div className='wrap'>
        {tab==='dash' && (<>
          <div className='hero'>
            <div className='panel'>
              <h1>Commander for your Auto Blog</h1>
              <p>Start/Stop, schedule in seconds/hours/daily/cron, upload queue, and inspect logs — all from one beautiful control room.</p>
              <div className='divider'/>
              <div className='small'>Tip: Add a site in <b>Sites</b> with the same API key set in your WP Bridge plugin.</div>
            </div>
            <div className='panel'>
              <KPIs sites={sites}/>
            </div>
          </div>
        </>)}
        {tab==='sites' && (<><AddSite onAdded={refresh}/><Sites/></>)}
        {tab==='queue' && (<><Queue sites={sites}/></>)}
        {tab==='logs' && (<><Logs/></>)}
      </div>
    </main>
  </div>)
}

createRoot(document.getElementById('root')).render(<App/>)
