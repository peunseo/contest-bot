const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
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

  const stripDecor = (v) => String(v || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

  const korRange = s.match(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?\s*[~\-]\s*(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일?/);
  if (korRange) {
    return korRange[0]
      .replace(/\s*년\s*/g, "-")
      .replace(/\s*월\s*/g, "-")
      .replace(/\s*일\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const fullRange = s.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?\s*[~\-]\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?/);
  if (fullRange) return stripDecor(fullRange[0]);

  const shortRange = s.match(/\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?\s*[~\-]\s*\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?/);
  if (shortRange) return stripDecor(shortRange[0]);

  const labeled = s.match(/(?:마감|마감일|접수마감)\s*[:：]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})/);
  if (labeled) return stripDecor(labeled[1]);

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

function extractPostedDate(text) {
  const s = cleanText(text);
  const labeled = s.match(/(?:등록일|게시일|작성일|업로드일|게재일)\s*[:：]?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
  if (!labeled) return "";

  const m = labeled[1].match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}.${String(m[2]).padStart(2, "0")}.${String(m[3]).padStart(2, "0")}`;
}

function splitTitleField(text) {
  const s = cleanText(text);
  const parts = s.split(/\s*분야\s*[:：]\s*/);
  const title = cleanText(parts[0].replace(/\s+SPECIAL(?:\s+IDEA)?\s*$/i, ""));
  const field = parts[1] ? cleanText(parts[1]) : "";
  return { title, field };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYmd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "";
  return formatYmd(y, m, d);
}

function parseDateToken(token, fallbackYear) {
  const t = cleanText(String(token || "")).replace(/\([^)]*\)/g, "").trim();
  if (!t) return "";

  const ymd = t.match(/(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/);
  if (ymd) return toIsoDate(ymd[1], ymd[2], ymd[3]);

  const korYmd = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (korYmd) return toIsoDate(korYmd[1], korYmd[2], korYmd[3]);

  const korMd = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (korMd) return toIsoDate(fallbackYear, korMd[1], korMd[2]);

  const md = t.match(/(\d{1,2})\s*[./-]\s*(\d{1,2})/);
  if (md) return toIsoDate(fallbackYear, md[1], md[2]);

  return "";
}

function normalizePeriodYear(startIso, endIso) {
  if (!startIso || !endIso) return { startIso, endIso };

  const sy = Number(startIso.slice(0, 4));
  const sm = Number(startIso.slice(5, 7));
  const ey = Number(endIso.slice(0, 4));
  const em = Number(endIso.slice(5, 7));
  if (!Number.isInteger(sy) || !Number.isInteger(ey)) return { startIso, endIso };

  if (sy === ey && em < sm) {
    const fixedEnd = toIsoDate(ey + 1, endIso.slice(5, 7), endIso.slice(8, 10));
    return { startIso, endIso: fixedEnd || endIso };
  }

  return { startIso, endIso };
}

function extractPeriodRangeFromText(text, fallbackDateText) {
  const s = cleanText(text || "");
  if (!s) return { startDate: "", endDate: "" };

  const fallbackYear = Number(String(fallbackDateText || "").match(/^(\d{4})/)?.[1] || new Date().getFullYear());
  const normalized = s.replace(/[~∼〜－]/g, "~");

  const tryRange = (regex) => {
    const m = normalized.match(regex);
    if (!m) return null;
    const startRaw = m[1];
    const endRaw = m[2];
    const parsedStart = parseDateToken(startRaw, fallbackYear);
    let parsedEnd = parseDateToken(endRaw, fallbackYear);
    if (!parsedStart || !parsedEnd) return null;

    let startIso = parsedStart;
    let endIso = parsedEnd;
    const bothNoYear = !/(\d{4})/.test(startRaw) && !/(\d{4})/.test(endRaw);
    if (bothNoYear) {
      const startDate = new Date(startIso);
      const endDate = new Date(endIso);
      if (endDate < startDate) {
        const shifted = toIsoDate(Number(endIso.slice(0, 4)) + 1, endIso.slice(5, 7), endIso.slice(8, 10));
        if (shifted) endIso = shifted;
      }
    }

    return normalizePeriodYear(startIso, endIso);
  };

  const rangePatterns = [
    /(?:접수|모집|신청|응모|공모)\s*(?:기간|일정)?\s*[:：]?\s*([0-9년월일./()\- ]+?)\s*~\s*([0-9년월일./()\- ]+)/,
    /([0-9]{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?)\s*~\s*([0-9]{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?)/,
    /([0-9]{1,2}[./-]\d{1,2}(?:\([^)]*\))?)\s*~\s*([0-9]{1,2}[./-]\d{1,2}(?:\([^)]*\))?)/,
    /(\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\([^)]*\))?)\s*~\s*(\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\([^)]*\))?)/
  ];

  for (const p of rangePatterns) {
    const hit = tryRange(p);
    if (hit && hit.startIso && hit.endIso) {
      return { startDate: hit.startIso, endDate: hit.endIso };
    }
  }

  const startLabeled = normalized.match(/(?:시작|접수시작|모집시작|신청시작)\s*[:：]?\s*([0-9년월일./()\- ]+)/);
  const endLabeled = normalized.match(/(?:마감|종료|접수마감|신청마감)\s*[:：]?\s*([0-9년월일./()\- ]+)/);
  if (startLabeled || endLabeled) {
    const startDate = parseDateToken(startLabeled?.[1] || "", fallbackYear);
    const endDate = parseDateToken(endLabeled?.[1] || "", fallbackYear);
    if (startDate || endDate) return { startDate, endDate };
  }

  const endOnlyLabeled = normalized.match(/(?:마감|종료|접수마감)\s*[:：]?\s*([0-9년월일./()\- ]+)/);
  if (endOnlyLabeled) {
    const endDate = parseDateToken(endOnlyLabeled[1], fallbackYear);
    if (endDate) return { startDate: "", endDate };
  }

  return { startDate: "", endDate: "" };
}

function composeDeadlineFromHints(startDate, endDate, fallbackDeadline) {
  if (startDate && endDate) return `${startDate} ~ ${endDate}`;
  if (endDate) return endDate;
  return fallbackDeadline || "기간 정보 없음";
}

function normalizeDeadline(deadline, uploadDate) {
  const text = cleanText(deadline || "");
  if (!text || text === "기간 정보 없음") return "기간 정보 없음";

  const yearFromUpload = String(uploadDate || "").match(/^(\d{4})[.-]/)?.[1];
  const fallbackYear = Number(yearFromUpload || new Date().getFullYear());

  const fullToShort = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*[~\-]\s*(\d{1,2})[./-](\d{1,2})$/);
  if (fullToShort) {
    const sy = Number(fullToShort[1]);
    const sm = Number(fullToShort[2]);
    const sd = Number(fullToShort[3]);
    const em = Number(fullToShort[4]);
    const ed = Number(fullToShort[5]);
    const ey = em < sm ? sy + 1 : sy;
    return `${formatYmd(sy, sm, sd)} ~ ${formatYmd(ey, em, ed)}`;
  }

  const shortRange = text.match(/^(\d{1,2})[./-](\d{1,2})\s*[~\-]\s*(\d{1,2})[./-](\d{1,2})$/);
  if (shortRange) {
    const sm = Number(shortRange[1]);
    const sd = Number(shortRange[2]);
    const em = Number(shortRange[3]);
    const ed = Number(shortRange[4]);
    const sy = fallbackYear;
    const ey = em < sm ? sy + 1 : sy;
    return `${formatYmd(sy, sm, sd)} ~ ${formatYmd(ey, em, ed)}`;
  }

  const fullRange = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*[~\-]\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (fullRange) {
    return `${formatYmd(Number(fullRange[1]), Number(fullRange[2]), Number(fullRange[3]))} ~ ${formatYmd(Number(fullRange[4]), Number(fullRange[5]), Number(fullRange[6]))}`;
  }

  const singleFull = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (singleFull) return formatYmd(Number(singleFull[1]), Number(singleFull[2]), Number(singleFull[3]));

  const singleShort = text.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (singleShort) return formatYmd(fallbackYear, Number(singleShort[1]), Number(singleShort[2]));

  return text;
}

function extractCampusPeriod(detailText, endDate) {
  const text = cleanText(detailText || "");

  const fullRange = text.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?)\s*[~\-]\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\([^)]*\))?)/);
  if (fullRange) return normalizeDeadline(`${fullRange[1]} ~ ${fullRange[2]}`, endDate);

  const korMdRange = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\([^)]*\))?\s*[~\-]\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (korMdRange) {
    const em = Number(korMdRange[3]);
    const ed = Number(korMdRange[4]);
    const sm = Number(korMdRange[1]);
    const sd = Number(korMdRange[2]);
    const endYear = Number(String(endDate || "").match(/^(\d{4})/)?.[1] || new Date().getFullYear());
    const startYear = sm > em ? endYear - 1 : endYear;
    return `${formatYmd(startYear, sm, sd)} ~ ${formatYmd(endYear, em, ed)}`;
  }

  const endOnly = normalizeDeadline(endDate, endDate);
  return endOnly;
}

function extractCampusKeyDatesFromHtml(html) {
  const source = String(html || "");
  const start = source.match(/startDate\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i)?.[1] || "";
  const end = source.match(/endDate\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i)?.[1] || "";
  return { startDate: start, endDate: end };
}

function extractKeyDatesFromHtml(html) {
  const source = String(html || "");

  const startPatterns = [
    /startDate\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /applyStart(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /recruitStart(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /receiptStart(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /start[_-]?date\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i
  ];

  const endPatterns = [
    /endDate\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /applyEnd(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /recruitEnd(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /receiptEnd(?:Date)?\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i,
    /end[_-]?date\s*[:=]\s*[\"'](\d{4}-\d{2}-\d{2})[\"']/i
  ];

  let startDate = "";
  let endDate = "";

  for (const p of startPatterns) {
    const hit = source.match(p)?.[1];
    if (hit) {
      startDate = hit;
      break;
    }
  }

  for (const p of endPatterns) {
    const hit = source.match(p)?.[1];
    if (hit) {
      endDate = hit;
      break;
    }
  }

  return { startDate, endDate };
}

function addDaysYmd(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function inferLinkareerDeadline(titleText, cardText) {
  const title = cleanText(titleText || "");
  const card = cleanText(cardText || "");

  const md = title.match(/\(~?\s*(\d{1,2})\/(\d{1,2})\s*\)/);
  if (md) {
    const now = new Date();
    const m = Number(md[1]);
    const d = Number(md[2]);
    let y = now.getFullYear();
    const candidate = new Date(y, m - 1, d);
    if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31)) {
      y += 1;
    }
    return formatYmd(y, m, d);
  }

  const dday = card.match(/D\s*-\s*(\d{1,3})/i);
  if (dday) return addDaysYmd(Number(dday[1]));

  return "기간 정보 없음";
}

function isContestLike(text) {
  return /공모|경진|해커톤|아이디어|챌린지|모집|서포터즈/i.test(String(text || ""));
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
    // 단일 날짜만 확보된 항목은 동일 시작/마감으로 처리해 화면에서 시작일을 명확히 표시합니다.
    return { start: d, end: d };
  }

  return { start: null, end: null };
}

function toYmd(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return "";
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
}

function dateDiffDays(fromDate, toDate) {
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const to = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function enrichPeriodFields(list) {
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return list.map((item) => {
    const hintedStart = parseDateValue(item.startDateHint, new Date().getFullYear());
    const hintedEnd = parseDateValue(item.endDateHint, new Date().getFullYear());
    const parsed = getPeriodRange(item.deadline);
    const start = hintedStart || parsed.start;
    const end = hintedEnd || parsed.end;
    const dday = end ? dateDiffDays(todayOnly, end) : null;
    const isClosed = end ? dday < 0 : false;
    const isUrgent = end ? dday >= 0 && dday <= 7 : false;

    return {
      ...item,
      startDate: toYmd(start),
      endDate: toYmd(end),
      dday,
      isClosed,
      isUrgent
    };
  });
}

function parseUploadDateForSort(uploadDate, deadline) {
  const upload = parseDateValue(uploadDate, new Date().getFullYear());
  if (upload) return upload.getTime();

  const { start, end } = getPeriodRange(deadline);
  if (start) return start.getTime();
  if (end) return end.getTime();
  return 0;
}

function sortByLatest(list) {
  return [...list].sort((a, b) => {
    const aTs = parseUploadDateForSort(a.uploadDate, a.deadline);
    const bTs = parseUploadDateForSort(b.uploadDate, b.deadline);
    if (bTs !== aTs) return bTs - aTs;
    const aOrder = Number.isInteger(a.collectedOrder) ? a.collectedOrder : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isInteger(b.collectedOrder) ? b.collectedOrder : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.title || "").localeCompare(String(b.title || ""), "ko");
  });
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
  const { data } = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    timeout: 10000
  }, 2);
  const $ = cheerio.load(data);

  const results = [];
  const anchors = $("a[href*='ix=']");

  anchors.each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href");
    const link = safeAbsolute("https://www.wevity.com", href);
    if (!link || !/ix=\d+/.test(link)) return;

    const $card = $a.closest("li, tr, .list_box, .inner");
    const rawTitle = cleanText($a.find(".tit").text() || $a.text());
    const parsed = splitTitleField(rawTitle);
    const text = cleanText(($card.length ? $card.text() : $a.text()) || "");

    if (!parsed.title) return;

    const listPeriod = extractPeriodRangeFromText(text, extractUploadDate(text));
    const deadline = composeDeadlineFromHints(
      listPeriod.startDate,
      listPeriod.endDate,
      normalizeDeadline(extractDeadline(text), extractUploadDate(text))
    );
    const uploadDate = extractPostedDate(text);

    results.push({
      title: parsed.title,
      field: parsed.field,
      link,
      deadline,
      uploadDate,
      startDateHint: listPeriod.startDate,
      endDateHint: listPeriod.endDate
    });
  });

  // 위비티는 상세 페이지에 기간 정보가 더 정확한 경우가 많아 항상 보강을 시도합니다.
  for (const item of results) {
    try {
      const detail = await fetchWithRetry(item.link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000
      }, 2);
      const detailHtml = String(detail.data || "");
      const detailText = cleanText(cheerio.load(detailHtml).text());
      const keyDates = extractKeyDatesFromHtml(detailHtml);
      const detailPeriod = extractPeriodRangeFromText(detailText, item.uploadDate || extractUploadDate(detailText));
      const enrichedDeadline = composeDeadlineFromHints(
        keyDates.startDate || detailPeriod.startDate,
        keyDates.endDate || detailPeriod.endDate,
        normalizeDeadline(extractDeadline(detailText), extractUploadDate(detailText))
      );
      const enrichedUploadDate = extractPostedDate(detailText);

      if (keyDates.startDate || detailPeriod.startDate) item.startDateHint = keyDates.startDate || detailPeriod.startDate;
      if (keyDates.endDate || detailPeriod.endDate) item.endDateHint = keyDates.endDate || detailPeriod.endDate;
      if (enrichedDeadline !== "기간 정보 없음") item.deadline = enrichedDeadline;
      if (enrichedUploadDate) item.uploadDate = enrichedUploadDate;
    } catch (_) {
      // 상세 보강 실패는 기존 목록 데이터 유지
    }
  }

  return dedupeByTitleAndLink(results).map((item) => ({ ...item, source: "wevity" }));
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
            results.push({ title, field: "", link, deadline: "기간 정보 없음", uploadDate: "", startDateHint: "", endDateHint: "" });
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
      const detailHtml = String(detail.data || "");
      const detailText = cleanText(cheerio.load(detailHtml).text());
      const keyDates = extractKeyDatesFromHtml(detailHtml);
      const detailPeriod = extractPeriodRangeFromText(detailText, item.uploadDate || extractUploadDate(detailText));
      const enrichedDeadline = composeDeadlineFromHints(
        keyDates.startDate || detailPeriod.startDate,
        keyDates.endDate || detailPeriod.endDate,
        normalizeDeadline(extractDeadline(detailText), extractUploadDate(detailText))
      );
      const enrichedUploadDate = extractPostedDate(detailText);

      if (keyDates.startDate || detailPeriod.startDate) item.startDateHint = keyDates.startDate || detailPeriod.startDate;
      if (keyDates.endDate || detailPeriod.endDate) item.endDateHint = keyDates.endDate || detailPeriod.endDate;
      if (enrichedDeadline !== "기간 정보 없음") item.deadline = enrichedDeadline;
      if (enrichedUploadDate) item.uploadDate = enrichedUploadDate;
    } catch (_) {
      item.deadline = "기간 정보 없음";
    }
  }

  return results.map((item) => ({ ...item, source: "thinkcontest" }));
}

// =======================
// 3. 캠퍼스픽
// =======================
async function scrapeCampuspick() {
  const apiUrl = "https://api2.campuspick.com/find/activity/list";
  const { data } = await axios.get(apiUrl, {
    params: {
      target: 1,
      limit: 40,
      offset: 0
    },
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.campuspick.com/contest"
    }
  });

  const activities = data?.result?.activities || [];

  const results = activities
    .filter((a) => a?.id && a?.title)
    .map((a) => {
      const endHint = a.endDate ? normalizeDeadline(cleanText(a.endDate), cleanText(a.endDate)) : "";
      return {
        title: cleanText(a.title),
        field: "",
        link: `https://www.campuspick.com/contest/view?id=${a.id}`,
        deadline: endHint || "기간 정보 없음",
        uploadDate: "",
        startDateHint: "",
        endDateHint: endHint || ""
      };
    });

  for (const item of results) {
    try {
      const detail = await fetchWithRetry(item.link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000
      }, 1);
      const detailHtml = String(detail.data || "");
      const detailText = cleanText(cheerio.load(detailHtml).text());
      const keyDates = extractCampusKeyDatesFromHtml(detailHtml);
      const detailPeriod = extractPeriodRangeFromText(detailText, item.uploadDate || extractUploadDate(detailText));
      const campusPeriod = extractCampusPeriod(detailText, item.deadline);
      const campusParsed = getPeriodRange(campusPeriod);

      if (keyDates.startDate) item.startDateHint = keyDates.startDate;
      else if (detailPeriod.startDate) item.startDateHint = detailPeriod.startDate;

      if (keyDates.endDate) item.endDateHint = keyDates.endDate;
      else if (detailPeriod.endDate) item.endDateHint = detailPeriod.endDate;

      if (!item.startDateHint && campusParsed.start) item.startDateHint = toYmd(campusParsed.start);
      if (!item.endDateHint && campusParsed.end) item.endDateHint = toYmd(campusParsed.end);
      item.deadline = composeDeadlineFromHints(item.startDateHint, item.endDateHint, campusPeriod);
    } catch (_) {
      item.deadline = normalizeDeadline(item.deadline, item.uploadDate);
    }
  }

  return results.map((item) => ({ ...item, source: "campuspick" }));
}

