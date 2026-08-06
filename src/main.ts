import * as THREE from "three";
import { createSceneRig } from "./three/scene";
import { createBoard } from "./three/board";
import { createTable } from "./three/table";
import { createTrayMesh, createScatteredPieces, createDemoPiece, randomTraySpot, type PieceOwner } from "./three/pieces";
import { setupInteraction, type Tray, type DragCandidate } from "./three/interaction";
import { animateCameraTo, menuPose, gamePose, endPose } from "./three/cameraRig";
import {
  BOARD_SIZE,
  BOARD_HALF,
  CELL_SIZE,
  TRAY_RADIUS,
  TRAY_BOARD_MARGIN,
  TRAY_PIECES_PER_LAYER,
  COLOR,
  PIECE_COUNT,
  PIECE_HEIGHT,
  cellToWorld,
} from "./three/config";
import { createGameState, getPlayerGroups, type BoardCoord } from "./game/rules";
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
const playButton = document.getElementById("play-button")!;
const playOnlineButton = document.getElementById("play-online-button")!;
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
const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
const hud = document.getElementById("hud")!;
const hudBlue = document.getElementById("hud-blue")!;
const hudGreen = document.getElementById("hud-green")!;
const scoreBlue = document.getElementById("score-blue")!;
const scoreGreen = document.getElementById("score-green")!;
const resultScreen = document.getElementById("result-screen")!;
const resultBadge = document.getElementById("result-badge")!;
const resultTitle = document.getElementById("result-title")!;
const resultReason = document.getElementById("result-reason")!;
const resultScoreGreen = document.getElementById("result-score-green")!;
const resultScoreBlue = document.getElementById("result-score-blue")!;
const resultCalcGreen = document.getElementById("result-calc-green")!;
const resultCalcBlue = document.getElementById("result-calc-blue")!;
const hudTimer = document.getElementById("hud-timer")!;
const undoButton = document.getElementById("undo-button")!;
const undoCountEl = document.getElementById("undo-count")!;
const restartButton = document.getElementById("restart-button")!;
const howtoScreen = document.getElementById("howto-screen")!;
const openHowtoButton = document.getElementById("open-howto-button")!;
const howtoCloseButton = document.getElementById("howto-close-button")!;

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

// Optional "which cell will this land on" indicator (gold/red), shown while dragging — off by
// default since the piece now sits close enough to the board to be its own preview, but some
// players prefer the extra cue, so it's a toggle in Settings.
const HIGHLIGHT_SETTING_KEY = "skato_highlight_enabled";
let highlightEnabled = localStorage.getItem(HIGHLIGHT_SETTING_KEY) === "1";

const dragHighlightMaterial = new THREE.MeshBasicMaterial({
  color: COLOR.gold,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
const dragHighlightMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92),
  dragHighlightMaterial
);
dragHighlightMesh.rotation.x = -Math.PI / 2;
dragHighlightMesh.visible = false;
scene.add(dragHighlightMesh);

const DRAG_LEGAL_COLOR = new THREE.Color(COLOR.gold);
const DRAG_ILLEGAL_COLOR = new THREE.Color(0xc0453f);

