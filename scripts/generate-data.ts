import { Chess } from "chess.js";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { OpeningData } from "../types";

const DATA_DIR = path.join(path.dirname(import.meta.filename), "..", "data/external");
async function fetchOpenings() {
  try {
    const categories = ["a", "b", "c", "d", "e"];
    const promises = categories.map(async (category) => {
      const res = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/master/${category}.tsv`);
      if (!res.ok) throw new Error(`Failed to fetch category ${category}: ${res.statusText}`);
      return (await res.text()).split("\n").slice(1);
    });

    return (await Promise.all(promises)).flat().filter(Boolean);
  } catch (error) {
    console.error("Error fetching openings:", error);
    throw error; // Re-throw to ensure the script exits if fetching fails
  }
}

function processRows(rows: string[], handler: (openingData: OpeningData) => void) {
  rows.forEach((row) => {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    chess.loadPgn(pgn);

    const history = chess.history({ verbose: true });
    const uci = history.reduce((uci, move) => {
      let moveUci = `${move.from}${move.to}`;
      if (move.promotion) moveUci += move.promotion;
      return uci + moveUci;
    }, "");
    const fen = chess.fen();
    const epd = fen.split(" ").slice(0, 4).join(" ");
    const openingData = { eco, name, pgn, epd, uci };
    handler(openingData);
  });
}

async function writeToData(filename: string, data: any) {
  try {
    await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
    console.log(`Data written to ${filename}`);
  } catch (error) {
    console.error(`Error writing to ${filename}:`, error);
    throw error; // Ensure the script exits on write error
  }
}

async function main() {
  try {
    const epdLookup: Record<string, OpeningData> = {};
    const ecoLookup: Record<string, OpeningData[]> = {};
    const categoryLookup: Record<string, OpeningData[]> = {};
    const openingList: OpeningData[] = [];

    const rows = await fetchOpenings();
    processRows(rows, (openingData) => {
      const eco = openingData.eco;
      const category = eco.charAt(0).toUpperCase();

      epdLookup[openingData.epd] = openingData;

      if (!ecoLookup[eco]) ecoLookup[eco] = [];
      ecoLookup[eco].push(openingData);

      if (!categoryLookup[category]) categoryLookup[category] = [];
      categoryLookup[category].push(openingData);

      openingList.push(openingData);
    });

    if (!existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });
    await Promise.all([
      writeToData("opening-list.json", openingList),
      writeToData("eco-lookup.json", ecoLookup),
      writeToData("category-lookup.json", categoryLookup),
      writeToData("epd-lookup.json", epdLookup),
      writeToData("eco-list.json", Object.keys(ecoLookup)),
    ]);

    console.log("All data has been processed and saved successfully.");
  } catch (error) {
    console.error("Error in main process:", error);
  }
}

main();