// =======================
// 4. 링커리어
// =======================
async function scrapeLinkareer() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    });

    await page.goto("https://linkareer.com/list/contest", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(3500);
    await page.waitForFunction(() => {
      const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const titled = Array.from(document.querySelectorAll("a[href*='/activity/']"))
        .filter((a) => clean(a.textContent || "").length > 0);
      return titled.length >= 10;
    }, { timeout: 20000 });

    const rows = await page.evaluate(() => {
      const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const anchors = Array.from(document.querySelectorAll("a[href*='/activity/']"));
      return anchors.map((a) => {
        const href = a.getAttribute("href") || "";
        const title = clean(a.textContent || "");
        const cardText = clean((a.parentElement && a.parentElement.textContent) || title);
        return { href, title, cardText };
      });
    });

    const out = [];
    for (const row of rows) {
      if (!row.href || !row.title) continue;
      if (!isContestLike(row.title)) continue;
      if (!/\/activity\/\d+/.test(row.href)) continue;

      const deadline = inferLinkareerDeadline(row.title, row.cardText);
      out.push({
        title: cleanText(row.title),
        field: "",
        link: safeAbsolute("https://linkareer.com", row.href),
        deadline,
        uploadDate: "",
        startDateHint: "",
        endDateHint: normalizeDeadline(deadline, "")
      });
    }

    return dedupeByTitleAndLink(out)
      .slice(0, 60)
      .map((item) => ({ ...item, source: "linkareer" }));
  } finally {
    await browser.close();
  }
}

