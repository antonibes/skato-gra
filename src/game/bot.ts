import { BOARD_SIZE } from "../three/config";
import type { PieceOwner } from "../three/pieces";
import { type Cell, type GameState } from "./rules";

export type Difficulty = "easy" | "medium" | "hard" | "expert" | "master";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Łatwy",
  medium: "Średni",
  hard: "Trudny",
  expert: "Ekspert",
  master: "Mistrz",
};

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert", "master"];

// Easy and Medium are scripted (see chooseEasyMove/chooseMediumMove below), not search-driven —
// the client wants their exact behavior easy to dial in independently, move-count phase by
// move-count phase, without touching the minimax engine at all. Hard/Expert/Master keep using
// that engine untouched, hence the narrower type: these config maps genuinely don't apply to
// easy/medium any more, and this way TypeScript won't let a difficulty check drift out of sync
// between chooseBotMove's branches and what these maps actually cover.
type SearchDifficulty = "hard" | "expert" | "master";

const MAX_DEPTH: Record<SearchDifficulty, number> = {
  hard: 8,
  expert: 10,
  master: 16,
};

const TIME_BUDGET_MS: Record<SearchDifficulty, number> = {
  hard: 280,
  expert: 900,
  master: 1800,
};

// Width of the move list considered at the root — kept generous so the bot's actual choice of
// move is picked from a good pool of candidates.
const CANDIDATE_CAP: Record<SearchDifficulty, number> = {
  hard: 16,
  expert: 24,
  master: 32,
};

// Width considered at every OTHER node in the tree. Move ordering already puts wins, blocks,
// and the strongest-looking moves first, so nodes deep in the tree don't need the same breadth
// as the root — narrowing them buys several extra plies of real search depth for the same node
// budget, which matters far more for playing strength than evaluating a few more so-so replies.
const INNER_CANDIDATE_CAP: Record<SearchDifficulty, number> = {
  hard: 8,
  expert: 9,
  master: 10,
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
  pieceCount: number;
}

function fromGameState(state: GameState): SimState {
  let pieceCount = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] !== null) pieceCount++;
    }
  }
  return {
    board: state.board.map((row) => row.slice()),
    scores: { ...state.scores },
    current: state.current,
    over: state.over,
    winner: state.winner,
    pieceCount,
  };
}

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

// One representative direction per axis — used where a signed pair of DIRECTIONS entries would
// just duplicate the same bidirectional walk (e.g. run-length scans that already look both ways).
const AXES = [
  [1, 0],
  [0, 1],
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

function legalMoves(sim: SimState): Move[] {
  const moves: Move[] = [];
  const isFirstMoveOfGame = sim.pieceCount === 0;

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

// Local-flood-fill scratch buffers for incremental scoring in applySim. Separate from
// evaluate()'s `visited`/`queue` since both can be mid-use within the same call stack
// (evaluate() runs at leaves, applySim() runs on every edge on the way there).
const localMark = new Uint8Array(64);
const localQueue = new Uint8Array(64);

function floodFillMark(board: Cell[][], owner: PieceOwner, col: number, row: number, mark: Uint8Array): number {
  let size = 0;
  let qHead = 0;
  let qTail = 0;
  const startIdx = col + row * BOARD_SIZE;
  mark[startIdx] = 1;
  localQueue[qTail++] = startIdx;

  while (qHead < qTail) {
    const idx = localQueue[qHead++];
    const r = (idx / BOARD_SIZE) | 0;
    const c = idx % BOARD_SIZE;
    size++;

    for (const [dc, dr] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
        const nIdx = nc + nr * BOARD_SIZE;
        if (board[nr][nc] === owner && !mark[nIdx]) {
          mark[nIdx] = 1;
          localQueue[qTail++] = nIdx;
        }
      }
    }
  }
  return size;
}

// Placing one piece can only change the groups touching it — either extending one or merging
// several. Rather than re-scanning the whole board (calculatePlayerScore), flood-fill just the
// (small, near the frontier) groups that are actually affected: sum what the touched neighbor
// groups used to contribute on the old board, then flood-fill the single merged group on the
// new board, and patch the total score by the difference. Falls back to nothing extra needed
// for the opponent, whose groups are untouched by owner's move.
function incrementalOwnerScore(oldBoard: Cell[][], newBoard: Cell[][], owner: PieceOwner, col: number, row: number, priorScore: number): number {
  localMark.fill(0);
  let oldContribution = 0;
  for (const [dc, dr] of DIRECTIONS) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nc >= BOARD_SIZE || nr < 0 || nr >= BOARD_SIZE) continue;
    if (oldBoard[nr][nc] !== owner) continue;
    const idx = nc + nr * BOARD_SIZE;
    if (localMark[idx]) continue;
    const size = floodFillMark(oldBoard, owner, nc, nr, localMark);
    if (size >= 5) oldContribution += size;
  }

  localMark.fill(0);
  const newSize = floodFillMark(newBoard, owner, col, row, localMark);
  const newContribution = newSize >= 5 ? newSize : 0;

  return priorScore - oldContribution + newContribution;
}

