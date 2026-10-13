const SUPABASE_URL = 'https://qlztltxlpggeglvyldxq.supabase.co';

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function buildSources() {
  const today = new Date();
  const start = isoDate(today);
  const end = isoDate(addDays(today, 60));

  return [
    {
      id: 'seoul-culture',
      name: '서울문화포털',
      url: `https://culture.seoul.go.kr/culture/culture/cultureEvent/list.do?menuNo=200110&sdate=${start}&edate=${end}`,
      maxItems: 24,
      note: '서울의 공연, 전시, 축제 중심. 교육/체험과 종료 행사는 제외한다.'
    },
    {
      id: 'sema',
      name: '서울시립미술관 SeMA',
      url: 'https://sema.seoul.go.kr/kr/whatson/landing?whatsonMenuDivList=EX',
      maxItems: 12,
      note: '현재 진행 중이거나 예정된 전시만 추출한다.'
    },
    {
      id: 'sejong',
      name: '세종문화회관',
      url: `https://www.sejongpac.or.kr/portal/subMain/perform.do?pageIndex=0&sdate=${start}`,
      maxItems: 10,
      note: '공연, 전시, 뮤지컬, 연극, 클래식 중 진행 중이거나 예정된 프로그램만 추출한다.'
    },
    {
      id: 'sac',
      name: '예술의전당',
      url: 'https://www.sac.or.kr/site/main/content/2026_SACpresents',
      maxItems: 10,
      note: '2026 예술의전당 프로그램 중 오늘 이후 진행 중이거나 예정된 공연·전시만 추출한다.'
    },
    {
      id: 'hyundai-popup',
      name: '현대백화점 팝업 다이어리',
      url: 'https://www.ehyundai.com/newPortal/NS/NS000001_V.do?bbsCd=201&seq=2093073',
      maxItems: 10,
      note: '팝업스토어와 브랜드 이벤트만 추출한다. 서울 소재 점포의 행사만 우선한다. 일반 상품 할인이나 단순 쇼핑 프로모션은 제외한다.'
    },
    {
      id: 'mmca-seoul',
      name: '국립현대미술관 서울',
      url: 'https://www.mmca.go.kr/visitingInfo/seoulInfo.do',
      maxItems: 12,
      note: '국립현대미술관 서울관의 현재 진행 중 또는 예정 전시·다원예술만 추출한다. 과천·덕수궁·청주관 행사는 제외한다.'
    },
    {
      id: 'lg-arts',
      name: 'LG아트센터 서울',
      url: 'https://www.lgart.com/',
      maxItems: 12,
      note: '서울 LG아트센터에서 진행 중이거나 예정된 공연만 추출한다. 티켓오픈 공지나 시설 안내는 제외한다.'
    },
    {
      id: 'ntok',
      name: '국립극장',
      url: 'https://www.ntok.go.kr/ntok/pm/prfmng/searchPerfList.do?mi=21008',
      maxItems: 14,
      note: '국립극장 공연 중 진행 중이거나 예정된 실제 공연만 추출한다. 교육·모집·마켓은 제외한다.'
    }
  ];
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
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
  const querySecret = req.query?.secret;
  const headerSecret = req.headers['x-collector-secret'];
  const isManual = Boolean(secret && (querySecret === secret || headerSecret === secret));
  const isVercelCron = String(req.headers['user-agent'] || '').includes('vercel-cron/1.0');
  return isManual || isVercelCron;
}

function normalizeEvent(event, source) {
  const normalized = {
    title: String(event?.title || '').trim(),
    event_type: String(event?.event_type || '공연').trim(),
    organizer_name: event?.organizer_name ? String(event.organizer_name).trim() : source.name,
    summary: event?.summary ? String(event.summary).trim() : null,
    start_date: event?.start_date || null,
    end_date: event?.end_date || event?.start_date || null,
    venue_name: event?.venue_name ? String(event.venue_name).trim() : null,
    sido: event?.sido ? String(event.sido).trim() : '서울특별시',
    sigungu: event?.sigungu ? String(event.sigungu).trim() : null,
    opening_hours: event?.opening_hours ? String(event.opening_hours).trim() : null,
    price_text: event?.price_text ? String(event.price_text).trim() : null,
    interests: Array.isArray(event?.interests) ? event.interests.slice(0, 3) : [],
    source_name: source.name,
    source_url: source.url
  };

  const allowedTypes = ['팝업', '공연', '전시', '페스티벌', '뮤지컬', '연극', '클래식'];
  if (!allowedTypes.includes(normalized.event_type)) {
    if (/팝업|popup/i.test(normalized.event_type)) normalized.event_type = '팝업';
    else if (/전시|미술|exhibition/i.test(normalized.event_type)) normalized.event_type = '전시';
    else if (/뮤지컬/i.test(normalized.event_type)) normalized.event_type = '뮤지컬';
    else if (/연극|theatre|theater/i.test(normalized.event_type)) normalized.event_type = '연극';
    else if (/클래식|오페라|교향|리사이틀/i.test(normalized.event_type)) normalized.event_type = '클래식';
    else if (/축제|페스티벌|festival/i.test(normalized.event_type)) normalized.event_type = '페스티벌';
    else normalized.event_type = '공연';
  }

  return normalized;
}