async function backfillUnknownPeriods(list) {
  const targets = list
    .filter((item) => item && item.link && item.deadline === "기간 정보 없음")
    .slice(0, 25);

  await Promise.all(targets.map(async (item) => {
    try {
      const detail = await fetchWithRetry(item.link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000
      }, 1);
      const detailHtml = String(detail.data || "");
      const detailText = cleanText(cheerio.load(detailHtml).text());
      const genericKeys = extractKeyDatesFromHtml(detailHtml);
      const campusKeys = item.source === "campuspick" ? extractCampusKeyDatesFromHtml(detailHtml) : { startDate: "", endDate: "" };
      const keyDates = {
        startDate: campusKeys.startDate || genericKeys.startDate,
        endDate: campusKeys.endDate || genericKeys.endDate
      };
      const detailPeriod = extractPeriodRangeFromText(detailText, item.uploadDate || extractUploadDate(detailText));
      let enriched = composeDeadlineFromHints(
        keyDates.startDate || detailPeriod.startDate,
        keyDates.endDate || detailPeriod.endDate,
        normalizeDeadline(extractDeadline(detailText), extractUploadDate(detailText))
      );
      if (item.source === "campuspick") {
        const campus = extractCampusPeriod(detailText, item.deadline);
        enriched = composeDeadlineFromHints(keyDates.startDate || detailPeriod.startDate, keyDates.endDate || detailPeriod.endDate, campus);
      }

      if (keyDates.startDate || detailPeriod.startDate) item.startDateHint = keyDates.startDate || detailPeriod.startDate;
      if (keyDates.endDate || detailPeriod.endDate) item.endDateHint = keyDates.endDate || detailPeriod.endDate;
      if (enriched && enriched !== "기간 정보 없음") item.deadline = enriched;

      const posted = extractPostedDate(detailText);
      if (posted) item.uploadDate = posted;
    } catch (_) {
      // 상세 페이지 보강 실패는 무시하고 기존 데이터를 유지합니다.
    }
  }));

  return list;
}

