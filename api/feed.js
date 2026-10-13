const SOURCES = {
  sac: {
    name: '예술의전당',
    url: 'https://www.sac.or.kr/site/main/program/schedule_year'
  },
  sejong: {
    name: '세종문화회관',
    url: 'https://www.sejongpac.or.kr/portal/subMain/perform.do?searchSort=1'
  },
  hyundaiList: {
    name: '현대백화점',
    url: 'https://www.ehyundai.com/newPortal/NS/NS000001_L.do?bbsCd=201'
  },
  hyundaiFallback: {
    name: '현대백화점 팝업 다이어리',
    url: 'https://www.ehyundai.com/newPortal/NS/NS000001_V.do?bbsCd=201&seq=2093073'
  }
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&middot;/gi, '·')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHtml(value = '') {
  return decodeEntities(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function iso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayIso() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function plusDaysIso(days) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
}

function stableId(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) + 1000000000;
}

function classify(title = '', venue = '', extra = '') {
  const text = `${title} ${venue} ${extra}`;
  if (/팝업|POP.?UP/i.test(text)) return '팝업';
  if (/뮤지컬/i.test(text)) return '뮤지컬';
  if (/연극|시어터|theatre|theater/i.test(text)) return '연극';
  if (/페스티벌|축제|festival/i.test(text)) return '페스티벌';
  if (/전시|展|미술관|박물관|갤러리|서예박물관|아트뮤지엄|art museum/i.test(text)) return '전시';
  if (/클래식|교향|오케스트라|리사이틀|독주회|협주|콘서트홀|챔버홀|바이올린|피아노|첼로|플루트|오보에|성악|가곡|오페라/i.test(text)) return '클래식';
  return '공연';
}

function inferSeoulGu(venue = '') {
  const text = String(venue);
  const rules = [
    [/예술의전당|서초/, '서초구'],
    [/세종문화회관|광화문/, '종로구'],
    [/더현대\s*서울/, '영등포구'],
    [/무역센터/, '강남구'],
    [/미아/, '성북구'],
    [/목동/, '양천구'],
    [/신촌/, '서대문구'],
    [/디큐브/, '구로구'],
    [/천호/, '강동구']
  ];
  const found = rules.find(([re]) => re.test(text));
  return found ? found[1] : null;
}

function isOutsideSeoulVenue(venue = '') {
  return /판교|중동|킨텍스|고양|일산|부천|성남/.test(String(venue));
}

function interestsFor(type, title = '') {
  const tags = [];
  const text = String(title);
  if (type === '전시') tags.push('미술');
  if (['공연', '페스티벌', '뮤지컬', '클래식'].includes(type)) tags.push('음악');
  if (/사진|포토/i.test(text)) tags.push('사진');
  if (/캐릭터|일러스트|그림책|쿵야|피터래빗/i.test(text)) tags.push('캐릭터');
  if (/패션|의류|러닝|스니커|슈즈|데상트/i.test(text)) tags.push('패션');
  if (/뷰티|화장품|코스메틱/i.test(text)) tags.push('뷰티');
  if (/음식|푸드|디저트|레스토랑|F&B|떡국/i.test(text)) tags.push('음식');
  if (/게임/i.test(text)) tags.push('게임');
  if (/영화|시네마/i.test(text)) tags.push('영화');
  return [...new Set(tags)].slice(0, 3);
}

function makeEvent({ title, start, end, venue, sourceName, sourceUrl, extra = '', eventType = null, summary = null, sigungu = null }) {
  const type = eventType || classify(title, venue, extra);
  const key = `${sourceName}|${title}|${start}|${venue || ''}`;
  return {
    id: stableId(key),
    title: cleanHtml(title),
    event_type: type,
    organizer_name: sourceName,
    summary: summary || `${venue || sourceName}에서 진행되는 ${type} 프로그램입니다. 자세한 일정과 이용 정보는 공식 출처에서 확인할 수 있습니다.`,
    start_date: start,
    end_date: end || start,
    venue_name: venue || sourceName,
    sido: '서울특별시',
    sigungu: sigungu || inferSeoulGu(venue),
    address_detail: null,
    opening_hours: null,
    price_text: null,
    reservation_url: null,
    official_url: sourceUrl,
    image_url: null,
    interests: interestsFor(type, title),
    status: 'approved',
    source_name: sourceName,
    ai_collected: false,
    created_at: new Date().toISOString()
  };
}

