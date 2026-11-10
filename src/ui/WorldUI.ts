import { RayInteractable } from '@iwsdk/core';

import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';

export interface UIParent {
  object3D: Object3D;
}

export interface ResponsiveUIRoot {
  group: Group;
  entity: any;
  readonly scaleX: number;
  refresh(): void;
  dispose(): void;
}

export type MascotAnimation = 'idle' | 'happy' | 'combo' | 'sleepy';

export interface MushroomMascot {
  setAnimation(animation: MascotAnimation): void;
  dispose(): void;
}

const liveCanvasTextures = new Set<CanvasTexture>();
let textureResizeListenerReady = false;
let uiAudioContext: AudioContext | undefined;

function playUISound(kind: 'button' | 'mode' | 'start') {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;

    uiAudioContext ??= new AudioContextClass();
    const context = uiAudioContext;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequency = kind === 'start' ? 520 : kind === 'mode' ? 390 : 300;

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + 0.06);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.1);

    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }
  } catch {
    // Audio is optional and must not affect UI interaction.
  }
}

export function trackUITexture(texture: CanvasTexture) {
  liveCanvasTextures.add(texture);
  if (!textureResizeListenerReady) {
    window.addEventListener('resize', () => {
      liveCanvasTextures.forEach((liveTexture) => {
        liveTexture.needsUpdate = true;
      });
    });
    textureResizeListenerReady = true;
  }
  return () => liveCanvasTextures.delete(texture);
}

export function getViewportWorldWidth(
  world: any,
  z: number,
  margin = 0,
  aspectOverride?: number
) {
  const camera = world.camera;
  const depth = Math.max(0.1, Math.abs(z - camera.position.z));
  const aspect = aspectOverride ?? window.innerWidth / Math.max(1, window.innerHeight);
  const viewWidth = 2 * depth * Math.tan(camera.fov * Math.PI / 360) * aspect;
  return viewWidth * Math.max(0, 1 - margin * 2);
}

export function getViewportWorldHeight(world: any, z: number, margin = 0) {
  const camera = world.camera;
  const depth = Math.max(0.1, Math.abs(z - camera.position.z));
  const viewHeight = 2 * depth * Math.tan(camera.fov * Math.PI / 360);
  return viewHeight * Math.max(0, 1 - margin * 2);
}

export function createResponsiveUIRoot(
  world: any,
  z: number,
  contentWidth: number,
  margin = 0.06
): ResponsiveUIRoot {
  const group = new Group();
  const entity = world.createTransformEntity(group);
  const refresh = () => {
    const availableWidth = getViewportWorldWidth(world, z, margin);
    group.scale.x = Math.min(1, availableWidth / contentWidth);
    group.updateMatrixWorld(true);
  };

  refresh();
  window.addEventListener('resize', refresh);

  return {
    group,
    entity,
    get scaleX() {
      return group.scale.x;
    },
    refresh,
    dispose() {
      window.removeEventListener('resize', refresh);
      entity.dispose();
    },
  };
}

const COLORS = {
  panel: '#6B3F35',
  panelLight: '#8F5948',
  border: '#3D251F',
  purple: '#C66B58',
  coral: '#E89278',
  teal: '#D5A06F',
  white: '#FFF1D6',
  ink: '#3D251F',
  shadow: '#9B5B49',
};

function drawPixelAccent(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = COLORS.coral;
  ctx.fillRect(x, y, 16, 16);
  ctx.fillRect(x + 16, y + 16, 16, 16);
  ctx.fillStyle = COLORS.teal;
  ctx.fillRect(x + 32, y, 16, 16);
}

function drawPixelCorner(ctx: CanvasRenderingContext2D, x: number, y: number, flipX = false) {
  const direction = flipX ? -1 : 1;
  ctx.fillStyle = COLORS.teal;
  ctx.fillRect(x, y, direction * 34, 8);
  ctx.fillRect(x, y, direction * 8, 34);
  ctx.fillStyle = COLORS.coral;
  ctx.fillRect(x + direction * 12, y + 12, direction * 20, 7);
}