function applySim(sim: SimState, owner: PieceOwner, move: Move): SimState {
  const board = sim.board.map((row) => row.slice());
  board[move.row][move.col] = owner;

  // Only `owner` gained a piece, so the opponent's groups (and score) are untouched.
  const scores = {
    ...sim.scores,
    [owner]: incrementalOwnerScore(sim.board, board, owner, move.col, move.row, sim.scores[owner]),
  } as { green: number; blue: number };

  const pieceCount = sim.pieceCount + 1;
  const full = pieceCount === BOARD_SIZE * BOARD_SIZE;
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

  return { board, scores, over, winner, current, pieceCount };
}

// Move ordering only ever sees run lengths 0-3 here: anything that would make a 4-run (one
// away from completing 5) is already caught by the exact win/block checks above and returns
// early. A LINEAR weight per run length badly undervalues a "three" (an open three is a real,
// forcing threat in a five-in-a-row game) against ordinary moves — center bias and a couple of
// adjacent cells could easily outscore it. That matters a lot more than it sounds: with the
// search's candidate list narrowed at every non-root node (see INNER_CANDIDATE_CAP), a threat
// that doesn't rank near the top gets pruned away and the search literally never considers
// addressing it. Ramping up steeply keeps a real three-in-a-row threat — ours or theirs — above
// the noise of ordinary positional moves so it always survives the cut.
const RUN_THREAT_WEIGHT = [0, 9, 34, 150];

