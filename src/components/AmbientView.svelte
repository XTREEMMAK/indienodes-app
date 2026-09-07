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
	let audioEntry = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let audioCandidate = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let audioCandidateTrack = $state(
		/** @type {{ label: string, media_url: string } | null} */ (null)
	);
	let visualEntry = $state(/** @type {import('$lib/ring.js').RingEntry | null} */ (null));
	let sessionOpen = false;
	let enteredFullscreen = false;
	let ownedPreviewEntryId = '';
	let optionsOpen = $state(false);
	let interactionsOpen = $state(false);
	// True when the visitor already had a queue going and ambient adopted it
	// rather than dealing its own audio. Entering used to preview something
	// random over the top of whatever was playing, which ducked their music to
	// silence and made this read as a separate player that had thrown away the
	// queue they built. A queue is an explicit choice; ambient rotating the
	// *visuals* around it is the feature, so the audio it finds playing is left
	// alone and this dock drives it directly.
	let adoptedQueue = $state(false);
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
	 * Which lane a temporary sound silenced, so the right one resumes after.
	 * Null whenever nothing is borrowed. Shared by every interruption in this
	 * mode — the discovery audition, a game trailer, and the text reader —
	 * because "one thing sounds at a time" is a property of the mode, not of
	 * whichever feature happens to be interrupting.
	 */
	let borrowedLane = /** @type {'queue' | 'preview' | null} */ (null);
	let soundFlash = $state(0);
	let visualFlash = $state(0);
	let visualTapTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
	let handledPreviewCompletion = 0;
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

	// In adopted mode the dock is a view onto the real queue, so the entry it
	// describes has to be resolved back from the queue item rather than dealt
	// here. Queue items carry only `entryId`, which is the id this looks up.
	const queueEntry = $derived(
		adoptedQueue
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

	/** Whichever audio this dock is currently speaking for, dealt or adopted. */
	const activeAudioEntry = $derived(queueEntry ?? audioEntry);
	const activeAudioPlaying = $derived(
		adoptedQueue ? audioPlayerStore.playing : audioPlayerStore.previewPlaying
	);
	const activeAudioLabel = $derived(
		adoptedQueue
			? (audioPlayerStore.current?.label ?? 'Audio')
			: (audioPlayerStore.previewItem?.label ?? activeAudioEntry?.tracks?.[0]?.label ?? 'Audio')
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

	/** @param {{ autoplay?: boolean }} [options] */
	function advanceAudio({ autoplay = false } = {}) {
		const next = draw(audioPool, 'audio', audioEntry?.id);
		audioEntry = next;
		if (!next) return;
		// Ambient is sounding its own pick now, so it stops speaking for the
		// queue. The queue is only ducked underneath, never cleared, and comes
		// back when this mode closes.
		adoptedQueue = false;
		ownedPreviewEntryId = next.id;
		audioPlayerStore.previewEntry(next, coverImageUrl(next), { autoplay });
		if (audioCandidate?.id === next.id) advanceAudioCandidate();
	}

	function advanceAudioCandidate() {
		stopCandidatePreview();
		const alternatives = audioPool.filter((entry) => entry.id !== activeAudioEntry?.id);
		const nextEntry = draw(alternatives, 'candidate', audioCandidate?.id) ?? activeAudioEntry;
		const currentPreview = audioPlayerStore.previewItem;
		const currentUrl = nextEntry?.id === currentPreview?.entryId ? (currentPreview?.url ?? '') : '';
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
	 * Silences whichever audio lane is currently sounding, remembering which so
	 * `returnSilence` can put exactly that one back. Safe to call when nothing
	 * is playing, and safe to call twice: a second borrow does not overwrite
	 * the first lane's claim with "nothing".
	 */
	function borrowSilence() {
		if (borrowedLane) return;
		if (adoptedQueue && audioPlayerStore.playing) {
			borrowedLane = 'queue';
			audioPlayerStore.toggle();
		} else if (audioPlayerStore.previewPlaying) {
			borrowedLane = 'preview';
			audioPlayerStore.togglePreview();
		}
	}

	/**
	 * Resumes the lane `borrowSilence` paused, if it is still the lane it was.
	 * The preview check matters: ambient may have moved on to a different
	 * track while the borrowed sound was playing, and resuming then would be
	 * restarting something the visitor already left behind.
	 */
	function returnSilence() {
		if (borrowedLane === 'queue') {
			if (!audioPlayerStore.playing) audioPlayerStore.toggle();
		} else if (
			borrowedLane === 'preview' &&
			audioPlayerStore.previewItem?.entryId === ownedPreviewEntryId &&
			!audioPlayerStore.previewPlaying
		) {
			audioPlayerStore.togglePreview();
		}
		borrowedLane = null;
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
		else borrowedLane = null;
	}

	// The discovery card's one-off preview is a third sounding element beside
	// the player's main and preview lanes, so it has to honour the same output
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
		const trackIndex =
			replacement.tracks?.findIndex(
				(track) => track.media_url === audioCandidateTrack?.media_url
			) ?? -1;
		stopCandidatePreview({ resume: false });
		audioEntry = replacement;
		// Same as advanceAudio: an explicit "play this instead" hands the sound
		// to ambient, ducking the adopted queue rather than discarding it.
		adoptedQueue = false;
		ownedPreviewEntryId = replacement.id;
		audioPlayerStore.previewEntry(replacement, coverImageUrl(replacement), {
			autoplay: true,
			trackIndex: trackIndex >= 0 ? trackIndex : 0
		});
		advanceAudioCandidate();
	}

	function toggleImmersive() {
		immersive = !immersive;
		optionsOpen = false;
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
		const resolve = () => (readingVoice = pickVoice(document.documentElement.lang || 'en'));
		resolve();
		window.speechSynthesis.addEventListener('voiceschanged', resolve);
		return () => window.speechSynthesis.removeEventListener('voiceschanged', resolve);
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

	async function openPlaylist() {
		interactionsOpen = false;
		optionsOpen = true;
		await tick();
		playlistEl?.scrollIntoView({ block: 'nearest' });
		playlistEl?.focus({ preventScroll: true });
	}

	function advanceVisual() {
		visualEntry = draw(visualPool, 'visual', visualEntry?.id);
	}

	function toggleAudio() {
		if (candidatePreviewing) stopCandidatePreview({ resume: false });
		if (adoptedQueue) {
			audioPlayerStore.toggle();
		} else if (audioPlayerStore.previewItem?.entryId === ownedPreviewEntryId) {
			audioPlayerStore.togglePreview();
		} else {
			advanceAudio({ autoplay: true });
		}
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
			if (audioPlayerStore.previewItem?.entryId === entry.id) audioPlayerStore.stopPreview();
			advanceAudio();
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
			interactionsOpen = false;
			audioCardVisible = true;
			immersive = false;
			nowPlayingToast = null;
			lastAnnouncedTrack = '';
			handledPreviewCompletion = audioPlayerStore.previewCompletion.sequence;
			decks.reset();
			untrack(() => {
				// Adopt whatever was already playing instead of dealing over it.
				adoptedQueue = !audioPlayerStore.isEmpty;
				if (!adoptedQueue) advanceAudio();
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
			if (audioPlayerStore.previewItem?.entryId === ownedPreviewEntryId) {
				audioPlayerStore.stopPreview();
			}
			ownedPreviewEntryId = '';
			adoptedQueue = false;
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
			interactionsOpen = false;
			clearTimeout(visualTapTimer);
		}
	});

	// A ring fetch may finish after the overlay opens. Fill either empty lane
	// as soon as its pool becomes available without restarting the other one.
	$effect(() => {
		const pool = audioPool;
		if (open && !adoptedQueue && !audioEntry && pool.length > 0) untrack(() => advanceAudio());
	});

	$effect(() => {
		const pool = audioPool;
		if (open && !audioCandidate && pool.length > 0) untrack(() => advanceAudioCandidate());
	});

	$effect(() => {
		const pool = visualPool;
		if (open && !visualEntry && pool.length > 0) untrack(() => advanceVisual());
	});

	// Audio advances from the media element's real `ended` event, never from a
	// content-rotation timer. A long track therefore gets its full runtime.
	$effect(() => {
		const completion = audioPlayerStore.previewCompletion;
		if (!open || completion.sequence <= handledPreviewCompletion) return;
		handledPreviewCompletion = completion.sequence;
		if (completion.entryId === ownedPreviewEntryId) {
			untrack(() => advanceAudio({ autoplay: true }));
		}
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
		if (optionsOpen) interactionsOpen = false;
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
				cover: (adoptedQueue ? audioPlayerStore.current?.cover : null) ?? coverImageUrl(entry)
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
		in:fade={{ duration: 180 }}
		out:flyFade={{ y: 32, duration: 280 }}
	>
		<!-- Tap shortcuts are supplemented by buttons in the revealed interaction layer. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="visual-canvas"
			onclick={handleVisualTap}
			ondblclick={handleVisualDoubleTap}
			title="Tap for actions. Double tap to like."
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
				bind:playlistEl
				onClose={() => (optionsOpen = false)}
				onToggleAudioCard={() => (audioCardVisible ? hideAudioCard() : (audioCardVisible = true))}
				onNextVisual={advanceVisual}
				onOpenViewer={openVisualViewer}
				onOpenTrailer={openTrailer}
				onToggleRead={toggleReadText}
				onToggleImmersive={toggleImmersive}
				onExit={close}
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
							(adoptedQueue ? audioPlayerStore.current?.cover : null) ?? coverImageUrl(dockEntry)}
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
							onclick={openPlaylist}
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
						onclick={() => (optionsOpen = !optionsOpen)}
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
		touch-action: manipulation;
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
		pointer-events: none;
	}

	@media (max-width: 30rem) {
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