function drawMushroomMascot(
  ctx: CanvasRenderingContext2D,
  animation: MascotAnimation,
  elapsed: number
) {
  const bob =
    animation === 'sleepy'
      ? Math.sin(elapsed * 1.2) * 1
      : Math.sin(elapsed * (animation === 'combo' ? 8 : 2.4)) * (animation === 'combo' ? 3 : 1.5);
  const blink = Math.sin(elapsed * 1.7) > 0.97;
  const cheering = animation === 'combo' && Math.sin(elapsed * 8) > 0;
  const x = 64;
  const y = 73 + bob;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;

  if (animation === 'combo') {
    ctx.fillStyle = COLORS.teal;
    ctx.fillRect(22, 23, 5, 5);
    ctx.fillRect(101, 29, 5, 5);
    ctx.fillStyle = COLORS.coral;
    ctx.fillRect(31, 14, 4, 4);
    ctx.fillRect(94, 17, 4, 4);
  }

  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x - 25, y - 28, 50, 8);
  ctx.fillRect(x - 31, y - 20, 62, 16);
  ctx.fillRect(x - 25, y - 4, 50, 8);
  ctx.fillStyle = '#E89278';
  ctx.fillRect(x - 20, y - 25, 40, 6);
  ctx.fillRect(x - 26, y - 19, 52, 13);
  ctx.fillRect(x - 19, y - 5, 38, 4);
  ctx.fillStyle = '#F2B090';
  ctx.fillRect(x - 10, y - 24, 8, 6);
  ctx.fillRect(x + 10, y - 18, 7, 5);

  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(x - 16, y + 3, 32, 29);
  ctx.fillRect(x - 10, y + 31, 20, 5);
  ctx.fillStyle = '#FFF1D6';
  ctx.fillRect(x - 11, y + 5, 22, 27);
  ctx.fillRect(x - 7, y + 32, 14, 3);

  ctx.fillStyle = COLORS.ink;
  if (blink || animation === 'sleepy') {
    ctx.fillRect(x - 14, y + 13, 8, 3);
    ctx.fillRect(x + 6, y + 13, 8, 3);
  } else {
    ctx.fillRect(x - 13, y + 11, 5, 7);
    ctx.fillRect(x + 8, y + 11, 5, 7);
  }

  ctx.fillStyle = '#E89278';
  ctx.fillRect(x - 19, y + 18, 6, 4);
  ctx.fillRect(x + 13, y + 18, 6, 4);

  ctx.fillStyle = COLORS.ink;
  if (animation === 'happy' || cheering) {
    ctx.fillRect(x - 6, y + 22, 4, 4);
    ctx.fillRect(x + 2, y + 22, 4, 4);
    ctx.fillRect(x - 2, y + 25, 4, 3);
  } else if (animation === 'sleepy') {
    ctx.fillRect(x - 4, y + 24, 8, 3);
  } else {
    ctx.fillRect(x - 4, y + 23, 8, 3);
  }

  if (animation === 'combo') {
    ctx.fillStyle = COLORS.coral;
    ctx.fillRect(x - 39, y + 2, 5, 18);
    ctx.fillRect(x + 34, y + 2, 5, 18);
  }
}

export function addMushroomMascot(
  world: any,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  parent?: UIParent,
  initialAnimation: MascotAnimation = 'idle'
): MushroomMascot {
  const texture = createTexture(128, 128, () => undefined);
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  const owner = parent?.object3D ?? world.scene;
  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 6;
  owner.add(sprite);

  let animation = initialAnimation;
  let frame = 0;
  const context = texture.image.getContext('2d');
  if (!context) {
    throw new Error('Mascot canvas context unavailable');
  }
  const render = (time: number) => {
    drawMushroomMascot(context, animation, time / 1000);
    texture.needsUpdate = true;
    frame = window.requestAnimationFrame(render);
  };
  frame = window.requestAnimationFrame(render);

  return {
    setAnimation(nextAnimation) {
      animation = nextAnimation;
    },
    dispose() {
      window.cancelAnimationFrame(frame);
      owner.remove(sprite);
      material.dispose();
      texture.dispose();
    },
  };
}

