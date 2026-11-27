// Automatische Tests für die Preisberechnung. Ausführen: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatePriceCents } from "./pricing";

const start = new Date("2026-01-01T10:00:00Z");
const after = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const price = (minutes: number) => calculatePriceCents(start, after(minutes), 50);

test("die ersten 5 Minuten sind kostenlos", () => {
  assert.equal(price(0), 0);
  assert.equal(price(5), 0);
});

test("jede angefangene Stunde zählt voll", () => {
  assert.equal(price(6), 50);
  assert.equal(price(60), 50);
  assert.equal(price(61), 100);
  assert.equal(price(179), 150);
});

test("Tageshöchstpreis: höchstens 8 Stunden pro Tag", () => {
  assert.equal(price(9 * 60), 400);
  assert.equal(price(23 * 60), 400);
});

test("mehrere Tage: volle Tage zum Höchstpreis + Rest", () => {
  assert.equal(price(24 * 60), 400); // genau 1 Tag
  assert.equal(price(24 * 60 + 30), 450); // 1 Tag + 30 Min
  assert.equal(price(3 * 24 * 60 + 10 * 60), 1600); // 3 Tage + 10 h (gedeckelt auf 8)
});

test("Ende vor Start (Uhrenfehler) kostet nichts statt negativ", () => {
  assert.equal(calculatePriceCents(after(10), start, 50), 0);
});
