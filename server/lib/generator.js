export async function generatePostForSite(site){
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  return {
    title: `Auto Blog Post @ ${ts} — ${site.name}`,
    content: `<p>Auto-generated for <strong>${site.url}</strong>.</p>`,
    status: 'publish'
  };
}