function onDragUpdate(candidate: DragCandidate | null) {
  if (!highlightEnabled || !candidate) {
    dragHighlightMesh.visible = false;
    return;
  }
  const world = cellToWorld(candidate.col, candidate.row);
  dragHighlightMesh.position.set(world.x, PIECE_HEIGHT + 0.015, world.z);
  dragHighlightMesh.visible = true;
  dragHighlightMaterial.color.copy(candidate.legal ? DRAG_LEGAL_COLOR : DRAG_ILLEGAL_COLOR);
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

// Undo is a training aid: only offered on the two easiest bot tiers, and only a couple of times
// per game, so it doesn't undermine the harder/ranked levels.
let undoUsesRemaining = 0;

function undoUsesForDifficulty(difficulty: Difficulty): number {
  return difficulty === "easy" || difficulty === "medium" ? 2 : 0;
}

function trayFor(owner: PieceOwner): Tray {
  return owner === "green" ? greenTray : blueTray;
}

function maybeTriggerBot() {
  if (!botConfig || state.over || botThinking) return;
  if (state.current !== botConfig.owner) return;

  botThinking = true;
  setTimeout(() => {
    const move = chooseBotMove(state, botConfig!.owner, botConfig!.difficulty);
    // Reset before placing: placeForOwner triggers a nested refreshHud() call (via onChange),
    // and that call needs to see botThinking already false, or the undo button (gated on
    // !botThinking) evaluates itself hidden right when the bot moves and never gets a later
    // refreshHud() call to correct itself — it would just stay stuck hidden.
    botThinking = false;
    interaction.placeForOwner(trayFor(botConfig!.owner), move.col, move.row);
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

function formatScoreCalc(groups: number[]): string {
  const scoring = groups.filter((g) => g >= 5);
  if (scoring.length === 0) return "Brak grup ≥ 5";
  return scoring.join(" + ");
}

/** For an early win the winner's score is forced to the full 32 and the loser's to their raw
 *  placed-piece count (see rules.ts) — the group breakdown no longer matches those numbers, so
 *  show what actually happened instead of a stale "9 + 6 = 15 pkt" next to a displayed 32. */
function calcTextFor(owner: PieceOwner): string {
  if (state.endReason === "five-in-row") {
    if (owner === state.winner) return "Automatyczna wygrana";
    return `Ułożone pionki: ${state.scores[owner]}`;
  }
  return formatScoreCalc(getPlayerGroups(state.board, owner));
}

let matchStartTime: number | null = null;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function refreshHud() {
  scoreBlue.textContent = String(state.scores.blue);
  scoreGreen.textContent = String(state.scores.green);
  hudBlue.classList.toggle("hud-player--active", !state.over && state.current === "blue");
  hudGreen.classList.toggle("hud-player--active", !state.over && state.current === "green");

  const canOfferUndo = botConfig !== null && undoUsesRemaining > 0 && !state.over && !botThinking;
  undoButton.classList.toggle("hidden", !canOfferUndo);
  if (canOfferUndo) undoCountEl.textContent = String(undoUsesRemaining);

  if (state.over) {
    animateCameraTo(camera, gamePose(camera), endPose(camera), 1400);

    // The end-of-game camera frames just the board — hide the baskets (and whatever pieces
    // are still sitting in them) so the overview reads as a clean finished board, not a shot
    // that happens to catch the trays at its edges.
    greenTrayMesh.visible = false;
    blueTrayMesh.visible = false;
    for (const piece of [...greenTray.pieces, ...blueTray.pieces]) piece.mesh.visible = false;

    resultTitle.textContent = outcomeLabel();
    resultReason.textContent = reasonLabel();

    // Set score values
    resultScoreGreen.textContent = String(state.scores.green);
    resultScoreBlue.textContent = String(state.scores.blue);

    // Set group calculation breakdowns (or early-win explanation)
    resultCalcGreen.textContent = calcTextFor("green");
    resultCalcBlue.textContent = calcTextFor("blue");

    // Setup result badge
    resultBadge.className = "result-badge";
    if (state.winner === "draw") {
      resultBadge.textContent = "Remis";
      resultBadge.classList.add("result-badge--draw");
    } else if (activeCampaignLevel !== null) {
      const config = campaignLevels[activeCampaignLevel];
      const humanOwner = config.playerColor;

      if (state.winner === humanOwner) {
        // Player won!
        const diff = Math.abs(state.scores[config.playerColor] - state.scores[config.botColor]);
        let stars = 1;
        if (diff >= 10) stars = 3;
        else if (diff >= 5) stars = 2;

        // Save stars if higher than previously earned
        const prevStars = Number(localStorage.getItem(`skato_stars_level_${activeCampaignLevel}`) || "0");
        if (stars > prevStars) {
          localStorage.setItem(`skato_stars_level_${activeCampaignLevel}`, String(stars));
        }

        // ELO increase
        const eloGain = 20 + stars * 5;
        playerElo += eloGain;
        localStorage.setItem("skato_player_elo", String(playerElo));
        updateEloDisplay();

        // Unlock next level
        const nextLevel = activeCampaignLevel + 1;
        if (nextLevel <= 9 && nextLevel > highestUnlockedLevel) {
          highestUnlockedLevel = nextLevel;
          localStorage.setItem("skato_highest_level", String(highestUnlockedLevel));
        }

        resultBadge.textContent = `Poziom ZALICZONY! (+${eloGain} ELO)`;
        resultBadge.classList.add("result-badge--win");
      } else {
        // Player lost or drew
        const eloLoss = 10;
        playerElo = Math.max(1000, playerElo - eloLoss);
        localStorage.setItem("skato_player_elo", String(playerElo));
        updateEloDisplay();

        resultBadge.textContent = `Porażka (-${eloLoss} ELO)`;
        resultBadge.classList.add("result-badge--lose");
      }

      // Re-render nodes
      renderCampaignNodes();
      updateHomeCampaignSummary();
    } else if (botConfig) {
      const humanOwner = botConfig.owner === "green" ? "blue" : "green";
      if (state.winner === humanOwner) {
        playerElo += 15;
        localStorage.setItem("skato_player_elo", String(playerElo));
        updateEloDisplay();
        resultBadge.textContent = "Zwycięstwo! (+15 ELO)";
        resultBadge.classList.add("result-badge--win");
      } else {
        playerElo = Math.max(1000, playerElo - 10);
        localStorage.setItem("skato_player_elo", String(playerElo));
        updateEloDisplay();
        resultBadge.textContent = "Porażka (-10 ELO)";
        resultBadge.classList.add("result-badge--lose");
      }
    } else {
      const winnerName = state.winner === "green" ? "Zielony" : "Niebieski";
      resultBadge.textContent = `Wygrywa ${winnerName}`;
      resultBadge.classList.add("result-badge--win");
    }

    if (state.winningLine) highlightWinningLine(state.winningLine);
    playOutcomeSound();
    setTimeout(() => resultScreen.classList.remove("hidden"), 1300);
    return;
  }

  maybeTriggerBot();
}

const interaction = setupInteraction(
  renderer,
  camera,
  [greenTray, blueTray],
  state,
  refreshHud,
  () => (botConfig ? (botConfig.owner === "green" ? "blue" : "green") : null),
  onDragUpdate
);

let gameStarted = false;
let forceShadowUpdateUntil = 0;

function startGame() {
  gameStarted = true;
  modeScreen.classList.add("hidden");
  botSetupScreen.classList.add("hidden");
  menuScreen.classList.add("hidden");
  clearDemoBoard();
  spawnTrays();
  forceShadowUpdateUntil = performance.now() + 2200;

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
    matchStartTime = performance.now();
    refreshHud();
  });
}

playButton.addEventListener("click", () => {
  menuScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
});

localModeButton.addEventListener("click", () => {
  botConfig = null;
  undoUsesRemaining = 0;
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

const modeBackButton = document.getElementById("mode-back-button")!;
if (modeBackButton) {
  modeBackButton.addEventListener("click", () => {
    modeScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
  });
}

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
  undoUsesRemaining = undoUsesForDifficulty(selectedDifficulty);
  arrangeTrays(selectedHumanColor);
  startGame();
});

restartButton.addEventListener("click", () => {
  window.location.reload();
});

undoButton.addEventListener("click", () => {
  if (!botConfig || undoUsesRemaining <= 0 || botThinking || state.over) return;
  const humanOwner: PieceOwner = botConfig.owner === "green" ? "blue" : "green";
  const undone = interaction.undoToPreviousTurn(humanOwner);
  if (undone) {
    undoUsesRemaining--;
    refreshHud();
  }
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

const HOWTO_SEEN_KEY = "skato_seen_howto";

function openHowto() {
  menuScreen.classList.add("hidden");
  howtoScreen.classList.remove("hidden");
}

function closeHowto() {
  localStorage.setItem(HOWTO_SEEN_KEY, "1");
  howtoScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
}

openHowtoButton.addEventListener("click", openHowto);
howtoCloseButton.addEventListener("click", closeHowto);

if (localStorage.getItem(HOWTO_SEEN_KEY) !== "1") {
  openHowto();
}

// Bottom navigation tabs controller
const navItems = document.querySelectorAll<HTMLButtonElement>(".nav-item");
const tabViews = document.querySelectorAll<HTMLDivElement>(".lobby-tab-view");

function switchTab(tabName: string) {
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.tab === tabName));
  tabViews.forEach((view) => {
    view.classList.toggle("active", view.id === `tab-${tabName}`);
  });
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tab) switchTab(btn.dataset.tab);
  });
});