function validLive(event) {
  if (!event?.title || !event?.start_date) return false;
  const today = todayIso();
  const horizon = plusDaysIso(100);
  const end = event.end_date || event.start_date;
  return end >= today && event.start_date <= horizon && !isOutsideSeoulVenue(event.venue_name) && !/교육|아카데미|워크숍|강좌|모집/.test(event.title);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TodaysDiscovery/1.2; +https://todays-discovery.vercel.app)',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseSacRows(html) {
  const events = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRe.exec(row[1]))) cells.push(cleanHtml(cell[1]));
    if (cells.length < 2) continue;

    const dateIndex = cells.findIndex(v => /20\d{2}\.\d{2}\.\d{2}/.test(v));
    if (dateIndex < 1) continue;

    const title = cells.slice(0, dateIndex).filter(Boolean).pop();
    const dateText = cells[dateIndex];
    const venue = cells[dateIndex + 1] || '예술의전당';
    if (!title || /행사명|기간|장소/.test(title)) continue;

    const dates = [...dateText.matchAll(/(20\d{2})\.(\d{2})\.(\d{2})/g)];
    if (!dates.length) continue;
    const start = iso(dates[0][1], dates[0][2], dates[0][3]);
    const last = dates[dates.length - 1];
    const end = iso(last[1], last[2], last[3]);

    const event = makeEvent({
      title,
      start,
      end,
      venue,
      sourceName: SOURCES.sac.name,
      sourceUrl: SOURCES.sac.url,
      extra: cells.join(' ')
    });
    if (validLive(event)) events.push(event);
  }
  return events;
}

function parseGenericCards(html, sourceName, sourceUrl, defaultVenue) {
  const events = [];
  const blocks = [];
  const tags = ['li', 'article'];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let m;
    while ((m = re.exec(html))) blocks.push(cleanHtml(m[1]));
  }

  for (const text of blocks) {
    const dm = text.match(/(20\d{2})[.\-/](\d{2})[.\-/](\d{2})\s*(?:-|~|–)\s*(20\d{2})[.\-/](\d{2})[.\-/](\d{2})/);
    if (!dm) continue;
    const start = iso(dm[1], dm[2], dm[3]);
    const end = iso(dm[4], dm[5], dm[6]);
    let before = text.slice(0, dm.index).replace(/Image|이미지|예매|상세|공연·전시·강좌/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!before) continue;
    const parts = before.split(/\s{2,}|\|/).filter(Boolean);
    let title = parts[parts.length - 1] || before;
    if (title.length > 120) title = title.slice(-120).replace(/^.*?(?=[가-힣A-Za-z0-9<《〈])/u, '');
    title = title.trim();
    if (title.length < 2 || /전체|검색|이전|다음/.test(title)) continue;

    const after = text.slice((dm.index || 0) + dm[0].length, (dm.index || 0) + dm[0].length + 60);
    const event = makeEvent({
      title,
      start,
      end,
      venue: defaultVenue,
      sourceName,
      sourceUrl,
      extra: after
    });
    if (validLive(event)) events.push(event);
  }
  return events;
}

function discoverPopupUrl(html) {
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const candidates = [];
  let m;
  while ((m = linkRe.exec(html))) {
    const text = cleanHtml(m[2]);
    if (!/팝업\s*다이어리|POP.?UP\s*DIARY/i.test(text)) continue;
    let href = decodeEntities(m[1]);
    if (href.startsWith('/')) href = `https://www.ehyundai.com${href}`;
    else if (!/^https?:/i.test(href)) href = `https://www.ehyundai.com/newPortal/NS/${href.replace(/^\.\//, '')}`;
    candidates.push(href);
  }
  return candidates[0] || SOURCES.hyundaiFallback.url;
}