// ---------------- TEXTURE HELPER ----------------

function createTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  draw(ctx);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

// ---------------- ROUNDED RECTANGLE ----------------

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// ---------------- MAIN PANEL ----------------

export function addPanel(
  world: any,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  parent?: UIParent
) {
  const textureWidth = 1024;
  const textureHeight = Math.max(640, Math.round(textureWidth * height / width));
  const texture = createTexture(textureWidth, textureHeight, (ctx) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const inset = Math.min(w, h) * 0.018;
    const radius = Math.min(w, h) * 0.035;
    ctx.clearRect(0, 0, w, h);

    roundedRect(ctx, inset, inset, w - inset * 2, h - inset * 2, radius);

    const panelGradient = ctx.createLinearGradient(0, 0, w, h);
    panelGradient.addColorStop(0, COLORS.panelLight);
    panelGradient.addColorStop(0.55, COLORS.panel);
    panelGradient.addColorStop(1, '#4D302A');
    ctx.fillStyle = panelGradient;
    ctx.fill();

    ctx.lineWidth = 14;
    ctx.strokeStyle = COLORS.border;
    ctx.stroke();

    roundedRect(ctx, inset * 2.5, inset * 2.5, w - inset * 5, h - inset * 5, radius * 0.72);

    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,241,214,0.22)';
    ctx.stroke();

    drawPixelCorner(ctx, w * 0.075, h * 0.075);
    drawPixelCorner(ctx, w * 0.925, h * 0.075, true);
    ctx.fillStyle = COLORS.coral;
    ctx.fillRect(w * 0.38, h * 0.055, w * 0.24, Math.max(10, h * 0.014));

    drawPixelAccent(ctx, w * 0.075, h * 0.075);
  });
  const releaseTexture = trackUITexture(texture);

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    material
  );

  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;

  (parent?.object3D ?? world.scene).add(mesh);

  return () => {
    world.scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
    releaseTexture();
  };
}

// ---------------- TEXT DRAWING ----------------

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  fontSize: number
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.imageSmoothingEnabled = false;

  // Higher resolution for sharper VR text
  const renderSize = Math.min(fontSize * 4, height * 0.72);
  ctx.font = `700 ${renderSize}px "Courier New", "Lucida Console", monospace`;

  ctx.fillStyle = color;
  ctx.shadowColor = COLORS.ink;
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, renderSize * 0.08);
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeText(text, width / 2, height / 2, width * 0.95);

  ctx.fillText(text, width / 2, height / 2, width * 0.95);

  ctx.shadowBlur = 0;
}

// ---------------- STATIC LABEL ----------------

export function addLabel(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color = COLORS.white,
  fontSize = 32,
  parent?: UIParent
) {
  const textureWidth = 2048;
  const textureHeight = Math.max(128, Math.round(textureWidth * height / width));
  const texture = createTexture(
    textureWidth,
    textureHeight,
    (ctx) => drawText(ctx, text, color, fontSize)
  );
  const releaseTexture = trackUITexture(texture);

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new Sprite(material);

  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 5;

  (parent?.object3D ?? world.scene).add(sprite);

  return () => {
    world.scene.remove(sprite);
    material.dispose();
    texture.dispose();
    releaseTexture();
  };
}

// ---------------- INTERACTIVE BUTTON ----------------

