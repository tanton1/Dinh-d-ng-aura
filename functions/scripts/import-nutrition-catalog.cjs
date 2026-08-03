#!/usr/bin/env node

/**
 * Seed the normalized Viện Dinh dưỡng records into Firestore.
 *
 * Safety: dry-run is the default. No records are deleted. Pass --commit to
 * perform deterministic upserts into `nutritionCatalog`.
 */

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { execFileSync } = require("node:child_process");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function help() {
  console.log(`Usage:
  node functions/scripts/import-nutrition-catalog.cjs [options]

Options:
  --input <path>         Normalized JSON input
                        (default: data/nutrition/viendinhduong.records.json)
  --collection <name>   Firestore collection (default: nutritionCatalog)
  --project <id>        Firebase/GCP project ID (or GOOGLE_CLOUD_PROJECT)
  --database-id <id>    Firestore database ID
                        (or FIRESTORE_DATABASE_ID, default: (default))
  --batch-size <n>      Writes per commit, 1-450 (default: 400)
  --firebase-cli-auth   Reuse the current Firebase CLI login instead of ADC
  --commit              Perform writes; without this flag the script is dry-run
  --help                Show this help

Authentication uses Application Default Credentials. This script only upserts;
it never deletes documents absent from the source file.
`);
}

function parseArgs(argv) {
  const options = {
    input: path.resolve("data/nutrition/viendinhduong.records.json"),
    collection: "nutritionCatalog",
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null,
    databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
    batchSize: 400,
    firebaseCliAuth: false,
    commit: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      help();
      process.exit(0);
    }
    if (arg === "--commit") {
      options.commit = true;
      continue;
    }
    if (arg === "--firebase-cli-auth") {
      options.firebaseCliAuth = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    index += 1;
    if (arg === "--input") options.input = path.resolve(value);
    else if (arg === "--collection") options.collection = value;
    else if (arg === "--project") options.projectId = value;
    else if (arg === "--database-id") options.databaseId = value;
    else if (arg === "--batch-size") options.batchSize = Number(value);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.collection)) {
    throw new Error("--collection may contain only letters, numbers, underscores, and hyphens");
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 450) {
    throw new Error("--batch-size must be an integer between 1 and 450");
  }
  return options;
}

