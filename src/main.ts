import * as THREE from "three";
import { createSceneRig } from "./three/scene";
import { createBoard } from "./three/board";
import { createTable } from "./three/table";
import { createTrayMesh, createScatteredPieces, createDemoPiece, randomTraySpot, type PieceOwner } from "./three/pieces";
import { setupInteraction, type Tray } from "./three/interaction";
import { animateCameraTo, menuPose, gamePose } from "./three/cameraRig";
import {
  BOARD_SIZE,
  BOARD_HALF,
  TRAY_RADIUS,
  TRAY_BOARD_MARGIN,
  TRAY_PIECES_PER_LAYER,
  COLOR,
  PIECE_COUNT,
  PIECE_HEIGHT,
  cellToWorld,
} from "./three/config";
import { createGameState, type BoardCoord } from "./game/rules";
import { chooseBotMove, type Difficulty } from "./game/bot";
import { playWin, playLose, playDraw, setVolume, getVolume } from "./audio/sound";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const menuScreen = document.getElementById("menu-screen")!;
const modeScreen = document.getElementById("mode-screen")!;
const botSetupScreen = document.getElementById("bot-setup-screen")!;
const onlineScreen = document.getElementById("online-screen")!;
const onlineInfoScreen = document.getElementById("online-info-screen")!;
const onlineInfoTitle = document.getElementById("online-info-title")!;
const onlineInfoText = document.getElementById("online-info-text")!;
const settingsScreen = document.getElementById("settings-screen")!;
const playButton = document.getElementById("play-button")!;
const playOnlineButton = document.getElementById("play-online-button")!;
const settingsButton = document.getElementById("settings-button")!;
const localModeButton = document.getElementById("local-mode-button")!;
const botModeButton = document.getElementById("bot-mode-button")!;
const botStartButton = document.getElementById("bot-start-button")!;
const botBackButton = document.getElementById("bot-back-button")!;
const difficultyGroup = document.getElementById("difficulty-group")!;
const colorGroup = document.getElementById("color-group")!;
const onlineCreateButton = document.getElementById("online-create-button")!;
const onlineJoinButton = document.getElementById("online-join-button")!;
const onlineLeaderboardButton = document.getElementById("online-leaderboard-button")!;
const onlineBackButton = document.getElementById("online-back-button")!;
const onlineInfoBackButton = document.getElementById("online-info-back-button")!;
const settingsBackButton = document.getElementById("settings-back-button")!;
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
const hud = document.getElementById("hud")!;
const hudBlue = document.getElementById("hud-blue")!;
const hudGreen = document.getElementById("hud-green")!;
const scoreBlue = document.getElementById("score-blue")!;
const scoreGreen = document.getElementById("score-green")!;
const resultScreen = document.getElementById("result-screen")!;
const resultTitle = document.getElementById("result-title")!;
const resultReason = document.getElementById("result-reason")!;
const resultScore = document.getElementById("result-score")!;
const restartButton = document.getElementById("restart-button")!;

const { renderer, scene, camera } = createSceneRig(canvas);

const initialPose = menuPose(camera);
camera.position.copy(initialPose.position);
camera.lookAt(initialPose.lookAt);

scene.add(createTable());
scene.add(createBoard());

/** A small connected, alternating-color layout so the menu background looks like a game
 *  already in progress instead of an empty board. Purely decorative — cleared on game start. */
function generateDemoLayout(): { col: number; row: number; owner: PieceOwner }[] {
  const cells: { col: number; row: number; owner: PieceOwner }[] = [];
  const start = Math.floor(BOARD_SIZE / 2) - 2;
  const end = Math.floor(BOARD_SIZE / 2) + 1;
  for (let row = start; row <= end; row++) {
    for (let col = start; col <= end; col++) {
      const owner: PieceOwner = (row + col) % 2 === 0 ? "green" : "blue";
      cells.push({ col, row, owner });
    }
  }
  return cells;
}

const demoPieces: THREE.Mesh[] = [];