async function backfillSingleDatePeriods(list) {
  const targets = list
    .filter((item) => item && item.link && item.deadline && item.deadline !== "기간 정보 없음" && !String(item.deadline).includes("~"))
    .slice(0, 30);

  await Promise.all(targets.map(async (item) => {
    try {
      const detail = await fetchWithRetry(item.link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 8000
      }, 1);
      const detailHtml = String(detail.data || "");
      const detailText = cleanText(cheerio.load(detailHtml).text());
      const genericKeys = extractKeyDatesFromHtml(detailHtml);
      const campusKeys = item.source === "campuspick" ? extractCampusKeyDatesFromHtml(detailHtml) : { startDate: "", endDate: "" };
      const keyDates = {
        startDate: campusKeys.startDate || genericKeys.startDate,
        endDate: campusKeys.endDate || genericKeys.endDate
      };
      const detailPeriod = extractPeriodRangeFromText(detailText, item.uploadDate || extractUploadDate(detailText));
      let enriched = composeDeadlineFromHints(
        keyDates.startDate || detailPeriod.startDate,
        keyDates.endDate || detailPeriod.endDate,
        normalizeDeadline(extractDeadline(detailText), extractUploadDate(detailText))
      );

      if (item.source === "campuspick") {
        const campus = extractCampusPeriod(detailText, item.deadline);
        enriched = composeDeadlineFromHints(keyDates.startDate || detailPeriod.startDate, keyDates.endDate || detailPeriod.endDate, campus);
      }

      if (keyDates.startDate || detailPeriod.startDate) item.startDateHint = keyDates.startDate || detailPeriod.startDate;
      if (keyDates.endDate || detailPeriod.endDate) item.endDateHint = keyDates.endDate || detailPeriod.endDate;
      if (enriched && enriched !== "기간 정보 없음") item.deadline = enriched;

      const posted = extractPostedDate(detailText);
      if (posted) item.uploadDate = posted;
    } catch (_) {
      // 상세 보강 실패는 무시합니다.
    }
  }));

  return list;
}

