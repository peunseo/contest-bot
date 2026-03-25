const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Discord 웹훅은 코드에 하드코딩하지 않고 환경변수로만 받습니다.
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
// GitHub Pages가 읽을 최신 데이터 파일 경로입니다.
const OUTPUT_PATH = path.join(__dirname, "docs", "data", "latest.json");

// =======================
// 날짜
// =======================
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}

function getIsoNow() {
  return new Date().toISOString();
}

function extractDeadline(text) {
  const s = cleanText(text);

  const korRange = s.match(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?\s*[~\-]\s*(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일?/);
  if (korRange) {
    return korRange[0]
      .replace(/\s*년\s*/g, "-")
      .replace(/\s*월\s*/g, "-")
      .replace(/\s*일\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const fullRange = s.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}\s*[~\-]\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}/);
  if (fullRange) return fullRange[0];

  const shortRange = s.match(/\d{1,2}[./-]\d{1,2}\s*[~\-]\s*\d{1,2}[./-]\d{1,2}/);
  if (shortRange) return shortRange[0];

  const labeled = s.match(/(?:마감|마감일|접수마감)\s*[:：]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})/);
  if (labeled) return labeled[1];

  return "기간 정보 없음";
}

function extractUploadDate(text) {
  const s = cleanText(text);
  const withYear = s.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/);
  if (withYear) {
    const m = withYear[0].match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (m) return `${m[1]}.${String(m[2]).padStart(2, "0")}.${String(m[3]).padStart(2, "0")}`;
  }

  const short = s.match(/\d{1,2}[./-]\d{1,2}/);
  if (short) {
    const m = short[0].match(/(\d{1,2})[./-](\d{1,2})/);
    if (m) return `${String(m[1]).padStart(2, "0")}.${String(m[2]).padStart(2, "0")}`;
  }

  return "";
}

async function fetchWithRetry(url, config = {}, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      lastError = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw lastError;
}

function parseDateValue(value, fallbackYear) {
  if (!value) return null;

  const normalized = String(value)
    .trim()
    .replace(/\./g, "-")
    .replace(/\//g, "-");

  const withYear = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (withYear) {
    const y = Number(withYear[1]);
    const m = Number(withYear[2]);
    const d = Number(withYear[3]);
    return new Date(y, m - 1, d);
  }

  const short = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (short) {
    const y = fallbackYear;
    const m = Number(short[1]);
    const d = Number(short[2]);
    return new Date(y, m - 1, d);
  }

  return null;
}

function getPeriodRange(deadlineText) {
  const text = cleanText(deadlineText || "");
  const today = new Date();
  const currentYear = today.getFullYear();

  const fullRange = text.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*[~\-]\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
  if (fullRange) {
    return {
      start: parseDateValue(fullRange[1], currentYear),
      end: parseDateValue(fullRange[2], currentYear)
    };
  }

  const shortRange = text.match(/(\d{1,2}[./-]\d{1,2})\s*[~\-]\s*(\d{1,2}[./-]\d{1,2})/);
  if (shortRange) {
    const start = parseDateValue(shortRange[1], currentYear);
    let end = parseDateValue(shortRange[2], currentYear);
    if (start && end && end < start) {
      end = new Date(currentYear + 1, end.getMonth(), end.getDate());
    }
    return { start, end };
  }

  const single = text.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})/);
  if (single) {
    const d = parseDateValue(single[1], currentYear);
    return { start: d, end: d };
  }

  return { start: null, end: null };
}

function filterActiveOrUpcoming(list) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return list.filter((item) => {
    const { start, end } = getPeriodRange(item.deadline);

    // 기간을 파싱할 수 없는 항목은 접수 상태를 판별할 수 없어 제외합니다.
    if (!start && !end) return false;

    // 접수중(start <= today <= end) 또는 접수예정(today < start)만 유지합니다.
    if (start && end) return today <= end;
    if (!start && end) return today <= end;
    if (start && !end) return today <= start;
    return false;
  });
}

// 줄바꿈/중복 공백을 줄여 카드 UI에서 읽기 쉽게 정리합니다.
function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

// href가 없거나 잘못된 경우 빈 문자열을 반환해 후처리에서 제외합니다.
function safeAbsolute(base, href) {
  if (!href || href === "undefined") return "";
  if (/^https?:\/\//i.test(href)) return href;
  return `${base}${href}`;
}

// =======================
// 1. 위비티
// =======================
async function scrapeWevity() {
  const url = "https://www.wevity.com/?c=find&s=1&gub=1";
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
  const $ = cheerio.load(data);

  const results = [];

  $(".list li").each((i, el) => {
    const title = cleanText($(el).find(".tit").text());
    const link = safeAbsolute("https://www.wevity.com", $(el).find("a").attr("href"));
    const text = $(el).text();

    const deadline = extractDeadline(text);
    const uploadDate = extractUploadDate(text);

    if (title && link) results.push({ title, link, deadline, uploadDate });
  });

  // 목록 텍스트에 마감일이 없을 때 상세 페이지 본문에서 한 번 더 보강합니다.
  for (const item of results) {
    if (item.deadline !== "기간 정보 없음") continue;

    try {
      const detail = await fetchWithRetry(item.link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000
      }, 2);
      const detailText = cleanText(cheerio.load(detail.data).text());
      const enrichedDeadline = extractDeadline(detailText);
      const enrichedUploadDate = extractUploadDate(detailText);

      if (enrichedDeadline !== "기간 정보 없음") item.deadline = enrichedDeadline;
      if (enrichedUploadDate) item.uploadDate = enrichedUploadDate;
    } catch (_) {
      item.deadline = "기간 정보 없음";
    }
  }

  return results.map((item) => ({ ...item, source: "wevity" }));
}