function firebaseCliAccessTokenProvider() {
  const globalModules = process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "npm", "node_modules")
    : execFileSync("npm", ["root", "-g"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
  const firebaseToolsRoot = path.join(globalModules, "firebase-tools", "lib");
  const auth = require(path.join(firebaseToolsRoot, "auth.js"));
  const api = require(path.join(firebaseToolsRoot, "apiv2.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account) throw new Error("Firebase CLI is not logged in. Run firebase login first.");
  if (!account.tokens?.refresh_token) throw new Error("The Firebase CLI account has no refresh token. Run firebase login again.");
  auth.setActiveAccount({}, account);
  return () => api.getAccessToken();
}

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot encode a non-finite Firestore number");
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (value && typeof value === "object") return { mapValue: { fields: firestoreFields(value) } };
  throw new Error(`Cannot encode Firestore value of type ${typeof value}`);
}

function firestoreFields(value) {
  return Object.fromEntries(Object.entries(value)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .map(([key, fieldValue]) => [key, firestoreValue(fieldValue)]));
}

async function commitWithFirebaseCli(options, records, generatedAt) {
  const getAccessToken = firebaseCliAccessTokenProvider();
  const databasePath = `projects/${options.projectId}/databases/${options.databaseId}`;
  const endpoint = `https://firestore.googleapis.com/v1/${databasePath}/documents:batchWrite`;
  let written = 0;
  for (let offset = 0; offset < records.length; offset += options.batchSize) {
    const slice = records.slice(offset, offset + options.batchSize);
    const writes = slice.map((record) => ({
      update: {
        name: `${databasePath}/documents/${options.collection}/${record.id}`,
        fields: firestoreFields(firestorePayload(record, generatedAt)),
      },
    }));
    const accessToken = await getAccessToken();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Firestore batchWrite failed (${response.status}): ${JSON.stringify(payload).slice(0, 500)}`);
    const failedStatus = Array.isArray(payload.status)
      ? payload.status.find((status) => status && typeof status.code === "number" && status.code !== 0)
      : null;
    if (failedStatus) throw new Error(`Firestore batchWrite returned an item error: ${JSON.stringify(failedStatus).slice(0, 500)}`);
    written += slice.length;
    console.log(`Committed ${written}/${records.length}`);
  }
  return written;
}

function asciiFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(record) {
  const phrases = [record.nameAscii, record.nameVi, record.nameEn]
    .map(asciiFold)
    .filter(Boolean);
  const tokens = new Set(phrases);
  for (const phrase of phrases) {
    for (const word of phrase.split(" ")) {
      if (!word) continue;
      tokens.add(word);
      for (let size = 2; size <= Math.min(word.length, 20); size += 1) {
        tokens.add(word.slice(0, size));
      }
    }
  }
  return [...tokens].sort().slice(0, 120);
}

function nutrientValue(record, key) {
  return record.nutrients?.find((nutrient) => nutrient.key === key)?.value ?? null;
}

function firestorePayload(record, generatedAt) {
  return {
    ...record,
    nameAscii: asciiFold(record.nameAscii || record.nameVi),
    nameTokens: searchTokens(record),
    macros: {
      proteinG: nutrientValue(record, "protein"),
      carbohydrateG: nutrientValue(record, "carbohydrate"),
      fatG: nutrientValue(record, "fat"),
      fiberG: nutrientValue(record, "fiber"),
    },
    catalogGeneratedAt: generatedAt || null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = JSON.parse(fs.readFileSync(options.input, "utf8"));
  if (!Array.isArray(source.records)) throw new Error("Input does not contain records[]");

  const ids = new Set();
  for (const record of source.records) {
    if (!record.id || ids.has(record.id)) throw new Error(`Missing/duplicate ID: ${record.id}`);
    if (Buffer.byteLength(record.id, "utf8") > 1_500 || record.id.includes("/")) {
      throw new Error(`ID is not safe as a Firestore document ID: ${record.id}`);
    }
    ids.add(record.id);
  }

  console.log(
    JSON.stringify(
      {
        mode: options.commit ? "commit" : "dry-run",
        input: options.input,
        collection: options.collection,
        projectId: options.projectId,
        databaseId: options.databaseId,
        authentication: options.firebaseCliAuth ? "firebase-cli" : "application-default",
        records: source.records.length,
        batches: Math.ceil(source.records.length / options.batchSize),
      },
      null,
      2,
    ),
  );
  if (!options.commit) {
    console.log("Dry-run complete. Re-run with --commit after reviewing the target above.");
    return;
  }
  if (!options.projectId) {
    throw new Error("Set --project or GOOGLE_CLOUD_PROJECT before using --commit");
  }

  if (options.firebaseCliAuth) {
    const written = await commitWithFirebaseCli(options, source.records, source.generatedAt);
    console.log(`Import complete: ${written} documents in ${options.collection}`);
    return;
  }

  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId });
  const db = getFirestore(app, options.databaseId);
  let written = 0;
  for (let offset = 0; offset < source.records.length; offset += options.batchSize) {
    const batch = db.batch();
    const slice = source.records.slice(offset, offset + options.batchSize);
    for (const record of slice) {
      const ref = db.collection(options.collection).doc(record.id);
      batch.set(ref, firestorePayload(record, source.generatedAt), { merge: false });
    }
    await batch.commit();
    written += slice.length;
    console.log(`Committed ${written}/${source.records.length}`);
  }
  console.log(`Import complete: ${written} documents in ${options.collection}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
