#!/usr/bin/env node

/** Build a lean, browser-friendly index from the audited normalized dataset. */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const inputPath = path.resolve(
  process.argv[2] || "data/nutrition/viendinhduong.records.json",
);
const outputPath = path.resolve(
  process.argv[3] || "public/data/nutrition-catalog.json",
);
const detailOutputDir = path.resolve(
  process.argv[4] || path.join(path.dirname(outputPath), "nutrition-details"),
);

function nutrientValue(record, key) {
  return record.nutrients?.find((nutrient) => nutrient.key === key)?.value ?? null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function detailBucket(record) {
  const sourceId = String(
    record.source?.sourceId || record.id?.split(":").at(-1) || "other",
  );
  return [...sourceId].reverse().find((character) => /[0-9a-f]/i.test(character))?.toLowerCase() || "other";
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

const sourceText = await readFile(inputPath, "utf8");
const source = JSON.parse(sourceText);
if (!Array.isArray(source.records)) {
  throw new Error(`Invalid normalized dataset: ${inputPath}`);
}

const records = source.records.map((record) => ({
  id: record.id,
  kind: record.kind,
  code: record.code,
  nameVi: record.nameVi,
  nameEn: record.nameEn,
  nameAscii: record.nameAscii,
  category: {
    id: record.category?.id ?? null,
    nameVi: record.category?.nameVi ?? null,
    nameEn: record.category?.nameEn ?? null,
  },
  region: record.region
    ? {
        id: record.region.id ?? null,
        nameVi: record.region.nameVi ?? null,
        code: record.region.code ?? null,
      }
    : null,
  energyKcal: record.energyKcal,
  macros: {
    proteinG: nutrientValue(record, "protein"),
    carbohydrateG: nutrientValue(record, "carbohydrate"),
    fatG: nutrientValue(record, "fat"),
  },
  basis: record.basis,
  imageUrl: record.imageUrl,
  sourceUrl: record.source?.pageUrl ?? null,
  sourceId: record.source?.sourceId ?? null,
  detailBucket: detailBucket(record),
}));

const output = {
  schemaVersion: "1.1.0",
  generatedAt: source.generatedAt,
  publisher: source.publisher,
  attributionUrl:
    "https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-thuc-pham",
  attributionUrls: [
    "https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-mon-an",
    "https://viendinhduong.vn/vi/cong-cu-va-tien-ich/gia-tri-dinh-duong-thuc-pham",
  ],
  sourceDatasetSha256: sha256(sourceText),
  recordCount: records.length,
  records,
};
const outputText = `${JSON.stringify(output)}\n`;

await mkdir(path.dirname(outputPath), { recursive: true });
await atomicWrite(outputPath, outputText);

const detailBuckets = new Map();
for (const record of source.records) {
  const bucket = detailBucket(record);
  const bucketRecords = detailBuckets.get(bucket) || [];
  bucketRecords.push(record);
  detailBuckets.set(bucket, bucketRecords);
}

await mkdir(detailOutputDir, { recursive: true });
await Promise.all(
  [...detailBuckets.entries()].map(async ([bucket, bucketRecords]) => {
    const bucketPayload = {
      schemaVersion: "1.0.0",
      generatedAt: source.generatedAt,
      publisher: source.publisher,
      bucket,
      recordCount: bucketRecords.length,
      records: bucketRecords,
    };
    await atomicWrite(
      path.join(detailOutputDir, `${bucket}.json`),
      `${JSON.stringify(bucketPayload)}\n`,
    );
  }),
);

const detailManifest = {
  schemaVersion: "1.0.0",
  generatedAt: source.generatedAt,
  publisher: source.publisher,
  recordCount: source.records.length,
  buckets: [...detailBuckets.entries()]
    .map(([bucket, bucketRecords]) => ({
      bucket,
      recordCount: bucketRecords.length,
      path: `${bucket}.json`,
    }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket)),
};
await atomicWrite(
  path.join(detailOutputDir, "manifest.json"),
  `${JSON.stringify(detailManifest)}\n`,
);
console.log(
  `Wrote ${records.length} catalog records and ${detailBuckets.size} detail buckets to ${path.dirname(outputPath)}`,
);