// =======================
// 2. 씽굿
// =======================
async function scrapeThinkgood() {
  const url = "https://www.thinkcontest.com/thinkgood/user/contest/index.do";
  const { data } = await axios.post(url, null, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.thinkcontest.com/"
    }
  });
  const $ = cheerio.load(data);

  const results = [];

  // 씽굿은 목록을 JS로 렌더링하므로 JSON-LD(ItemList) 블록에서 링크/제목을 추출합니다.
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of arr) {
        if (!obj || obj["@type"] !== "ItemList" || !Array.isArray(obj.itemListElement)) continue;

        for (const item of obj.itemListElement) {
          const title = cleanText(item?.name);
          const link = safeAbsolute("https://www.thinkcontest.com", item?.url || "");
          if (title && link.includes("contest/view.do")) {
            results.push({ title, link, deadline: "기간 정보 없음", uploadDate: "" });
          }
        }
      }
    } catch (_) {
      // JSON 파싱 실패는 무시하고 다음 블록을 시도합니다.
    }
  });

  // 씽굿 상세 페이지에서 실제 접수기간/마감일을 보강합니다.
  for (const item of results) {
    try {
      const detail = await fetchWithRetry(item.link, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.thinkcontest.com/"
        },
        timeout: 8000
      }, 2);
      const detailText = cleanText(cheerio.load(detail.data).text());
      const enrichedDeadline = extractDeadline(detailText);
      const enrichedUploadDate = extractUploadDate(detailText);

      if (enrichedDeadline !== "기간 정보 없음") item.deadline = enrichedDeadline;
      if (enrichedUploadDate) item.uploadDate = enrichedUploadDate;
    } catch (_) {
      item.deadline = "기간 정보 없음";
    }
  }

  return results.map((item) => ({ ...item, source: "thinkcontest" }));
}

// =======================
// 통합
// =======================
async function getAllContests() {
  // 한 사이트가 실패해도 전체 수집은 계속 진행하기 위해 allSettled를 사용합니다.
  const jobs = [
    ["wevity", scrapeWevity()],
    ["thinkcontest", scrapeThinkgood()]
  ];
  const settled = await Promise.allSettled(jobs.map(([, p]) => p));

  const results = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = settled
    .map((r, i) => ({ source: jobs[i][0], result: r }))
    .filter((x) => x.result.status === "rejected");

  if (failed.length > 0) {
    console.warn(`⚠ 일부 사이트 수집 실패: ${failed.length}개`);
    for (const f of failed) {
      const reason = f.result.reason?.message || String(f.result.reason);
      console.warn(`  - ${f.source}: ${reason}`);
    }
  }

  return results.flat();
}

// =======================
// 오늘 필터
// =======================
function filterToday(list) {
  const today = getToday().slice(5);
  return list.filter(c => c.uploadDate.includes(today));
}

function dedupeByTitleAndLink(list) {
  // 제목만으로 중복 제거하면 충돌이 생길 수 있어 제목+링크 조합으로 키를 만듭니다.
  return Array.from(new Map(list.map((c) => [`${c.title}::${c.link}`, c])).values());
}

function buildPayload(allList) {
  const unique = dedupeByTitleAndLink(allList);
  const activeOrUpcoming = filterActiveOrUpcoming(unique);
  const todayList = filterToday(activeOrUpcoming);

  return {
    generatedAt: getIsoNow(),
    today: getToday(),
    counts: {
      total: activeOrUpcoming.length,
      today: todayList.length
    },
    items: activeOrUpcoming,
    todayItems: todayList
  };
}

// =======================
// 포맷
// =======================
function format(todayList, allList) {
  const today = getToday();

  const makeLines = (arr) => arr.map((c, i) => 
`${i+1}. ${c.title}
🔗 ${c.link}
⏰ ${c.deadline}`
  ).join("\n\n");

  if (todayList.length > 0) {
    return `📢 [${today}] 오늘 올라온 공모전\n\n${makeLines(todayList)}`;
  }

  return `📢 [${today}] 오늘의 공모전 업로드 없음

👉 최신 공모전

${makeLines(allList.slice(0,5))}`;
}

function writeJson(payload) {
  // 저장 폴더가 없으면 생성한 뒤 JSON 파일을 갱신합니다.
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
}

// =======================
// 전송
// =======================
async function send(msg) {
  // 웹훅이 없는 환경(로컬 테스트, 공개 저장소 등)에서는 전송을 건너뜁니다.
  if (!WEBHOOK_URL) {
    console.log("ℹ DISCORD_WEBHOOK_URL 미설정: Discord 전송 생략");
    return;
  }

  await axios.post(WEBHOOK_URL, { content: msg });
}

// =======================
// 실행
// =======================
async function run() {
  const all = await getAllContests();
  const payload = buildPayload(all);

  writeJson(payload);

  const msg = format(payload.todayItems, payload.items);
  await send(msg);

  console.log(`✅ 완료: ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error("❌ 실패", err);
  process.exit(1);
});