// api/cosmic-proxy.js

const TARGET_BASE = 'https://lc5.cosmicscans.asia';

// Daftar User-Agent realistis (desktop modern)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Fungsi untuk mendapatkan header lengkap seperti browser
function buildHeaders(userAgent, referer = null) {
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'TE': 'Trailers'
  };

  if (referer) {
    headers['Referer'] = referer;
    headers['Origin'] = new URL(referer).origin;
  }

  return headers;
}

// Fungsi untuk mencoba REST API (biasanya lebih longgar)
async function tryRestApi(path, userAgent) {
  // Ubah path dari /manga/?order=update&page=1 ke /wp-json/wp/v2/manga
  let apiPath = '/wp-json/wp/v2/manga';
  const urlObj = new URL(path, TARGET_BASE);
  const searchParams = urlObj.searchParams;
  
  if (searchParams.has('page')) {
    apiPath += `?page=${searchParams.get('page')}&per_page=24`;
  }
  if (searchParams.has('s')) {
    apiPath = `/wp-json/wp/v2/manga?search=${encodeURIComponent(searchParams.get('s'))}&per_page=24`;
  }
  
  const apiUrl = `${TARGET_BASE}${apiPath}`;
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'application/json',
      'Referer': TARGET_BASE + '/',
      'Origin': TARGET_BASE
    }
  });
  
  if (response.ok) {
    const data = await response.json();
    return { success: true, data, isJson: true };
  }
  return { success: false };
}

// Fungsi utama proxy dengan retry
async function proxyWithRetry(path, retries = 3) {
  let lastError = null;
  const fullUrl = `${TARGET_BASE}${path}`;

  for (let i = 0; i < retries; i++) {
    const userAgent = USER_AGENTS[i % USER_AGENTS.length];
    // Referer bergantian agar natural
    const referer = i === 0 ? TARGET_BASE + '/' : fullUrl;
    const headers = buildHeaders(userAgent, referer);
    
    try {
      const response = await fetch(fullUrl, { headers });
      
      if (response.ok) {
        const html = await response.text();
        // Cek apakah halaman berisi challenge Cloudflare
        if (html.includes('cf-challenge') || html.includes('captcha') || html.includes('__cf_chl')) {
          throw new Error('Cloudflare challenge detected');
        }
        return { success: true, html, status: response.status };
      }
      
      if (response.status === 403) {
        // Coba fallback ke REST API
        const restResult = await tryRestApi(path, userAgent);
        if (restResult.success) {
          return { success: true, html: JSON.stringify(restResult.data), isRestApi: true, status: 200 };
        }
        throw new Error(`HTTP ${response.status} - mungkin kena Cloudflare`);
      }
      
      throw new Error(`HTTP ${response.status}`);
      
    } catch (err) {
      lastError = err;
      // Tunggu sebentar sebelum retry (backoff sederhana)
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('Gagal setelah retry');
}

// Handler Vercel
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Parameter path diperlukan. Contoh: ?path=/manga/?order=update&page=1' });
  }
  
  try {
    const result = await proxyWithRetry(path);
    
    if (result.isRestApi) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Proxy-Source', 'cosmic-rest-api');
      return res.status(200).send(result.html);
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Proxy-Source', 'cosmic-html');
    return res.status(result.status).send(result.html);
    
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ 
      error: err.message,
      suggestion: 'Coba gunakan endpoint REST API langsung: /wp-json/wp/v2/manga'
    });
  }
}