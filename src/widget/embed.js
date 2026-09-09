// Entry point for the standalone widget bundle. Importing a
// customElement-compiled Svelte component registers it as a side effect, so
// this file's only job is that one import. A site embeds the widget with:
//
//   <script type="module" src="https://app.indienodes.us/embed.v1.js"></script>
//   <indienode-widget></indienode-widget>
import './Widget.svelte';
