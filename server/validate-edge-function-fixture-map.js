#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MIN_EXPECTED_COUNT = 72;
const MAX_EXPECTED_COUNT = 104;
const sourcePath = path.join(__dirname, "fixture-map.json");
const edgePath = path.join(
  __dirname,
  "..",
  "supabase",
  "functions",
  "sync-finished-scores",
  "fixture-map.json"
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  console.error(`[edge-fixture-map] ${message}`);
  process.exitCode = 1;
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates).sort((a, b) => a - b);
}

function main() {
  const source = readJson(sourcePath);
  const edge = readJson(edgePath);
  const errors = [];

  if (!Array.isArray(source)) errors.push("server/fixture-map.json must be an array.");
  if (!Array.isArray(edge)) errors.push("Edge Function fixture-map.json must be an array.");
  if (errors.length) {
    errors.forEach(fail);
    return;
  }

  if (source.length < MIN_EXPECTED_COUNT || source.length > MAX_EXPECTED_COUNT) {
    errors.push(
      `Authoritative fixture map must contain ${MIN_EXPECTED_COUNT}-${MAX_EXPECTED_COUNT} entries; found ${source.length}.`
    );
  }
  if (edge.length !== source.length) {
    errors.push(`Edge Function fixture map must contain ${source.length} entries; found ${edge.length}.`);
  }

  const sourceByInternalId = new Map();
  const sourceInternalIds = [];
  const sourceProviderIds = [];
  for (const entry of source) {
    const internalMatchId = Number(entry.id);
    const footballDataMatchId = Number(entry.footballDataMatchId);
    if (!Number.isInteger(internalMatchId) || !Number.isInteger(footballDataMatchId)) {
      errors.push("Authoritative fixture map contains a non-integer mapping ID.");
      continue;
    }
    sourceInternalIds.push(internalMatchId);
    sourceProviderIds.push(footballDataMatchId);
    sourceByInternalId.set(internalMatchId, footballDataMatchId);
  }

  const edgeInternalIds = [];
  const edgeProviderIds = [];
  for (const entry of edge) {
    const keys = Object.keys(entry).sort();
    if (keys.join(",") !== "footballDataMatchId,internalMatchId") {
      errors.push("Edge Function mapping entries must contain only internalMatchId and footballDataMatchId.");
    }

    const internalMatchId = Number(entry.internalMatchId);
    const footballDataMatchId = Number(entry.footballDataMatchId);
    if (!Number.isInteger(internalMatchId) || !Number.isInteger(footballDataMatchId)) {
      errors.push("Edge Function fixture map contains a non-integer mapping ID.");
      continue;
    }

    edgeInternalIds.push(internalMatchId);
    edgeProviderIds.push(footballDataMatchId);

    if (!sourceByInternalId.has(internalMatchId)) {
      errors.push(`Unexpected internal match ID ${internalMatchId}.`);
      continue;
    }
    if (sourceByInternalId.get(internalMatchId) !== footballDataMatchId) {
      errors.push(
        `Mapping mismatch for internal match ${internalMatchId}: expected ${sourceByInternalId.get(internalMatchId)}, found ${footballDataMatchId}.`
      );
    }
  }

  const duplicateSourceInternalIds = findDuplicates(sourceInternalIds);
  const duplicateSourceProviderIds = findDuplicates(sourceProviderIds);
  const duplicateInternalIds = findDuplicates(edgeInternalIds);
  const duplicateProviderIds = findDuplicates(edgeProviderIds);
  if (duplicateSourceInternalIds.length) {
    errors.push(
      `Authoritative map has duplicate internal match IDs: ${duplicateSourceInternalIds.join(", ")}.`
    );
  }
  if (duplicateSourceProviderIds.length) {
    errors.push(
      `Authoritative map has duplicate football-data match IDs: ${duplicateSourceProviderIds.join(", ")}.`
    );
  }
  if (duplicateInternalIds.length) {
    errors.push(`Duplicate internal match IDs: ${duplicateInternalIds.join(", ")}.`);
  }
  if (duplicateProviderIds.length) {
    errors.push(`Duplicate football-data match IDs: ${duplicateProviderIds.join(", ")}.`);
  }

  for (const internalMatchId of sourceByInternalId.keys()) {
    if (!edgeInternalIds.includes(internalMatchId)) {
      errors.push(`Missing internal match ID ${internalMatchId}.`);
    }
  }

  if (errors.length) {
    errors.forEach(fail);
    return;
  }

  console.log(
    `[edge-fixture-map] Validated ${source.length} unique Edge Function mappings against server/fixture-map.json.`
  );
}

main();