const homeCampaignCard = document.getElementById("home-campaign-card");
homeCampaignCard?.addEventListener("click", () => switchTab("campaign"));

// ELO logic
let playerElo = Number(localStorage.getItem("skato_player_elo") || "1000");
const userEloVal = document.getElementById("user-elo-val")!;
const userTierVal = document.getElementById("user-tier-val")!;
const homeEloVal = document.getElementById("home-elo-val");
const homeTierVal = document.getElementById("home-tier-val");

function getTierName(elo: number): string {
  if (elo >= 1800) return "Wielki Arcymistrz";
  if (elo >= 1600) return "Mistrz III";
  if (elo >= 1400) return "Mistrz I";
  if (elo >= 1200) return "Diament II";
  if (elo >= 1100) return "Diament I";
  return "Nowicjusz";
}

function updateEloDisplay() {
  if (userEloVal) userEloVal.textContent = `${playerElo} ELO`;
  if (userTierVal) userTierVal.textContent = getTierName(playerElo);
  if (homeEloVal) homeEloVal.textContent = `${playerElo} ELO`;
  if (homeTierVal) homeTierVal.textContent = getTierName(playerElo);
  const rankVal = document.getElementById("user-rank-val");
  if (rankVal) {
    if (playerElo >= 1800) rankVal.textContent = "1";
    else if (playerElo >= 1600) rankVal.textContent = "2";
    else if (playerElo >= 1500) rankVal.textContent = "3";
    else if (playerElo >= 1350) rankVal.textContent = "4";
    else if (playerElo >= 1250) rankVal.textContent = "5";
    else {
      const rank = Math.max(6, Math.min(99, Math.floor(99 - ((playerElo - 1000) / 250) * 93)));
      rankVal.textContent = String(rank);
    }
  }
}

