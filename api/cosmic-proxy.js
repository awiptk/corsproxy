// api/cosmic-proxy.js
export const config = {
  runtime: 'edge',
};

const TARGET_BASE = 'https://lc5.cosmicscans.asia';

function buildTargetUrl(path) {
  const cleanPath = String(path || '/').trim();
  return new URL(cleanPath, TARGET_BASE).toString();
}

async function proxyRequest(path, req) {
  const targetUrl = buildTargetUrl(path);

  const headers = new Headers();
  headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
  headers.set('Accept-Language', 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7');
  headers.set('Referer', TARGET_BASE + '/');

  const upstream = await fetch(targetUrl, {
    method: 'GET',
    headers,
    redirect: 'follow',
  });

  const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
      'X-Proxy-Source': 'cosmic-edge',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  const url = new URL(req.url);
  const path = url.searchParams.get('path');

  if (!path) {
    return new Response(
      JSON.stringify({
        error: 'Parameter path diperlukan',
        example: '?path=/manga/?order=update&page=1',
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  try {
    return await proxyRequest(path, req);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err?.message || 'Proxy error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}