function parseHyundaiPopups(html, sourceUrl) {
  const events = [];
  const year = Number(todayIso().slice(0, 4));
  const blocks = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li;
  while ((li = liRe.exec(html))) blocks.push(cleanHtml(li[1]));
  blocks.push(cleanHtml(html));

  const locationRe = '(더현대\\s*서울|더현대서울|무역센터점?|미아점?|판교점?|목동점?|신촌점?|디큐브시티|천호점?|중동점?|킨텍스점?)';
  const re = new RegExp(`${locationRe}\\s*\\((\\d{1,2})\\/(\\d{1,2})\\s*~\\s*(\\d{1,2})\\/(\\d{1,2})\\)\\s*[:：]?\\s*([^•|]{2,70})`, 'gi');

  for (const block of blocks) {
    let m;
    while ((m = re.exec(block))) {
      const venue = m[1].replace(/더현대서울/, '더현대 서울');
      const sm = Number(m[2]), sd = Number(m[3]), em = Number(m[4]), ed = Number(m[5]);
      const endYear = em < sm ? year + 1 : year;
      const start = iso(year, sm, sd);
      const end = iso(endYear, em, ed);
      let title = m[6]
        .replace(/자세히\s*보기.*$/i, '')
        .replace(/\bImage\b.*$/i, '')
        .replace(/\s+(더현대\s*서울|무역센터|미아|판교|목동|신촌|천호).*$/i, '')
        .trim();
      if (title.length > 45) title = title.slice(0, 45).trim();
      if (!title || /팝업\s*다이어리|카테고리|캘린더/.test(title)) continue;
      const event = makeEvent({
        title,
        start,
        end,
        venue,
        sourceName: SOURCES.hyundaiFallback.name,
        sourceUrl,
        eventType: '팝업',
        summary: `${venue}에서 운영되는 팝업 또는 브랜드 이벤트입니다. 세부 운영시간과 변경 사항은 현대백화점 공식 팝업 다이어리에서 확인할 수 있습니다.`
      });
      if (validLive(event)) events.push(event);
    }
  }
  return events;
}

function dedupe(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.title.toLowerCase()}|${e.start_date}|${e.venue_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectBalanced(events) {
  const sorted = dedupe(events).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
  const popup = sorted.filter(e => e.event_type === '팝업').slice(0, 8);
  const exhibitions = sorted.filter(e => e.event_type === '전시').slice(0, 10);
  const performances = sorted.filter(e => !['팝업', '전시'].includes(e.event_type)).slice(0, 28);
  const selected = dedupe([...popup, ...exhibitions, ...performances]).sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (selected.length < 36) {
    for (const e of sorted) {
      if (selected.some(x => x.id === e.id)) continue;
      selected.push(e);
      if (selected.length >= 42) break;
    }
  }
  return selected.slice(0, 42);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const errors = [];
  let events = [];

  const [sacResult, sejongResult, popupListResult] = await Promise.allSettled([
    fetchHtml(SOURCES.sac.url),
    fetchHtml(SOURCES.sejong.url),
    fetchHtml(SOURCES.hyundaiList.url)
  ]);

  if (sacResult.status === 'fulfilled') {
    events.push(...parseSacRows(sacResult.value));
  } else {
    errors.push(`예술의전당: ${sacResult.reason?.message || 'fetch failed'}`);
  }

  if (sejongResult.status === 'fulfilled') {
    events.push(...parseGenericCards(sejongResult.value, SOURCES.sejong.name, SOURCES.sejong.url, '세종문화회관'));
  } else {
    errors.push(`세종문화회관: ${sejongResult.reason?.message || 'fetch failed'}`);
  }

  let popupUrl = SOURCES.hyundaiFallback.url;
  if (popupListResult.status === 'fulfilled') popupUrl = discoverPopupUrl(popupListResult.value);
  try {
    const popupHtml = await fetchHtml(popupUrl);
    events.push(...parseHyundaiPopups(popupHtml, popupUrl));
  } catch (error) {
    errors.push(`현대백화점: ${error.message}`);
  }

  const selected = selectBalanced(events);
  return res.status(200).json({
    ok: selected.length > 0,
    generated_at: new Date().toISOString(),
    count: selected.length,
    sources: [...new Set(selected.map(e => e.source_name))],
    events: selected,
    errors
  });
}
