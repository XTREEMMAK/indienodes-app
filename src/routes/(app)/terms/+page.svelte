<script>
	import GlassPanel from '../../../components/GlassPanel.svelte';
	import EulaContent from '../../../components/legal/EulaContent.svelte';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Terms of Use and Privacy Notice, IndieNodes</title>
	<meta name="description" content="The Terms of Use and Privacy Notice for IndieNodes." />
</svelte:head>

<div class="legal-page">
	<GlassPanel class="legal-panel">
		<EulaContent html={page.data.termsHtml} standalone />
	</GlassPanel>
</div>

<style>
	.legal-page {
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem 2rem 4rem;
	}

	:global(.legal-panel) {
		padding: clamp(1.25rem, 3vw, 2.5rem);
	}

	@media (max-width: 640px) {
		.legal-page {
			padding-inline: 1rem;
		}
	}
</style>
