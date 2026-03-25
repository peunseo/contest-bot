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
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];

  $(".list li").each((i, el) => {
    const title = cleanText($(el).find(".tit").text());
    const link = safeAbsolute("https://www.wevity.com", $(el).find("a").attr("href"));
    const text = $(el).text();

    const deadline = (text.match(/~\s*\d{2}\.\d{2}/) || ["마감일 없음"])[0];
    const uploadDate = (text.match(/\d{2}\.\d{2}/) || [""])[0];

    if (title && link) results.push({ title, link, deadline, uploadDate });
  });

  return results.map((item) => ({ ...item, source: "wevity" }));
}

// =======================
// 2. 씽굿
// =======================
async function scrapeThinkgood() {
  const url = "https://www.thinkcontest.com/Contest/CateField.html";
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];

  $("table tr").each((i, el) => {
    const title = cleanText($(el).find("a").text());
    const link = safeAbsolute("https://www.thinkcontest.com", $(el).find("a").attr("href"));
    const text = $(el).text();

    const deadline = (text.match(/\d{2}\.\d{2}/) || ["마감일 없음"])[0];
    const uploadDate = deadline;

    if (title && link) results.push({ title, link, deadline, uploadDate });
  });

  return results.map((item) => ({ ...item, source: "thinkcontest" }));
}

// =======================
// 3. 올콘
// =======================
async function scrapeAllcon() {
  const url = "https://www.all-con.co.kr/uni_contest";
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);

  const results = [];

  $(".list li").each((i, el) => {
    const title = cleanText($(el).find(".title").text());
    const link = safeAbsolute("https://www.all-con.co.kr", $(el).find("a").attr("href"));
    const text = $(el).text();

    const deadline = (text.match(/\d{2}\.\d{2}/) || ["마감일 없음"])[0];
    const uploadDate = deadline;

    if (title && link) results.push({ title, link, deadline, uploadDate });
  });

  return results.map((item) => ({ ...item, source: "allcon" }));
}

// =======================
// 통합
// =======================
async function getAllContests() {
  // 한 사이트가 실패해도 전체 수집은 계속 진행하기 위해 allSettled를 사용합니다.
  const settled = await Promise.allSettled([
    scrapeWevity(),
    scrapeThinkgood(),
    scrapeAllcon()
  ]);

  const results = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = settled.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`⚠ 일부 사이트 수집 실패: ${failed.length}개`);
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
  const todayList = filterToday(unique);

  return {
    generatedAt: getIsoNow(),
    today: getToday(),
    counts: {
      total: unique.length,
      today: todayList.length
    },
    items: unique,
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