import * as THREE from "three";
import {
  PIECE_HEIGHT,
  PIECE_SIZE,
  DRAG_HEIGHT,
  GRAVITY,
  BOUNCE_DAMPING,
  MIN_BOUNCE_SPEED,
  TRAY_PIECES_PER_LAYER,
  cellToWorld,
  worldToCell,
} from "./config";
import { randomTraySpot, type Piece, type PieceOwner } from "./pieces";
import { isLegalMove, applyMove, calculatePlayerScore, type GameState } from "../game/rules";
import { playPickup, playPlace } from "../audio/sound";

export interface Tray {
  owner: PieceOwner;
  origin: { x: number; z: number };
  pieces: Piece[];
}

interface FallingPiece {
  piece: Piece;
  velocityY: number;
  targetY: number;
}

interface PlacementRecord {
  piece: Piece;
  col: number;
  row: number;
  owner: PieceOwner;
}

// Raycast against the board surface (y=0), not the piece's lifted drag height — otherwise the
// elevated camera creates a parallax offset between where you point and where the piece lands.
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// A tap doesn't need to land exactly inside a piece's own footprint — this is the effective
// touch target radius (in world units) used as a fallback when the precise raycast misses.
const PICKUP_TOLERANCE = PIECE_SIZE * 1.3;

// While dragging, the effective aim point is shifted this many CSS pixels above the actual
// finger — on a phone your fingertip sits right on top of the cell you're trying to hit, so
// aiming "through" the finger is unreliable. Shifting the aim point (and therefore the piece
// and the target-cell highlight, since both are driven by the same point) up and clear of the
// finger means what you see is what you get, instead of guessing at a hidden target.
const DRAG_SCREEN_OFFSET_PX = 100;

// Held noticeably larger than its resting size, on top of the screen-space offset above, so the
// piece itself is unambiguous while airborne.
const DRAG_SCALE = 1.6;

export interface DragCandidate {
  col: number;
  row: number;
  legal: boolean;
}

export interface Interaction {
  update: (delta: number) => boolean;
  placeForOwner: (tray: Tray, col: number, row: number) => boolean;
  dropIn: (piece: Piece, targetY: number) => void;
  undoToPreviousTurn: (humanOwner: PieceOwner) => boolean;
}

