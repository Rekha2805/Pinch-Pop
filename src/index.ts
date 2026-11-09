
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
  setGameMode,
  type GameMode,
} from './gameSettings';

import {
  addPanel,
  addLabel,
  addButton,
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

  const menuCleanups: (() => void)[] = [];

  let modeButtonCleanups: (() => void)[] = [];

  let startButtonCleanup: (() => void) | undefined;

  // ---------------- MAIN PANEL ----------------

  menuCleanups.push(
    addPanel(
      world,
      0,
      1.50,
      -1.5,
      1.65,
      2.1
    )
  );

  // ---------------- TITLE ----------------

  menuCleanups.push(
    addLabel(
      world,
      'PINCH POP',
      0, 2.15, -1.45,
      1.15, 0.24,
      '#FF91B5',
      62
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'POP IT. SCORE BIG.',
      0, 1.92, -1.45,
      1.05, 0.13,
      '#E7D4F7',
      30
    )
  );

  // ---------------- MODE HEADING ----------------

  menuCleanups.push(
    addLabel(
      world,
      'CHOOSE YOUR GAME MODE',
      0, 1.66, -1.45,
      1.35, 0.13,
      '#FFFFFF',
      29
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
        -0.40,
        1.34,
        -1.39,
        0.70,
        0.29,
        () => {
          if (gameStarted) return;

          selectedMode = 'endless';
          createModeButtons();
        },
        selectedMode === 'endless'
          ? '#A34BC8'
          : '#49345F'
      )
    );

    // Challenge mode button
    modeButtonCleanups.push(
      addButton(
        world,
        selectedMode === 'challenge'
          ? '30 SEC  ✓'
          : '30 SEC',
        0.40,
        1.34,
        -1.39,
        0.70,
        0.29,
        () => {
          if (gameStarted) return;

          selectedMode = 'challenge';
          createModeButtons();
        },
        selectedMode === 'challenge'
          ? '#A34BC8'
          : '#49345F'
      )
    );
  }

  createModeButtons();

  // ---------------- INSTRUCTIONS ----------------

  menuCleanups.push(
    addLabel(
      world,
      'HOW TO PLAY',
      0, 1.02, -1.45,
      0.85, 0.13,
      '#FF91B5',
      31
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'PINCH YOUR THUMB + INDEX FINGER',
      0, 0.87, -1.45,
      1.45, 0.12,
      '#FFFFFF',
      24
    )
  );

  menuCleanups.push(
    addLabel(
      world,
      'TO POP THE GLOWING ORBS',
      0, 0.74, -1.45,
      1.25, 0.12,
      '#DCC9EE',
      24
    )
  );

  // ---------------- START GAME ----------------

  function startGame() {

    if (gameStarted) return;

    gameStarted = true;

    setGameMode(selectedMode);

    // Stop menu pinch detection
    setMenuPinchHandler(null);

    // Remove welcome screen
    menuCleanups.forEach((cleanup) => cleanup());

    modeButtonCleanups.forEach((cleanup) => cleanup());

    startButtonCleanup?.();

    // Start gameplay
    world.registerSystem(SpawnSystem);

    console.log(`Pinch Pop started: ${selectedMode}`);
  }

  // Start button
  startButtonCleanup = addButton(
    world,
    'START GAME',
    0,
    0.56,
    -1.38,
    1.0,
    0.20,
    startGame,
    '#FF779A'
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
      Math.abs(point.x - x) <= width / 2 + 0.12 &&
      Math.abs(point.y - y) <= height / 2 + 0.12 &&
      Math.abs(point.z - z) <= 0.35
    );
  }

  // ---------------- MENU PINCH HANDLER ----------------

  function handleMenuPinch(point: Vector3) {

    if (gameStarted) return;

    // Start Game
    if (
      isInsideButton(
        point,
        0,
        0.56,
        -1.38,
        1.0,
        0.20
      )
    ) {
      startGame();
      return;
    }

    // Endless mode
    if (
      isInsideButton(
        point,
        -0.40,
        1.34,
        -1.39,
        0.70,
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
        point,
        0.40,
        1.34,
        -1.39,
        0.70,
        0.29
      )
    ) {
      selectedMode = 'challenge';
      createModeButtons();
    }
  }

  // ---------------- REGISTER MENU SYSTEM ----------------

  setMenuPinchHandler(handleMenuPinch);

  world.registerSystem(MenuPinchSystem);

  console.log('Pinch Pop welcome menu loaded!');
}

// ---------------- ERROR HANDLING ----------------

startApp().catch((error) => {
  console.error('Failed to start Pinch Pop:', error);
});
