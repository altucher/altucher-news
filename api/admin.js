import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const password = req.query.password;
  if (password !== process.env.ADMIN_PASSWORD) {
    res.setHeader("Content-Type", "text/html");
    return res.status(401).send(`
      <!DOCTYPE html>
      <html><head><title>Admin</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 400px; margin: 5rem auto; padding: 1rem; }
        input { font-size: 16px; padding: 10px; width: 100%; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; }
        button { font-size: 16px; padding: 10px 20px; margin-top: 10px; background: #1a1a1a; color: white; border: none; border-radius: 6px; cursor: pointer; }
      </style></head>
      <body>
        <h2>Admin login</h2>
        <form method="GET" action="/api/admin">
          <input type="password" name="password" placeholder="Password" autofocus />
          <button type="submit">Sign in</button>
        </form>
      </body></html>
    `);
  }

  try {
    const raw = await kv.lrange("searches", 0, -1);
    const entries = raw.map(r => typeof r === "string" ? JSON.parse(r) : r);

    const filterCounts = {};
    const countryCounts = {};
    let successCount = 0;
    let errorCount = 0;

    for (const e of entries) {
      filterCounts[e.filter] = (filterCounts[e.filter] || 0) + 1;
      countryCounts[e.country] = (countryCounts[e.country] || 0) + 1;
      if (e.status === "success") successCount++;
      else errorCount++;
    }

    const sortedFilters = Object.entries(filterCounts).sort((a, b) => b[1] - a[1]);
    const sortedCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(`
      <!DOCTYPE html>
      <html><head><title>Admin — searches</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; color: #1a1a1a; }
        h1 { font-size: 24px; }
        h2 { font-size: 18px; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; }
        td, th { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
        th { background: #f5f5f0; }
        .stats { display: flex; gap: 2rem; margin-top: 1rem; }
        .stat { background: #f5f5f0; padding: 12px 16px; border-radius: 8px; }
        .stat .num { font-size: 22px; font-weight: 500; }
        .stat .label { font-size: 12px; color: #666; }
      </style></head>
      <body>
        <h1>Search log</h1>
        <div class="stats">
          <div class="stat"><div class="num">${entries.length}</div><div class="label">Total searches</div></div>
          <div class="stat"><div class="num">${successCount}</div><div class="label">Successful</div></div>
          <div class="stat"><div class="num">${errorCount}</div><div class="label">Errors</div></div>
        </div>

        <h2>Top filters</h2>
        <table><tr><th>Filter</th><th>Count</th></tr>
        ${sortedFilters.map(([f, c]) => `<tr><td>${f}</td><td>${c}</td></tr>`).join("")}
        </table>

        <h2>Top countries</h2>
        <table><tr><th>Country</th><th>Count</th></tr>
        ${sortedCountries.map(([c, n]) => `<tr><td>${c}</td><td>${n}</td></tr>`).join("")}
        </table>

        <h2>Recent searches (last 100)</h2>
        <table><tr><th>Time</th><th>Filter</th><th>Country</th><th>Status</th></tr>
        ${entries.slice(0, 100).map(e =>
          `<tr><td>${new Date(e.timestamp).toLocaleString()}</td><td>${e.filter}</td><td>${e.country}</td><td>${e.status}</td></tr>`
        ).join("")}
        </table>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
}