function eventKey(event) {
  return [event.title, event.start_date || '', event.venue_name || ''].map(v => String(v).trim().toLowerCase()).join('|');
}

function isCurrentOrUpcoming(event) {
  if (!event?.start_date) return false;
  const today = isoDate(new Date());
  const end = event.end_date || event.start_date;
  return end >= today;
}

function assessQuality(event, source) {
  let score = 0;
  const reasons = [];
  const allowedTypes = ['팝업', '공연', '전시', '페스티벌', '뮤지컬', '연극', '클래식'];

  if (event.title && event.title.length >= 2) score += 10; else reasons.push('title');
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(String(event.start_date || ''));
  const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(event.end_date || ''));
  if (validStart && validEnd && event.end_date >= event.start_date && isCurrentOrUpcoming(event)) score += 20;
  else reasons.push('date');

  if (source?.name && /^https:\/\//.test(source?.url || '')) score += 20; else reasons.push('source');
  if (event.venue_name && event.venue_name.length >= 2) score += 10; else reasons.push('venue');

  if (event.sido === '서울특별시') {
    score += 5;
    if (event.sigungu && /구$/.test(event.sigungu)) score += 5;
  } else {
    reasons.push('seoul');
  }

  if (allowedTypes.includes(event.event_type)) score += 10; else reasons.push('type');
  if (event.summary && event.summary.length >= 10) score += 5; else reasons.push('summary');
  if (Array.isArray(event.interests) && event.interests.length > 0) score += 5; else reasons.push('interests');
  if (/^https:\/\//.test(event.source_url || '')) score += 10; else reasons.push('url');

  return { score, reasons };
}

async function aiRecheck(source, text, events, oidc) {
  if (!events.length) return [];
  const prompt = `아래는 '${source.name}' 공식 페이지에서 1차 추출했지만 품질 점수가 중간 수준인 행사들이다.
원문을 다시 대조하여 틀린 값만 수정하고, 원문에서 확인되지 않는 값은 null로 둔다.
서울특별시에서 진행되는 현재/예정 행사만 남긴다. 추측하지 않는다.
반드시 {"events":[...]} JSON만 반환한다.

재검증 대상:
${JSON.stringify(events)}

공식 페이지 원문:
${text.slice(0, 50000)}`;

  const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidc}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Recheck extracted Korean event records against official source text. Return strict JSON only and never invent facts.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${source.name} recheck ${response.status}: ${raw.slice(0, 250)}`);
  const envelope = JSON.parse(raw);
  const parsed = JSON.parse(cleanJson(envelope?.choices?.[0]?.message?.content || '{}'));
  return (Array.isArray(parsed.events) ? parsed.events : []).map(row => normalizeEvent(row, source)).filter(isCurrentOrUpcoming);
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TodaysDiscoveryBot/1.1; cultural-event prototype)',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
      Accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`${source.name} source fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const text = stripHtml(html);
  if (text.length < 80) throw new Error(`${source.name} source text was empty`);
  return text;
}

