import { BOARD_SIZE, PIECE_COUNT } from "../three/config";
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

export function calculatePlayerScore(board: Cell[][], owner: PieceOwner): number {
  const visited = Array.from({ length: BOARD_SIZE }, () => Array<boolean>(BOARD_SIZE).fill(false));
  let totalScore = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === owner && !visited[r][c]) {
        // Find all connected pieces in this group
        const group: BoardCoord[] = [];
        const queue: BoardCoord[] = [{ col: c, row: r }];
        visited[r][c] = true;

        while (queue.length > 0) {
          const current = queue.shift()!;
          group.push(current);

          for (const [dc, dr] of ORTHOGONAL_NEIGHBORS) {
            const nc = current.col + dc;
            const nr = current.row + dr;

            if (nc >= 0 && nc < BOARD_SIZE && nr >= 0 && nr < BOARD_SIZE) {
              if (board[nr][nc] === owner && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push({ col: nc, row: nr });
              }
            }
          }
        }

        // Only groups of size >= 5 count towards the score
        if (group.length >= 5) {
          totalScore += group.length;
        }
      }
    }
  }

  return totalScore;
}

export function isLegalMove(state: GameState, col: number, row: number): boolean {
  if (state.over) return false;
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return false;
  if (state.board[row][col] !== null) return false;

  let totalPiecesPlaced = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] !== null) totalPiecesPlaced++;
    }
  }
  const isFirstMoveOfGame = totalPiecesPlaced === 0;
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
  
  // Recalculate group-based scores for both players
  state.scores.green = calculatePlayerScore(state.board, "green");
  state.scores.blue = calculatePlayerScore(state.board, "blue");

  let totalPiecesPlaced = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] !== null) totalPiecesPlaced++;
    }
  }
  const boardFull = totalPiecesPlaced === BOARD_SIZE * BOARD_SIZE;
  const winningLine = findWinningLine(state.board, owner, col, row);

  if (winningLine) {
    state.over = true;
    state.winner = owner;
    state.endReason = "five-in-row";
    state.endTriggeredBy = owner;
    state.winningLine = winningLine;

    // A five-in-a-row is an automatic full win, scored as the full 32 regardless of how many
    // qualifying groups the winner had actually built up. The loser's score is untouched —
    // still exactly calculatePlayerScore()'s groups-of-5+ result from above, same rule as any
    // other end-of-game score.
    state.scores[owner] = PIECE_COUNT;
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

export function getPlayerGroups(board: Cell[][], owner: PieceOwner): number[] {
  const visited = Array.from({ length: BOARD_SIZE }, () => Array<boolean>(BOARD_SIZE).fill(false));
  const groups: number[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === owner && !visited[r][c]) {
        let size = 0;
        const queue: BoardCoord[] = [{ col: c, row: r }];
        visited[r][c] = true;

        while (queue.length > 0) {
          const current = queue.shift()!;
          size++;

          for (const [dc, dr] of ORTHOGONAL_NEIGHBORS) {
            const nc = current.col + dc;
            const nr = current.row + dr;

            if (nc >= 0 && nc < BOARD_SIZE && nr >= 0 && nr < BOARD_SIZE) {
              if (board[nr][nc] === owner && !visited[nr][nc]) {
                visited[nr][nc] = true;
                queue.push({ col: nc, row: nr });
              }
            }
          }
        }
        groups.push(size);
      }
    }
  }

  return groups.sort((a, b) => b - a);
}
