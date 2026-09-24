import AudioStage from './stages/AudioStage.svelte';
import ComicStage from './stages/ComicStage.svelte';
import TextStage from './stages/TextStage.svelte';
import GameStage from './stages/GameStage.svelte';
import ArtStage from './stages/ArtStage.svelte';
import CraftStage from './stages/CraftStage.svelte';

/** @type {import('../../contracts.js').NodeSkinModule['stages']} */
export const stages = {
	audio: AudioStage,
	comic: ComicStage,
	text: TextStage,
	game: GameStage,
	art: ArtStage,
	craft: CraftStage
};
