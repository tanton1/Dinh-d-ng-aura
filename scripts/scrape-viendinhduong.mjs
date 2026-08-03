#!/usr/bin/env node

/**
 * Respectful importer for the two public nutrition lookup tools published by
 * Vietnam's National Institute of Nutrition (Viện Dinh dưỡng Quốc gia).
 *
 * The importer deliberately uses only the public JSON endpoints used by the
 * website itself. It checks robots.txt, rate-limits every request, retries only
 * transient failures, records provenance, and writes atomically.
 *
 * Usage:
 *   node scripts/scrape-viendinhduong.mjs
 *   node scripts/scrape-viendinhduong.mjs --max-pages 1 --out-dir data/sample
 *   NIN_SCRAPER_USER_AGENT="AuraNutritionBot/1.0 (+mailto:data@example.com)" \
 *     node scripts/scrape-viendinhduong.mjs
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = "https://viendinhduong.vn";
const ROBOTS_URL = `${BASE_URL}/robots.txt`;
const PUBLISHER = "Viện Dinh dưỡng Quốc gia";
const DEFAULT_USER_AGENT =
  "AuraNutritionDataImporter/0.1 (respectful public-data client; configure contact with NIN_SCRAPER_USER_AGENT)";

const REGION_BY_ID = {
  "686e102911d18c507e060c09": { nameVi: "Miền Bắc", code: "SFF" },
  "686e101611d18c507e060c08": { nameVi: "Hải Phòng", code: "HAP" },
  "686e0fd611d18c507e060c07": { nameVi: "Hà Nội", code: "HAN" },
  "686e104511d18c507e060c0a": { nameVi: "Chung toàn quốc", code: "VPF" },
};

const SOURCE_CONFIG = {
  dishes: {
    kind: "dish",
    pageUrl: `${BASE_URL}/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-mon-an`,
    apiPath: "/api/fe/tool/getPageFoodData",
    normalize: normalizeDish,
  },
  foods: {
    kind: "food",
    pageUrl: `${BASE_URL}/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-thuc-pham`,
    // `foodNatunal` is the spelling used by the publisher's production bundle.
    apiPath: "/api/fe/foodNatunal/getPageFoodData",
    normalize: normalizeFood,
  },
};

function printHelp() {
  console.log(`Usage: node scripts/scrape-viendinhduong.mjs [options]

Options:
  --out-dir <path>       Output directory (default: data/nutrition)
  --kind <all|dishes|foods>
                         Dataset to import (default: all)
  --page-size <n>        Records requested per API call, 1-200 (default: 100)
  --delay-ms <n>         Minimum delay between requests, >=500 (default: 1250)
  --jitter-ms <n>        Extra random delay, 0-2000 (default: 250)
  --timeout-ms <n>       Per-request timeout, >=5000 (default: 30000)
  --max-retries <n>      Retries for 429/5xx/network errors, 0-8 (default: 4)
  --max-pages <n>        Limit pages per source for a test run (default: all)
  --write-raw            Also write publisher-shaped raw records
  --help                 Show this help

Environment:
  NIN_SCRAPER_USER_AGENT Set a descriptive User-Agent with a real contact for
                         production runs.
`);
}

function parseArgs(argv) {
  const options = {
    outDir: path.resolve("data/nutrition"),
    kind: "all",
    pageSize: 100,
    delayMs: 1250,
    jitterMs: 250,
    timeoutMs: 30_000,
    maxRetries: 4,
    maxPages: Number.POSITIVE_INFINITY,
    writeRaw: false,
    userAgent: process.env.NIN_SCRAPER_USER_AGENT || DEFAULT_USER_AGENT,
  };

  const valueOptions = new Set([
    "--out-dir",
    "--kind",
    "--page-size",
    "--delay-ms",
    "--jitter-ms",
    "--timeout-ms",
    "--max-retries",
    "--max-pages",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--write-raw") {
      options.writeRaw = true;
      continue;
    }
    if (!valueOptions.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    switch (arg) {
      case "--out-dir":
        options.outDir = path.resolve(value);
        break;
      case "--kind":
        options.kind = value;
        break;
      case "--page-size":
        options.pageSize = parseInteger(value, arg);
        break;
      case "--delay-ms":
        options.delayMs = parseInteger(value, arg);
        break;
      case "--jitter-ms":
        options.jitterMs = parseInteger(value, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = parseInteger(value, arg);
        break;
      case "--max-retries":
        options.maxRetries = parseInteger(value, arg);
        break;
      case "--max-pages":
        options.maxPages = parseInteger(value, arg);
        break;
      default:
        break;
    }
  }

  if (!new Set(["all", "dishes", "foods"]).has(options.kind)) {
    throw new Error("--kind must be one of: all, dishes, foods");
  }
  assertRange(options.pageSize, 1, 200, "--page-size");
  assertRange(options.delayMs, 500, 60_000, "--delay-ms");
  assertRange(options.jitterMs, 0, 2_000, "--jitter-ms");
  assertRange(options.timeoutMs, 5_000, 120_000, "--timeout-ms");
  assertRange(options.maxRetries, 0, 8, "--max-retries");
  if (Number.isFinite(options.maxPages)) {
    assertRange(options.maxPages, 1, 100_000, "--max-pages");
  }
  return options;
}

function parseInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function assertRange(value, min, max, label) {
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function absoluteUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

function asciiFold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function slugify(value) {
  return asciiFold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUnit(unit) {
  const raw = String(unit ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "kcal") return "kcal";
  if (lower === "g") return "g";
  if (lower === "mg") return "mg";
  if (["mcg", "μg", "µg", "ug"].includes(lower)) return "µg";
  return raw || null;
}

function canonicalNutrientKey({ sourceKey, nameVi, nameEn }) {
  const tokens = [sourceKey, nameVi, nameEn]
    .map(asciiFold)
    .filter(Boolean);
  const exact = new Set(tokens);
  const combined = tokens.join(" | ");

  if (exact.has("energy") || exact.has("nang-luong")) return "energy";
  if (exact.has("protein") || exact.has("chat-dam")) return "protein";
  if (
    exact.has("lipid") ||
    exact.has("chat-beo") ||
    exact.has("total lipid (fat)") ||
    exact.has("total-lipid-fat")
  ) {
    return "fat";
  }
  if (
    exact.has("glucid") ||
    exact.has("chat-bot-duong") ||
    exact.has("carbohydrate") ||
    exact.has("carbohydrate by difference")
  ) {
    return "carbohydrate";
  }
  if (
    exact.has("xo") ||
    exact.has("chat-xo") ||
    exact.has("chat xo") ||
    exact.has("fiber") ||
    exact.has("dietary fiber") ||
    exact.has("fiber, total dietary") ||
    exact.has("fibre, total dietary") ||
    combined.includes("dietary fibre") ||
    combined.includes("fibre, total dietary")
  ) {
    return "fiber";
  }
  if (exact.has("sugars, total") || exact.has("sugar") || exact.has("duong tong so")) {
    return "sugars_total";
  }
  if (exact.has("natri") || exact.has("sodium") || exact.has("na")) return "sodium";
  if (exact.has("canxi") || exact.has("calcium") || exact.has("ca")) return "calcium";
  if (exact.has("sat") || exact.has("iron") || exact.has("fe")) return "iron";
  if (exact.has("kem") || exact.has("zinc") || exact.has("zn")) return "zinc";
  if (exact.has("kali") || exact.has("potassium") || exact.has("k")) return "potassium";
  if (exact.has("cholesterol")) return "cholesterol";
  if (exact.has("magie") || exact.has("magnesium") || exact.has("mg")) return "magnesium";
  return slugify(sourceKey || nameEn || nameVi) || "unknown";
}

function normalizeEquivalents(equivalents) {
  if (!Array.isArray(equivalents)) return [];
  return equivalents.map((item) => ({
    key: slugify(item.key || item.nameEn || item.name) || "unknown",
    nameVi: item.name || null,
    nameEn: item.nameEn || null,
    value: asNumber(item.amount),
    unit: normalizeUnit(item.unit_name),
  }));
}

function normalizeDishNutrients(rawNutrients) {
  if (!Array.isArray(rawNutrients)) return [];
  return rawNutrients.map((item) => {
    const sourceKey = item.key || slugify(item.nameEn || item.name);
    return {
      key: canonicalNutrientKey({
        sourceKey,
        nameVi: item.name,
        nameEn: item.nameEn,
      }),
      sourceKey,
      nameVi: item.name || null,
      nameEn: item.nameEn || null,
      value: asNumber(item.amount),
      unit: normalizeUnit(item.unit_name),
      equivalents: normalizeEquivalents(item.equivalenceComponents),
    };
  });
}

function normalizeFoodNutrients(record) {
  const rawNutrients = Array.isArray(record.nutrition) ? record.nutrition : [];
  const nutrients = rawNutrients.map((item) => {
    const sourceKey = slugify(item.name_en || item.name);
    return {
      key: canonicalNutrientKey({
        sourceKey,
        nameVi: item.name,
        nameEn: item.name_en,
      }),
      sourceKey,
      nameVi: item.name || null,
      nameEn: item.name_en || null,
      value: asNumber(item.value),
      unit: normalizeUnit(item.unit),
      equivalents: [],
    };
  });

  if (!nutrients.some((item) => item.key === "energy")) {
    nutrients.unshift({
      key: "energy",
      sourceKey: "energy",
      nameVi: "Năng lượng",
      nameEn: "Energy",
      value: asNumber(record.energy),
      unit: "kcal",
      equivalents: [],
    });
  }
  return nutrients;
}

function provenance(config, record, fetchedAt) {
  return {
    publisher: PUBLISHER,
    pageUrl: config.pageUrl,
    apiUrl: new URL(config.apiPath, BASE_URL).toString(),
    sourceId: String(record._id ?? ""),
    sourceUpdatedAt: record.updated_at || null,
    fetchedAt,
    rawRecordSha256: sha256(JSON.stringify(record)),
  };
}

function normalizeDish(record, config, fetchedAt) {
  const sourceId = String(record._id ?? "");
  const region = REGION_BY_ID[record.food_area_id] || null;
  return {
    id: `nin:dish:${sourceId}`,
    kind: "dish",
    code: String(record.code ?? ""),
    nameVi: record.name_vi || null,
    nameEn: record.name_en || null,
    nameAscii: record.name_vi_ascii || asciiFold(record.name_vi),
    category: {
      id: record.category_id || null,
      nameVi: record.category_name || null,
      nameEn: record.category_name_en || null,
    },
    region: record.food_area_id
      ? {
          id: record.food_area_id,
          nameVi: region?.nameVi || null,
          code: region?.code || null,
        }
      : null,
    basis: {
      amount: null,
      unit: null,
      qualifier: "not_specified_by_source",
      labelVi: "Trang nguồn không nêu rõ khẩu phần chuẩn",
    },
    energyKcal: asNumber(record.total_energy),
    nutrients: normalizeDishNutrients(record.nutritional_components),
    recipeComponents: Array.isArray(record.dish_components) ? record.dish_components : [],
    imageUrl: absoluteUrl(record.image),
    description: record.description || null,
    source: provenance(config, record, fetchedAt),
  };
}

function normalizeFood(record, config, fetchedAt) {
  const sourceId = String(record._id ?? "");
  return {
    id: `nin:food:${sourceId}`,
    kind: "food",
    code: String(record.code ?? ""),
    nameVi: record.name_vi || null,
    nameEn: record.name_en || null,
    nameAscii: asciiFold(record.name_vi),
    category: {
      id: null,
      nameVi: record.category || null,
      nameEn: record.categoryEn || null,
    },
    region: null,
    basis: {
      amount: 100,
      unit: "g",
      qualifier: "edible_raw_fresh",
      labelVi: "100 g phần ăn được, sống/sạch",
    },
    energyKcal: asNumber(record.energy),
    nutrients: normalizeFoodNutrients(record),
    recipeComponents: [],
    imageUrl: null,
    description: null,
    source: provenance(config, record, fetchedAt),
  };
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

class RespectfulHttpClient {
  constructor(options) {
    this.delayMs = options.delayMs;
    this.jitterMs = options.jitterMs;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.userAgent = options.userAgent;
    this.lastRequestStartedAt = 0;
  }

  async waitForRateLimit() {
    const randomJitter = Math.floor(Math.random() * (this.jitterMs + 1));
    const earliest = this.lastRequestStartedAt + this.delayMs + randomJitter;
    const waitMs = earliest - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestStartedAt = Date.now();
  }

  async request(url, accept) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRateLimit();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          headers: {
            Accept: accept,
            "User-Agent": this.userAgent,
          },
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) return response;
        const transient = response.status === 429 || response.status >= 500;
        const bodyPreview = (await response.text()).slice(0, 300);
        if (!transient || attempt === this.maxRetries) {
          throw new Error(
            `HTTP ${response.status} for ${url}${bodyPreview ? `: ${bodyPreview}` : ""}`,
          );
        }
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const backoffMs = retryAfterMs ?? Math.min(30_000, 750 * 2 ** attempt);
        console.warn(
          `[retry ${attempt + 1}/${this.maxRetries}] HTTP ${response.status}; waiting ${backoffMs} ms`,
        );
        await sleep(backoffMs);
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        const isHttpError = String(error?.message || "").startsWith("HTTP ");
        if (isHttpError || attempt === this.maxRetries) throw error;
        const backoffMs = Math.min(30_000, 750 * 2 ** attempt);
        console.warn(
          `[retry ${attempt + 1}/${this.maxRetries}] ${error.message}; waiting ${backoffMs} ms`,
        );
        await sleep(backoffMs);
      }
    }
    throw lastError || new Error(`Request failed: ${url}`);
  }

  async text(url) {
    const response = await this.request(url, "text/plain,text/html;q=0.9,*/*;q=0.1");
    return {
      body: await response.text(),
      status: response.status,
      contentType: response.headers.get("content-type"),
    };
  }

  async json(url) {
    const response = await this.request(url, "application/json");
    const body = await response.text();
    try {
      return {
        data: JSON.parse(body),
        status: response.status,
        contentType: response.headers.get("content-type"),
      };
    } catch (error) {
      throw new Error(`Invalid JSON from ${url}: ${error.message}`);
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function robotsPattern(pattern) {
  const endsAtPath = pattern.endsWith("$");
  const withoutEnd = endsAtPath ? pattern.slice(0, -1) : pattern;
  const regex = escapeRegex(withoutEnd).replace(/\\\*/g, ".*");
  return new RegExp(`^${regex}${endsAtPath ? "$" : ""}`);
}

function parseRobots(text) {
  const groups = [];
  let agents = [];
  let rules = [];

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (rules.length > 0) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length > 0) {
      rules.push({ type: field, path: value });
    }
  }
  flush();
  return groups;
}

