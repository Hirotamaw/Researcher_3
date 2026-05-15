export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, category, query } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const geminiKey = process.env.GEMINI_API_KEY;
  const cmcKey    = process.env.CMC_API_KEY;
  if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  try {
    let realtimeData = {};

    // ── CoinMarketCap: 時価総額 ────────────────────────────────
    if (category === 'blockchain' && query && cmcKey) {
      try {
        const cmcRes = await fetch(
          `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(query.toUpperCase())}&convert=USD`,
          { headers: { 'X-CMC_PRO_API_KEY': cmcKey, 'Accept': 'application/json' } }
        );
        const cmcData = await cmcRes.json();
        const entries = Object.values(cmcData.data || {});
        if (entries.length > 0) {
          const coin = entries[0];
          const usd  = coin.quote?.USD;
          if (usd?.market_cap) realtimeData.market_cap = `$${(usd.market_cap / 1e9).toFixed(1)}B（CoinMarketCap）`;
          if (usd?.price)      realtimeData.price      = `$${Number(usd.price.toFixed(4)).toLocaleString()}`;
          realtimeData.cmc_url = `https://coinmarketcap.com/currencies/${coin.slug}/`;
        }
      } catch(_) {}
    }

    // ── DeFiLlama: TVL・月間取引高 ────────────────────────────
    if (category === 'defi' && query) {
      try {
        const listRes  = await fetch('https://api.llama.fi/protocols');
        const listData = await listRes.json();
        const q = query.toLowerCase().replace(/\s+/g, '');
        const protocol = listData.find(p =>
          p.name.toLowerCase().replace(/\s+/g, '') === q ||
          p.slug.toLowerCase().replace(/\s+/g, '') === q ||
          p.name.toLowerCase().includes(query.toLowerCase())
        );
        if (protocol) {
          if (protocol.tvl) realtimeData.tvl = `$${(protocol.tvl / 1e9).toFixed(2)}B`;
          realtimeData.tvl_change    = protocol.change_1d ? `前日比 ${protocol.change_1d.toFixed(2)}%` : null;
          realtimeData.defillama_url = `https://defillama.com/protocol/${protocol.slug}`;

          try {
            const volRes  = await fetch(`https://api.llama.fi/summary/dexs/${protocol.slug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`);
            const volData = await volRes.json();
            if (volData.total30d) realtimeData.monthly_volume = `$${(volData.total30d / 1e9).toFixed(2)}B（過去30日）`;
          } catch(_) {}
        }
      } catch(_) {}
    }

    // ── Gemini リサーチ ───────────────────────────────────────
    const rtContext = Object.keys(realtimeData).length > 0
      ? `\n\n【取得済みリアルタイムデータ（必ずJSONに反映すること）】\n${JSON.stringify(realtimeData, null, 2)}`
      : '';

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt + rtContext }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
        })
      }
    );

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({ error: geminiData.error?.message || 'Gemini API error' });
    }

    const parts = geminiData.candidates?.[0]?.content?.parts;
    const text  = parts?.filter(p => p.text).map(p => p.text).join('') || '';
    if (!text) return res.status(500).json({ error: 'Empty response from Gemini' });

    return res.status(200).json({ text, realtimeData });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