// Campaign configuration
interface CampaignLevel {
  level: number;
  title: string;
  subtitle: string;
  desc: string;
  difficulty: Difficulty;
  playerColor: PieceOwner;
  botColor: PieceOwner;
}

const campaignLevels: Record<number, CampaignLevel> = {
  1: { level: 1, title: "POZIOM 1", subtitle: "Wioskowy Mędrzec", desc: "Naucz się podstaw przeciwko łatwemu botowi. Grasz jako Zielony.", difficulty: "easy", playerColor: "green", botColor: "blue" },
  2: { level: 2, title: "POZIOM 2", subtitle: "Strażnik Drewna", desc: "Spróbuj zablokować ruchy łatwego bota. Grasz jako Niebieski.", difficulty: "easy", playerColor: "blue", botColor: "green" },
  3: { level: 3, title: "POZIOM 3", subtitle: "Szaman Lasu", desc: "Pierwsze poważne starcie przeciwko średniemu botowi. Grasz jako Zielony.", difficulty: "medium", playerColor: "green", botColor: "blue" },
  4: { level: 4, title: "POZIOM 4", subtitle: "Władca Zamku", desc: "Pokonaj średniego bota w starym zamku. Grasz jako Niebieski.", difficulty: "medium", playerColor: "blue", botColor: "green" },
  5: { level: 5, title: "POZIOM 5", subtitle: "Kamienny Strażnik", desc: "Zabezpiecz swoje szafiry na planszy. Grasz jako Zielony.", difficulty: "medium", playerColor: "green", botColor: "blue" },
  6: { level: 6, title: "POZIOM 6", subtitle: "Królewski Strateg", desc: "Uważaj na jego ruchy w komnacie tronowej. Grasz jako Niebieski.", difficulty: "hard", playerColor: "blue", botColor: "green" },
  7: { level: 7, title: "POZIOM 7", subtitle: "Kupiec Miejski", desc: "Szybka, agresywna gra w Złotym Mieście. Grasz jako Zielony.", difficulty: "hard", playerColor: "green", botColor: "blue" },
  8: { level: 8, title: "POZIOM 8", subtitle: "Burmistrz Metropolii", desc: "Prawie niemożliwy test strategii. Grasz jako Niebieski.", difficulty: "expert", playerColor: "blue", botColor: "green" },
  9: { level: 9, title: "POZIOM 9", subtitle: "Cesarz Skato", desc: "Pokonaj ostatecznego mistrza, aby zdobyć koronę! Grasz jako Zielony.", difficulty: "master", playerColor: "green", botColor: "blue" },
};

let highestUnlockedLevel = Number(localStorage.getItem("skato_highest_level") || "1");
let activeCampaignLevel: number | null = null;

function zoneNameForLevel(level: number): string {
  if (level <= 3) return "Kraina Drewna";
  if (level <= 6) return "Kraina Kamienia";
  return "Złote Miasto";
}

const homeCampaignVal = document.getElementById("home-campaign-val");
const homeCampaignSub = document.querySelector("#home-campaign-card .home-stat-sub");

function updateHomeCampaignSummary() {
  if (homeCampaignVal) homeCampaignVal.textContent = `Poziom ${highestUnlockedLevel}`;
  if (homeCampaignSub) homeCampaignSub.textContent = zoneNameForLevel(highestUnlockedLevel);
}

