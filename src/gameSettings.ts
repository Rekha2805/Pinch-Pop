export type GameMode = 'endless' | 'challenge';

export const START_GAME_EVENT = 'pinch-pop:start-game';
export const RETURN_HOME_EVENT = 'pinch-pop:return-home';

let selectedGameMode: GameMode = 'endless';

export function setGameMode(mode: GameMode) {
  selectedGameMode = mode;
}

export function getGameMode(): GameMode {
  return selectedGameMode;
}