function allowedByRobots(groups, userAgent, targetUrl) {
  const ua = userAgent.toLowerCase();
  const exactGroups = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && ua.includes(agent)),
  );
  const applicable =
    exactGroups.length > 0
      ? exactGroups
      : groups.filter((group) => group.agents.includes("*"));
  const pathAndQuery = `${targetUrl.pathname}${targetUrl.search}`;
  const matches = applicable
    .flatMap((group) => group.rules)
    .filter((rule) => rule.path && robotsPattern(rule.path).test(pathAndQuery))
    .sort((a, b) => b.path.length - a.path.length || (a.type === "allow" ? -1 : 1));
  return matches.length === 0 || matches[0].type === "allow";
}

async function verifyRobots(client, configs, fetchedAt) {
  const response = await client.text(ROBOTS_URL);
  const groups = parseRobots(response.body);
  const targets = configs.flatMap((config) => [
    config.pageUrl,
    new URL(config.apiPath, BASE_URL).toString(),
  ]);
  const decisions = targets.map((url) => ({
    url,
    allowed: allowedByRobots(groups, client.userAgent, new URL(url)),
  }));
  const blocked = decisions.filter((item) => !item.allowed);
  if (blocked.length > 0) {
    throw new Error(
      `robots.txt does not permit: ${blocked.map((item) => item.url).join(", ")}`,
    );
  }
  return {
    url: ROBOTS_URL,
    fetchedAt,
    sha256: sha256(response.body),
    decisions,
    notice:
      "robots.txt allowed these paths when the import ran. Re-check before each future import.",
  };
}