function runThreatWeight(run: number): number {
  return RUN_THREAT_WEIGHT[run] ?? RUN_THREAT_WEIGHT[RUN_THREAT_WEIGHT.length - 1];
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

  // 3. Reward building our own runs / blocking opponent runs — see runThreatWeight for why this
  // isn't linear. DIRECTIONS has both signed entries per axis ([1,0]/[-1,0] and [0,1]/[0,-1]);
  // countDirection is already called for both signs within a single iteration below, so only two
  // of the four entries need visiting to cover both axes — the other two would just repeat the
  // same two runs.
  for (const [dc, dr] of AXES) {
    const ourRun = countDirection(sim.board, owner, move.col + dc, move.row + dr, dc, dr) +
                    countDirection(sim.board, owner, move.col - dc, move.row - dr, -dc, -dr);
    const oppRun = countDirection(sim.board, opponent, move.col + dc, move.row + dr, dc, dr) +
                    countDirection(sim.board, opponent, move.col - dc, move.row - dr, -dc, -dr);

    // Blocking is weighted a little above building, so that when in doubt (e.g. this move both
    // extends our own two and blocks their two) defense still edges out the ranking.
    score += runThreatWeight(ourRun);
    score += runThreatWeight(oppRun) * 1.15;
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
  let botLongestRun = 0;
  let opponentLongestRun = 0;
  let positional = 0;
  const center = 3.5;

  visited.fill(0);

  // Single pass over the board: group-flood-fill potential, positional bias, and longest-run
  // are all derived from the same per-cell scan instead of four separate full-board loops.
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = sim.board[r][c];
      if (cell === null) continue;

      const dist = Math.abs(r - center) + Math.abs(c - center);
      const bonus = (8 - dist) * 0.15;
      positional += cell === botOwner ? bonus : -bonus;

      if (c === 0 || sim.board[r][c - 1] !== cell) {
        let len = 0;
        let cc = c;
        while (cc < BOARD_SIZE && sim.board[r][cc] === cell) {
          len++;
          cc++;
        }
        if (cell === botOwner) {
          if (len > botLongestRun) botLongestRun = len;
        } else if (len > opponentLongestRun) opponentLongestRun = len;
      }

      if (r === 0 || sim.board[r - 1][c] !== cell) {
        let len = 0;
        let rr = r;
        while (rr < BOARD_SIZE && sim.board[rr][c] === cell) {
          len++;
          rr++;
        }
        if (cell === botOwner) {
          if (len > botLongestRun) botLongestRun = len;
        } else if (len > opponentLongestRun) opponentLongestRun = len;
      }

      const idx = c + r * BOARD_SIZE;
      if (visited[idx] !== 0) continue;

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

  // Same non-linear reasoning as runThreatWeight, but for leaf evaluation: a leaf can genuinely
  // have an open four sitting on the board (unlike move ordering, this isn't gated by the exact
  // win/block checks), so this needs to cover run lengths past 3 too. A flat linear runDiff
  // barely distinguished "opponent has a three" from "opponent has an open four" (60 points
  // apart at most), which is nowhere near enough for search to reliably steer away from leaving
  // a four-length threat unaddressed — it's one move from an automatic loss.
  const runThreat = (run: number): number => {
    if (run <= 0) return 0;
    if (run === 1) return 3;
    if (run === 2) return 14;
    if (run === 3) return 60;
    if (run === 4) return 320;
    return 320 + (run - 4) * 500;
  };
  const runDiff = runThreat(botLongestRun) - runThreat(opponentLongestRun) * 1.1;

  return actualScoreDiff * 150 + (botGroupPotential - opponentGroupPotential) * 15 + positional + runDiff;
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

// ---------------------------------------------------------------------------------------------
// Easy / Medium: scripted personalities, not search. Per the client's spec for the online-play
// rework, these two tiers are defined as an explicit schedule over the BOT'S OWN move count
// (1st move it makes, 2nd, 3rd, ...) so each phase can be dialed in independently by editing the
// ranges below, without touching the minimax engine that still drives Hard/Expert/Master.
// ---------------------------------------------------------------------------------------------

function countOwnerPieces(board: Cell[][], owner: PieceOwner): number {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === owner) count++;
    }
  }
  return count;
}

// "Blocking the five" per the client's spec means two distinct things: stopping an opponent run
// of 4 with an open end (one move from winning — makesFiveInRow already detects exactly this),
// and stopping an open three (a run of 3 with BOTH ends empty, since left alone it becomes an
// unstoppable open four). This scans for the latter: the first open three found, blocked at one
// of its two open ends.
function findOpenThreeBlockMove(board: Cell[][], opponent: PieceOwner): Move | null {
  for (const [dc, dr] of AXES) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== opponent) continue;

        const prevCol = col - dc;
        const prevRow = row - dr;
        const prevInBounds = prevCol >= 0 && prevCol < BOARD_SIZE && prevRow >= 0 && prevRow < BOARD_SIZE;
        if (prevInBounds && board[prevRow][prevCol] === opponent) continue; // not the start of a run

        const runLen = countDirection(board, opponent, col, row, dc, dr);
        if (runLen !== 3) continue;

        const afterCol = col + dc * runLen;
        const afterRow = row + dr * runLen;
        const afterInBounds = afterCol >= 0 && afterCol < BOARD_SIZE && afterRow >= 0 && afterRow < BOARD_SIZE;

        const beforeOpen = prevInBounds && board[prevRow][prevCol] === null;
        const afterOpen = afterInBounds && board[afterRow][afterCol] === null;
        if (beforeOpen && afterOpen) {
          return { col: afterCol, row: afterRow };
        }
      }
    }
  }
  return null;
}

