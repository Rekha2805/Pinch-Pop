
import { createSystem, RayInteractable } from '@iwsdk/core';

import {
  AdditiveBlending,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';

import { Orb } from '../components/Orb';
import {
  RETURN_HOME_EVENT,
  START_GAME_EVENT,
  getGameMode,
} from '../gameSettings';

import {
  addPanel,
  addLabel,
  addButton,
  addMushroomMascot,
  addDynamicLabel,
  createResponsiveUIRoot,
  getViewportWorldHeight,
  getViewportWorldWidth,
  trackUITexture,
  pressButtonAtPoint,
  type ResponsiveUIRoot,
  type MushroomMascot,
} from '../ui/WorldUI';

const PINCH_START_DISTANCE = 0.028;
const PINCH_RELEASE_DISTANCE = 0.045;
const BASE_ORB_RADIUS = 0.12;
const MIN_ORB_RADIUS = 0.085;
const POP_DURATION = 0.2;
const PARTICLE_COUNT = 6;
const COMBO_WINDOW = 1.8;
const MAX_MULTIPLIER = 5;
const MAX_ACTIVE_ORBS = 8;
const MAX_DIFFICULTY = 8;

let sharedGlowTexture: CanvasTexture | undefined;

function getGlowTexture() {
  if (sharedGlowTexture) return sharedGlowTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return undefined;

  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  sharedGlowTexture = new CanvasTexture(canvas);
  sharedGlowTexture.colorSpace = SRGBColorSpace;
  sharedGlowTexture.needsUpdate = true;
  return sharedGlowTexture;
}

const COLORS = [
  { name: 'coral', value: 0xff6f61 },
  { name: 'teal', value: 0x22b8b2 },
  { name: 'amber', value: 0xffb000 },
  { name: 'violet', value: 0x9b59b6 },
] as const;

interface TrackedOrb {
  entity: any;
  age: number;
  popping: boolean;
  radius: number;
  glow: Sprite;
  phase: number;
}

interface Particle {
  entity: any;
  velocity: Vector3;
  age: number;
}

export class SpawnSystem extends createSystem({}) {
  private readonly orbs: TrackedOrb[] = [];
  private readonly particles: Particle[] = [];

  private spawnTimer = 1.5;
  private score = 0;
  private elapsed = 0;
  private lastPopAt = Number.NEGATIVE_INFINITY;
  private combo = 0;
  private lastDisplayedSecond = -1;
  private audioContext?: AudioContext;
  private readonly worldPosition = new Vector3();
  private readonly cameraPosition = new Vector3();
  private readonly cameraForward = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly cameraUp = new Vector3();
  private readonly cameraRotation = new Quaternion();
  private readonly handleViewportResize = () => {
    this.reflowOrbs();
    const compact = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;

    if (this.hudRoot && compact !== this.compactHUD && !this.gameOver) {
      this.disposeGameUI();
      this.createGameUI();
      if (this.pausedForConfirmation) this.hudRoot.group.visible = false;
    }

    if (this.pausedForConfirmation) this.createEndConfirmationUI();
    if (this.gameOver && this.resultRoot) this.endGame(this.endReason);
  };
  private readonly handleStartGameRequest = () => this.restartGame();

  private gameMode = getGameMode();
  private timeRemaining = 30;
  private gameOver = false;
  private active = true;
  private pausedForConfirmation = false;
  private bestScore = 0;
  private endReason: 'timeout' | 'manual' = 'timeout';
  private compactHUD = false;

  private leftPinching = false;
  private rightPinching = false;

  private scoreSprite?: Sprite;
  private scoreTexture?: CanvasTexture;
  private releaseScoreTexture?: () => void;

  // 3D UI cleanup functions
  private hudCleanup: (() => void)[] = [];
  private resultCleanup: (() => void)[] = [];
  private endConfirmationCleanup: (() => void)[] = [];
  private restartCleanup?: () => void;
  private endButtonCleanup?: () => void;
  private hudRoot?: ResponsiveUIRoot;
  private resultRoot?: ResponsiveUIRoot;
  private endConfirmationRoot?: ResponsiveUIRoot;

  // Dynamic 3D labels
  private timerLabel?: ReturnType<typeof addDynamicLabel>;
  private bestLabel?: ReturnType<typeof addDynamicLabel>;
  private comboLabel?: ReturnType<typeof addDynamicLabel>;
  private gameplayMascot?: MushroomMascot;
  private mascotResetTimer?: number;

  // ---------------- INITIALIZE GAME ----------------

  init() {
    this.gameMode = getGameMode();
    this.timeRemaining = 30;
    this.gameOver = false;
    this.active = true;
    this.pausedForConfirmation = false;
    this.elapsed = 0;
    this.lastPopAt = Number.NEGATIVE_INFINITY;
    this.combo = 0;
    this.lastDisplayedSecond = -1;

    this.loadBestScore();

    this.createGameUI();
    window.addEventListener('resize', this.handleViewportResize);
    window.addEventListener(START_GAME_EVENT, this.handleStartGameRequest);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('resize', this.handleViewportResize);
      window.removeEventListener(START_GAME_EVENT, this.handleStartGameRequest);
      this.disposeGameUI();
      this.disposeResultsUI();
      this.disposeEndConfirmation();
      void this.audioContext?.close().catch(() => {});
      this.audioContext = undefined;
    });

    // Keep the first target in a comfortable seated reach zone.
    this.spawnOrb('coral', 0, -0.25, 1.35);

    console.log(`Pinch Pop started: ${this.gameMode}`);
  }

  // ---------------- GAME UPDATE ----------------

  update(delta: number) {
    if (this.gameOver || !this.active || this.pausedForConfirmation) {
      return;
    }

    this.elapsed += delta;

    if (
      this.combo > 0 &&
      this.elapsed - this.lastPopAt > COMBO_WINDOW
    ) {
      this.combo = 0;
      this.updateGameHUD();
    }

    // Countdown for 30-second challenge
    if (this.gameMode === 'challenge') {
      this.timeRemaining -= delta;

      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        this.updateGameHUD();
        this.endGame('timeout');
        return;
      }

      const displayedSecond = Math.ceil(this.timeRemaining);
      if (displayedSecond !== this.lastDisplayedSecond) {
        this.lastDisplayedSecond = displayedSecond;
        this.updateGameHUD();
      }
    }

    // Increase spawn rate and reduce target size gradually as score grows.
    this.spawnTimer -= delta;

    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.currentSpawnInterval();
      if (this.orbs.filter((orb) => !orb.popping).length < this.maxActiveOrbs()) {
        this.spawnRandomOrb();
      }
    }

    this.updatePinches();
    this.updateOrbs(delta);
    this.updateParticles(delta);
  }

  private reflowOrbs() {
    let activeOrbs = this.orbs.filter((orb) => !orb.popping);
    const activeLimit = this.maxActiveOrbs();
    while (activeOrbs.length > activeLimit) {
      const removedOrb = activeOrbs.pop();
      if (!removedOrb) break;
      this.disposeOrb(removedOrb);
      const index = this.orbs.indexOf(removedOrb);
      if (index >= 0) this.orbs.splice(index, 1);
    }
    if (activeOrbs.length === 0) return;

    const occupied: Array<{ x: number; y: number; radius: number }> = [];
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    for (const orb of activeOrbs) {
      const object = orb.entity.object3D as Mesh | undefined;
      if (!object) continue;

      const currentPosition = object.getWorldPosition(new Vector3());
      const camera = this.world.camera;
      camera.updateWorldMatrix(true, false);
      camera.getWorldPosition(this.cameraPosition);
      camera.getWorldQuaternion(this.cameraRotation);
      this.cameraForward.set(0, 0, -1).applyQuaternion(this.cameraRotation);
      this.cameraRight.set(1, 0, 0).applyQuaternion(this.cameraRotation);
      this.cameraUp.set(0, 1, 0).applyQuaternion(this.cameraRotation);

      const currentFromCamera = currentPosition.clone().sub(this.cameraPosition);
      const depth = aspect < 0.65
        ? 1.85
        : Math.max(0.4, currentFromCamera.dot(this.cameraForward));
      const bounds = this.getSafeOrbBounds(depth, orb.radius);
      const currentInPlane = currentPosition.clone().sub(bounds.center);
      const preferredX = Math.max(
        -bounds.halfWidth,
        Math.min(bounds.halfWidth, currentInPlane.dot(bounds.right))
      );
      const preferredY = Math.max(
        bounds.minY,
        Math.min(bounds.maxY, currentInPlane.dot(bounds.up))
      );
      const middleY = (bounds.minY + bounds.maxY) / 2;
      const lowerY = bounds.minY * 0.75 + bounds.maxY * 0.25;
      const upperY = bounds.minY * 0.25 + bounds.maxY * 0.75;
      const candidates = [
        [preferredX, preferredY],
        [0, middleY],
        [-bounds.halfWidth * 0.7, lowerY],
        [bounds.halfWidth * 0.7, lowerY],
        [-bounds.halfWidth * 0.7, upperY],
        [bounds.halfWidth * 0.7, upperY],
        [0, bounds.minY],
        [0, bounds.maxY],
      ];

      let chosen: Vector3 | undefined;
      let fallback: Vector3 | undefined;
      let widestGap = Number.NEGATIVE_INFINITY;
      for (const [x, y] of candidates) {
        const candidate = bounds.center.clone()
          .addScaledVector(bounds.right, x)
          .addScaledVector(bounds.up, y);
        const relative = candidate.clone().sub(this.cameraPosition);
        const candidateDepth = Math.max(0.4, relative.dot(this.cameraForward));
        const angularX = relative.dot(this.cameraRight) / candidateDepth;
        const angularY = relative.dot(this.cameraUp) / candidateDepth;
        const angularRadius = orb.radius * 1.35 / candidateDepth;
        const gap = occupied.reduce((minimumGap, other) => {
          const distance = Math.hypot(angularX - other.x, angularY - other.y);
          return Math.min(minimumGap, distance - angularRadius - other.radius);
        }, Number.POSITIVE_INFINITY);

        if (gap > widestGap) {
          widestGap = gap;
          fallback = candidate;
        }
        if (gap >= 0) {
          chosen = candidate;
          break;
        }
      }

      const nextPosition = chosen ?? fallback ?? bounds.center;
      object.position.copy(nextPosition);
      orb.glow.position.copy(nextPosition);

      const relative = nextPosition.clone().sub(this.cameraPosition);
      const depthAfterMove = Math.max(0.4, relative.dot(this.cameraForward));
      occupied.push({
        x: relative.dot(this.cameraRight) / depthAfterMove,
        y: relative.dot(this.cameraUp) / depthAfterMove,
        radius: orb.radius * 1.35 / depthAfterMove,
      });
    }
  }

  private createGameUI() {
    this.compactHUD = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    this.hudRoot = createResponsiveUIRoot(
      this.world,
      -2.2,
      this.compactHUD ? 0.76 : 2.0,
      0.06,
      this.compactHUD ? 1.3 : 1.6,
      this.compactHUD ? 2.12 : 2.15,
      this.compactHUD ? 1.0 : 1.1
    );
    this.createScoreDisplay();
    this.createRestartButton();
    this.createEndButton();
    this.createGameHUD();
  }

  private disposeScoreDisplay() {
    this.scoreSprite?.removeFromParent();
    this.scoreSprite?.material.dispose();
    this.releaseScoreTexture?.();
    this.releaseScoreTexture = undefined;
    this.scoreTexture?.dispose();
    this.scoreSprite = undefined;
    this.scoreTexture = undefined;
  }

  private disposeGameUI() {
    this.hudCleanup.forEach((cleanup) => cleanup());
    this.hudCleanup = [];
    this.restartCleanup?.();
    this.restartCleanup = undefined;
    this.endButtonCleanup?.();
    this.endButtonCleanup = undefined;
    this.disposeScoreDisplay();
    this.gameplayMascot?.dispose();
    this.gameplayMascot = undefined;
    if (this.mascotResetTimer !== undefined) {
      window.clearTimeout(this.mascotResetTimer);
      this.mascotResetTimer = undefined;
    }
    this.hudRoot?.dispose();
    this.hudRoot = undefined;
    this.timerLabel = undefined;
    this.bestLabel = undefined;
    this.comboLabel = undefined;
  }

  private disposeResultsUI() {
    this.resultCleanup.forEach((cleanup) => cleanup());
    this.resultCleanup = [];
    this.resultRoot?.dispose();
    this.resultRoot = undefined;
  }

  // ---------------- 3D RESTART BUTTON ----------------

  private createRestartButton() {
    if (!this.hudRoot) return;
    const compact = this.compactHUD;
    this.restartCleanup = addButton(
      this.world,
      'RESET',
      compact ? -0.2 : 0.49,
      compact ? 1.68 : 2.27,
      -2.15,
      compact ? 0.34 : 0.32,
      compact ? 0.22 : 0.32,
      () => this.restartGame(),
      '#B96F58',
      this.hudRoot.entity
    );
  }

  private createEndButton() {
    if (!this.hudRoot) return;
    const compact = this.compactHUD;
    this.endButtonCleanup = addButton(
      this.world,
      'END',
      compact ? 0.2 : 0.83,
      compact ? 1.68 : 2.27,
      -2.15,
      compact ? 0.34 : 0.32,
      compact ? 0.22 : 0.32,
      () => this.showEndConfirmation(),
      '#C96D5B',
      this.hudRoot.entity
    );
  }

  private showEndConfirmation() {
    if (this.gameOver || !this.active || this.pausedForConfirmation) return;

    this.pausedForConfirmation = true;
    this.leftPinching = false;
    this.rightPinching = false;
    this.setGameplayVisible(false);
    this.createEndConfirmationUI();
  }

  private createEndConfirmationUI() {
    this.disposeEndConfirmation();
    const compact = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    this.endConfirmationRoot = createResponsiveUIRoot(
      this.world,
      -2.3,
      compact ? 0.76 : 1.7
    );
    const parent = this.endConfirmationRoot.entity;

    this.endConfirmationCleanup.push(
      addPanel(
        this.world, 0, 1.75, -2.3,
        compact ? 0.76 : 1.7,
        compact ? 1.3 : 1.0,
        parent
      )
    );
    this.endConfirmationCleanup.push(
      addLabel(
        this.world, 'GAME PAUSED', 0, compact ? 2.08 : 2.0, -2.25,
        compact ? 0.68 : 1.4, 0.18, '#D5A06F', compact ? 44 : 52, parent
      )
    );
    this.endConfirmationCleanup.push(
      addLabel(
        this.world, 'Resume or end this run?', 0, compact ? 1.87 : 1.86, -2.25,
        compact ? 0.69 : 1.45, 0.14, '#FFF1D6', compact ? 30 : 34, parent
      )
    );
    this.endConfirmationCleanup.push(
      addButton(
        this.world,
        'RESUME',
        compact ? 0 : -0.43,
        compact ? 1.5 : 1.47,
        -2.22,
        compact ? 0.62 : 0.58,
        compact ? 0.20 : 0.22,
        () => this.resumeGame(),
        '#C58B68',
        parent
      )
    );
    this.endConfirmationCleanup.push(
      addButton(
        this.world,
        'END GAME',
        compact ? 0 : 0.43,
        compact ? 1.27 : 1.47,
        -2.22,
        compact ? 0.62 : 0.58,
        compact ? 0.20 : 0.22,
        () => {
          this.disposeEndConfirmation();
          this.endGame('manual');
        },
        '#C96D5B',
        parent
      )
    );
  }

  private resumeGame() {
    this.disposeEndConfirmation();
    this.setGameplayVisible(true);
    this.leftPinching = false;
    this.rightPinching = false;
    this.pausedForConfirmation = false;
  }

  private setGameplayVisible(visible: boolean) {
    if (this.hudRoot) this.hudRoot.group.visible = visible;
    for (const orb of this.orbs) {
      if (orb.entity.object3D) orb.entity.object3D.visible = visible;
      orb.glow.visible = visible;
    }
    for (const particle of this.particles) {
      if (particle.entity.object3D) particle.entity.object3D.visible = visible;
    }
  }

  private disposeEndConfirmation() {
    this.endConfirmationCleanup.forEach((cleanup) => cleanup());
    this.endConfirmationCleanup = [];
    this.endConfirmationRoot?.dispose();
    this.endConfirmationRoot = undefined;
  }

  // ---------------- RESTART GAME ----------------

  private restartGame() {
    this.disposeResultsUI();
    this.disposeEndConfirmation();
    this.disposeGameUI();

    // Remove existing orbs
    for (const orb of this.orbs) {
      this.disposeOrb(orb);
    }

    this.orbs.length = 0;

    // Remove existing particles
    for (const particle of this.particles) {
      particle.entity.dispose();
    }

    this.particles.length = 0;

    // Reset game state
    this.score = 0;
    this.spawnTimer = 1.5;
    this.gameMode = getGameMode();
    this.loadBestScore();
    this.timeRemaining = 30;
    this.gameOver = false;
    this.active = true;
    this.pausedForConfirmation = false;
    this.elapsed = 0;
    this.lastPopAt = Number.NEGATIVE_INFINITY;
    this.combo = 0;
    this.lastDisplayedSecond = -1;

    this.leftPinching = false;
    this.rightPinching = false;

    this.createGameUI();

    // Spawn a fresh red orb
    this.spawnOrb('coral', 0, -0.25, 1.35);

    console.log('Game restarted!');
  }

  // ---------------- 3D GAME HUD ----------------

  private createGameHUD() {
    if (!this.hudRoot) return;
    const parent = this.hudRoot.entity;
    const compact = this.compactHUD;
    const modeName =
      this.gameMode === 'endless'
        ? 'ENDLESS'
        : '30 SEC';

    this.hudCleanup.push(
      addPanel(
        this.world,
        0,
        compact ? 2.12 : 2.15,
        -2.2,
        compact ? 0.76 : 2.0,
        compact ? 1.10 : 0.72,
        parent
      )
    );

    this.gameplayMascot = addMushroomMascot(
      this.world,
      compact ? 0 : 0.63,
      compact ? 2.66 : 2.05,
      -2.16,
      compact ? 0.16 : 0.18,
      compact ? 0.20 : 0.23,
      parent,
      'idle'
    );
    this.hudCleanup.push(() => {
      this.gameplayMascot?.dispose();
      this.gameplayMascot = undefined;
    });

    this.hudCleanup.push(
      addLabel(
        this.world,
        modeName,
        compact ? 0 : -0.64,
        compact ? 2.52 : 2.34,
        -2.17,
        compact ? 0.68 : 0.46,
        compact ? 0.13 : 0.18,
        '#E0A06F',
        compact ? 46 : 58,
        parent
      )
    );

    this.timerLabel = addDynamicLabel(
      this.world,
      '',
      compact ? -0.19 : -0.64,
      compact ? 2.09 : 1.92,
      -2.17,
      compact ? 0.34 : 0.58,
      compact ? 0.14 : 0.21,
      '#F1B08E',
      compact ? 44 : 62,
      parent
    );

    this.bestLabel = addDynamicLabel(
      this.world,
      '',
      compact ? 0.19 : 0,
      compact ? 2.09 : 1.92,
      -2.17,
      compact ? 0.34 : 0.5,
      compact ? 0.14 : 0.19,
      '#E0A06F',
      compact ? 44 : 56,
      parent
    );

    this.comboLabel = addDynamicLabel(
      this.world,
      '',
      compact ? 0 : 0.64,
      compact ? 1.88 : 1.92,
      -2.17,
      compact ? 0.70 : 0.66,
      compact ? 0.14 : 0.21,
      '#F1B08E',
      compact ? 44 : 52,
      parent
    );

    this.hudCleanup.push(
      () => this.timerLabel?.dispose()
    );

    this.hudCleanup.push(
      () => this.bestLabel?.dispose()
    );

    this.hudCleanup.push(
      () => this.comboLabel?.dispose()
    );

    this.updateGameHUD();

  }

  private updateGameHUD() {
    this.timerLabel?.update(
      this.gameMode === 'endless'
        ? 'TIME: ∞'
        : `TIME: ${Math.ceil(this.timeRemaining)}s`
    );

    this.bestLabel?.update(
      `BEST: ${this.bestScore}`
    );

    this.comboLabel?.update(
      this.combo > 0
        ? `COMBO ${this.combo}  x${this.currentMultiplier()}`
        : 'PINCH TO POP'
    );
  }

  private currentMultiplier() {
    return Math.min(
      MAX_MULTIPLIER,
      1 + Math.floor(this.combo / 3)
    );
  }

  private currentDifficulty() {
    return Math.min(
      MAX_DIFFICULTY,
      Math.floor(this.score / 6)
    );
  }

  private currentSpawnInterval() {
    return Math.max(
      0.52,
      1.5 - this.currentDifficulty() * 0.11
    );
  }

  // ---------------- BEST SCORE ----------------

  private loadBestScore() {
    const key = `pinch-pop-best-${this.gameMode}`;

    try {
      const savedScore = Number(localStorage.getItem(key));
      this.bestScore = Number.isFinite(savedScore)
        ? Math.max(0, savedScore)
        : 0;
    } catch {
      this.bestScore = 0;
    }
  }

  private saveBestScore() {
    const key = `pinch-pop-best-${this.gameMode}`;

    try {
      localStorage.setItem(
        key,
        `${this.bestScore}`
      );
    } catch (error) {
      console.warn(
        'Could not save best score:',
        error
      );
    }
  }

  private updateBestScore() {
    if (this.score > this.bestScore) {
      this.bestScore = this.score;

      this.saveBestScore();
      this.updateGameHUD();

      console.log(
        `New best score: ${this.bestScore}`
      );
    }
  }

  // ---------------- 3D RESULTS SCREEN ----------------

  private endGame(reason: 'timeout' | 'manual' = 'timeout') {
    this.endReason = reason;
    this.gameOver = true;
    this.playGameOverSound(reason);
    this.pausedForConfirmation = false;
    this.disposeEndConfirmation();
    this.disposeGameUI();
    this.disposeResultsUI();

    // Remove remaining orbs
    for (const orb of this.orbs) {
      this.disposeOrb(orb);
    }

    this.orbs.length = 0;

    // Remove remaining particles
    for (const particle of this.particles) {
      particle.entity.dispose();
    }

    this.particles.length = 0;

    const compact = window.innerWidth / Math.max(1, window.innerHeight) < 0.75;
    this.resultRoot = createResponsiveUIRoot(
      this.world,
      -2.3,
      compact ? 0.76 : 1.65
    );
    const parent = this.resultRoot.entity;

    const resultMascot = addMushroomMascot(
      this.world,
      compact ? 0.22 : 0.57,
      compact ? 1.86 : 1.88,
      -2.24,
      compact ? 0.18 : 0.24,
      compact ? 0.23 : 0.30,
      parent,
      this.score >= 10
        ? 'combo'
        : reason === 'timeout'
          ? 'sleepy'
          : 'happy'
    );
    this.resultCleanup.push(() => resultMascot.dispose());

    // Main results panel
    this.resultCleanup.push(
      addPanel(
        this.world,
        0, 1.75, -2.3,
        compact ? 0.76 : 1.65,
        compact ? 1.74 : 1.3,
        parent
      )
    );

    // Title
    this.resultCleanup.push(
      addLabel(
        this.world,
        'PINCH POP',
        0, 2.16, -2.25,
        compact ? 0.68 : 1.1, 0.2,
        '#D5A06F',
        compact ? 44 : 56,
        parent
      )
    );

    // Game over text
    this.resultCleanup.push(
      addLabel(
        this.world,
        reason === 'timeout' ? "TIME'S UP!" : 'GAME ENDED',
        0, 2.0, -2.25,
        compact ? 0.68 : 1.2, 0.2,
        '#E89278',
        compact ? 52 : 70,
        parent
      )
    );

    // Final score
    this.resultCleanup.push(
      addLabel(
        this.world,
        `FINAL SCORE: ${this.score}`,
        0, 1.75, -2.25,
        compact ? 0.68 : 1.4,
        compact ? 0.15 : 0.17,
        '#FFF1D6',
        compact ? 38 : 46,
        parent
      )
    );

    // Best score
    this.resultCleanup.push(
      addLabel(
        this.world,
        `BEST SCORE: ${this.bestScore}`,
        0, 1.53, -2.25,
        compact ? 0.68 : 1.4,
        compact ? 0.14 : 0.16,
        '#E0A06F',
        compact ? 38 : 42,
        parent
      )
    );

    // Return-home and replay actions
    this.resultCleanup.push(
      addButton(
        this.world,
        'HOME',
        compact ? 0 : -0.39,
        1.28,
        -2.2,
        compact ? 0.46 : 0.44,
        compact ? 0.13 : 0.14,
        () => this.returnHome(),
        '#765044',
        parent
      )
    );
    this.resultCleanup.push(
      addButton(
        this.world,
        'PLAY AGAIN',
        compact ? 0 : 0.39,
        compact ? 1.06 : 1.28,
        -2.2,
        compact ? 0.46 : 0.46,
        compact ? 0.13 : 0.14,
        () => this.restartGame(),
        '#B96F78',
        parent
      )
    );

    console.log(
      `${reason === 'timeout' ? 'Challenge finished' : 'Game ended'}. Final score: ${this.score}`
    );
  }

  private returnHome() {
    this.disposeResultsUI();
    this.gameOver = true;
    this.active = false;
    window.dispatchEvent(new Event(RETURN_HOME_EVENT));
  }

  // ---------------- ORB SPAWNING ----------------

  private spawnRandomOrb() {
    const color =
      COLORS[Math.floor(Math.random() * COLORS.length)];

    const radius = Math.max(
      MIN_ORB_RADIUS,
      BASE_ORB_RADIUS - this.currentDifficulty() * 0.004
    );
    const isNarrow = window.innerWidth / Math.max(1, window.innerHeight) < 0.65;
    const minDepth = isNarrow ? 1.78 : 1.2;
    const maxDepth = isNarrow ? 1.95 : 1.65;

    for (let attempt = 0; attempt < 20; attempt++) {
      const depth = minDepth + Math.random() * (maxDepth - minDepth);
      const bounds = this.getSafeOrbBounds(depth, radius);
      const x = (Math.random() * 2 - 1) * bounds.halfWidth;
      const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      const position = bounds.center.clone()
        .addScaledVector(bounds.right, x)
        .addScaledVector(bounds.up, y);

      if (this.isOrbPositionClear(position, depth, radius)) {
        this.spawnOrb(color.name, x, y, depth);
        return;
      }
    }
  }

  private maxActiveOrbs() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (aspect < 0.65) return 2;
    if (aspect < 0.9) return 4;
    return MAX_ACTIVE_ORBS;
  }

  private isOrbPositionClear(position: Vector3, depth: number, radius: number) {
    const candidateAngularRadius = radius * 1.35 / depth;
    const candidateX = position.clone().sub(this.cameraPosition).dot(this.cameraRight) / depth;
    const candidateY = position.clone().sub(this.cameraPosition).dot(this.cameraUp) / depth;

    return this.orbs.every((orb) => {
      if (orb.popping) return true;
      const existingPosition = orb.entity.object3D?.getWorldPosition(new Vector3());
      if (!existingPosition) return true;

      const relative = existingPosition.sub(this.cameraPosition);
      const existingDepth = Math.max(0.4, relative.dot(this.cameraForward));
      const existingX = relative.dot(this.cameraRight) / existingDepth;
      const existingY = relative.dot(this.cameraUp) / existingDepth;
      const existingAngularRadius = orb.radius * 1.35 / existingDepth;
      return Math.hypot(candidateX - existingX, candidateY - existingY) >=
        candidateAngularRadius + existingAngularRadius + 0.015;
    });
  }

  private getSafeOrbBounds(depth: number, radius: number) {
    const camera = this.world.camera;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldQuaternion(this.cameraRotation);
    this.cameraForward.set(0, 0, -1).applyQuaternion(this.cameraRotation);
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.cameraRotation);
    this.cameraUp.set(0, 1, 0).applyQuaternion(this.cameraRotation);

    const safeVisualRadius = radius * 1.3 + 0.035;
    const safeWidth = getViewportWorldWidth(
      this.world,
      camera.position.z - depth,
      0.08,
      Math.min(window.innerWidth / Math.max(1, window.innerHeight), 1.1)
    );
    const safeHeight = getViewportWorldHeight(this.world, camera.position.z - depth, 0.08);

    return {
      center: this.cameraPosition.clone().addScaledVector(this.cameraForward, depth),
      right: this.cameraRight.clone(),
      up: this.cameraUp.clone(),
      halfWidth: Math.max(0, safeWidth / 2 - safeVisualRadius),
      minY: -Math.max(0, safeHeight / 2 - safeVisualRadius),
      maxY: -Math.min(Math.max(0, safeHeight / 2 - safeVisualRadius), 0.06),
    };
  }

  private spawnOrb(
    colorName: string,
    x: number,
    y: number,
    z: number
  ) {
    const color =
      colorName === 'red'
        ? 0xff0000
        : COLORS.find(
            (item) => item.name === colorName
          )?.value ?? 0xffffff;

    const difficulty = this.currentDifficulty();
    const radius = Math.max(
      MIN_ORB_RADIUS,
      BASE_ORB_RADIUS - difficulty * 0.004
    );

    const safe = this.getSafeOrbBounds(z, radius);
    const safeX = Math.max(-safe.halfWidth, Math.min(safe.halfWidth, x));
    const safeY = Math.max(safe.minY, Math.min(safe.maxY, y));
    const position = safe.center
      .addScaledVector(safe.right, safeX)
      .addScaledVector(safe.up, safeY);

    const mesh = new Mesh(
      new SphereGeometry(
        radius,
        24,
        16
      ),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      })
    );

    mesh.position.copy(position);

    const entity =
      this.world.createTransformEntity(mesh);

    const glowMaterial = new SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      opacity: 0.62,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const glow = new Sprite(glowMaterial);
    glow.position.copy(position);
    glow.scale.setScalar(radius * 2.5);
    glow.renderOrder = 2;
    this.world.scene.add(glow);

    entity.addComponent(Orb, {
      color: colorName,
      scoreValue: 1,
    });

    entity.addComponent(RayInteractable);

    const trackedOrb: TrackedOrb = {
      entity,
      age: 0,
      popping: false,
      radius,
      glow,
      phase: Math.random() * Math.PI * 2,
    };

    this.orbs.push(trackedOrb);

    // Desktop mouse and XR pointer interaction
    mesh.addEventListener('pointerdown', () => {
      if (
        !trackedOrb.popping &&
        !this.gameOver
      ) {
        this.popOrb(trackedOrb);
      }
    });

    console.log(`Orb created: ${colorName}`);
  }

  // ---------------- HAND PINCH DETECTION ----------------

  private updatePinches() {
    const frame = this.world.xrFrame;
    const referenceSpace = this.world.xrReferenceSpace;

    if (
      !frame ||
      !referenceSpace ||
      !this.world.session
    ) {
      return;
    }

    let leftPinching = this.leftPinching;
    let rightPinching = this.rightPinching;
    let leftHandSeen = false;
    let rightHandSeen = false;

    for (
      const inputSource of this.world.session.inputSources
    ) {
      if (!inputSource.hand) {
        continue;
      }

      const isLeft = inputSource.handedness === 'left';
      if (isLeft) {
        leftHandSeen = true;
      } else {
        rightHandSeen = true;
      }

      const thumb = inputSource.hand.get('thumb-tip');
      const index = inputSource.hand.get('index-finger-tip');

      if (
        !thumb ||
        !index ||
        typeof frame.getJointPose !== 'function'
      ) {
        continue;
      }

      const thumbPose = frame.getJointPose(
        thumb,
        referenceSpace
      );

      const indexPose = frame.getJointPose(
        index,
        referenceSpace
      );

      if (!thumbPose || !indexPose) {
        continue;
      }

      const dx =
        thumbPose.transform.position.x -
        indexPose.transform.position.x;

      const dy =
        thumbPose.transform.position.y -
        indexPose.transform.position.y;

      const dz =
        thumbPose.transform.position.z -
        indexPose.transform.position.z;

      const distance = Math.sqrt(
        dx * dx + dy * dy + dz * dz
      );

      const wasPinching = isLeft
        ? this.leftPinching
        : this.rightPinching;

      const isPinching = wasPinching
        ? distance < PINCH_RELEASE_DISTANCE
        : distance < PINCH_START_DISTANCE;

      if (isLeft) {
        leftPinching = isPinching;
      } else {
        rightPinching = isPinching;
      }

      // Detect only the beginning of a pinch
      if (isPinching && !wasPinching) {
        const pinchPoint = new Vector3(
          (
            thumbPose.transform.position.x +
            indexPose.transform.position.x
          ) / 2,

          (
            thumbPose.transform.position.y +
            indexPose.transform.position.y
          ) / 2,

          (
            thumbPose.transform.position.z +
            indexPose.transform.position.z
          ) / 2
        );

        if (!pressButtonAtPoint(pinchPoint)) {
          this.tryPopOrb(pinchPoint);
        }
      }
    }

    this.leftPinching = leftHandSeen && leftPinching;
    this.rightPinching = rightHandSeen && rightPinching;
  }

  private tryPopOrb(pinchPoint: Vector3) {
    if (this.gameOver) {
      return;
    }

    let closest: TrackedOrb | undefined;
    let closestDistance = 0.20;

    for (const orb of this.orbs) {
      if (
        orb.popping ||
        !orb.entity.object3D
      ) {
        continue;
      }

      const orbPosition =
        orb.entity.object3D.getWorldPosition(
          new Vector3()
        );

      const distance =
        orbPosition.distanceTo(pinchPoint);

      const hitDistance = Math.max(0.15, orb.radius + 0.075);
      if (distance <= hitDistance && distance <= closestDistance) {
        closest = orb;
        closestDistance = distance;
      }
    }

    if (closest) {
      this.popOrb(closest);
    }
  }

  private disposeOrb(orb: TrackedOrb) {
    const mesh = orb.entity.object3D as Mesh | undefined;
    orb.entity.dispose();
    mesh?.geometry.dispose();
    if (Array.isArray(mesh?.material)) {
      mesh.material.forEach((material) => material.dispose());
    } else {
      mesh?.material.dispose();
    }
    orb.glow.removeFromParent();
    orb.glow.material.dispose();
  }

  // ---------------- POP ORB ----------------

  private popOrb(orb: TrackedOrb) {
    if (
      orb.popping ||
      this.gameOver
    ) {
      return;
    }

    orb.popping = true;
    orb.age = 0;

    this.combo = this.elapsed - this.lastPopAt <= COMBO_WINDOW
      ? this.combo + 1
      : 1;
    this.lastPopAt = this.elapsed;
    const multiplier = this.currentMultiplier();
    this.score += multiplier;

    this.gameplayMascot?.setAnimation(
      this.combo >= 3 ? 'combo' : 'happy'
    );
    if (this.mascotResetTimer !== undefined) {
      window.clearTimeout(this.mascotResetTimer);
    }
    this.mascotResetTimer = window.setTimeout(() => {
      this.gameplayMascot?.setAnimation('idle');
      this.mascotResetTimer = undefined;
    }, this.combo >= 3 ? 650 : 420);

    this.updateBestScore();
    this.updateGameHUD();

    console.log(
      `Orb popped! Score: ${this.score}`
    );

    this.updateScoreDisplay();

    this.playPopSound(multiplier);

    const object = orb.entity.object3D;

    if (!object) {
      return;
    }

    const origin =
      object.getWorldPosition(new Vector3());

    const material = (object as Mesh).material;

    const sourceMaterial = Array.isArray(material)
      ? material[0]
      : material;

    const particleColor =
      sourceMaterial instanceof MeshBasicMaterial
        ? sourceMaterial.color
        : 0xffffff;

    // A short burst keeps the pop readable without adding much GPU work.
    for (
      let i = 0;
      i < PARTICLE_COUNT;
      i++
    ) {
      const particleMesh = new Mesh(
        new PlaneGeometry(0.025, 0.025),
        new MeshBasicMaterial({
          color: particleColor,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        })
      );

      particleMesh.position.copy(origin);

      const particleEntity =
        this.world.createTransformEntity(
          particleMesh
        );

      const angle =
        (i / PARTICLE_COUNT) * Math.PI * 2;

      this.particles.push({
        entity: particleEntity,

        velocity: new Vector3(
          Math.cos(angle) * 0.45,
          0.25 + (i % 3) * 0.12,
          Math.sin(angle) * 0.45
        ),

        age: 0,
      });
    }
  }

  private playPopSound(multiplier: number) {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;

      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const pitch = 1 + (multiplier - 1) * 0.1;

      oscillator.type = multiplier > 1 ? 'square' : 'sine';
      oscillator.frequency.setValueAtTime(620 * pitch, now);
      oscillator.frequency.exponentialRampToValueAtTime(170 * pitch, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);

      if (context.state === 'suspended') {
        void context.resume().catch(() => {});
      }
    } catch {
      // Sound is optional; audio restrictions should never interrupt gameplay.
    }
  }

  private playGameOverSound(reason: 'timeout' | 'manual') {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;

      this.audioContext ??= new AudioContextClass();
      const context = this.audioContext;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startFrequency = reason === 'timeout' ? 420 : 280;

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(startFrequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(150, now + 0.32);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.13, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.36);

      if (context.state === 'suspended') {
        void context.resume().catch(() => {});
      }
    } catch {
      // Audio is optional and must not interrupt the results screen.
    }
  }

  // ---------------- UPDATE ORBS ----------------

  private updateOrbs(delta: number) {
    for (
      let i = this.orbs.length - 1;
      i >= 0;
      i--
    ) {
      const orb = this.orbs[i];

      if (!orb.popping) {
        orb.age += delta;
        const pulse = 1 + 0.04 * Math.sin(this.elapsed * 3 + orb.phase);
        const object = orb.entity.object3D;
        if (object) {
          object.scale.setScalar(pulse);
          orb.glow.position.copy(object.getWorldPosition(this.worldPosition));
        }
        orb.glow.scale.setScalar(orb.radius * 2.5 * pulse);
        orb.glow.material.opacity = 0.52 + 0.12 * Math.sin(this.elapsed * 3 + orb.phase);
        continue;
      }

      orb.age += delta;

      const progress = Math.min(
        orb.age / POP_DURATION,
        1
      );

      const scale = progress < 0.25
        ? 1 + 0.55 * (1 - (1 - progress / 0.25) ** 2)
        : 1.55 * ((1 - progress) / 0.75) ** 1.35;
      const object = orb.entity.object3D;
      object?.scale.setScalar(Math.max(0, scale));

      const material = (object as Mesh | undefined)?.material;
      const popMaterial = Array.isArray(material)
        ? material[0]
        : material;
      if (popMaterial instanceof MeshBasicMaterial) {
        popMaterial.opacity = 1 - progress;
      }
      if (object) {
        orb.glow.position.copy(object.getWorldPosition(this.worldPosition));
      }
      orb.glow.scale.setScalar(orb.radius * 2.5 * Math.max(0, scale));
      orb.glow.material.opacity = 0.62 * (1 - progress);

      if (progress >= 1) {
        this.disposeOrb(orb);
        this.orbs.splice(i, 1);
      }
    }
  }

  // ---------------- UPDATE PARTICLES ----------------

  private updateParticles(delta: number) {
    for (
      let i = this.particles.length - 1;
      i >= 0;
      i--
    ) {
      const particle = this.particles[i];

      particle.age += delta;

      const progress = Math.min(
        particle.age / 0.6,
        1
      );

      const object = particle.entity.object3D;

      if (object) {
        object.position.addScaledVector(
          particle.velocity,
          delta
        );

        object.position.y -=
          delta * delta * 0.45;

        const material =
          (object as Mesh).material as MeshBasicMaterial;

        material.opacity = 1 - progress;

        object.scale.setScalar(
          1 - progress * 0.35
        );
      }

      if (progress >= 1) {
        particle.entity.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  // ---------------- 3D SCORE DISPLAY ----------------

  private createScoreDisplay() {
    if (!this.hudRoot) return;
    const canvas = document.createElement('canvas');

    canvas.width = 768;
    canvas.height = 160;

    this.scoreTexture = new CanvasTexture(canvas);
    this.releaseScoreTexture = trackUITexture(this.scoreTexture);

    this.scoreSprite = new Sprite(
      new SpriteMaterial({
        map: this.scoreTexture,
        transparent: true,
        depthTest: false,
      })
    );

    this.scoreSprite.position.set(
      0,
      this.compactHUD ? 2.30 : 2.34,
      -2.17
    );
    this.scoreSprite.renderOrder = 6;

    this.scoreSprite.scale.set(
      this.compactHUD ? 0.64 : 0.62,
      this.compactHUD ? 0.14 : 0.22,
      1
    );

    this.hudRoot.group.add(this.scoreSprite);

    this.updateScoreDisplay();
  }

  private updateScoreDisplay() {
    const canvas = this.scoreTexture?.image;

    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !this.scoreTexture
    ) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    context.font = `700 ${this.compactHUD ? 80 : 96}px "Courier New", monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = '#FFF1D6';
    context.strokeStyle = '#3D251F';
    context.lineWidth = 8;

    context.strokeText(
      `SCORE: ${this.score}`,
      canvas.width / 2,
      canvas.height / 2
    );

    context.fillText(
      `SCORE: ${this.score}`,
      canvas.width / 2,
      canvas.height / 2
    );

    this.scoreTexture.needsUpdate = true;
  }
}