function spawnDemoBoard() {
  const board = scene.getObjectByName("board");
  for (const cell of generateDemoLayout()) {
    const world = cellToWorld(cell.col, cell.row);
    const mesh = createDemoPiece(cell.owner === "green" ? COLOR.green : COLOR.blue);
    mesh.position.set(world.x, PIECE_HEIGHT / 2, world.z);
    if (board) {
      board.add(mesh);
    } else {
      scene.add(mesh);
    }
    demoPieces.push(mesh);
  }
}

spawnDemoBoard();

function clearDemoBoard() {
  const duration = 450;
  const board = scene.getObjectByName("board");
  for (const mesh of demoPieces) {
    const startTime = performance.now() + Math.random() * 300;
    const material = mesh.material as THREE.MeshStandardMaterial;
    function step(now: number) {
      if (now < startTime) {
        requestAnimationFrame(step);
        return;
      }
      const t = Math.min((now - startTime) / duration, 1);
      mesh.scale.setScalar(Math.max(1 - t, 0.001));
      material.opacity = 1 - t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        if (board) {
          board.remove(mesh);
        } else {
          scene.remove(mesh);
        }
      }
    }
    requestAnimationFrame(step);
  }
  demoPieces.length = 0;
}

const trayZ = BOARD_HALF + TRAY_RADIUS + TRAY_BOARD_MARGIN;
const nearOrigin = { x: 0, z: trayZ };
const farOrigin = { x: 0, z: -trayZ };

const greenTrayMesh = createTrayMesh();
greenTrayMesh.position.set(nearOrigin.x, 0, nearOrigin.z);
const blueTrayMesh = createTrayMesh();
blueTrayMesh.position.set(farOrigin.x, 0, farOrigin.z);

const greenTray: Tray = {
  owner: "green",
  origin: nearOrigin,
  pieces: createScatteredPieces("green", COLOR.green, PIECE_COUNT, nearOrigin),
};
const blueTray: Tray = {
  owner: "blue",
  origin: farOrigin,
  pieces: createScatteredPieces("blue", COLOR.blue, PIECE_COUNT, farOrigin),
};

const highlightGeometry = new THREE.RingGeometry(PIECE_HEIGHT * 2.1, PIECE_HEIGHT * 2.7, 24);
const highlightMaterial = new THREE.MeshBasicMaterial({
  color: COLOR.gold,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});
const highlightRings: THREE.Mesh[] = [];

function clearHighlights() {
  for (const ring of highlightRings) scene.remove(ring);
  highlightRings.length = 0;
}

