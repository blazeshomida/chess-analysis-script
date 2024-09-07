import { z } from "zod";
import type { OpeningData } from "./types";
import { Chess } from "chess.js";
import epdLookup from "./data/external/epd-lookup.json";

const archiveSchema = z.object({ archives: z.array(z.string()) });

const playerSchema = z.object({
  rating: z.number(),
  result: z.string(),
  "@id": z.string(),
  username: z.string(),
  uuid: z.string(),
});

const accuraciesSchema = z
  .object({
    white: z.number(),
    black: z.number(),
  })
  .optional();

const gameSchema = z.object({
  url: z.string(),
  pgn: z.string(),
  time_control: z.string(),
  end_time: z.number(),
  rated: z.boolean(),
  tcn: z.string().optional(),
  uuid: z.string(),
  initial_setup: z.string(),
  fen: z.string(),
  time_class: z.string(),
  rules: z.string(),
  white: playerSchema,
  black: playerSchema,
  accuracies: accuraciesSchema,
});

const gamesDataSchema = z.object({
  games: z.array(gameSchema),
});

type Game = z.infer<typeof gameSchema>;
type GameWithOpening = Game & { opening: OpeningData | null };

function identifyOpening(pgn: string): OpeningData | null {
  if (!pgn) return null;
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  let result = null;
  while (!result) {
    if (history.length === 0) break;
    const epd = history.at(-1)?.after.split(" ").slice(0, 4).join(" ")!;
    result = epdLookup[epd];
    history.pop();
  }

  return result;
}

async function fetchGames(username: string) {
  const res = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
  const archiveList = archiveSchema.parse(await res.json());
  console.log(
    "Username: %s\nAnalyzing the following archives:\n %s",
    username,
    archiveList.archives
      .slice(-6)
      .map((url) => url.slice(-7))
      .join(" | ")
  );
  const games = (
    await Promise.all(
      archiveList.archives.slice(-6).map(async (archive) => {
        const res = await fetch(archive);
        const gamesJson = await res.json();
        const gamesData = gamesDataSchema.parse(gamesJson);
        return gamesData.games.reduce((results: GameWithOpening[], game) => {
          if (game.rules === "chess") {
            results.push(
              Object.assign(
                {
                  opening: identifyOpening(game.pgn),
                },
                game
              )
            );
          }
          return results;
        }, []);
      })
    )
  ).flat();
  console.log("\nFound a total of %d games\n", games.length);
  return games;
}

const USERNAME = "shomidamoney";

const games = await fetchGames(USERNAME);

type Stats = { total: number; wins: number; losses: number; draws: number };

const initialStats = (): Stats => ({ total: 0, wins: 0, losses: 0, draws: 0 });
function analyzeGames(username: string, games: GameWithOpening[]) {
  const openingStats: Record<"white" | "black", Record<string, Stats>> = {
    white: {},
    black: {},
  };
  games.forEach((game) => {
    if (game.opening) {
      const playerColor = game.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
      const opponentColor = playerColor === "black" ? "white" : "black";
      const result =
        game[playerColor].result === game[opponentColor].result
          ? "draw"
          : game[playerColor].result === "win"
          ? "win"
          : "loss";

      if (!openingStats[playerColor][game.opening.name]) {
        openingStats[playerColor][game.opening.name] = initialStats();
      }
      const openingStat = openingStats[playerColor][game.opening.name];
      openingStat.total++;

      switch (result) {
        case "win":
          openingStat.wins++;
          break;
        case "loss":
          openingStat.losses++;
          break;
        case "draw":
          openingStat.draws++;
          break;
      }
    }
  });

  return {
    white: sortOpenings(openingStats.white)
      .slice(0, 10)
      .map((opening) => `${opening.winRate.toFixed(2)}%: ${opening.openingName} played ${opening.stats.total} games.`),
    black: sortOpenings(openingStats.black)
      .slice(0, 10)
      .map((opening) => `${opening.winRate.toFixed(2)}%: ${opening.openingName} played ${opening.stats.total} games.`),
  };
}

function sortOpenings(openingStats: Record<string, Stats>) {
  return Object.entries(openingStats)
    .map(([openingName, stats]) => {
      const winRate = stats.total ? (stats.wins / stats.total) * 100 : 0;
      return { openingName, stats, winRate };
    })
    .filter((opening) => opening.stats.total > 15)
    .sort((a, b) => b.winRate - a.winRate);
}

const analyzedGames = analyzeGames(USERNAME, games);
console.log(JSON.stringify(analyzedGames, null, 2));
