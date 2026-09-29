const SUPABASE_URL = 'https://qlztltxlpggeglvyldxq.supabase.co';
const SOURCE_URL = 'https://culture.seoul.go.kr/culture/culture/cultureCalendar/list.do?menuNo=200122';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanJson(text) {
  const t = String(text || '').trim();
  if (t.startsWith('```')) return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

async function aiExtract(text) {
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  if (!oidc) throw new Error('VERCEL_OIDC_TOKEN unavailable. Enable Vercel OIDC for this project.');

  const prompt = `오늘 날짜는 ${new Date().toISOString().slice(0,10)}이다. 아래 서울문화포털 공식 페이지 텍스트에서 현재 진행 중이거나 앞으로 열릴 문화행사를 최대 6개 추출해라. 교육/체험은 제외하고 공연, 전시, 페스티벌, 뮤지컬, 연극, 클래식 중심으로 선택한다. 텍스트에 없는 정보는 추측하지 않는다. 관심 태그는 패션, 뷰티, 캐릭터, 애니메이션, 게임, 영화, 미술, 사진, 음악, 음식, 디저트, 주류, 스포츠, 인테리어 중에서만 선택한다. 반드시 JSON만 반환한다. 형식: {"events":[{"title":"행사명","event_type":"공연|전시|페스티벌|뮤지컬|연극|클래식","organizer_name":null,"summary":"한 문장 요약","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","venue_name":"장소명","sido":"서울특별시","sigungu":null,"opening_hours":null,"price_text":null,"interests":["음악"]}]}\n\n페이지 텍스트:\n${text.slice(0,50000)}`;

  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oidc}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-5.5-mini',
      messages: [
        { role: 'system', content: 'Extract Korean cultural event data and return strict JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const raw = await r.text();
  if (!r.ok) throw new Error(`AI Gateway ${r.status}: ${raw.slice(0,250)}`);
  const envelope = JSON.parse(raw);
  const content = envelope?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(cleanJson(content));
  return Array.isArray(parsed.events) ? parsed.events : [];
}

async function enqueue(e) {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.COLLECTOR_SECRET;
  if (!key || !secret) throw new Error('Missing SUPABASE_PUBLISHABLE_KEY or COLLECTOR_SECRET');

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_event`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_secret: secret,
      p_title: e.title,
      p_event_type: e.event_type || null,
      p_organizer_name: e.organizer_name || null,
      p_summary: e.summary || null,
      p_start_date: e.start_date || null,
      p_end_date: e.end_date || e.start_date || null,
      p_venue_name: e.venue_name || null,
      p_sido: e.sido || '서울특별시',
      p_sigungu: e.sigungu || null,
      p_opening_hours: e.opening_hours || null,
      p_price_text: e.price_text || null,
      p_interests: Array.isArray(e.interests) ? e.interests : [],
      p_official_url: SOURCE_URL
    })
  });

  const body = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${body.slice(0,250)}`);
}

export default async function handler(req, res) {
  try {
    const source = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 todays-discovery/1.0' } });
    if (!source.ok) throw new Error(`Source fetch failed: ${source.status}`);
    const html = await source.text();
    const events = await aiExtract(stripHtml(html));

    let queued = 0;
    for (const e of events) {
      if (!e?.title || !e?.start_date) continue;
      await enqueue(e);
      queued++;
    }

    res.status(200).json({ ok: true, source: '서울문화포털', extracted: events.length, queued, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
