import { BOARD_SIZE } from "../three/config";
import type { PieceOwner } from "../three/pieces";
import { type Cell, type GameState, calculatePlayerScore } from "./rules";

export type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Łatwy",
  medium: "Średni",
  hard: "Trudny",
  expert: "Ekspert",
  master: "Mistrz",
};

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert", "master"];

// Iterative deepening: search depth 1, 2, 3... keeping the best move found after each
// completed depth, until either the max depth or the time budget is hit. This keeps response
// time bounded regardless of how tactically complex a position gets, instead of a fixed depth
// that's fast in simple positions but can blow up in busy ones.
const MAX_DEPTH: Record<Difficulty, number> = {
  easy: 0,
  medium: 4,
  hard: 6,
  expert: 8,
  master: 12,
};

const TIME_BUDGET_MS: Record<Difficulty, number> = {
  easy: 0,
  medium: 250,
  hard: 500,
  expert: 900,
  master: 1600,
};

const CANDIDATE_CAP: Record<Difficulty, number> = {
  easy: BOARD_SIZE * BOARD_SIZE,
  medium: 8,
  hard: 10,
  expert: 12,
  master: 14,
};

export interface Move {
  col: number;
  row: number;
}

type SimOutcome = PieceOwner | "draw" | null;

interface SimState {
  board: Cell[][];
  scores: { green: number; blue: number };
  current: PieceOwner;
  over: boolean;
  winner: SimOutcome;
}

function fromGameState(state: GameState): SimState {
  return {
    board: state.board.map((row) => row.slice()),
    scores: { ...state.scores },
    current: state.current,
    over: state.over,
    winner: state.winner,
  };
}

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function countDirection(board: Cell[][], owner: PieceOwner, col: number, row: number, dc: number, dr: number): number {
  let count = 0;
  let c = col;
  let r = row;
  while (c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && board[r][c] === owner) {
    count++;
    c += dc;
    r += dr;
  }
  return count;
}

function makesFiveInRow(board: Cell[][], owner: PieceOwner, col: number, row: number): boolean {
  const horizontal = countDirection(board, owner, col, row, 1, 0) + countDirection(board, owner, col, row, -1, 0) - 1;
  const vertical = countDirection(board, owner, col, row, 0, 1) + countDirection(board, owner, col, row, 0, -1) - 1;
  return horizontal >= 5 || vertical >= 5;
}

function legalMoves(sim: SimState): Move[] {
  const moves: Move[] = [];
  const isFirstMoveOfGame = sim.scores.green + sim.scores.blue === 0;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (sim.board[row][col] !== null) continue;
      if (isFirstMoveOfGame) {
        moves.push({ col, row });
        continue;
      }
      const hasNeighbor = DIRECTIONS.some(([dc, dr]) => {
        const c = col + dc;
        const r = row + dr;
        return c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && sim.board[r][c] !== null;
      });
      if (hasNeighbor) moves.push({ col, row });
    }
  }
  return moves;
}

function applySim(sim: SimState, owner: PieceOwner, move: Move): SimState {
  const board = sim.board.map((row) => row.slice());
  board[move.row][move.col] = owner;
  
  const scores = {
    green: calculatePlayerScore(board, "green"),
    blue: calculatePlayerScore(board, "blue")
  };

  let totalPieces = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) totalPieces++;
    }
  }
  const full = totalPieces === BOARD_SIZE * BOARD_SIZE;
  const madeFive = makesFiveInRow(board, owner, move.col, move.row);

  let over = sim.over;
  let winner: SimOutcome = sim.winner;
  let current = sim.current;

  if (madeFive) {
    over = true;
    winner = owner;
  } else if (full) {
    over = true;
    winner = scores.green === scores.blue ? "draw" : scores.green > scores.blue ? "green" : "blue";
  } else {
    current = owner === "green" ? "blue" : "green";
  }

  return { board, scores, over, winner, current };
}

function neighborBias(sim: SimState, owner: PieceOwner, move: Move): number {
  let score = 0;
  for (const [dc, dr] of DIRECTIONS) {
    const c = move.col + dc;
    const r = move.row + dr;
    if (c < 0 || c >= BOARD_SIZE || r < 0 || r >= BOARD_SIZE) continue;
    const cell = sim.board[r][c];
    if (cell === owner) score += 2;
    else if (cell !== null) score -= 1;
  }
  return score;
}

function orderedCandidates(sim: SimState, owner: PieceOwner, cap: number): Move[] {
  const moves = legalMoves(sim);
  moves.sort((a, b) => neighborBias(sim, owner, b) - neighborBias(sim, owner, a));
  return moves.slice(0, cap);
}

const TERMINAL_WIN_VALUE = 1_000_000;

/** Longest run of `owner`'s pieces anywhere on the board (horizontal or vertical) — a proxy for
 *  how close that side is to completing a 5-in-a-row, which raw piece count doesn't capture. */
