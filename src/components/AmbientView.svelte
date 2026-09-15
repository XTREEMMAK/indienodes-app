<script>
	/**
	 * A full-viewport visual canvas with compact audio transport anchored at the
	 * bottom. Audio and visual entries are still dealt independently, while the
	 * player's preview lane lets a queue built before entering be ducked, not
	 * replaced, and restored when the mode closes.
	 *
	 * Pairing is intentionally independent for now. `pairs_with` is still an
	 * open data-model decision (docs/roadmap.md), so inventing a relationship in
	 * the client would make this first pass look more authoritative than it is.
	 *
	 * @type {{ open?: boolean, onClose?: () => void }}
	 */
	let { open = false, onClose } = $props();

	import { tick, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import FieldNode from './FieldNode.svelte';
	import AmbientDiscoveryCard from './AmbientDiscoveryCard.svelte';
	import AmbientActionPanel from './AmbientActionPanel.svelte';
	import AmbientOptionsSheet from './AmbientOptionsSheet.svelte';
	import AmbientPlaylistSheet from './AmbientPlaylistSheet.svelte';
	import { audioPlayerStore } from '$lib/audioPlayerStore.svelte.js';
	import { audioSettingsStore } from '$lib/audioSettingsStore.svelte.js';
	import { comicViewerStore } from '$lib/comicViewerStore.svelte.js';
	import { createDecks } from '$lib/entryDeck.js';
	import { hideEntry, likeEntry } from '$lib/entryCuration.js';
	import { filtersStore } from '$lib/filtersStore.svelte.js';
	import { hiddenStore } from '$lib/hiddenStore.svelte.js';
	import { journalStore } from '$lib/journalStore.svelte.js';
	import { preferencesStore } from '$lib/preferencesStore.svelte.js';
	import { coverImageUrl, isVisibleTo, stripHtml } from '$lib/ring.js';
	import { ringStore } from '$lib/ringStore.svelte.js';
	import { flyFade } from '$lib/transitions.js';
	import { pickVoice, speak, speechSupported } from '$lib/speech.js';
	import { youtubeEmbedUrl } from '$lib/videoPreview.js';

	let overlayEl = $state(/** @type {HTMLElement | null} */ (null));
	let playlistEl = $state(/** @type {HTMLElement | null} */ (null));
	let candidatePreviewEl = $state(/** @type {HTMLAudioElement | null} */ (null));
	// The pick ambient offers while nothing is queued. Shown in the dock and
	// queued only when the visitor presses play (or skips, or takes the
	// discovery card's suggestion), so merely opening the mode never writes to
	// their playlist. Once anything is queued the dock follows the queue.
	let audioEntry = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let audioCandidate = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let audioCandidateTrack = $state(
		/** @type {{ label: string, media_url: string } | null} */ (null)
	);
	let visualEntry = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let sessionOpen = false;
	let enteredFullscreen = false;
	let optionsOpen = $state(false);
	let playlistOpen = $state(false);
	let interactionsOpen = $state(false);
	let audioCardVisible = $state(true);
	// Unobstructed mode: every piece of chrome steps out so the rotating visual
	// is the whole screen. Distinct from the browser fullscreen this overlay
	// already requests on entry, which removes the *browser's* furniture but
	// leaves ours; this removes ours.
	let immersive = $state(false);
	let immersiveHint = $state(false);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let immersiveHintTimer = undefined;
	// Set while we exit element-fullscreen on purpose, so the fullscreenchange
	// listener below does not read that exit as the visitor leaving ambient.
	let suppressFullscreenClose = false;
	// A game's direct `preview_url` is a muted teaser. Its `trailer_url`, when
	// present, is the click-to-play YouTube version; otherwise Ambient can still
	// open the direct preview with controls. Both borrow the audio lane rather
	// than playing over the music, and the YouTube iframe is not created early.
	// The text reader. `voice` is resolved rather than assumed: a device with
	// only remote voices reports none, and the control stays hidden rather
	// than sending the excerpt to a vendor. See speech.js.
	let reading = $state(false);
	let readingVoice = $state(/** @type {SpeechSynthesisVoice | null} */ (null));
	let stopReading = /** @type {(() => void) | null} */ (null);
	let trailerOpen = $state(false);
	let trailerEl = $state(/** @type {HTMLVideoElement | null} */ (null));
	/** @type {{ id: number, label: string, creator: string, cover: string | null } | null} */
	let nowPlayingToast = $state(null);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let nowPlayingTimer = undefined;
	let nowPlayingSeq = 0;
	let lastAnnouncedTrack = '';
	let candidatePreviewing = $state(false);
	let candidateRotationProgress = $state(0);
	/**
	 * Whether a temporary sound paused the queue, so it resumes after. Shared
	 * by every interruption in this mode — the discovery audition, a game
	 * trailer, and the text reader — because "one thing sounds at a time" is a
	 * property of the mode, not of whichever feature happens to be
	 * interrupting.
	 */
	let borrowedPlayback = false;
	let soundFlash = $state(0);
	let visualFlash = $state(0);
	let visualTapTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
	// Set when the queue had already run out before the mode opened, so the
	// run-out effect does not read an old ending as a new one and start
	// playing on entry. Cleared as soon as the queue moves again.
	let staleAtEnd = false;
	// Visuals already shown this session, newest last, for swiping back.
	// Plain rather than state: only the swipe handler reads it.
	/** @type {import('$lib/ring.js').RingEntry[]} */
	let visualHistory = [];
	const VISUAL_HISTORY_MAX = 20;
	/** @type {{ id: number, x: number, y: number } | null} */
	let swipeStart = null;
	// A swipe still ends in a click; this tells the tap handler to let it go.
	let swipeHandled = false;
	const SWIPE_MIN_PX = 56;
	// Swipes starting this close to either edge belong to the system (Android's
	// back gesture), not to the visual.
	const SWIPE_EDGE_PX = 24;
	const decks = createDecks();

	const eligible = $derived(
		ringStore.entries.filter(
			(entry) =>
				isVisibleTo(entry, preferencesStore.showExplicit) &&
				filtersStore.matches(entry) &&
				!hiddenStore.isHidden(entry.id) &&
				preferencesStore.isAmbientTypeVisible(entry.type)
		)
	);
	const audioPool = $derived(
		eligible.filter(
			(entry) =>
				entry.type === 'audio' && (entry.tracks ?? []).some((track) => Boolean(track.media_url))
		)
	);
	const visualPool = $derived(eligible.filter((entry) => entry.type !== 'audio'));

	// Ambient plays through the real queue, the same one the regular player
	// drives. It used to audition its picks in the player's one-track preview
	// lane instead, which is why its playlist never showed what was playing:
	// a preview never enters the queue. Now the queue is the session — a queue
	// the visitor brought in plays first, ambient's picks are appended when it
	// runs out (the regular player's Keep going), and leaving the mode carries
	// on playing in the regular player.
	const queueActive = $derived(!audioPlayerStore.isEmpty);
	// Queue items carry only `entryId`, which is the id this looks up.
	const queueEntry = $derived(
		queueActive
			? (ringStore.entries.find((entry) => entry.id === audioPlayerStore.current?.entryId) ?? null)
			: null
	);
	/**
	 * The excerpts a text entry carries, joined into one passage. Text is the
	 * only type with `excerpts`; anything else has nothing to read.
	 */
	const readableText = $derived(
		visualEntry?.type === 'text'
			? (visualEntry?.excerpts ?? [])
					.map((sample) => stripHtml(sample?.text ?? ''))
					.join(' ')
					.trim()
			: ''
	);
	const canRead = $derived(Boolean(readableText) && Boolean(readingVoice));

	/** Game trailer wins when supplied; old preview-only entries still work. */
	const visualTrailerUrl = $derived(
		visualEntry?.type === 'game' ? visualEntry.trailer_url || visualEntry.preview_url || null : null
	);
	const visualTrailerEmbedUrl = $derived(youtubeEmbedUrl(visualTrailerUrl));

	// Comics and Art both use the shared full-screen image viewer. Their
	// semantics remain distinct inside it: sequential pages versus independent
	// works.
	const visualReadable = $derived(
		(visualEntry?.type === 'comic' &&
			(visualEntry?.pages ?? []).some((page) => Boolean(page?.image_url))) ||
			(visualEntry?.type === 'art' &&
				(visualEntry?.artworks ?? []).some((artwork) => Boolean(artwork?.image_url)))
	);

	/** Whichever audio this dock is currently speaking for: the queue, or the pending pick. */
	const activeAudioEntry = $derived(queueEntry ?? audioEntry);
	const activeAudioPlaying = $derived(queueActive && audioPlayerStore.playing);
	const activeAudioLabel = $derived(
		queueActive
			? (audioPlayerStore.current?.label ?? 'Audio')
			: (audioEntry?.tracks?.find((track) => Boolean(track.media_url))?.label ?? 'Audio')
	);

	/**
	 * Deals through every eligible entry before refilling. See `entryDeck.js`
	 * for why a deck rather than a fresh random index each rotation.
	 * @param {import('$lib/ring.js').RingEntry[]} pool
	 * @param {'audio' | 'candidate' | 'visual'} lane
	 * @param {string} currentId
	 */
	function draw(pool, lane, currentId = '') {
		const id = decks.take(
			lane,
			pool.map((entry) => entry.id),
			currentId ? [currentId] : []
		);
		// Null means everything eligible is already showing, which for a
		// single-slot lane means staying put is the only option left.
		return pool.find((entry) => entry.id === id) ?? (id === null ? null : (pool[0] ?? null));
	}

	/** A fresh, silent pick for the dock while nothing is queued. */
	function dealPendingAudio() {
		audioEntry = draw(audioPool, 'audio', audioEntry?.id);
		if (audioEntry && audioCandidate?.id === audioEntry.id) advanceAudioCandidate();
	}

	/**
	 * Appends an entry to the queue and plays it, from `trackUrl` when given.
	 * Appended rather than replacing, the same as the regular player's Keep
	 * going: the queue is the session, and whatever was already in it stays.
	 * @param {import('$lib/ring.js').RingEntry} entry
	 * @param {string} [trackUrl]
	 */
	function playInQueue(entry, trackUrl = '') {
		// Already queued (another track of a node that is playing): go to it
		// rather than queueing the whole node a second time.
		const existing = trackUrl
			? audioPlayerStore.queue.findIndex(
					(item) => item.entryId === entry.id && item.url === trackUrl
				)
			: -1;
		if (existing >= 0) {
			audioPlayerStore.jumpTo(existing);
			return;
		}
		const from = audioPlayerStore.queue.length;
		const added = audioPlayerStore.addEntry(entry, coverImageUrl(entry), {
			openQueue: false,
			start: false
		});
		if (!added) return;
		// Found by URL rather than position: the visitor's shuffle preference
		// may have reordered the entry's tracks on the way in.
		const offset = audioPlayerStore.queue.slice(from).findIndex((item) => item.url === trackUrl);
		audioPlayerStore.jumpTo(from + Math.max(0, offset));
	}

	/** Deals the next audio node onto the end of the queue and plays it. */
	function continueWithNewAudio() {
		// A pool of one has nothing else to deal, and the draw says so with
		// null; ambient goes round that one node again rather than falling
		// silent.
		const next =
			draw(audioPool, 'audio', audioPlayerStore.current?.entryId ?? audioEntry?.id) ??
			audioPool[0] ??
			null;
		if (!next) return;
		audioEntry = next;
		playInQueue(next);
		if (audioCandidate?.id === next.id) advanceAudioCandidate();
	}

	/**
	 * The dock's skip: the next track in the queue, or a new node once the
	 * queue has nothing after this one. With nothing queued yet it only swaps
	 * the pending pick, which stays silent like the one it replaces.
	 */
	function skipAudio() {
		if (candidatePreviewing) stopCandidatePreview({ resume: false });
		if (!queueActive) {
			dealPendingAudio();
		} else if (audioPlayerStore.index < audioPlayerStore.queue.length - 1) {
			audioPlayerStore.next();
		} else {
			continueWithNewAudio();
		}
	}

	function advanceAudioCandidate() {
		stopCandidatePreview();
		const alternatives = audioPool.filter((entry) => entry.id !== activeAudioEntry?.id);
		const nextEntry = draw(alternatives, 'candidate', audioCandidate?.id) ?? activeAudioEntry;
		// The track the dock is showing, queued or pending, so the card never
		// suggests the very thing already in front of the visitor.
		const shownUrl = queueActive
			? audioPlayerStore.current?.url
			: audioEntry?.tracks?.find((track) => Boolean(track.media_url))?.media_url;
		const currentUrl = nextEntry?.id === activeAudioEntry?.id ? (shownUrl ?? '') : '';
		const tracks = (nextEntry?.tracks ?? []).filter(
			(track) => Boolean(track.media_url) && track.media_url !== currentUrl
		);
		const nextTrack =
			tracks.find(
				(track) =>
					nextEntry?.id !== audioCandidate?.id || track.media_url !== audioCandidateTrack?.media_url
			) ?? tracks[0];
		audioCandidate = nextTrack ? nextEntry : null;
		audioCandidateTrack = nextTrack ?? null;
	}

	/**
	 * Pauses the queue for a temporary sound, remembering to resume it. Safe to
	 * call when nothing is playing, and safe to call twice.
	 */
	function borrowSilence() {
		if (borrowedPlayback || !audioPlayerStore.playing) return;
		borrowedPlayback = true;
		audioPlayerStore.setPlaying(false);
	}

	/** Resumes the queue `borrowSilence` paused, if there is still one to resume. */
	function returnSilence() {
		if (borrowedPlayback && !audioPlayerStore.isEmpty && !audioPlayerStore.playing) {
			audioPlayerStore.setPlaying(true);
		}
		borrowedPlayback = false;
	}

	/** @param {{ resume?: boolean }} [options] */
	function stopCandidatePreview({ resume = true } = {}) {
		if (candidatePreviewEl) {
			candidatePreviewEl.pause();
			candidatePreviewEl.removeAttribute('src');
			candidatePreviewEl.load();
		}
		candidatePreviewing = false;
		if (resume) returnSilence();
		else borrowedPlayback = false;
	}

	// The discovery card's one-off preview is a sounding element beside the
	// player's own, so it has to honour the same output
	// level they do; without this it played every audition at full volume, and
	// went on sounding while the player was muted.
	$effect(() => {
		const el = candidatePreviewEl;
		if (el) el.volume = audioSettingsStore.outputVolume;
	});

	async function previewAudioCandidate() {
		if (!audioCandidate || !audioCandidateTrack || !candidatePreviewEl) return;
		if (candidatePreviewing) {
			stopCandidatePreview();
			return;
		}
		const mediaUrl = audioCandidateTrack.media_url;
		if (!mediaUrl) return;

		// An audition is one thing at a time.
		borrowSilence();
		candidatePreviewing = true;
		candidatePreviewEl.src = mediaUrl;
		try {
			await candidatePreviewEl.play();
		} catch {
			stopCandidatePreview();
		}
	}

	function replaceAudioWithCandidate() {
		if (!audioCandidate || !audioCandidateTrack) return;
		const replacement = audioCandidate;
		const trackUrl = audioCandidateTrack.media_url;
		stopCandidatePreview({ resume: false });
		// An explicit "play this instead": queued after whatever is there and
		// started, from the very track the card was offering.
		audioEntry = replacement;
		playInQueue(replacement, trackUrl);
		advanceAudioCandidate();
	}

	function toggleImmersive() {
		immersive = !immersive;
		optionsOpen = false;
		playlistOpen = false;
		interactionsOpen = false;
		clearTimeout(immersiveHintTimer);
		if (immersive) {
			// The way back has to be stated once, because in this mode there is
			// deliberately no visible control left to infer it from.
			immersiveHint = true;
			immersiveHintTimer = setTimeout(() => (immersiveHint = false), 2600);
		} else {
			immersiveHint = false;
		}
	}

	/**
	 * Opens the full-screen reader on the current visual.
	 *
	 * The reader is mounted at the root layout, not inside this overlay, so it
	 * is a *sibling* of the element holding browser fullscreen — and a
	 * fullscreen element renders only itself and its descendants, which would
	 * leave the reader invisible while ambient held it. Releasing fullscreen
	 * first is what makes the reader reachable at all; the overlay itself is
	 * `position: fixed` over the viewport, so ambient stays exactly where it
	 * was underneath, and the reader offers its own fullscreen control.
	 */
	async function openVisualViewer() {
		if (!visualEntry || !visualReadable) return;
		const entry = visualEntry;
		interactionsOpen = false;
		optionsOpen = false;
		playlistOpen = false;
		if (document.fullscreenElement === overlayEl && document.exitFullscreen) {
			suppressFullscreenClose = true;
			try {
				await document.exitFullscreen();
			} catch {
				// Refused: the fixed overlay was never depending on it.
			}
			suppressFullscreenClose = false;
		}
		// Opening the reader is the visitor choosing to actually look at the
		// work, which is what the journal records elsewhere for the same action.
		journalStore.record(entry.id, 'opened');
		comicViewerStore.show(entry);
	}

	// Voices populate asynchronously on some browsers, so an empty list on the
	// first read means "not yet" rather than "none available".
	$effect(() => {
		if (!open || !speechSupported()) return;
		let attempts = 0;
		let retryTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
		const resolve = () => {
			readingVoice = pickVoice(document.documentElement.lang || 'en');
			clearTimeout(retryTimer);
			// Mobile Safari and some WebViews populate voices late without firing
			// voiceschanged. Poll briefly as a fallback, still accepting only the
			// local voices pickVoice permits.
			if (!readingVoice && attempts < 12) {
				attempts += 1;
				retryTimer = setTimeout(resolve, 250);
			}
		};
		resolve();
		window.speechSynthesis.addEventListener('voiceschanged', resolve);
		return () => {
			clearTimeout(retryTimer);
			window.speechSynthesis.removeEventListener('voiceschanged', resolve);
		};
	});

	function stopTextReading() {
		stopReading?.();
		stopReading = null;
		reading = false;
	}

	function toggleReadText() {
		if (reading) {
			stopTextReading();
			return;
		}
		if (!canRead) return;
		interactionsOpen = false;
		optionsOpen = false;
		playlistOpen = false;
		stopCandidatePreview({ resume: false });
		// Two voices at once is unusable, so the reader borrows the lane the
		// same way an audition or a trailer does.
		borrowSilence();
		reading = true;
		stopReading = speak(readableText, {
			voice: readingVoice,
			onDone: () => {
				reading = false;
				stopReading = null;
				returnSilence();
			}
		});
	}

	function openTrailer() {
		if (!visualTrailerUrl) return;
		interactionsOpen = false;
		optionsOpen = false;
		playlistOpen = false;
		stopCandidatePreview({ resume: false });
		borrowSilence();
		trailerOpen = true;
	}

	function closeTrailer() {
		trailerOpen = false;
		returnSilence();
	}

	// Matches the level every other sounding element in this mode honours.
	$effect(() => {
		const el = trailerEl;
		if (el) el.volume = audioSettingsStore.outputVolume;
	});

	function hideAudioCard() {
		stopCandidatePreview();
		audioCardVisible = false;
	}

	async function togglePlaylist() {
		if (playlistOpen) {
			playlistOpen = false;
			return;
		}
		interactionsOpen = false;
		optionsOpen = false;
		playlistOpen = true;
		await tick();
		playlistEl?.focus({ preventScroll: true });
	}

	function toggleOptions() {
		playlistOpen = false;
		optionsOpen = !optionsOpen;
	}

	function advanceVisual() {
		const next = draw(visualPool, 'visual', visualEntry?.id);
		if (visualEntry && next && next.id !== visualEntry.id) {
			visualHistory = [...visualHistory, visualEntry].slice(-VISUAL_HISTORY_MAX);
		}
		visualEntry = next;
	}

	/** Back to the visual before this one, skipping any since dismissed. */
	function previousVisual() {
		while (visualHistory.length > 0) {
			const previous = visualHistory[visualHistory.length - 1];
			visualHistory = visualHistory.slice(0, -1);
			if (visualPool.some((entry) => entry.id === previous.id)) {
				visualEntry = previous;
				return;
			}
		}
	}

	/** @param {PointerEvent} event */
	function handleVisualPointerDown(event) {
		swipeHandled = false;
		swipeStart = null;
		if (!event.isPrimary || isActionTarget(event.target)) return;
		if (event.clientX < SWIPE_EDGE_PX || event.clientX > window.innerWidth - SWIPE_EDGE_PX) return;
		swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
	}

	/**
	 * Swipe left for the next visual, right for the one before. Mostly
	 * horizontal only, so a sloppy vertical drag is not read as either.
	 * @param {PointerEvent} event
	 */
	function handleVisualPointerUp(event) {
		const start = swipeStart;
		swipeStart = null;
		if (!start || start.id !== event.pointerId || immersive) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
		swipeHandled = true;
		if (dx < 0) advanceVisual();
		else previousVisual();
	}

	function toggleAudio() {
		if (candidatePreviewing) stopCandidatePreview({ resume: false });
		if (queueActive) audioPlayerStore.toggle();
		else if (audioEntry) playInQueue(audioEntry);
		else continueWithNewAudio();
	}

	/** @param {import('$lib/ring.js').RingEntry} entry */
	function toggleLike(entry) {
		likeEntry(entry.id);
	}

	/**
	 * @param {import('$lib/ring.js').RingEntry} entry
	 * @param {'audio' | 'visual'} medium
	 */
	function toggleHide(entry, medium) {
		if (hideEntry(entry.id) === 'restored') return;

		// Ambient mode has no useful "quiet in place" state. Move on after a
		// dismissal, but leave the replacement audio selected and silent so the
		// visitor still decides whether it should play.
		if (medium === 'audio') {
			if (audioCandidate?.id === entry.id) advanceAudioCandidate();
			// `hideEntry` already dropped the node's tracks and moved the queue
			// on; an ending reached that way is the run-out effect's to handle.
			// With nothing left queued, offer a fresh pick in its place.
			if (!audioPlayerStore.isEmpty) return;
			dealPendingAudio();
		} else {
			advanceVisual();
		}
	}

	/** @param {EventTarget | null} target */
	function isActionTarget(target) {
		return target instanceof Element && Boolean(target.closest('button, a, input, select'));
	}

	/** @param {MouseEvent} event */
	function handleVisualTap(event) {
		if (swipeHandled) {
			swipeHandled = false;
			return;
		}
		if (isActionTarget(event.target)) return;
		if (immersive) {
			// The only way back, and the reason entering states it explicitly.
			toggleImmersive();
			return;
		}
		visualFlash += 1;
		clearTimeout(visualTapTimer);
		visualTapTimer = setTimeout(() => {
			interactionsOpen = !interactionsOpen;
		}, 220);
	}

	/** @param {MouseEvent} event */
	function handleVisualDoubleTap(event) {
		if (immersive || !visualEntry || isActionTarget(event.target)) return;
		clearTimeout(visualTapTimer);
		interactionsOpen = true;
		toggleLike(visualEntry);
	}

	/** @param {MouseEvent} event */
	function handleSoundDockTap(event) {
		if (isActionTarget(event.target)) return;
		soundFlash += 1;
	}

	/** @param {MouseEvent} event */
	function handleSoundDockDoubleTap(event) {
		if (!activeAudioEntry || isActionTarget(event.target)) return;
		toggleLike(activeAudioEntry);
	}

	async function close() {
		optionsOpen = false;
		playlistOpen = false;
		interactionsOpen = false;
		immersive = false;
		immersiveHint = false;
		nowPlayingToast = null;
		stopCandidatePreview({ resume: false });
		clearTimeout(visualTapTimer);
		clearTimeout(immersiveHintTimer);
		clearTimeout(nowPlayingTimer);
		if (document.fullscreenElement === overlayEl && document.exitFullscreen) {
			try {
				await document.exitFullscreen();
			} catch {
				// The fixed overlay is still a complete fallback if exit is refused.
			}
		}
		onClose?.();
	}

	$effect(() => {
		if (open && !sessionOpen) {
			sessionOpen = true;
			enteredFullscreen = false;
			visualHistory = [];
			interactionsOpen = false;
			audioCardVisible = true;
			immersive = false;
			nowPlayingToast = null;
			lastAnnouncedTrack = '';
			decks.reset();
			untrack(() => {
				// A queue the visitor brought in is what plays; only an empty one
				// gets a pick of ambient's own, and that stays silent until asked.
				staleAtEnd = audioPlayerStore.atEnd;
				if (audioPlayerStore.isEmpty) dealPendingAudio();
				advanceAudioCandidate();
				advanceVisual();
			});

			const originalOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			tick().then(async () => {
				if (!open || !overlayEl?.requestFullscreen) return;
				try {
					await overlayEl.requestFullscreen();
					enteredFullscreen = true;
				} catch {
					// iOS and embedded browsers commonly refuse element fullscreen;
					// the fixed, full-viewport overlay is the documented fallback.
				}
			});

			return () => {
				document.body.style.overflow = originalOverflow;
			};
		}

		if (!open && sessionOpen) {
			sessionOpen = false;
			// The queue is left exactly as it is, playing or not: it carries on
			// in the regular player.
			visualHistory = [];
			immersive = false;
			immersiveHint = false;
			trailerOpen = false;
			stopTextReading();
			nowPlayingToast = null;
			lastAnnouncedTrack = '';
			clearTimeout(immersiveHintTimer);
			clearTimeout(nowPlayingTimer);
			audioEntry = null;
			audioCandidate = null;
			audioCandidateTrack = null;
			visualEntry = null;
			optionsOpen = false;
			playlistOpen = false;
			interactionsOpen = false;
			clearTimeout(visualTapTimer);
		}
	});

	// A ring fetch may finish after the overlay opens. Fill either empty lane
	// as soon as its pool becomes available without restarting the other one.
	$effect(() => {
		const pool = audioPool;
		if (open && !queueActive && !audioEntry && pool.length > 0) untrack(() => dealPendingAudio());
	});

	$effect(() => {
		const pool = audioPool;
		if (open && !audioCandidate && pool.length > 0) untrack(() => advanceAudioCandidate());
	});

	$effect(() => {
		const pool = visualPool;
		if (open && !visualEntry && pool.length > 0) untrack(() => advanceVisual());
	});

	// The card must not go on suggesting the track that has just started
	// playing — which happens whenever a play or skip lands on it, including
	// the visitor's shuffle preference reordering a node on its way in.
	$effect(() => {
		const current = queueActive ? audioPlayerStore.current : null;
		if (!open || !current || !audioCandidateTrack) return;
		if (audioCandidate?.id === current.entryId && audioCandidateTrack.media_url === current.url) {
			untrack(() => advanceAudioCandidate());
		}
	});

	// When the queue runs out, the next node is dealt onto its end and played:
	// the regular player's Keep going, without the question, because ambient
	// is already a standing request to keep going. The run-out comes from the
	// media element's real `ended` event, never a content-rotation timer, so a
	// long track still gets its full runtime.
	$effect(() => {
		const ended = audioPlayerStore.atEnd;
		if (!ended) staleAtEnd = false;
		if (!open || !ended || staleAtEnd) return;
		untrack(() => continueWithNewAudio());
	});

	$effect(() => {
		// Reading holds the slide: advancing mid-passage would leave the voice
		// describing something no longer on screen.
		if (!open || !visualEntry || interactionsOpen || trailerOpen || reading) return;
		const timer = setTimeout(advanceVisual, preferencesStore.rotationFor(visualEntry.type));
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (
			!open ||
			!audioCardVisible ||
			!audioCandidate ||
			!audioCandidateTrack ||
			candidatePreviewing ||
			interactionsOpen
		)
			return;

		const duration = preferencesStore.rotationFor('audio');
		const startedAt = performance.now();
		candidateRotationProgress = 0;
		let frame = requestAnimationFrame(function updateProgress(now) {
			const elapsed = now - startedAt;
			candidateRotationProgress = Math.min(1, elapsed / duration);
			if (elapsed < duration) frame = requestAnimationFrame(updateProgress);
		});
		const timer = setTimeout(advanceAudioCandidate, duration);
		return () => {
			clearTimeout(timer);
			cancelAnimationFrame(frame);
		};
	});

	$effect(() => {
		if (optionsOpen || playlistOpen) interactionsOpen = false;
	});

	// A track change is the one event in this mode with nothing on screen to
	// report it: the dock may be hidden behind unobstructed mode, and even when
	// it isn't, the visitor is watching the visual rather than the transport.
	// Announced rather than merely rendered, so it reads as something that just
	// happened instead of a label that was always there.
	$effect(() => {
		const entry = activeAudioEntry;
		const label = activeAudioLabel;
		if (!open || !entry) return;

		const signature = `${entry.id}:${label}`;
		if (signature === lastAnnouncedTrack) return;
		// Deliberately not gated on "is playing": ambient deals its first track
		// paused, so requiring playback here meant the seed was never taken and
		// the *next* change — the first real one — was swallowed as if it were
		// the first track. What is suppressed is the first signature seen this
		// session, which is the track the visitor already knows about, whether
		// it is sounding yet or not.
		const first = lastAnnouncedTrack === '';
		lastAnnouncedTrack = signature;
		if (first) return;

		untrack(() => {
			nowPlayingSeq += 1;
			nowPlayingToast = {
				id: nowPlayingSeq,
				label,
				creator: entry.creator,
				cover: (queueActive ? audioPlayerStore.current?.cover : null) ?? coverImageUrl(entry)
			};
			clearTimeout(nowPlayingTimer);
			nowPlayingTimer = setTimeout(() => (nowPlayingToast = null), 4200);
		});
	});

	$effect(() => {
		if (!open) return;
		function handleFullscreenChange() {
			if (suppressFullscreenClose) return;
			// The reader takes fullscreen for itself when opened from here, which
			// is a handoff, not the visitor leaving ambient.
			if (comicViewerStore.open) return;
			if (enteredFullscreen && !document.fullscreenElement) onClose?.();
		}
		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
	});
</script>

{#if open}
	<section
		bind:this={overlayEl}
		class="ambient-view"
		aria-label="Ambient view"
		style:--ambient-mobile-meta-bottom={immersive
			? 'max(1rem, env(safe-area-inset-bottom))'
			: '6.5rem'}
		in:fade={{ duration: 180 }}
		out:flyFade={{ y: 32, duration: 280 }}
	>
		<!-- Tap shortcuts are supplemented by buttons in the revealed interaction layer. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="visual-canvas"
			onpointerdown={handleVisualPointerDown}
			onpointerup={handleVisualPointerUp}
			onpointercancel={() => (swipeStart = null)}
			ondragstart={(event) => event.preventDefault()}
			onclick={handleVisualTap}
			ondblclick={handleVisualDoubleTap}
			title="Tap for actions. Double tap to like. Swipe for the next or previous visual."
		>
			{#if visualEntry}
				<FieldNode entry={visualEntry} showCurateControls={false} showActions={false} immersive />
			{:else}
				<p class="empty-visual">No visual entries are available in your current content pool.</p>
			{/if}
			{#key visualFlash}
				{#if visualFlash > 0}
					<span class="visual-tap-flash" aria-hidden="true"></span>
				{/if}
			{/key}
		</div>

		<audio
			bind:this={candidatePreviewEl}
			class="candidate-preview-audio"
			preload="metadata"
			onended={() => stopCandidatePreview()}
			onerror={() => candidatePreviewing && stopCandidatePreview()}
		></audio>

		{#if !immersive && audioCardVisible && audioCandidate && audioCandidateTrack}
			{@const candidate = audioCandidate}
			{@const candidateTrack = audioCandidateTrack}
			<!-- Keyed so a new candidate animates in as a new card rather than
			     mutating the one on screen. -->
			{#key `${candidate.id}:${candidateTrack.media_url}`}
				<AmbientDiscoveryCard
					entry={candidate}
					track={candidateTrack}
					cover={coverImageUrl(candidate)}
					previewing={candidatePreviewing}
					progress={candidateRotationProgress}
					onPreview={previewAudioCandidate}
					onReplace={replaceAudioWithCandidate}
					onNext={advanceAudioCandidate}
					onHide={hideAudioCard}
				/>
			{/key}
		{/if}

		{#if interactionsOpen}
			<AmbientActionPanel
				audioEntry={activeAudioEntry}
				{visualEntry}
				{canRead}
				{reading}
				{visualReadable}
				{visualTrailerUrl}
				onClose={() => (interactionsOpen = false)}
				onLike={toggleLike}
				onHide={toggleHide}
				onNextAudio={skipAudio}
				onNextVisual={advanceVisual}
				onOpenViewer={openVisualViewer}
				onOpenTrailer={openTrailer}
				onToggleRead={toggleReadText}
			/>
		{/if}

		{#if optionsOpen}
			<AmbientOptionsSheet
				audioEntry={activeAudioEntry}
				{visualEntry}
				{audioCardVisible}
				{canRead}
				{reading}
				{visualReadable}
				{visualTrailerUrl}
				onClose={() => (optionsOpen = false)}
				onToggleAudioCard={() => (audioCardVisible ? hideAudioCard() : (audioCardVisible = true))}
				onNextVisual={advanceVisual}
				onOpenViewer={openVisualViewer}
				onOpenTrailer={openTrailer}
				onToggleRead={toggleReadText}
				onExit={close}
			/>
		{/if}

		{#if playlistOpen}
			<AmbientPlaylistSheet
				pendingEntry={queueActive ? null : audioEntry}
				pendingLabel={activeAudioLabel}
				bind:listEl={playlistEl}
				onPlayPending={toggleAudio}
				onClose={() => (playlistOpen = false)}
			/>
		{/if}

		{#if nowPlayingToast}
			{#key nowPlayingToast.id}
				<!-- aria-live rather than a role="alert": a track change is
				     informational, and should not interrupt a screen reader
				     mid-sentence to say so. -->
				<div
					class="now-playing-toast glass-panel"
					role="status"
					aria-live="polite"
					in:flyFade={{ y: -14, duration: 240 }}
					out:flyFade={{ y: -14, duration: 200 }}
				>
					{#if nowPlayingToast.cover}
						<img src={nowPlayingToast.cover} alt="" decoding="async" referrerpolicy="no-referrer" />
					{/if}
					<div>
						<span>Now playing</span>
						<strong>{nowPlayingToast.label}</strong>
						<span>{nowPlayingToast.creator}</span>
					</div>
				</div>
			{/key}
		{/if}

		{#if immersiveHint}
			<p class="immersive-hint" transition:fade={{ duration: 200 }}>
				Tap anywhere to show controls
			</p>
		{/if}

		{#if !immersive && canRead}
			<!-- On the main view rather than only in the tap menu: reading is the
			     primary thing to do with a text entry here, and burying the one
			     action a type actually has behind a tap makes it undiscoverable.
			     Absent entirely when the device has no on-device voice. -->
			<button
				type="button"
				class="read-control glass-panel"
				class:reading
				onclick={toggleReadText}
				aria-pressed={reading}
				aria-label={reading ? 'Stop reading this text' : 'Read this text aloud'}
				transition:flyFade={{ y: -12, duration: 200 }}
			>
				{#if reading}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h4v12H7zM13 6h4v12h-4z" /></svg>
					<span>Stop</span>
				{:else}
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M11 5L6.5 9H3v6h3.5L11 19z" stroke-linejoin="round" stroke-linecap="round" />
						<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2" stroke-linecap="round" />
					</svg>
					<span>Read aloud</span>
				{/if}
			</button>
		{/if}

		{#if trailerOpen && visualTrailerUrl && visualEntry}
			{@const trailerFor = visualEntry}
			<div class="trailer-layer" transition:fade={{ duration: 180 }}>
				<button
					type="button"
					class="trailer-backdrop"
					onclick={closeTrailer}
					aria-label="Close trailer"
				></button>
				<div class="trailer-frame glass-panel">
					{#if visualTrailerEmbedUrl}
						<iframe
							src={visualTrailerEmbedUrl}
							title={`${trailerFor.creator} game trailer`}
							allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
							allowfullscreen
							referrerpolicy="strict-origin-when-cross-origin"
						></iframe>
					{:else}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							bind:this={trailerEl}
							src={visualTrailerUrl}
							poster={coverImageUrl(trailerFor) ?? undefined}
							controls
							autoplay
							playsinline
							onended={closeTrailer}
							onerror={closeTrailer}
						></video>
					{/if}
					<div class="trailer-bar">
						<span>{trailerFor.creator}</span>
						<button type="button" onclick={closeTrailer} aria-label="Close trailer">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if !immersive}
			<div class="dock-row" transition:flyFade={{ y: 24, duration: 220 }}>
				<!-- Flash/double-tap are pointer shortcuts; playback and reactions have accessible buttons. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<section
					class="sound-dock glass-panel"
					aria-label="Ambient sound controls. Double tap the track area to like this audio."
					onclick={handleSoundDockTap}
					ondblclick={handleSoundDockDoubleTap}
				>
					{#key soundFlash}
						{#if soundFlash > 0}<span class="sound-tap-flash" aria-hidden="true"></span>{/if}
					{/key}
					{#if activeAudioEntry}
						{@const dockEntry = activeAudioEntry}
						{@const dockCover =
							(queueActive ? audioPlayerStore.current?.cover : null) ?? coverImageUrl(dockEntry)}
						{#if dockCover}
							<img src={dockCover} alt="" decoding="async" referrerpolicy="no-referrer" />
						{/if}
						<div class="sound-meta">
							<strong>{activeAudioLabel}</strong>
							<span>{dockEntry.creator}</span>
						</div>
						<button
							type="button"
							class="sound-control play-control"
							onclick={toggleAudio}
							aria-label={activeAudioPlaying ? 'Pause ambient audio' : 'Play ambient audio'}
						>
							{#if activeAudioPlaying}
								<svg
									viewBox="0 0 24 24"
									width="22"
									height="22"
									fill="currentColor"
									aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg
								>
							{:else}
								<svg
									viewBox="0 0 24 24"
									width="22"
									height="22"
									fill="currentColor"
									aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg
								>
							{/if}
						</button>
						<button
							type="button"
							class="sound-control"
							onclick={skipAudio}
							aria-label="Next audio track"
							title="Next track"
						>
							<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"
								><path d="M5 5.5l10 6.5-10 6.5zM16.5 5.5h2.5v13h-2.5z" /></svg
							>
						</button>
						<button
							type="button"
							class="sound-control"
							class:active={playlistOpen}
							onclick={togglePlaylist}
							aria-expanded={playlistOpen}
							aria-label={`Open current playlist, ${audioPlayerStore.queue.length} tracks`}
						>
							<svg
								viewBox="0 0 24 24"
								width="20"
								height="20"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<path
									d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"
									stroke-linecap="round"
								/>
							</svg>
						</button>
					{:else}
						<div class="sound-meta">
							<strong>Silent session</strong><span>No playable audio available</span>
						</div>
					{/if}
				</section>

				<!-- Mode controls, deliberately outside the sound dock rather than
			     trailing it. Sitting inside, they read as belonging to playback —
			     a row of transport controls that happens to end with two that do
			     something else entirely. The dock speaks for the audio; this
			     speaks for the view. -->
				<section class="view-dock glass-panel" aria-label="View and options">
					<button
						type="button"
						class="sound-control"
						onclick={toggleImmersive}
						aria-label="Hide controls for an unobstructed view"
						title="Unobstructed view"
					>
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path
								d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<button
						type="button"
						class="sound-control"
						class:active={optionsOpen}
						onclick={toggleOptions}
						aria-expanded={optionsOpen}
						aria-label="Ambient options"
					>
						<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true">
							<circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle
								cx="19"
								cy="12"
								r="1.7"
							/>
						</svg>
					</button>
				</section>
			</div>
		{/if}
	</section>
{/if}

<style>
	.ambient-view {
		position: fixed;
		inset: 0;
		z-index: 200;
		overflow: hidden;
		background: var(--bg);
	}

	.visual-canvas {
		position: absolute;
		inset: 0;
		/* pan-y rather than manipulation: a horizontal swipe has to reach the
		   pointer handlers instead of being claimed as a browser pan. Still
		   rules out double-tap zoom, which double-tap-to-like depends on. */
		touch-action: pan-y;
	}

	.visual-tap-flash {
		position: absolute;
		inset: 0;
		z-index: 3;
		background: radial-gradient(circle at center, rgb(255 255 255 / 0.2), transparent 52%);
		pointer-events: none;
		animation: visual-light-flash 360ms ease-out both;
	}

	@keyframes visual-light-flash {
		0% {
			opacity: 0;
		}
		35% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	.candidate-preview-audio {
		display: none;
	}

	.empty-visual {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 2rem;
		color: var(--text-muted);
		text-align: center;
		background:
			radial-gradient(
				circle at 50% 40%,
				color-mix(in oklch, var(--type-comic) 24%, transparent),
				transparent 45%
			),
			var(--bg);
	}

	/* Top-centre, where the now-playing toast also appears — they never
	   coexist, since reading borrows the audio lane that would be announcing. */
	.read-control {
		position: absolute;
		top: max(1rem, env(safe-area-inset-top));
		left: 50%;
		z-index: 6;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1.1rem;
		transform: translateX(-50%);
		border-radius: 999px;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.read-control.reading {
		color: var(--accent);
	}

	.read-control svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
	}

	.read-control.reading svg {
		fill: currentColor;
		stroke: none;
	}

	.trailer-layer {
		position: absolute;
		inset: 0;
		z-index: 8;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.trailer-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: color-mix(in oklch, #000 72%, transparent);
		cursor: pointer;
	}

	.trailer-frame {
		position: relative;
		display: flex;
		width: min(64rem, 100%);
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem;
		border-radius: 1rem;
	}

	.trailer-frame video,
	.trailer-frame iframe {
		width: 100%;
		max-height: min(70vh, 40rem);
		border-radius: 0.7rem;
		background: #000;
		border: 0;
	}

	.trailer-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 0.3rem 0.2rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.trailer-bar button {
		display: inline-flex;
		width: 2.2rem;
		height: 2.2rem;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 999px;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.trailer-bar button:hover {
		color: var(--text);
	}

	.trailer-bar svg {
		width: 1.1rem;
		height: 1.1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	/* The two docks are laid out together so the view controls sit *beside*
	   the player rather than trailing its transport. The row owns the
	   positioning that used to be on .sound-dock. */
	.dock-row {
		position: absolute;
		left: 50%;
		bottom: max(0.75rem, env(safe-area-inset-bottom));
		z-index: 4;
		display: flex;
		align-items: stretch;
		gap: 0.55rem;
		width: min(46rem, calc(100% - 1.5rem));
		/* Keep centering independent of flyFade's animated transform. */
		translate: -50% 0;
	}

	.sound-dock {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		min-height: 4.4rem;
		padding: 0.55rem;
		border-radius: 1.2rem;
		overflow: hidden;
		position: relative;
		touch-action: manipulation;
	}

	/* Auto width: it holds exactly its two controls and never competes with
	   the player for horizontal space. */
	.view-dock {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem;
		border-radius: 1.2rem;
	}

	.sound-dock > :not(.sound-tap-flash) {
		position: relative;
		z-index: 1;
	}

	.sound-tap-flash {
		position: absolute;
		inset: 0;
		z-index: 0;
		border-radius: inherit;
		background: white;
		pointer-events: none;
		animation: sound-dock-flash 260ms ease-out both;
	}

	@keyframes sound-dock-flash {
		0% {
			opacity: 0;
		}
		35% {
			opacity: 0.18;
		}
		100% {
			opacity: 0;
		}
	}

	.sound-dock img {
		width: 3.15rem;
		height: 3.15rem;
		flex: 0 0 auto;
		border-radius: 0.8rem;
		object-fit: cover;
	}

	.sound-meta {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.sound-meta strong,
	.sound-meta span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sound-meta strong {
		font-size: var(--text-sm);
	}

	.sound-meta span {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.sound-control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.65rem;
		height: 2.65rem;
		flex: 0 0 auto;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	.sound-control:hover,
	.sound-control.active {
		background: var(--glass-bg);
		color: var(--accent);
	}

	.sound-control.play-control {
		background: var(--accent);
		color: white;
	}

	/* Anchored top-centre, clear of the discovery card (bottom right) and the
	   dock (bottom): the one place nothing else in this mode occupies. */
	.now-playing-toast {
		position: absolute;
		top: max(1rem, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		max-width: min(26rem, calc(100% - 2rem));
		padding: 0.7rem 1.1rem 0.7rem 0.7rem;
		border-radius: 999px;
		pointer-events: none;
	}

	.now-playing-toast img {
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.now-playing-toast div {
		display: flex;
		min-width: 0;
		flex-direction: column;
		line-height: 1.25;
	}

	.now-playing-toast span:first-child {
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.now-playing-toast strong,
	.now-playing-toast span:last-child {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.now-playing-toast strong {
		font-size: var(--text-sm);
	}

	.now-playing-toast span:last-child {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	/* Centred over the visual rather than beside a control, because in
	   unobstructed mode there is no control left for it to sit beside. */
	.immersive-hint {
		position: absolute;
		bottom: max(2.5rem, env(safe-area-inset-bottom));
		left: 50%;
		z-index: 6;
		margin: 0;
		padding: 0.55rem 1.2rem;
		transform: translateX(-50%);
		border-radius: 999px;
		background: color-mix(in oklch, var(--bg) 62%, transparent);
		color: var(--text-muted);
		font-size: var(--text-xs);
		line-height: 1.25;
		text-align: center;
		pointer-events: none;
	}

	@media (max-width: 30rem) {
		.now-playing-toast {
			gap: 0.6rem;
			max-width: calc(100% - 1.25rem);
			padding: 0.55rem 0.85rem 0.55rem 0.55rem;
		}

		.now-playing-toast img {
			width: 2.25rem;
			height: 2.25rem;
		}

		.now-playing-toast div {
			line-height: 1.15;
		}

		.now-playing-toast span:first-child,
		.now-playing-toast span:last-child {
			font-size: 0.68rem;
		}

		.now-playing-toast strong {
			font-size: 0.8rem;
		}

		.immersive-hint {
			max-width: calc(100% - 2rem);
			padding: 0.5rem 0.9rem;
			font-size: 0.72rem;
		}

		.dock-row {
			gap: 0.35rem;
		}

		.sound-dock,
		.view-dock {
			gap: 0.35rem;
			padding: 0.45rem;
		}

		.sound-dock {
			min-height: 4rem;
		}

		.sound-dock img {
			width: 2.8rem;
			height: 2.8rem;
		}

		.sound-control {
			width: 2.4rem;
			height: 2.4rem;
		}
	}
</style>