async function aiExtract(source, text, oidc) {
  if (!oidc) throw new Error('Vercel OIDC token unavailable');

  const today = isoDate(new Date());
  const prompt = `오늘 날짜는 ${today}이다. 아래 텍스트는 '${source.name}' 공식 웹페이지에서 가져온 행사 정보다.\n\n` +
    `목표: 오늘 기준으로 진행 중이거나 앞으로 시작하는 실제 오프라인 문화·라이프스타일 행사를 최대 ${source.maxItems}개 구조화한다.\n` +
    `대상 유형: 팝업스토어, 공연, 전시, 페스티벌, 뮤지컬, 연극, 클래식.\n` +
    `제외: 이미 종료된 행사, 교육/강좌, 채용/공지, 단순 상품 할인, 온라인 쇼핑 프로모션, 페이지에 근거가 없는 정보.\n` +
    `이 출처에 대한 추가 기준: ${source.note}\n\n` +
    `반드시 원문에서 확인되는 정보만 사용한다. 불명확한 값은 null로 둔다. 행사명이 다른 항목은 각각 별개 행사로 유지한다.\n` +
    `event_type은 반드시 팝업, 공연, 전시, 페스티벌, 뮤지컬, 연극, 클래식 중 하나로 정규화한다.\n` +
    `관심 태그는 패션, 뷰티, 캐릭터, 애니메이션, 게임, 영화, 미술, 사진, 음악, 음식, 디저트, 주류, 스포츠, 인테리어 중에서만 최대 3개 선택한다.\n` +
    `날짜는 YYYY-MM-DD로 변환한다. 종료일이 원문에 없으면 start_date와 동일하게 둔다.\n` +
    `서울 행사라면 sido는 서울특별시로 기록하고, 구 정보가 원문에 명확히 있으면 sigungu에 기록한다.\n\n` +
    `반드시 아래 JSON 형식만 반환한다:\n` +
    `{"events":[{"title":"행사명","event_type":"전시","organizer_name":null,"summary":"원문에 근거한 한 문장 요약","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","venue_name":"장소명","sido":"서울특별시","sigungu":null,"opening_hours":null,"price_text":null,"interests":["미술"]}]}\n\n` +
    `페이지 텍스트:\n${text.slice(0, 60000)}`;

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
          content: 'Extract Korean event data from official-source text. Never invent facts. Return strict JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${source.name} AI Gateway ${response.status}: ${raw.slice(0, 300)}`);
  }

  const envelope = JSON.parse(raw);
  const content = envelope?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${source.name} AI response was empty`);

  const parsed = JSON.parse(cleanJson(content));
  const rows = Array.isArray(parsed.events) ? parsed.events : [];
  return rows.map(row => normalizeEvent(row, source)).filter(isCurrentOrUpcoming);
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
      p_event_type: event.event_type,
      p_organizer_name: event.organizer_name,
      p_summary: event.summary,
      p_start_date: event.start_date,
      p_end_date: event.end_date,
      p_venue_name: event.venue_name,
      p_sido: event.sido,
      p_sigungu: event.sigungu,
      p_opening_hours: event.opening_hours,
      p_price_text: event.price_text,
      p_interests: event.interests,
      p_official_url: event.source_url
    })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  }
}

async function collectOneSource(source, oidc) {
  try {
    const text = await fetchSource(source);
    const extracted = await aiExtract(source, text, oidc);
    const high = [], medium = [], low = [];

    for (const event of extracted) {
      const quality = assessQuality(event, source);
      if (quality.score >= 80) high.push({ ...event, quality_score: quality.score });
      else if (quality.score >= 60) medium.push(event);
      else low.push({ title: event.title, score: quality.score, reasons: quality.reasons });
    }

    let rechecked = [];
    if (medium.length) {
      try {
        const repaired = await aiRecheck(source, text, medium, oidc);
        rechecked = repaired
          .map(event => ({ event, quality: assessQuality(event, source) }))
          .filter(x => x.quality.score >= 80 && x.event.sido === '서울특별시')
          .map(x => ({ ...x.event, quality_score: x.quality.score }));
      } catch (error) {
        console.error(`[collector:${source.id}:recheck]`, error);
      }
    }

    const events = [...high, ...rechecked].filter(event => event.sido === '서울특별시');
    return {
      source,
      events,
      stats: { extracted: extracted.length, approved: events.length, rechecked: medium.length, rejected: extracted.length - events.length, low: low.slice(0, 5) },
      error: null
    };
  } catch (error) {
    console.error(`[collector:${source.id}]`, error);
    return { source, events: [], stats: { extracted: 0, approved: 0, rechecked: 0, rejected: 0 }, error: error.message };
  }
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const oidc = process.env.VERCEL_OIDC_TOKEN || req.headers['x-vercel-oidc-token'];
    const sources = buildSources();

    // Run source extraction concurrently so the collector remains fast enough for a serverless function.
    const results = await Promise.all(sources.map(source => collectOneSource(source, oidc)));

    const seen = new Set();
    const merged = [];
    for (const result of results) {
      for (const event of result.events) {
        if (!event.title || !event.start_date) continue;
        const key = eventKey(event);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(event);
      }
    }

    let queued = 0;
    const insertErrors = [];
    for (const event of merged) {
      try {
        await enqueue(event);
        queued += 1;
      } catch (error) {
        insertErrors.push({ title: event.title, error: error.message });
      }
    }

    const perSource = results.map(result => ({
      source: result.source.name,
      extracted: result.stats?.extracted || 0,
      approved: result.stats?.approved || 0,
      rechecked: result.stats?.rechecked || 0,
      rejected: result.stats?.rejected || 0,
      error: result.error
    }));

    return res.status(200).json({
      ok: results.some(result => !result.error),
      target: '30+ live events',
      sources: perSource,
      qualityPolicy: 'rules >=80 auto-approve; 60-79 AI batch recheck; <60 reject; duplicate is a hard gate',
      extractedAfterDedup: merged.length,
      queued,
      insertErrors: insertErrors.slice(0, 10)
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