function longestRun(board: Cell[][], owner: PieceOwner): number {
  let best = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== owner) continue;

      if (col === 0 || board[row][col - 1] !== owner) {
        let len = 0;
        let c = col;
        while (c < BOARD_SIZE && board[row][c] === owner) {
          len++;
          c++;
        }
        if (len > best) best = len;
      }

      if (row === 0 || board[row - 1][col] !== owner) {
        let len = 0;
        let r = row;
        while (r < BOARD_SIZE && board[r][col] === owner) {
          len++;
          r++;
        }
        if (len > best) best = len;
      }
    }
  }
  return best;
}

function evaluate(sim: SimState, botOwner: PieceOwner, opponent: PieceOwner): number {
  if (sim.over) {
    if (sim.winner === botOwner) return TERMINAL_WIN_VALUE;
    if (sim.winner === opponent) return -TERMINAL_WIN_VALUE;
    return 0;
  }

  // Actual score difference under the new rule (groups >= 5)
  const actualScoreDiff = sim.scores[botOwner] - sim.scores[opponent];
  
  // Potential reward for building groups:
  let botGroupPotential = 0;
  let opponentGroupPotential = 0;
  
  const visited = Array.from({ length: BOARD_SIZE }, () => Array<boolean>(BOARD_SIZE).fill(false));
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = sim.board[r][c];
      if (cell !== null && !visited[r][c]) {
        let size = 0;
        const queue: [number, number][] = [[r, c]];
        visited[r][c] = true;
        while (queue.length > 0) {
          const [currR, currC] = queue.shift()!;
          size++;
          for (const [dc, dr] of DIRECTIONS) {
            const nr = currR + dr;
            const nc = currC + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
              if (sim.board[nr][nc] === cell && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push([nr, nc]);
              }
            }
          }
        }
        
        let potential = 0;
        if (size === 1) potential = 0.2;
        else if (size === 2) potential = 1.0;
        else if (size === 3) potential = 3.0;
        else if (size === 4) potential = 12.0; // extremely close to scoring!
        else potential = size * 5.0; // groups >= 5 are extremely valuable
        
        if (cell === botOwner) {
          botGroupPotential += potential;
        } else {
          opponentGroupPotential += potential;
        }
      }
    }
  }

  const center = (BOARD_SIZE - 1) / 2;
  let positional = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = sim.board[row][col];
      if (!cell) continue;
      const distanceFromCenter = Math.abs(row - center) + Math.abs(col - center);
      const bonus = (BOARD_SIZE - distanceFromCenter) * 0.15;
      positional += cell === botOwner ? bonus : -bonus;
    }
  }

  const runDiff = longestRun(sim.board, botOwner) - longestRun(sim.board, opponent);
  
  return actualScoreDiff * 120 + (botGroupPotential - opponentGroupPotential) * 12 + positional + runDiff * 45;
}

class SearchTimeout extends Error {}

function minimax(
  sim: SimState,
  depth: number,
  alpha: number,
  beta: number,
  botOwner: PieceOwner,
  opponent: PieceOwner,
  cap: number,
  deadline: number
): number {
  if (performance.now() > deadline) throw new SearchTimeout();
  if (sim.over || depth === 0) return evaluate(sim, botOwner, opponent);

  const candidates = orderedCandidates(sim, sim.current, cap);
  if (candidates.length === 0) return evaluate(sim, botOwner, opponent);

  const maximizing = sim.current === botOwner;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of candidates) {
    const next = applySim(sim, sim.current, move);
    const value = minimax(next, depth - 1, alpha, beta, botOwner, opponent, cap, deadline);

    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }

  return best;
}

export function chooseBotMove(state: GameState, botOwner: PieceOwner, difficulty: Difficulty): Move {
  const sim = fromGameState(state);
  const opponent: PieceOwner = botOwner === "green" ? "blue" : "green";
  const allMoves = legalMoves(sim);
  if (allMoves.length === 0) {
    throw new Error("Bot has no legal moves available");
  }

  if (difficulty === "easy") {
    return allMoves[Math.floor(Math.random() * allMoves.length)];
  }

  const cap = CANDIDATE_CAP[difficulty];
  const maxDepth = MAX_DEPTH[difficulty];
  const deadline = performance.now() + TIME_BUDGET_MS[difficulty];
  const rootCandidates = orderedCandidates(sim, botOwner, cap);

  let bestMove = rootCandidates[0];

  for (let depth = 1; depth <= maxDepth; depth++) {
    let depthBestMove = rootCandidates[0];
    let bestValue = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    let completed = true;

    try {
      for (const move of rootCandidates) {
        const next = applySim(sim, botOwner, move);
        const value = minimax(next, depth - 1, alpha, beta, botOwner, opponent, cap, deadline);
        if (value > bestValue) {
          bestValue = value;
          depthBestMove = move;
        }
        alpha = Math.max(alpha, value);
      }
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error;
      completed = false;
    }

    if (!completed) break;

    bestMove = depthBestMove;
    if (bestValue >= TERMINAL_WIN_VALUE) break;
    if (performance.now() >= deadline) break;
  }

  return bestMove;
}