function findGroupsWithMembers(board: Cell[][], owner: PieceOwner): Move[][] {
  const visited = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  const groups: Move[][] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] !== owner) continue;
      const startIdx = row * BOARD_SIZE + col;
      if (visited[startIdx]) continue;

      const cells: Move[] = [];
      const stack = [startIdx];
      visited[startIdx] = 1;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const r = (idx / BOARD_SIZE) | 0;
        const c = idx % BOARD_SIZE;
        cells.push({ col: c, row: r });

        for (const [dc, dr] of DIRECTIONS) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < BOARD_SIZE && nr >= 0 && nr < BOARD_SIZE) {
            const nIdx = nr * BOARD_SIZE + nc;
            if (board[nr][nc] === owner && !visited[nIdx]) {
              visited[nIdx] = 1;
              stack.push(nIdx);
            }
          }
        }
      }
      groups.push(cells);
    }
  }
  return groups;
}

// Medium's "every second move, try to cut off a group of 3-4 opponent pieces": picks the
// largest qualifying opponent group and plays a legal cell touching it, containing its growth
// rather than reacting to a specific line threat.
function findGroupCutoffMove(board: Cell[][], opponent: PieceOwner, legalMoves: Move[]): Move | null {
  const groups = findGroupsWithMembers(board, opponent).filter((g) => g.length >= 3 && g.length <= 4);
  if (groups.length === 0) return null;
  groups.sort((a, b) => b.length - a.length);

  const legalSet = new Set(legalMoves.map((m) => m.row * BOARD_SIZE + m.col));

  for (const group of groups) {
    const candidates: Move[] = [];
    for (const cell of group) {
      for (const [dc, dr] of DIRECTIONS) {
        const nc = cell.col + dc;
        const nr = cell.row + dr;
        if (nc >= 0 && nc < BOARD_SIZE && nr >= 0 && nr < BOARD_SIZE) {
          const idx = nr * BOARD_SIZE + nc;
          if (board[nr][nc] === null && legalSet.has(idx)) {
            candidates.push({ col: nc, row: nr });
          }
        }
      }
    }
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
  return null;
}

// Medium's "prefers building up its own groups": no search, just a greedy pick of whichever
// legal cell touches the most of the bot's own pieces (ties broken randomly).
function pickBuildingMove(board: Cell[][], owner: PieceOwner, moves: Move[]): Move {
  let bestScore = -1;
  let best: Move[] = [];
  for (const move of moves) {
    let score = 0;
    for (const [dc, dr] of DIRECTIONS) {
      const nc = move.col + dc;
      const nr = move.row + dr;
      if (nc >= 0 && nc < BOARD_SIZE && nr >= 0 && nr < BOARD_SIZE && board[nr][nc] === owner) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = [move];
    } else if (score === bestScore) {
      best.push(move);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

function restrictToInnerArea(moves: Move[], margin: number): Move[] {
  const lo = margin;
  const hi = BOARD_SIZE - 1 - margin;
  return moves.filter((m) => m.col >= lo && m.col <= hi && m.row >= lo && m.row <= hi);
}

// Move-count phase schedule, straight from the client's spec: which of the bot's own moves
// (1st, 2nd, 3rd, ...) actually engage the blocking logic below. Everything outside these
// ranges plays on regardless of any threat on the board — intentional, not a bug: new players
// mostly focus on landing their own five, and this is what lets that land often enough to feel
// rewarding at the easiest tier.
function easyShouldBlock(botMoveIndex: number): boolean {
  if (botMoveIndex <= 8) return true;
  if (botMoveIndex <= 11) return false;
  if (botMoveIndex <= 18) return true;
  if (botMoveIndex <= 23) return false;
  if (botMoveIndex <= 28) return true;
  return false;
}

function mediumShouldBlock(botMoveIndex: number): boolean {
  if (botMoveIndex <= 10) return true;
  if (botMoveIndex === 11) return false;
  if (botMoveIndex <= 18) return true;
  if (botMoveIndex <= 20) return false;
  if (botMoveIndex <= 30) return true;
  return false;
}

function chooseEasyMove(sim: SimState, botOwner: PieceOwner, opponent: PieceOwner, allMoves: Move[]): Move {
  const winningMove = allMoves.find((m) => makesFiveInRow(sim.board, botOwner, m.col, m.row));
  if (winningMove) return winningMove;

  const botPieceCount = countOwnerPieces(sim.board, botOwner);
  const botMoveIndex = botPieceCount + 1;

  if (easyShouldBlock(botMoveIndex)) {
    const fourBlock = allMoves.find((m) => makesFiveInRow(sim.board, opponent, m.col, m.row));
    if (fourBlock) return fourBlock;

    const threeBlock = findOpenThreeBlockMove(sim.board, opponent);
    if (threeBlock) {
      const legal = allMoves.find((m) => m.col === threeBlock.col && m.row === threeBlock.row);
      if (legal) return legal;
    }
  }

  // First move of the game for this bot only — no analysis otherwise, pure random.
  const pool = botPieceCount === 0 ? restrictToInnerArea(allMoves, 1) : allMoves;
  const candidates = pool.length > 0 ? pool : allMoves;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function chooseMediumMove(sim: SimState, botOwner: PieceOwner, opponent: PieceOwner, allMoves: Move[]): Move {
  const winningMove = allMoves.find((m) => makesFiveInRow(sim.board, botOwner, m.col, m.row));
  if (winningMove) return winningMove;

  const botPieceCount = countOwnerPieces(sim.board, botOwner);
  const botMoveIndex = botPieceCount + 1;

  if (mediumShouldBlock(botMoveIndex)) {
    const fourBlock = allMoves.find((m) => makesFiveInRow(sim.board, opponent, m.col, m.row));
    if (fourBlock) return fourBlock;

    const threeBlock = findOpenThreeBlockMove(sim.board, opponent);
    if (threeBlock) {
      const legal = allMoves.find((m) => m.col === threeBlock.col && m.row === threeBlock.row);
      if (legal) return legal;
    }
  }

  if (botMoveIndex % 2 === 0) {
    const cutoff = findGroupCutoffMove(sim.board, opponent, allMoves);
    if (cutoff) return cutoff;
  }

  const pool = botPieceCount === 0 ? restrictToInnerArea(allMoves, 2) : allMoves;
  const candidates = pool.length > 0 ? pool : allMoves;
  return pickBuildingMove(sim.board, botOwner, candidates);
}

export function chooseBotMove(state: GameState, botOwner: PieceOwner, difficulty: Difficulty): Move {
  const sim = fromGameState(state);
  const opponent: PieceOwner = botOwner === "green" ? "blue" : "green";
  const allMoves = legalMoves(sim);
  if (allMoves.length === 0) {
    throw new Error("Bot has no legal moves available");
  }

  if (difficulty === "easy") {
    return chooseEasyMove(sim, botOwner, opponent, allMoves);
  }
  if (difficulty === "medium") {
    return chooseMediumMove(sim, botOwner, opponent, allMoves);
  }

  const cap = CANDIDATE_CAP[difficulty];
  const innerCap = INNER_CANDIDATE_CAP[difficulty];
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
        const value = minimax(next, depth - 1, alpha, beta, botOwner, opponent, innerCap, deadline);
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