function renderCampaignNodes() {
  const nodes = document.querySelectorAll<HTMLButtonElement>(".level-node");
  nodes.forEach((node) => {
    const lvl = Number(node.dataset.level);
    if (isNaN(lvl)) return;

    const numEl = node.querySelector<HTMLSpanElement>(".level-num")!;
    const starsEl = node.querySelector<HTMLSpanElement>(".level-stars")!;

    if (lvl <= highestUnlockedLevel) {
      node.classList.remove("locked");
      if (numEl) numEl.textContent = String(lvl);
      if (starsEl) {
        const stars = Number(localStorage.getItem(`skato_stars_level_${lvl}`) || "0");
        starsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
      }
    } else {
      node.classList.add("locked");
      if (numEl) numEl.textContent = "–";
      if (starsEl) {
        starsEl.textContent = "";
      }
    }
  });
}

// Campaign level details modal handler
const campaignLevelModal = document.getElementById("campaign-level-modal")!;
const levelModalTitle = document.getElementById("level-modal-title")!;
const levelModalSubtitle = document.getElementById("level-modal-subtitle")!;
const levelModalDesc = document.getElementById("level-modal-desc")!;
const levelStartBtn = document.getElementById("level-start-btn")!;
const levelCancelBtn = document.getElementById("level-cancel-btn")!;

const levelNodes = document.querySelectorAll<HTMLButtonElement>(".level-node");
levelNodes.forEach((node) => {
  node.addEventListener("click", () => {
    const lvl = Number(node.dataset.level);
    if (isNaN(lvl)) return;

    if (lvl > highestUnlockedLevel) return;

    const config = campaignLevels[lvl];
    if (!config) return;

    activeCampaignLevel = lvl;
    if (levelModalTitle) levelModalTitle.textContent = config.title;
    if (levelModalSubtitle) levelModalSubtitle.textContent = config.subtitle;
    if (levelModalDesc) levelModalDesc.textContent = config.desc;

    menuScreen.classList.add("hidden");
    campaignLevelModal.classList.remove("hidden");
  });
});

if (levelCancelBtn) {
  levelCancelBtn.addEventListener("click", () => {
    campaignLevelModal.classList.add("hidden");
    menuScreen.classList.remove("hidden");
  });
}

if (levelStartBtn) {
  levelStartBtn.addEventListener("click", () => {
    if (activeCampaignLevel === null) return;
    const config = campaignLevels[activeCampaignLevel];
    if (!config) return;

    campaignLevelModal.classList.add("hidden");

    selectedDifficulty = config.difficulty;
    selectedHumanColor = config.playerColor;

    botConfig = {
      owner: config.botColor,
      difficulty: config.difficulty,
    };
    undoUsesRemaining = undoUsesForDifficulty(config.difficulty);

    arrangeTrays(selectedHumanColor);
    startGame();
  });
}

updateEloDisplay();
renderCampaignNodes();
updateHomeCampaignSummary();

const volumeValueLabel = document.getElementById("volume-value-label");

function updateVolumeSliderUI() {
  const pct = Math.round(getVolume() * 100);
  volumeSlider.value = String(pct);
  volumeSlider.style.setProperty("--volume-percent", `${pct}%`);
  if (volumeValueLabel) {
    volumeValueLabel.textContent = `${pct}%`;
  }
}

updateVolumeSliderUI();

volumeSlider.addEventListener("input", () => {
  const val = Number(volumeSlider.value);
  setVolume(val / 100);
  volumeSlider.style.setProperty("--volume-percent", `${val}%`);
  if (volumeValueLabel) {
    volumeValueLabel.textContent = `${val}%`;
  }
});

const highlightToggle = document.getElementById("highlight-toggle") as HTMLInputElement;
if (highlightToggle) {
  highlightToggle.checked = highlightEnabled;
  highlightToggle.addEventListener("change", () => {
    highlightEnabled = highlightToggle.checked;
    localStorage.setItem(HIGHLIGHT_SETTING_KEY, highlightEnabled ? "1" : "0");
    if (!highlightEnabled) dragHighlightMesh.visible = false;
  });
}

const clock = new THREE.Clock();

function tick() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const interactionActive = interaction.update(delta);

  let boardRotating = false;
  if (!gameStarted) {
    const board = scene.getObjectByName("board");
    if (board) {
      board.rotation.y += 0.08 * delta;
      boardRotating = true;
    }
  }

  if (highlightRings.length > 0) {
    const pulse = 0.55 + Math.sin(clock.getElapsedTime() * 4) * 0.3;
    for (const ring of highlightRings) {
      (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }

  if (matchStartTime !== null && !state.over) {
    hudTimer.textContent = formatDuration(performance.now() - matchStartTime);
  }

  // Shadow map is frozen by default (see scene.ts) — only pay for recomputing it on frames
  // where something that actually casts/receives a shadow is moving.
  if (interactionActive || boardRotating || performance.now() < forceShadowUpdateUntil) {
    renderer.shadowMap.needsUpdate = true;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();


