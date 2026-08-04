import { BOARD_SIZE } from "../three/config";
import type { PieceOwner } from "../three/pieces";

export type Cell = PieceOwner | null;

export interface BoardCoord {
  col: number;
  row: number;
}

export type EndReason = "five-in-row" | "board-full" | null;

export interface GameState {
  board: Cell[][];
  current: PieceOwner;
  scores: Record<PieceOwner, number>;
  over: boolean;
  winner: PieceOwner | "draw" | null;
  endReason: EndReason;
  endTriggeredBy: PieceOwner | null;
  winningLine: BoardCoord[] | null;
}

export function createGameState(startingPlayer: PieceOwner = "green"): GameState {
  return {
    board: Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null)),
    current: startingPlayer,
    scores: { green: 0, blue: 0 },
    over: false,
    winner: null,
    endReason: null,
    endTriggeredBy: null,
    winningLine: null,
  };
}

const ORTHOGONAL_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function isLegalMove(state: GameState, col: number, row: number): boolean {
  if (state.over) return false;
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return false;
  if (state.board[row][col] !== null) return false;

  const isFirstMoveOfGame = state.scores.green + state.scores.blue === 0;
  if (isFirstMoveOfGame) return true;

  return ORTHOGONAL_NEIGHBORS.some(([dc, dr]) => {
    const c = col + dc;
    const r = row + dr;
    return c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && state.board[r][c] !== null;
  });
}

function collectRun(board: Cell[][], owner: PieceOwner, col: number, row: number, dc: number, dr: number): BoardCoord[] {
  const run: BoardCoord[] = [{ col, row }];

  let c = col + dc;
  let r = row + dr;
  while (c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && board[r][c] === owner) {
    run.push({ col: c, row: r });
    c += dc;
    r += dr;
  }

  c = col - dc;
  r = row - dr;
  while (c >= 0 && c < BOARD_SIZE && r >= 0 && r < BOARD_SIZE && board[r][c] === owner) {
    run.unshift({ col: c, row: r });
    c -= dc;
    r -= dr;
  }

  return run;
}

function findWinningLine(board: Cell[][], owner: PieceOwner, col: number, row: number): BoardCoord[] | null {
  const horizontal = collectRun(board, owner, col, row, 1, 0);
  if (horizontal.length >= 5) return horizontal;

  const vertical = collectRun(board, owner, col, row, 0, 1);
  if (vertical.length >= 5) return vertical;

  return null;
}

/** Places a piece and mutates state in place: score, turn, and end-of-game outcome. */
export function applyMove(state: GameState, owner: PieceOwner, col: number, row: number): void {
  state.board[row][col] = owner;
  state.scores[owner] += 1;

  const boardFull = state.scores.green + state.scores.blue === BOARD_SIZE * BOARD_SIZE;
  const winningLine = findWinningLine(state.board, owner, col, row);

  if (winningLine) {
    state.over = true;
    state.winner = owner;
    state.endReason = "five-in-row";
    state.endTriggeredBy = owner;
    state.winningLine = winningLine;
  } else if (boardFull) {
    state.over = true;
    state.winner =
      state.scores.green === state.scores.blue ? "draw" : state.scores.green > state.scores.blue ? "green" : "blue";
    state.endReason = "board-full";
    state.endTriggeredBy = null;
    state.winningLine = null;
  } else {
    state.current = owner === "green" ? "blue" : "green";
  }
}
