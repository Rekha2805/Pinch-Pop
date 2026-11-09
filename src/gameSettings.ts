export type GameMode = 'endless' | 'challenge';

let selectedGameMode: GameMode = 'endless';

export function setGameMode(mode: GameMode) {
  selectedGameMode = mode;
}

export function getGameMode(): GameMode {
  return selectedGameMode;
}