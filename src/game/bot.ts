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

const MAX_DEPTH: Record<Difficulty, number> = {
  easy: 0,
  medium: 4,
  hard: 6,
  expert: 8,
  master: 12,
};

const TIME_BUDGET_MS: Record<Difficulty, number> = {
  easy: 0,
  medium: 120,
  hard: 280,
  expert: 600,
  master: 1200,
};

const CANDIDATE_CAP: Record<Difficulty, number> = {
  easy: BOARD_SIZE * BOARD_SIZE,
  medium: 12,
  hard: 16,
  expert: 24,
  master: 32,
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
  // Start counting from adjacent cells since (col, row) is currently empty but will be occupied by owner
  const horizontal = countDirection(board, owner, col + 1, row, 1, 0) + countDirection(board, owner, col - 1, row, -1, 0) + 1;
  const vertical = countDirection(board, owner, col, row + 1, 0, 1) + countDirection(board, owner, col, row - 1, 0, -1) + 1;
  return horizontal >= 5 || vertical >= 5;
}

function countPieces(board: Cell[][]): number {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) count++;
    }
  }
  return count;
}

function legalMoves(sim: SimState): Move[] {
  const moves: Move[] = [];
  const isFirstMoveOfGame = countPieces(sim.board) === 0;

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

function evaluateCandidateMove(sim: SimState, owner: PieceOwner, move: Move): number {
  const opponent: PieceOwner = owner === "green" ? "blue" : "green";
  
  // 1. Check if this move wins immediately for us
  if (makesFiveInRow(sim.board, owner, move.col, move.row)) {
    return 100000;
  }
  
  // 2. Check if this move blocks an opponent's immediate win (4-in-a-row)
  if (makesFiveInRow(sim.board, opponent, move.col, move.row)) {
    return 50000;
  }
  
  let score = 0;
  
  // 3. Reward building our own runs / blocking opponent runs
  for (const [dc, dr] of DIRECTIONS) {
    const ourRun = countDirection(sim.board, owner, move.col + dc, move.row + dr, dc, dr) +
                    countDirection(sim.board, owner, move.col - dc, move.row - dr, -dc, -dr);
    const oppRun = countDirection(sim.board, opponent, move.col + dc, move.row + dr, dc, dr) +
                    countDirection(sim.board, opponent, move.col - dc, move.row - dr, -dc, -dr);
                    
    score += ourRun * 12;
    score += oppRun * 10;
  }
  
  // 4. Center bias
  const center = 3.5;
  const dist = Math.abs(move.col - center) + Math.abs(move.row - center);
  score += (8 - dist) * 1.5;
  
  return score;
}

function orderedCandidates(sim: SimState, owner: PieceOwner, cap: number): Move[] {
  const moves = legalMoves(sim);
  moves.sort((a, b) => evaluateCandidateMove(sim, owner, b) - evaluateCandidateMove(sim, owner, a));
  return moves.slice(0, cap);
}

const TERMINAL_WIN_VALUE = 1_000_000;

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

// Flat pre-allocated typed arrays to eliminate garbage collection frame stutter/lags
const visited = new Uint8Array(64);
const queue = new Uint8Array(64);

function evaluate(sim: SimState, botOwner: PieceOwner, opponent: PieceOwner): number {
  if (sim.over) {
    if (sim.winner === botOwner) return TERMINAL_WIN_VALUE;
    if (sim.winner === opponent) return -TERMINAL_WIN_VALUE;
    return 0;
  }

  const actualScoreDiff = sim.scores[botOwner] - sim.scores[opponent];
  
  let botGroupPotential = 0;
  let opponentGroupPotential = 0;
  
  visited.fill(0);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = sim.board[r][c];
      const idx = c + r * BOARD_SIZE;
      if (cell !== null && visited[idx] === 0) {
        let size = 0;
        
        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = idx;
        visited[idx] = 1;
        
        while (qHead < qTail) {
          const currIdx = queue[qHead++];
          const currR = Math.floor(currIdx / BOARD_SIZE);
          const currC = currIdx % BOARD_SIZE;
          size++;
          
          for (const [dc, dr] of DIRECTIONS) {
            const nr = currR + dr;
            const nc = currC + dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
              const nIdx = nc + nr * BOARD_SIZE;
              if (sim.board[nr][nc] === cell && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue[qTail++] = nIdx;
              }
            }
          }
        }
        
        let potential = 0;
        if (size === 1) potential = 0.2;
        else if (size === 2) potential = 1.0;
        else if (size === 3) potential = 3.0;
        else if (size === 4) potential = 12.0;
        else potential = size * 5.0;
        
        if (cell === botOwner) {
          botGroupPotential += potential;
        } else {
          opponentGroupPotential += potential;
        }
      }
    }
  }

  const center = 3.5;
  let positional = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = sim.board[r][c];
      if (cell !== null) {
        const dist = Math.abs(r - center) + Math.abs(c - center);
        const bonus = (8 - dist) * 0.15;
        positional += cell === botOwner ? bonus : -bonus;
      }
    }
  }

  const runDiff = longestRun(sim.board, botOwner) - longestRun(sim.board, opponent);
  
  return actualScoreDiff * 150 + (botGroupPotential - opponentGroupPotential) * 15 + positional + runDiff * 60;
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
    // Fully random play never blocks an obvious win, which makes the bot feel broken rather
    // than "easy" — even a beginner notices and blocks an immediate 5-in-a-row. Give Easy just
    // those two obvious instincts (take a free win, block a free loss); everything else is random.
    const winningMove = allMoves.find((m) => makesFiveInRow(sim.board, botOwner, m.col, m.row));
    if (winningMove) return winningMove;
    const blockingMove = allMoves.find((m) => makesFiveInRow(sim.board, opponent, m.col, m.row));
    if (blockingMove) return blockingMove;
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
