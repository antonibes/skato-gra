import * as THREE from "three";
import {
  PIECE_HEIGHT,
  DRAG_HEIGHT,
  GRAVITY,
  BOUNCE_DAMPING,
  MIN_BOUNCE_SPEED,
  TRAY_PIECES_PER_LAYER,
  cellToWorld,
  worldToCell,
} from "./config";
import { randomTraySpot, type Piece, type PieceOwner } from "./pieces";
import { isLegalMove, applyMove, type GameState } from "../game/rules";
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

// Raycast against the board surface (y=0), not the piece's lifted drag height — otherwise the
// elevated camera creates a parallax offset between where you point and where the piece lands.
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export interface Interaction {
  update: (delta: number) => void;
  placeForOwner: (tray: Tray, col: number, row: number) => boolean;
  dropIn: (piece: Piece, targetY: number) => void;
}

export function setupInteraction(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  trays: Tray[],
  state: GameState,
  onChange: () => void,
  getHumanOwner: () => PieceOwner | null
): Interaction {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const falling: FallingPiece[] = [];

  let dragging: { piece: Piece; tray: Tray } | null = null;

  function updatePointer(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isPlayableByTouch(tray: Tray): boolean {
    if (tray.owner !== state.current) return false;
    const humanOwner = getHumanOwner();
    return humanOwner === null || tray.owner === humanOwner;
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
    return null;
  }

  function dropInto(piece: Piece, targetY: number) {
    falling.push({ piece, velocityY: 0, targetY });
  }

  function returnToTray(piece: Piece, tray: Tray) {
    const layer = Math.floor(tray.pieces.length / TRAY_PIECES_PER_LAYER);
    const spot = randomTraySpot(tray.origin, layer);
    piece.mesh.position.x = spot.x;
    piece.mesh.position.z = spot.z;
    tray.pieces.push(piece);
    dropInto(piece, spot.y);
  }

  function commitPlacement(piece: Piece, col: number, row: number) {
    const world = cellToWorld(col, row);
    piece.mesh.position.x = world.x;
    piece.mesh.position.z = world.z;
    piece.mesh.rotation.y = 0;
    piece.placed = true;
    dropInto(piece, PIECE_HEIGHT / 2);
    playPlace();
    applyMove(state, piece.owner, col, row);
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
    playPickup();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, point)) {
      dragging.piece.mesh.position.x = point.x;
      dragging.piece.mesh.position.z = point.z;
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    const { piece, tray } = dragging;
    dragging = null;

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

  function update(delta: number) {
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
  }

  function placeForOwner(tray: Tray, col: number, row: number): boolean {
    if (!isLegalMove(state, col, row)) return false;
    const piece = tray.pieces.pop();
    if (!piece) return false;
    piece.mesh.position.y = DRAG_HEIGHT;
    commitPlacement(piece, col, row);
    return true;
  }

  return { update, placeForOwner, dropIn: dropInto };
}