function highlightWinningLine(cells: BoardCoord[]) {
  clearHighlights();
  for (const cell of cells) {
    const world = cellToWorld(cell.col, cell.row);
    const ring = new THREE.Mesh(highlightGeometry, highlightMaterial.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(world.x, PIECE_HEIGHT + 0.02, world.z);
    scene.add(ring);
    highlightRings.push(ring);
  }
}

function trayMeshFor(owner: PieceOwner): THREE.Group {
  return owner === "green" ? greenTrayMesh : blueTrayMesh;
}

function relocateTray(tray: Tray, origin: { x: number; z: number }) {
  tray.origin = origin;
  trayMeshFor(tray.owner).position.set(origin.x, 0, origin.z);
  tray.pieces.forEach((piece, index) => {
    const layer = Math.floor(index / TRAY_PIECES_PER_LAYER);
    const spot = randomTraySpot(origin, layer);
    piece.mesh.position.set(spot.x, spot.y, spot.z);
  });
}

/** Puts the given color's tray on the near (reachable) side of the board, the other on the far side. */
function arrangeTrays(nearOwner: PieceOwner) {
  const farOwner: PieceOwner = nearOwner === "green" ? "blue" : "green";
  relocateTray(trayFor(nearOwner), nearOrigin);
  relocateTray(trayFor(farOwner), farOrigin);
}

function easeOutBack(t: number): number {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function animateGroupDrop(group: THREE.Object3D, fromY: number, toY: number, duration: number, delayMs = 0) {
  const startTime = performance.now() + delayMs;
  group.position.y = fromY;
  function step(now: number) {
    if (now < startTime) {
      requestAnimationFrame(step);
      return;
    }
    const t = Math.min((now - startTime) / duration, 1);
    group.position.y = fromY + (toY - fromY) * easeOutBack(t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

let traysSpawned = false;

/** Baskets and tiles stay out of the scene until the player actually starts a game, then drop in. */
function spawnTrays() {
  if (traysSpawned) return;
  traysSpawned = true;

  scene.add(greenTrayMesh, blueTrayMesh);
  animateGroupDrop(greenTrayMesh, 5, 0, 650);
  animateGroupDrop(blueTrayMesh, 5, 0, 650, 140);

  for (const piece of [...greenTray.pieces, ...blueTray.pieces]) {
    const targetY = piece.mesh.position.y;
    piece.mesh.position.y = targetY + 4 + Math.random() * 2;
    scene.add(piece.mesh);
    interaction.dropIn(piece, targetY);
  }
}

const state = createGameState("green");

interface BotConfig {
  owner: PieceOwner;
  difficulty: Difficulty;
}

let botConfig: BotConfig | null = null;
let botThinking = false;

function trayFor(owner: PieceOwner): Tray {
  return owner === "green" ? greenTray : blueTray;
}

function maybeTriggerBot() {
  if (!botConfig || state.over || botThinking) return;
  if (state.current !== botConfig.owner) return;

  botThinking = true;
  setTimeout(() => {
    const move = chooseBotMove(state, botConfig!.owner, botConfig!.difficulty);
    interaction.placeForOwner(trayFor(botConfig!.owner), move.col, move.row);
    botThinking = false;
  }, 550);
}

function outcomeLabel(): string {
  if (state.winner === "draw") return "Remis";
  if (botConfig) {
    const humanOwner: PieceOwner = botConfig.owner === "green" ? "blue" : "green";
    return state.winner === humanOwner ? "Wygrałeś!" : "Przegrałeś";
  }
  return state.winner === "green" ? "Wygrywa zielony" : "Wygrywa niebieski";
}

function reasonLabel(): string {
  if (state.endReason === "five-in-row") {
    const mover = state.endTriggeredBy === "green" ? "Zielony" : "Niebieski";
    return `${mover} ułożył 5 w rzędzie — automatyczna wygrana.`;
  }
  return "Plansza została całkowicie zapełniona.";
}

function playOutcomeSound() {
  if (state.winner === "draw") {
    playDraw();
    return;
  }
  if (botConfig) {
    const humanOwner: PieceOwner = botConfig.owner === "green" ? "blue" : "green";
    if (state.winner === humanOwner) playWin();
    else playLose();
  } else {
    playWin();
  }
}

function refreshHud() {
  scoreBlue.textContent = String(state.scores.blue);
  scoreGreen.textContent = String(state.scores.green);
  hudBlue.classList.toggle("hud-player--active", !state.over && state.current === "blue");
  hudGreen.classList.toggle("hud-player--active", !state.over && state.current === "green");

  if (state.over) {
    resultTitle.textContent = outcomeLabel();
    resultReason.textContent = reasonLabel();
    resultScore.textContent = `${state.scores.green} : ${state.scores.blue}`;
    if (state.winningLine) highlightWinningLine(state.winningLine);
    playOutcomeSound();
    setTimeout(() => resultScreen.classList.remove("hidden"), 1300);
    return;
  }

  maybeTriggerBot();
}

const interaction = setupInteraction(renderer, camera, [greenTray, blueTray], state, refreshHud, () =>
  botConfig ? (botConfig.owner === "green" ? "blue" : "green") : null
);

let gameStarted = false;

function startGame() {
  gameStarted = true;
  modeScreen.classList.add("hidden");
  botSetupScreen.classList.add("hidden");
  clearDemoBoard();
  spawnTrays();

  // Smoothly animate the board back to 0 rotation
  const board = scene.getObjectByName("board");
  if (board) {
    const activeBoard = board;
    const startRotY = activeBoard.rotation.y;
    const duration = 1500;
    const startTime = performance.now();
    function resetRot(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Smoothstep easing
      const eased = t * t * (3 - 2 * t);
      activeBoard.rotation.y = startRotY * (1 - eased);
      if (t < 1) {
        requestAnimationFrame(resetRot);
      } else {
        activeBoard.rotation.y = 0;
      }
    }
    requestAnimationFrame(resetRot);
  }

  const from = menuPose(camera);
  const to = gamePose(camera);
  animateCameraTo(camera, from, to, 1800, () => {
    hud.classList.remove("hidden");
    refreshHud();
  });
}

playButton.addEventListener("click", () => {
  menuScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
});

localModeButton.addEventListener("click", () => {
  botConfig = null;
  arrangeTrays("green");
  startGame();
});

botModeButton.addEventListener("click", () => {
  modeScreen.classList.add("hidden");
  botSetupScreen.classList.remove("hidden");
});

botBackButton.addEventListener("click", () => {
  botSetupScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
});

let selectedDifficulty: Difficulty = "easy";
let selectedHumanColor: PieceOwner = "green";

for (const button of difficultyGroup.querySelectorAll<HTMLButtonElement>(".btn-choice")) {
  if (button.dataset.difficulty === selectedDifficulty) button.classList.add("btn-choice--selected");
  button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.difficulty as Difficulty;
    for (const other of difficultyGroup.querySelectorAll(".btn-choice")) {
      other.classList.toggle("btn-choice--selected", other === button);
    }
  });
}

for (const button of colorGroup.querySelectorAll<HTMLButtonElement>(".btn-choice")) {
  if (button.dataset.color === selectedHumanColor) button.classList.add("btn-choice--selected");
  button.addEventListener("click", () => {
    selectedHumanColor = button.dataset.color as PieceOwner;
    for (const other of colorGroup.querySelectorAll(".btn-choice")) {
      other.classList.toggle("btn-choice--selected", other === button);
    }
  });
}

botStartButton.addEventListener("click", () => {
  botConfig = {
    owner: selectedHumanColor === "green" ? "blue" : "green",
    difficulty: selectedDifficulty,
  };
  arrangeTrays(selectedHumanColor);
  startGame();
});

restartButton.addEventListener("click", () => {
  window.location.reload();
});

playOnlineButton.addEventListener("click", () => {
  menuScreen.classList.add("hidden");
  onlineScreen.classList.remove("hidden");
});

onlineBackButton.addEventListener("click", () => {
  onlineScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
});

function showOnlineInfo(title: string, text: string) {
  onlineInfoTitle.textContent = title;
  onlineInfoText.textContent = text;
  onlineScreen.classList.add("hidden");
  onlineInfoScreen.classList.remove("hidden");
}

onlineCreateButton.addEventListener("click", () => {
  const code = Math.random().toString(36).slice(2, 7).toUpperCase();
  showOnlineInfo(
    "TWOJE LOBBY",
    `Kod lobby: ${code}\n\nGra online wymaga serwera — ta funkcja pojawi się w kolejnej aktualizacji.`
  );
});

onlineJoinButton.addEventListener("click", () => {
  showOnlineInfo("DOŁĄCZ DO LOBBY", "Gra online wymaga serwera — ta funkcja pojawi się w kolejnej aktualizacji.");
});

onlineLeaderboardButton.addEventListener("click", () => {
  showOnlineInfo("RANKING", "Ranking graczy pojawi się razem z trybem online.");
});

onlineInfoBackButton.addEventListener("click", () => {
  onlineInfoScreen.classList.add("hidden");
  onlineScreen.classList.remove("hidden");
});

settingsButton.addEventListener("click", () => {
  menuScreen.classList.add("hidden");
  settingsScreen.classList.remove("hidden");
});

settingsBackButton.addEventListener("click", () => {
  settingsScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
});

volumeSlider.value = String(Math.round(getVolume() * 100));
volumeSlider.addEventListener("input", () => {
  setVolume(Number(volumeSlider.value) / 100);
});

const clock = new THREE.Clock();

function tick() {
  const delta = Math.min(clock.getDelta(), 0.05);
  interaction.update(delta);

  if (!gameStarted) {
    const board = scene.getObjectByName("board");
    if (board) {
      board.rotation.y += 0.08 * delta;
    }
  }

  if (highlightRings.length > 0) {
    const pulse = 0.55 + Math.sin(clock.getElapsedTime() * 4) * 0.3;
    for (const ring of highlightRings) {
      (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
