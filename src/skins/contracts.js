/**
 * Public contract for trusted, build-time skin packages.
 *
 * Skins receive data and host services through props. They must not import
 * application stores directly. This keeps playback, navigation, persistence,
 * accessibility, and sound permission under application control.
 */

export const SKIN_CATEGORIES = /** @type {const} */ (['ui', 'node']);
export const NODE_TYPES = /** @type {const} */ (['audio', 'comic', 'text', 'game', 'art', 'craft']);

/**
 * @typedef {object} NodeSkinServices
 * @property {(url: string) => void} preloadImage
 * @property {(url: string, options?: { volume?: number }) => Promise<boolean>} playSound
 * @property {() => void} play Request the host's normal play or preview action.
 * @property {() => void} read Request the host's comic reader action.
 * @property {() => void} visit Record a creator-site visit.
 */

/**
 * Props supplied to every node stage. Individual stages may use only the
 * fields relevant to their type.
 * @typedef {object} NodeSkinStageProps
 * @property {import('../lib/ring.js').RingEntry} entry
 * @property {string | null} cover
 * @property {boolean} hasImage
 * @property {boolean} paused
 * @property {boolean} motionReduced
 * @property {NodeSkinServices} services
 * @property {() => void} onImageError
 * @property {(open: boolean) => void} onTrailerChange Notify the host when an audible trailer opens or closes.
 * @property {(index: number) => void} onExcerptChange Notify the host which text sample is currently showing.
 * @property {(reading: boolean) => void} onReadingChange Notify the host that a stage has moved from presenting its cover to presenting the work itself, so host-owned chrome can step out of the way.
 * @property {(progress: number | null) => void} onStageProgressChange Notify the host about an internal content countdown when the stage rotates work within one entry.
 */

/**
 * @typedef {object} NodeSkinManifest
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {'node'} category
 * @property {readonly ('audio' | 'comic' | 'text' | 'game' | 'art' | 'craft')[]} types
 * @property {() => Promise<NodeSkinModule>} [load] Omitted by the synchronous default skin.
 */

/**
 * @typedef {object} NodeSkinModule
 * @property {Record<string, import('svelte').Component<NodeSkinStageProps>>} stages
 */

/**
 * @typedef {object} UiSkinManifest
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {'ui'} category
 * @property {() => Promise<unknown>} load
 */
