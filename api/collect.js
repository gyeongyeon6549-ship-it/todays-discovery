const SUPABASE_URL = 'https://qlztltxlpggeglvyldxq.supabase.co';
const SOURCE_URL = 'https://culture.seoul.go.kr/culture/main/main.do?ready=Y';

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
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  return first >= 0 && last > first ? t.slice(first, last + 1) : t;
}

function isAuthorized(req) {
  const secret = process.env.COLLECTOR_SECRET;
  const manualSecret = req.query?.secret;
  const isManual = Boolean(secret && manualSecret === secret);
  const isVercelCron = String(req.headers['user-agent'] || '').includes('vercel-cron/1.0');
  return isManual || isVercelCron;
}

async function aiExtract(text, oidc) {
  if (!oidc) throw new Error('Vercel OIDC token unavailable');

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `오늘 날짜는 ${today}이다. 아래 텍스트는 서울문화포털 공식 홈페이지의 현재 문화행사 정보다.\n\n` +
    `오늘 기준으로 진행 중이거나 앞으로 시작하는 행사만 최대 10개 추출한다. 이미 종료된 행사는 제외한다. 교육/체험은 제외하고 공연, 전시, 축제/페스티벌, 뮤지컬, 연극, 클래식 중심으로 고른다. 페이지에 없는 정보는 추측하지 않는다.\n\n` +
    `event_type은 공연, 전시, 페스티벌, 뮤지컬, 연극, 클래식 중 하나로 정규화한다. 관심 태그는 패션, 뷰티, 캐릭터, 애니메이션, 게임, 영화, 미술, 사진, 음악, 음식, 디저트, 주류, 스포츠, 인테리어 중에서만 0~3개 고른다. 날짜는 YYYY-MM-DD로 변환한다.\n\n` +
    `반드시 아래 JSON 형식만 반환한다:\n` +
    `{"events":[{"title":"행사명","event_type":"공연","organizer_name":null,"summary":"사실에 근거한 한 문장 요약","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","venue_name":"장소명","sido":"서울특별시","sigungu":null,"opening_hours":null,"price_text":null,"interests":["음악"]}]}\n\n` +
    `페이지 텍스트:\n${text.slice(0, 55000)}`;

  const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oidc}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-5-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You extract Korean cultural-event data from official source text. Return strict JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AI Gateway ${response.status}: ${raw.slice(0, 300)}`);
  }

  const envelope = JSON.parse(raw);
  const content = envelope?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI response was empty');

  const parsed = JSON.parse(cleanJson(content));
  return Array.isArray(parsed.events) ? parsed.events : [];
}

async function enqueue(event) {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.COLLECTOR_SECRET;
  if (!key || !secret) {
    throw new Error('Missing SUPABASE_PUBLISHABLE_KEY or COLLECTOR_SECRET');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_event`, {
    method: 'POST',
    headers: {
      apikey: key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_secret: secret,
      p_title: event.title,
      p_event_type: event.event_type || null,
      p_organizer_name: event.organizer_name || null,
      p_summary: event.summary || null,
      p_start_date: event.start_date || null,
      p_end_date: event.end_date || event.start_date || null,
      p_venue_name: event.venue_name || null,
      p_sido: event.sido || '서울특별시',
      p_sigungu: event.sigungu || null,
      p_opening_hours: event.opening_hours || null,
      p_price_text: event.price_text || null,
      p_interests: Array.isArray(event.interests) ? event.interests : [],
      p_official_url: SOURCE_URL
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  }
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const oidc = process.env.VERCEL_OIDC_TOKEN || req.headers['x-vercel-oidc-token'];

    const sourceResponse = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 todays-discovery/1.0',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });

    if (!sourceResponse.ok) {
      throw new Error(`Source fetch failed: ${sourceResponse.status}`);
    }

    const html = await sourceResponse.text();
    const pageText = stripHtml(html);
    const events = await aiExtract(pageText, oidc);

    let queued = 0;
    for (const event of events) {
      if (!event?.title || !event?.start_date) continue;
      await enqueue(event);
      queued += 1;
    }

    return res.status(200).json({
      ok: true,
      source: '서울문화포털',
      extracted: events.length,
      queued,
      status: 'pending'
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