async function fetchSource(client, config, options, fetchedAt) {
  const recordsById = new Map();
  const rawRecordsById = new Map();
  const pageResponses = [];
  let page = 1;
  let expectedTotal = null;
  let expectedLastPage = null;
  let truncated = false;

  while (page <= options.maxPages) {
    const url = new URL(config.apiPath, BASE_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(options.pageSize));
    console.log(`[${config.kind}] page ${page}: ${url}`);
    const response = await client.json(url);
    const payload = response.data;
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error(`Unexpected ${config.kind} response shape on page ${page}`);
    }

    const responseTotal = asNumber(payload.total);
    if (responseTotal === null) {
      throw new Error(`Missing total in ${config.kind} response on page ${page}`);
    }
    if (expectedTotal === null) expectedTotal = responseTotal;
    if (responseTotal !== expectedTotal) {
      console.warn(
        `[${config.kind}] source total changed during import: ${expectedTotal} -> ${responseTotal}`,
      );
      expectedTotal = responseTotal;
    }

    const responsePerPage = asNumber(payload.per_page) || options.pageSize;
    expectedLastPage =
      asNumber(payload.last_page) || Math.max(1, Math.ceil(expectedTotal / responsePerPage));
    pageResponses.push({
      page,
      count: payload.data.length,
      total: responseTotal,
      perPage: responsePerPage,
      status: response.status,
      contentType: response.contentType,
    });

    for (const rawRecord of payload.data) {
      const sourceId = String(rawRecord?._id ?? "");
      if (!sourceId) throw new Error(`${config.kind} record is missing _id on page ${page}`);
      rawRecordsById.set(sourceId, rawRecord);
      recordsById.set(sourceId, config.normalize(rawRecord, config, fetchedAt));
    }

    if (payload.data.length === 0 || page >= expectedLastPage || recordsById.size >= expectedTotal) {
      break;
    }
    page += 1;
  }

  if (page < expectedLastPage && page >= options.maxPages) truncated = true;
  if (!truncated && recordsById.size !== expectedTotal) {
    throw new Error(
      `${config.kind} completeness check failed: received ${recordsById.size}, source reported ${expectedTotal}`,
    );
  }

  return {
    records: [...recordsById.values()],
    rawRecords: [...rawRecordsById.values()],
    summary: {
      kind: config.kind,
      pageUrl: config.pageUrl,
      apiUrl: new URL(config.apiPath, BASE_URL).toString(),
      fetchedPages: pageResponses.length,
      fetchedRecords: recordsById.size,
      sourceReportedTotal: expectedTotal,
      truncated,
      responses: pageResponses,
    },
  };
}