export function setupInteraction(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  trays: Tray[],
  state: GameState,
  onChange: () => void,
  getHumanOwner: () => PieceOwner | null,
  onDragUpdate: (candidate: DragCandidate | null) => void = () => {}
): Interaction {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const falling: FallingPiece[] = [];
  const history: PlacementRecord[] = [];

  let dragging: { piece: Piece; tray: Tray } | null = null;

  function updatePointer(event: PointerEvent, offsetYPx = 0) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - offsetYPx - rect.top) / rect.height) * 2 + 1;
  }

  function isPlayableByTouch(tray: Tray): boolean {
    if (tray.owner !== state.current) return false;
    const humanOwner = getHumanOwner();
    return humanOwner === null || tray.owner === humanOwner;
  }

  /** Fallback for imprecise touch: finds the nearest pickable piece to where the ray crosses
   *  that piece's own height, within a forgiving radius — used only when the exact-geometry
   *  raycast below misses, so slightly missing a small piece on a phone screen still works. */
  function nearestPieceWithinTolerance(): { piece: Piece; tray: Tray } | null {
    raycaster.setFromCamera(pointer, camera);
    let best: { piece: Piece; tray: Tray; dist: number } | null = null;

    for (const tray of trays) {
      if (!isPlayableByTouch(tray)) continue;
      for (const piece of tray.pieces) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -piece.mesh.position.y);
        const point = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, point)) continue;
        const dist = Math.hypot(point.x - piece.mesh.position.x, point.z - piece.mesh.position.z);
        if (dist <= PICKUP_TOLERANCE && (!best || dist < best.dist)) {
          best = { piece, tray, dist };
        }
      }
    }

    return best ? { piece: best.piece, tray: best.tray } : null;
  }

  function pieceAtPointer(): { piece: Piece; tray: Tray } | null {
    raycaster.setFromCamera(pointer, camera);
    for (const tray of trays) {
      if (!isPlayableByTouch(tray)) continue;
      const meshes = tray.pieces.map((p) => p.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const mesh = hits[0].object;
        const piece = tray.pieces.find((p) => p.mesh === mesh);
        if (piece) return { piece, tray };
      }
    }
    return nearestPieceWithinTolerance();
  }

  function dropInto(piece: Piece, targetY: number) {
    falling.push({ piece, velocityY: 0, targetY });
  }

  function returnToTray(piece: Piece, tray: Tray) {
    piece.mesh.castShadow = true;
    piece.mesh.scale.setScalar(1);
    const layer = Math.floor(tray.pieces.length / TRAY_PIECES_PER_LAYER);
    const spot = randomTraySpot(tray.origin, layer);
    piece.mesh.position.x = spot.x;
    piece.mesh.position.z = spot.z;
    tray.pieces.push(piece);
    dropInto(piece, spot.y);
  }

  function commitPlacement(piece: Piece, col: number, row: number) {
    piece.mesh.castShadow = true;
    piece.mesh.scale.setScalar(1);
    const world = cellToWorld(col, row);
    piece.mesh.position.x = world.x;
    piece.mesh.position.z = world.z;
    piece.mesh.rotation.y = 0;
    piece.placed = true;
    dropInto(piece, PIECE_HEIGHT / 2);
    playPlace();
    applyMove(state, piece.owner, col, row);
    history.push({ piece, col, row, owner: piece.owner });
    onChange();
  }

  function onPointerDown(event: PointerEvent) {
    if (state.over) return;
    updatePointer(event);
    const hit = pieceAtPointer();
    if (!hit) return;

    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // some mobile browsers reject capture on rapid re-touch — the drag still works without it
    }
    const { piece, tray } = hit;
    tray.pieces.splice(tray.pieces.indexOf(piece), 1);
    dragging = { piece, tray };
    piece.mesh.position.y = DRAG_HEIGHT;
    piece.mesh.scale.setScalar(DRAG_SCALE);
    // No cast shadow while airborne — the live gold/red cell highlight is the authoritative
    // "where will this land" indicator; a real cast shadow at this height would drift away from
    // it (light isn't perfectly vertical) and read as a second, conflicting target.
    piece.mesh.castShadow = false;
    playPickup();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    updatePointer(event, DRAG_SCREEN_OFFSET_PX);
    raycaster.setFromCamera(pointer, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, point)) {
      dragging.piece.mesh.position.x = point.x;
      dragging.piece.mesh.position.z = point.z;
      const { col, row } = worldToCell(point.x, point.z);
      onDragUpdate({ col, row, legal: isLegalMove(state, col, row) });
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    const { piece, tray } = dragging;
    dragging = null;
    onDragUpdate(null);

    const { x, z } = piece.mesh.position;
    const { col, row } = worldToCell(x, z);

    if (isLegalMove(state, col, row)) {
      commitPlacement(piece, col, row);
    } else {
      returnToTray(piece, tray);
    }

    try {
      renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already have been released by the browser (e.g. touch-cancel) — safe to ignore
    }
  }

  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerUp);

  /** Returns whether anything actually moved this frame — used to decide whether the shadow
   *  map needs recomputing (see scene.ts: it's frozen by default for performance). */
  function update(delta: number): boolean {
    const wasActive = falling.length > 0 || dragging !== null;

    for (let i = falling.length - 1; i >= 0; i--) {
      const fp = falling[i];
      fp.velocityY += GRAVITY * delta;
      const nextY = fp.piece.mesh.position.y + fp.velocityY * delta;

      if (nextY <= fp.targetY) {
        fp.piece.mesh.position.y = fp.targetY;
        if (Math.abs(fp.velocityY) > MIN_BOUNCE_SPEED) {
          fp.velocityY = -fp.velocityY * BOUNCE_DAMPING;
        } else {
          falling.splice(i, 1);
        }
      } else {
        fp.piece.mesh.position.y = nextY;
      }
    }

    return wasActive || falling.length > 0 || dragging !== null;
  }

  function placeForOwner(tray: Tray, col: number, row: number): boolean {
    if (!isLegalMove(state, col, row)) return false;
    const piece = tray.pieces.pop();
    if (!piece) return false;
    piece.mesh.position.y = DRAG_HEIGHT;
    commitPlacement(piece, col, row);
    return true;
  }

  function undoOnePlacement(): boolean {
    const record = history.pop();
    if (!record) return false;

    const { piece, col, row, owner } = record;
    state.board[row][col] = null;
    state.scores.green = calculatePlayerScore(state.board, "green");
    state.scores.blue = calculatePlayerScore(state.board, "blue");
    state.over = false;
    state.winner = null;
    state.endReason = null;
    state.endTriggeredBy = null;
    state.winningLine = null;
    state.current = owner;

    piece.placed = false;
    const tray = trays.find((t) => t.owner === owner);
    if (tray) {
      const layer = Math.floor(tray.pieces.length / TRAY_PIECES_PER_LAYER);
      const spot = randomTraySpot(tray.origin, layer);
      piece.mesh.position.x = spot.x;
      piece.mesh.position.z = spot.z;
      tray.pieces.push(piece);
      dropInto(piece, spot.y);
    }
    return true;
  }

  /** Undoes moves until it's the given player's turn again with their own last placement taken
   *  back — i.e. reverts the bot's reply along with the human's move that triggered it, landing
   *  back on the human's turn as if that move never happened. */
  function undoToPreviousTurn(humanOwner: PieceOwner): boolean {
    let undidAny = false;

    while (history.length > 0 && history[history.length - 1].owner !== humanOwner) {
      if (!undoOnePlacement()) break;
      undidAny = true;
    }

    if (history.length > 0 && history[history.length - 1].owner === humanOwner) {
      undidAny = undoOnePlacement() || undidAny;
    }

    return undidAny;
  }

  return { update, placeForOwner, dropIn: dropInto, undoToPreviousTurn };
}
