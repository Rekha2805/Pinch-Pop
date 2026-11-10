
import { World } from '@iwsdk/core';
import { Vector3 } from 'three';

import projectOptions from 'virtual:iwsdk-project';

import { Orb } from './components/Orb';
import { SpawnSystem } from './systems/SpawnSystem';

import {
  MenuPinchSystem,
  setMenuPinchHandler,
} from './systems/MenuPinchSystem';

import {
  RETURN_HOME_EVENT,
  START_GAME_EVENT,
  setGameMode,
  type GameMode,
} from './gameSettings';

import {
  addPanel,
  addLabel,
  addButton,
  addMushroomMascot,
  createResponsiveUIRoot,
} from './ui/WorldUI';

// ---------------- START APPLICATION ----------------

async function startApp() {

  // Find and validate scene container
  const container = document.getElementById('scene-container');

  if (!container) {
    throw new Error('Scene container not found');
  }

  // Create IWSDK world
  const world = await World.create(container, projectOptions);

  world.registerComponent(Orb);

  // ---------------- MENU STATE ----------------

  let selectedMode: GameMode = 'endless';
  let gameStarted = false;
  let spawnSystemRegistered = false;

  const MENU_PANEL_Z = -2.4;
  const MENU_LABEL_Z = -2.39;
  const MENU_BUTTON_Z = -2.38;
  const MENU_Y_OFFSET = 0.25;
  const menuRoot = createResponsiveUIRoot(world, MENU_PANEL_Z, 1.25);

  const menuCleanups: (() => void)[] = [];

  let modeButtonCleanups: (() => void)[] = [];

  // ---------------- MAIN PANEL ----------------

  menuCleanups.push(
    addPanel(
      world,
      0,
      1.45 + MENU_Y_OFFSET,
      MENU_PANEL_Z,
      1.25,
      2.0,
      menuRoot.entity
    )
  );

  const menuMascot = addMushroomMascot(
    world,
    0.43,
    1.78 + MENU_Y_OFFSET,
    MENU_LABEL_Z,
    0.22,
    0.28,
    menuRoot.entity,
    'idle'
  );
  menuCleanups.push(() => menuMascot.dispose());

  // ---------------- TITLE ----------------

  menuCleanups.push(
    addLabel(
      world,
      'PINCH POP',
      0, 2.15 + MENU_Y_OFFSET, MENU_LABEL_Z,
      1.05, 0.24,
      '#F1B08E',
      62,
      menuRoot.entity
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'POP IT. SCORE BIG.',
      0, 1.92 + MENU_Y_OFFSET, MENU_LABEL_Z,
      0.95, 0.13,
      '#FFE3C2',
      30,
      menuRoot.entity
    )
  );

  // ---------------- MODE HEADING ----------------

  menuCleanups.push(
    addLabel(
      world,
      'CHOOSE YOUR GAME MODE',
      0, 1.66 + MENU_Y_OFFSET, MENU_LABEL_Z,
      1.1, 0.13,
      '#FFF1D6',
      29,
      menuRoot.entity
    )
  );

  // ---------------- MODE BUTTONS ----------------

  function createModeButtons() {

    // Remove old mode buttons
    modeButtonCleanups.forEach((cleanup) => cleanup());

    modeButtonCleanups = [];

    // Endless mode button
    modeButtonCleanups.push(
      addButton(
        world,
        selectedMode === 'endless'
          ? 'ENDLESS  ✓'
          : 'ENDLESS',
        -0.31,
        1.34 + MENU_Y_OFFSET,
        MENU_BUTTON_Z,
        0.48,
        0.24,
        () => {
          if (gameStarted) return;

          selectedMode = 'endless';
          createModeButtons();
        },
        selectedMode === 'endless'
          ? '#E89278'
          : '#5A3830',
        menuRoot.entity
      )
    );

    // Challenge mode button
    modeButtonCleanups.push(
      addButton(
        world,
        selectedMode === 'challenge'
          ? '30 SEC  ✓'
          : '30 SEC',
        0.31,
        1.34 + MENU_Y_OFFSET,
        MENU_BUTTON_Z,
        0.48,
        0.24,
        () => {
          if (gameStarted) return;

          selectedMode = 'challenge';
          createModeButtons();
        },
        selectedMode === 'challenge'
          ? '#E89278'
          : '#5A3830',
        menuRoot.entity
      )
    );
  }

  createModeButtons();

  // ---------------- INSTRUCTIONS ----------------

  menuCleanups.push(
    addLabel(
      world,
      'HOW TO PLAY',
      0, 1.12 + MENU_Y_OFFSET, MENU_LABEL_Z,
      0.75, 0.13,
      '#F1B08E',
      31,
      menuRoot.entity
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'PINCH YOUR THUMB + INDEX FINGER',
      0, 0.97 + MENU_Y_OFFSET, MENU_LABEL_Z,
      1.1, 0.12,
      '#FFF1D6',
      24,
      menuRoot.entity
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'PLAY SEATED OR STANDING',
      0, 0.84 + MENU_Y_OFFSET, MENU_LABEL_Z,
      1.0, 0.12,
      '#EBC9A6',
      24,
      menuRoot.entity
    )
  );

  // ---------------- START GAME ----------------

  function startGame() {

    if (gameStarted) return;

    gameStarted = true;

    setGameMode(selectedMode);

    // Stop menu pinch detection
    setMenuPinchHandler(null);

    // Keep the menu alive so the results screen can return here without
    // reloading the XR scene.
    menuRoot.group.visible = false;

    if (!spawnSystemRegistered) {
      world.registerSystem(SpawnSystem);
      spawnSystemRegistered = true;
    } else {
      window.dispatchEvent(new Event(START_GAME_EVENT));
    }

    console.log(`Pinch Pop started: ${selectedMode}`);
  }

  // Start button
  addButton(
    world,
    'START GAME',
    0,
    0.66 + MENU_Y_OFFSET,
    MENU_BUTTON_Z,
    0.82,
    0.20,
    startGame,
    '#E89278',
    menuRoot.entity
  );

  // ---------------- BUTTON HIT TEST ----------------

  function isInsideButton(
    point: Vector3,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number
  ) {
    return (
      Math.abs(point.x - x) <= width / 2 + 0.015 &&
      Math.abs(point.y - y) <= height / 2 + 0.025 &&
      Math.abs(point.z - z) <= 0.35
    );
  }

  // ---------------- MENU PINCH HANDLER ----------------

  function handleMenuPinch(point: Vector3) {

    if (gameStarted) return;

    menuRoot.group.updateMatrixWorld(true);
    const localPoint = menuRoot.group.worldToLocal(point.clone());

    // Start Game
    if (
      isInsideButton(
        localPoint,
        0,
      0.66 + MENU_Y_OFFSET,
        MENU_BUTTON_Z,
      0.82,
        0.20
      )
    ) {
      startGame();
      return;
    }

    // Endless mode
    if (
      isInsideButton(
        localPoint,
        -0.31,
        1.34 + MENU_Y_OFFSET,
        MENU_BUTTON_Z,
        0.56,
        0.29
      )
    ) {
      selectedMode = 'endless';
      createModeButtons();
      return;
    }

    // 30-second challenge
    if (
      isInsideButton(
        localPoint,
        0.31,
        1.34 + MENU_Y_OFFSET,
        MENU_BUTTON_Z,
        0.56,
        0.29
      )
    ) {
      selectedMode = 'challenge';
      createModeButtons();
    }
  }

  window.addEventListener(RETURN_HOME_EVENT, () => {
    gameStarted = false;
    menuRoot.group.visible = true;
    setMenuPinchHandler(handleMenuPinch);
  });

  // ---------------- REGISTER MENU SYSTEM ----------------

  setMenuPinchHandler(handleMenuPinch);

  world.registerSystem(MenuPinchSystem);

  console.log('Pinch Pop welcome menu loaded!');
}

// ---------------- ERROR HANDLING ----------------

startApp().catch((error) => {
  console.error('Failed to start Pinch Pop:', error);
});