function nutrientValue(record, key) {
  const nutrient = record.nutrients.find((item) => item.key === key);
  return nutrient?.value ?? null;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const string = typeof value === "string" ? value : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function recordsToCsv(records) {
  const columns = [
    "id",
    "kind",
    "code",
    "name_vi",
    "name_en",
    "name_ascii",
    "category_id",
    "category_vi",
    "category_en",
    "region_id",
    "region_vi",
    "region_code",
    "basis_amount",
    "basis_unit",
    "basis_qualifier",
    "energy_kcal",
    "protein_g",
    "fat_g",
    "carbohydrate_g",
    "fiber_g",
    "sugars_total_g",
    "sodium_mg",
    "image_url",
    "source_id",
    "source_page_url",
    "source_api_url",
    "source_updated_at",
    "fetched_at",
    "raw_record_sha256",
    "nutrients_json",
  ];

  const lines = [columns.join(",")];
  for (const record of records) {
    const row = [
      record.id,
      record.kind,
      record.code,
      record.nameVi,
      record.nameEn,
      record.nameAscii,
      record.category.id,
      record.category.nameVi,
      record.category.nameEn,
      record.region?.id,
      record.region?.nameVi,
      record.region?.code,
      record.basis.amount,
      record.basis.unit,
      record.basis.qualifier,
      record.energyKcal,
      nutrientValue(record, "protein"),
      nutrientValue(record, "fat"),
      nutrientValue(record, "carbohydrate"),
      nutrientValue(record, "fiber"),
      nutrientValue(record, "sugars_total"),
      nutrientValue(record, "sodium"),
      record.imageUrl,
      record.source.sourceId,
      record.source.pageUrl,
      record.source.apiUrl,
      record.source.sourceUpdatedAt,
      record.source.fetchedAt,
      record.source.rawRecordSha256,
      JSON.stringify(record.nutrients),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function recordSort(a, b) {
  return (
    a.kind.localeCompare(b.kind) ||
    a.code.localeCompare(b.code, "vi", { numeric: true }) ||
    String(a.nameVi).localeCompare(String(b.nameVi), "vi")
  );
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, "utf8");
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await rm(filePath, { force: true });
    await rename(temporaryPath, filePath);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedKeys =
    options.kind === "all" ? ["dishes", "foods"] : [options.kind];
  const configs = selectedKeys.map((key) => SOURCE_CONFIG[key]);
  const fetchedAt = new Date().toISOString();
  const client = new RespectfulHttpClient(options);

  if (options.userAgent === DEFAULT_USER_AGENT) {
    console.warn(
      "Warning: set NIN_SCRAPER_USER_AGENT to include a real operator contact before scheduled/production runs.",
    );
  }

  console.log(`Checking ${ROBOTS_URL}`);
  const robots = await verifyRobots(client, configs, fetchedAt);
  console.log("robots.txt permits the requested page and API paths.");

  const results = [];
  for (const config of configs) {
    results.push(await fetchSource(client, config, options, fetchedAt));
  }

  const records = results.flatMap((result) => result.records).sort(recordSort);
  const ids = new Set(records.map((record) => record.id));
  if (ids.size !== records.length) {
    throw new Error(`Duplicate normalized IDs: ${records.length - ids.size}`);
  }

  const dataset = {
    schemaVersion: "1.0.0",
    generatedAt: fetchedAt,
    publisher: PUBLISHER,
    recordCount: records.length,
    records,
  };
  const jsonContents = `${JSON.stringify(dataset)}\n`;
  const csvContents = recordsToCsv(records);

  await mkdir(options.outDir, { recursive: true });
  const jsonPath = path.join(options.outDir, "viendinhduong.records.json");
  const csvPath = path.join(options.outDir, "viendinhduong.records.csv");
  await atomicWrite(jsonPath, jsonContents);
  await atomicWrite(csvPath, csvContents);

  const outputFiles = {
    json: {
      path: path.relative(process.cwd(), jsonPath).replace(/\\/g, "/"),
      bytes: Buffer.byteLength(jsonContents),
      sha256: sha256(jsonContents),
    },
    csv: {
      path: path.relative(process.cwd(), csvPath).replace(/\\/g, "/"),
      bytes: Buffer.byteLength(csvContents),
      sha256: sha256(csvContents),
    },
  };

  if (options.writeRaw) {
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const config = configs[index];
      const rawPath = path.join(
        options.outDir,
        `viendinhduong.${config.kind}.raw.json`,
      );
      const rawContents = `${JSON.stringify({
        fetchedAt,
        pageUrl: config.pageUrl,
        apiUrl: new URL(config.apiPath, BASE_URL).toString(),
        recordCount: result.rawRecords.length,
        records: result.rawRecords,
      })}\n`;
      await atomicWrite(rawPath, rawContents);
      outputFiles[`${config.kind}Raw`] = {
        path: path.relative(process.cwd(), rawPath).replace(/\\/g, "/"),
        bytes: Buffer.byteLength(rawContents),
        sha256: sha256(rawContents),
      };
    }
  }

  const counts = Object.fromEntries(
    configs.map((config) => [
      config.kind,
      records.filter((record) => record.kind === config.kind).length,
    ]),
  );
  const manifest = {
    schemaVersion: "1.0.0",
    generatedAt: fetchedAt,
    publisher: PUBLISHER,
    importer: {
      script: "scripts/scrape-viendinhduong.mjs",
      userAgent: options.userAgent,
      pageSize: options.pageSize,
      minimumDelayMs: options.delayMs,
      jitterMs: options.jitterMs,
      maxRetries: options.maxRetries,
    },
    robots,
    legal: {
      machineReadableLicenseFound: false,
      explicitTermsLinkFoundOnSourcePages: false,
      sourceFooterNotice: "Copyright @ 2025 Bản Quyền Thuộc Viện Dinh Dưỡng Quốc Gia",
      recommendation:
        "Obtain written permission or a confirmed reuse licence before redistributing or using this dataset commercially. Keep attribution and provenance visible.",
    },
    scope: {
      selected: selectedKeys,
      recordCount: records.length,
      counts,
      complete: results.every((result) => !result.summary.truncated),
    },
    sources: results.map((result) => result.summary),
    files: outputFiles,
    interpretationNotes: [
      "Food values are labelled by the publisher as per 100 g edible, raw/fresh.",
      "The dish page does not state a standard mass or serving basis in its visible labels; dish basis is therefore not_specified_by_source.",
      "Blank source nutrient amounts are preserved as null, not zero.",
      "Nutrition values are reference data and are not a medical diagnosis.",
    ],
  };
  const manifestPath = path.join(options.outDir, "viendinhduong.manifest.json");
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Done: ${records.length} records (${JSON.stringify(counts)})`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
