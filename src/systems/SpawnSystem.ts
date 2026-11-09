
import { createSystem, RayInteractable } from '@iwsdk/core';

import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

import { Orb } from '../components/Orb';
import { getGameMode } from '../gameSettings';

import {
  addPanel,
  addLabel,
  addButton,
  addDynamicLabel,
} from '../ui/WorldUI';

const PINCH_THRESHOLD = 0.75;
const ORB_RADIUS = 0.12;
const POP_DURATION = 0.1;
const PARTICLE_COUNT = 7;

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

  private gameMode = getGameMode();
  private timeRemaining = 30;
  private gameOver = false;
  private bestScore = 0;

  private leftPinching = false;
  private rightPinching = false;

  private scoreSprite?: Sprite;
  private scoreTexture?: CanvasTexture;

  // 3D UI cleanup functions
  private hudCleanup: (() => void)[] = [];
  private resultCleanup: (() => void)[] = [];
  private restartCleanup?: () => void;

  // Dynamic 3D labels
  private timerLabel?: ReturnType<typeof addDynamicLabel>;
  private bestLabel?: ReturnType<typeof addDynamicLabel>;

  // ---------------- INITIALIZE GAME ----------------

  init() {
    this.gameMode = getGameMode();
    this.timeRemaining = 30;
    this.gameOver = false;

    this.loadBestScore();

    this.createScoreDisplay();
    this.createRestartButton();
    this.createGameHUD();

    // First red orb
    this.spawnOrb('red', 0, 1.9, -1.5);

    console.log(`Pinch Pop started: ${this.gameMode}`);
  }

  // ---------------- GAME UPDATE ----------------

  update(delta: number) {
    if (this.gameOver) {
      return;
    }

    // Countdown for 30-second challenge
    if (this.gameMode === 'challenge') {
      this.timeRemaining -= delta;

      if (this.timeRemaining <= 0) {
        this.timeRemaining = 0;
        this.updateGameHUD();
        this.endGame();
        return;
      }

      this.updateGameHUD();
    }

    // Spawn a random orb every 1.5 seconds
    this.spawnTimer -= delta;

    if (this.spawnTimer <= 0) {
      this.spawnTimer += 1.5;
      this.spawnRandomOrb();
    }

    this.updatePinches();
    this.updateOrbs(delta);
    this.updateParticles(delta);
  }

  // ---------------- 3D RESTART BUTTON ----------------

  private createRestartButton() {
    this.restartCleanup = addButton(
      this.world,
      'RESTART',
      0.85, 1.9, -1.4,
      0.38, 0.15,
      () => this.restartGame(),
      '#9b59b6'
    );

    this.cleanupFuncs.push(() => {
      this.restartCleanup?.();
      this.restartCleanup = undefined;
    });
  }

  // ---------------- RESTART GAME ----------------

  private restartGame() {
    // Remove existing orbs
    for (const orb of this.orbs) {
      orb.entity.dispose();
    }

    this.orbs.length = 0;

    // Remove existing particles
    for (const particle of this.particles) {
      particle.entity.dispose();
    }

    this.particles.length = 0;

    // Remove 3D results screen
    this.resultCleanup.forEach((cleanup) => cleanup());
    this.resultCleanup = [];

    // Reset game state
    this.score = 0;
    this.spawnTimer = 1.5;
    this.timeRemaining = 30;
    this.gameOver = false;

    this.leftPinching = false;
    this.rightPinching = false;

    // Update displays
    this.updateScoreDisplay();
    this.updateGameHUD();

    // Spawn a fresh red orb
    this.spawnOrb('red', 0, 1.9, -1.5);

    console.log('Game restarted!');
  }

  // ---------------- 3D GAME HUD ----------------

  private createGameHUD() {
    const modeName =
      this.gameMode === 'endless'
        ? 'ENDLESS MODE'
        : '30 SECOND CHALLENGE';

    this.hudCleanup.push(
      addPanel(
        this.world,
        -0.75, 1.9, -1.5,
        0.65, 0.48
      )
    );

    this.hudCleanup.push(
      addLabel(
        this.world,
        modeName,
        -0.75, 2.08, -1.47,
        0.58, 0.09,
        '#bd75ff',
        25
      )
    );

    this.timerLabel = addDynamicLabel(
      this.world,
      '',
      -0.75, 1.94, -1.47,
      0.5, 0.09,
      '#55e5dc',
      35
    );

    this.bestLabel = addDynamicLabel(
      this.world,
      '',
      -0.75, 1.79, -1.47,
      0.5, 0.08,
      '#ffb000',
      28
    );

    this.hudCleanup.push(
      () => this.timerLabel?.dispose()
    );

    this.hudCleanup.push(
      () => this.bestLabel?.dispose()
    );

    this.updateGameHUD();

    // Register cleanup
    this.cleanupFuncs.push(() => {
      this.hudCleanup.forEach((cleanup) => cleanup());
      this.hudCleanup = [];
    });
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
  }

  // ---------------- BEST SCORE ----------------

  private loadBestScore() {
    const key = `pinch-pop-best-${this.gameMode}`;

    try {
      this.bestScore =
        Number(localStorage.getItem(key)) || 0;
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

  private endGame() {
    this.gameOver = true;

    // Remove remaining orbs
    for (const orb of this.orbs) {
      orb.entity.dispose();
    }

    this.orbs.length = 0;

    // Remove remaining particles
    for (const particle of this.particles) {
      particle.entity.dispose();
    }

    this.particles.length = 0;

    // Main results panel
    this.resultCleanup.push(
      addPanel(
        this.world,
        0, 1.5, -1.2,
        1.35, 1.2
      )
    );

    // Title
    this.resultCleanup.push(
      addLabel(
        this.world,
        'PINCH POP',
        0, 1.95, -1.17,
        0.9, 0.16,
        '#55e5dc',
        48
      )
    );

    // Game over text
    this.resultCleanup.push(
      addLabel(
        this.world,
        "TIME'S UP!",
        0, 1.72, -1.17,
        1.0, 0.17,
        '#ff6f91',
        65
      )
    );

    // Final score
    this.resultCleanup.push(
      addLabel(
        this.world,
        `FINAL SCORE: ${this.score}`,
        0, 1.47, -1.17,
        1.0, 0.13,
        '#ffffff',
        40
      )
    );

    // Best score
    this.resultCleanup.push(
      addLabel(
        this.world,
        `BEST SCORE: ${this.bestScore}`,
        0, 1.27, -1.17,
        1.0, 0.12,
        '#ffb000',
        36
      )
    );

    // Play Again button
    this.resultCleanup.push(
      addButton(
        this.world,
        'PLAY AGAIN',
        0, 1.02, -1.15,
        0.75, 0.2,
        () => this.restartGame(),
        '#bd55a8'
      )
    );

    console.log(
      `Challenge finished! Final score: ${this.score}`
    );
  }

  // ---------------- ORB SPAWNING ----------------

  private spawnRandomOrb() {
    const color =
      COLORS[Math.floor(Math.random() * COLORS.length)];

    const x = -0.5 + Math.random();
    const y = 1.0 + Math.random() * 0.6;
    const z = -1.2 - Math.random() * 0.8;

    this.spawnOrb(color.name, x, y, z);
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

    const mesh = new Mesh(
      new SphereGeometry(
        ORB_RADIUS,
        24,
        16
      ),
      new MeshBasicMaterial({ color })
    );

    mesh.position.set(x, y, z);

    const entity =
      this.world.createTransformEntity(mesh);

    entity.addComponent(Orb, {
      color: colorName,
      scoreValue: 1,
    });

    entity.addComponent(RayInteractable);

    const trackedOrb: TrackedOrb = {
      entity,
      age: 0,
      popping: false,
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

    let leftPinching = false;
    let rightPinching = false;

    for (
      const inputSource of this.world.session.inputSources
    ) {
      if (!inputSource.hand) {
        continue;
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

      const pinchStrength = Math.max(
        0,
        1 - distance / 0.08
      );

      const isPinching =
        pinchStrength >= PINCH_THRESHOLD;

      const isLeft =
        inputSource.handedness === 'left';

      if (isLeft) {
        leftPinching = isPinching;
      } else {
        rightPinching = isPinching;
      }

      const wasPinching = isLeft
        ? this.leftPinching
        : this.rightPinching;

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

        this.tryPopOrb(pinchPoint);
      }
    }

    this.leftPinching = leftPinching;
    this.rightPinching = rightPinching;
  }

  private tryPopOrb(pinchPoint: Vector3) {
    if (this.gameOver) {
      return;
    }

    let closest: TrackedOrb | undefined;
    let closestDistance = 0.15;

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

      if (distance <= closestDistance) {
        closest = orb;
        closestDistance = distance;
      }
    }

    if (closest) {
      this.popOrb(closest);
    }
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

    this.score += 1;

    this.updateBestScore();

    console.log(
      `Orb popped! Score: ${this.score}`
    );

    this.updateScoreDisplay();

    console.log('Pop sound stub');

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

    // Create 7 particles
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

  // ---------------- UPDATE ORBS ----------------

  private updateOrbs(delta: number) {
    for (
      let i = this.orbs.length - 1;
      i >= 0;
      i--
    ) {
      const orb = this.orbs[i];

      if (!orb.popping) {
        continue;
      }

      orb.age += delta;

      const progress = Math.min(
        orb.age / POP_DURATION,
        1
      );

      orb.entity.object3D?.scale.setScalar(
        1 - progress
      );

      if (progress >= 1) {
        orb.entity.dispose();
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
    const canvas = document.createElement('canvas');

    canvas.width = 512;
    canvas.height = 128;

    this.scoreTexture = new CanvasTexture(canvas);

    this.scoreSprite = new Sprite(
      new SpriteMaterial({
        map: this.scoreTexture,
        transparent: true,
        depthTest: false,
      })
    );

    this.scoreSprite.position.set(
      0,
      2.10,
      -1.5
    );

    this.scoreSprite.scale.set(
      0.8,
      0.2,
      1
    );

    this.world.scene.add(this.scoreSprite);

    this.cleanupFuncs.push(() => {
      this.scoreTexture?.dispose();
      this.scoreSprite?.material.dispose();
      this.scoreSprite?.removeFromParent();
    });

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

    context.font = 'bold 64px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = '#ffffff';
    context.strokeStyle = '#111111';
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