// =======================
// 통합
// =======================
async function getAllContests() {
  // 한 사이트가 실패해도 전체 수집은 계속 진행하기 위해 allSettled를 사용합니다.
  const jobs = [
    ["wevity", scrapeWevity()],
    ["thinkcontest", scrapeThinkgood()],
    ["campuspick", scrapeCampuspick()],
    ["linkareer", scrapeLinkareer()]
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

  const merged = results.flat();
  await backfillUnknownPeriods(merged);
  await backfillSingleDatePeriods(merged);
  merged.forEach((item, idx) => {
    item.collectedOrder = idx;
  });
  return merged;
}

// =======================
// 오늘 필터
// =======================
function filterToday(list) {
  const today = getToday();
  return list.filter((c) => String(c.uploadDate || "") === today);
}

function dedupeByTitleAndLink(list) {
  // 제목만으로 중복 제거하면 충돌이 생길 수 있어 제목+링크 조합으로 키를 만듭니다.
  return Array.from(new Map(list.map((c) => [`${c.title}::${c.link}`, c])).values());
}

function buildPayload(allList) {
  const unique = dedupeByTitleAndLink(allList);
  const enriched = enrichPeriodFields(unique);
  const sorted = sortByLatest(enriched);
  const todayList = filterToday(sorted);

  return {
    generatedAt: getIsoNow(),
    today: getToday(),
    counts: {
      total: sorted.length,
      today: todayList.length
    },
    items: sorted,
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