export function addButton(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  onClick: () => void,
  color = COLORS.purple,
  parent?: UIParent
) {
  const buttonScale = 0.88;
  const buttonWidth = width * buttonScale;
  const buttonHeight = height * buttonScale;
  const textureWidth = 2048;
  const textureHeight = Math.max(320, Math.min(1024, Math.round(textureWidth * height / width)));
  const texture = createTexture(
    textureWidth,
    textureHeight,
    (ctx) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const inset = Math.max(10, h * 0.02);
      ctx.clearRect(0, 0, w, h);

      roundedRect(ctx, inset, inset, w - inset * 2, h - inset * 2, h * 0.08);

      const gradient = ctx.createLinearGradient(
        0, 0, w, h
      );

      gradient.addColorStop(0, color);
      gradient.addColorStop(1, COLORS.shadow);

      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.lineWidth = Math.max(8, h * 0.018);
      ctx.strokeStyle = COLORS.ink;
      roundedRect(ctx, inset, inset, w - inset * 2, h - inset * 2, h * 0.08);
      ctx.stroke();

      const gloss = ctx.createLinearGradient(0, inset, 0, h * 0.54);
      gloss.addColorStop(0, 'rgba(255,241,214,0.24)');
      gloss.addColorStop(1, 'rgba(255,241,214,0)');
      roundedRect(ctx, inset * 2, inset * 1.5, w - inset * 4, h * 0.42, h * 0.08);
      ctx.fillStyle = gloss;
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.imageSmoothingEnabled = false;
      const textSize = Math.min(h * 0.28, w * 0.13);
      ctx.font = `700 ${Math.max(28, Math.round(textSize))}px "Courier New", "Lucida Console", monospace`;

      ctx.fillStyle = COLORS.white;
      ctx.shadowColor = COLORS.ink;
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(3, textSize * 0.08);
      ctx.strokeStyle = COLORS.ink;

      ctx.strokeText(text, w / 2, h / 2, w * 0.88);
      ctx.fillText(text, w / 2, h / 2, w * 0.88);

      ctx.shadowBlur = 0;
    }
  );
  const releaseTexture = trackUITexture(texture);

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(
    new PlaneGeometry(buttonWidth, buttonHeight),
    material
  );

  mesh.position.set(x, y, z);
  mesh.renderOrder = 4;
  const baseScale = mesh.scale.clone();

  const entity = world.createTransformEntity(
    mesh,
    parent ? { parent } : undefined
  );

  entity.addComponent(RayInteractable);

  const handleClick = () => {
    const soundKind =
      text === 'START GAME'
        ? 'start'
        : text === 'ENDLESS' || text === 'ENDLESS  ✓' || text === '30 SEC' || text === '30 SEC  ✓'
          ? 'mode'
          : 'button';
    playUISound(soundKind);
    mesh.scale.copy(baseScale).multiplyScalar(0.97);
    window.setTimeout(() => mesh.scale.copy(baseScale), 90);
    onClick();
  };

  const handlePointerOver = () => {
    mesh.scale.copy(baseScale).multiplyScalar(1.035);
  };
  const handlePointerOut = () => {
    mesh.scale.copy(baseScale);
  };

  mesh.addEventListener('pointerdown', handleClick);
  mesh.addEventListener('pointerover', handlePointerOver);
  mesh.addEventListener('pointerout', handlePointerOut);

  return () => {
    mesh.removeEventListener('pointerdown', handleClick);
    mesh.removeEventListener('pointerover', handlePointerOver);
    mesh.removeEventListener('pointerout', handlePointerOut);

    entity.dispose();

    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
    releaseTexture();
  };
}

// ---------------- DYNAMIC LABEL ----------------

export function addDynamicLabel(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color = COLORS.white,
  fontSize = 32,
  parent?: UIParent
) {
  const textureWidth = 2048;
  const textureHeight = Math.max(128, Math.round(textureWidth * height / width));
  const texture = createTexture(
    textureWidth,
    textureHeight,
    (ctx) => drawText(ctx, text, color, fontSize)
  );
  const releaseTexture = trackUITexture(texture);

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new Sprite(material);

  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 5;

  (parent?.object3D ?? world.scene).add(sprite);

  return {
    update(newText: string) {
      const ctx = texture.image.getContext('2d');

      if (!ctx) return;

      drawText(ctx, newText, color, fontSize);
      texture.needsUpdate = true;
    },

    dispose() {
      world.scene.remove(sprite);
      material.dispose();
      texture.dispose();
      releaseTexture();
    },
  };
}
