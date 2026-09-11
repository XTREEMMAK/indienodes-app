# IndieNodes is a static SvelteKit site (adapter-static): the build produces
# plain HTML, CSS, and JS with no server process behind it, so this image is
# a build stage plus a static file server, nothing more. That is a real
# difference from a typical SvelteKit container, not an oversight worth
# "fixing" later: there is no Node process, no PM2, no database, and no
# adapter-node in this project at all (see docs/roadmap.md's Production
# packaging section). GGRequestz's Dockerfile was used as a structural
# reference for the parts that DO transfer (multi-stage layout, non-root
# PUID/PGID) — its process manager, database migrations, and entrypoint
# script are adapter-node concerns this project does not have.

# --platform=$BUILDPLATFORM pins this stage to the machine actually running
# the build, never the target platform buildx was asked for. The build
# produces a static site (adapter-static): its output is plain HTML/CSS/JS,
# identical regardless of which CPU compiled it, so cross-building it for
# arm64 buys nothing and forces npm/vite/Tailwind's native addons (Rolldown,
# @tailwindcss/oxide, lightningcss -- all multi-threaded Rust) through QEMU's
# user-mode emulation, which is documented to crash that kind of code
# intermittently with SIGILL (exit 132) rather than reliably either way. Only
# the tiny runtime stage below now varies per target platform, and it does no
# compute of its own -- just copying the (architecture-agnostic) build output
# into the right caddy:2-alpine base image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

# Every VITE_ var is compiled into the client bundle at build time, not read
# at runtime: adapter-static means there is nothing running later that could
# read an environment variable (see src/lib/config.js, .env.example).
# `docker run -e` on the final image does nothing; changing any value means
# rebuilding the image with a different --build-arg.
#
# This is the complete build-time surface for a production image -- every
# VITE_ var the app reads, VITE_RING_URL now included. It was excluded here
# for most of this project's life as a dev-only switch for pointing
# `npm run dev:fixture` at the 50-entry fixture, on the reasoning that it had
# no legitimate production value. That stopped being true once the ring became
# something a deployment can read from somewhere other than its own origin: a
# packaged client and a Docker deployment may each need to name the canonical
# endpoint. Unset still means `/ring.json` on this origin, so every existing
# build is byte-identical. Whether any of the rest below are actually set is an
# infra decision this image takes no position on: SITE_ORIGIN defaults to the
# project's own site as a starting point for a bare `docker build .` with no
# args -- not this repo's opinion of the "real" value, and any build that
# cares what origin ships should pass its own --build-arg rather than rely on
# it -- and the rest default to unset, which is itself a valid, documented
# choice (mocks in dev, "closed"/no-widget/no-tab/not-in-Early-Access in a
# production build) rather than an oversight to fix later.
#
# That SITE_ORIGIN default is `app.indienodes.us`, matching what
# docker-publish.yml falls back to. It used to read `indienodes.us`, the apex,
# which is not where this app is served from -- a bare `docker build .` baked
# in an origin that does not answer, and SITE_ORIGIN is the one value a wrong
# setting breaks silently across origins: the widget is embedded on third-party
# sites and cannot use a relative path, so it fetches whatever this says.
# Docker's own build linter flags VITE_TURNSTILE_SITE_KEY below as
# "sensitive data in ARG/ENV" -- a false positive worth leaving documented
# rather than silenced. Turnstile's *site* key is designed to be public and
# embedded in every page that renders the widget; the matching *secret* key
# (the one that would actually be sensitive) never appears in this repo at
# all, by design -- see the .env.example entry this ARG mirrors.
ARG VITE_SITE_ORIGIN=https://app.indienodes.us
ARG VITE_SUBMISSION_WEBHOOK_URL=
ARG VITE_CONTACT_WEBHOOK_URL=
ARG VITE_RATING_WEBHOOK_URL=
ARG VITE_TURNSTILE_SITE_KEY=
ARG VITE_KOFI_URL=
ARG VITE_RING_REPO_URL=
ARG VITE_RING_URL=
ARG VITE_EARLY_ACCESS=
ENV VITE_SITE_ORIGIN=$VITE_SITE_ORIGIN
ENV VITE_SUBMISSION_WEBHOOK_URL=$VITE_SUBMISSION_WEBHOOK_URL
ENV VITE_CONTACT_WEBHOOK_URL=$VITE_CONTACT_WEBHOOK_URL
ENV VITE_RATING_WEBHOOK_URL=$VITE_RATING_WEBHOOK_URL
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
ENV VITE_KOFI_URL=$VITE_KOFI_URL
ENV VITE_RING_REPO_URL=$VITE_RING_REPO_URL
ENV VITE_RING_URL=$VITE_RING_URL
ENV VITE_EARLY_ACCESS=$VITE_EARLY_ACCESS

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Chains build:widget first (see package.json); adapter-static then picks up
# the generated static/embed.js and static/embed.v1.js as ordinary static
# assets, which is why this is one RUN rather than two separate build steps.
COPY docs/legal/EULA.md docs/legal/EULA.md
COPY docs/legal/TERMS-AND-PRIVACY.md docs/legal/TERMS-AND-PRIVACY.md
RUN npm run build

# ---------------------------------------------------------------- runtime --
FROM caddy:2-alpine AS runtime

ARG PUID=1000
ARG PGID=1000

# Temporary pre-launch access gate. Both unset (the default) means gate.caddy
# is never written, the Caddyfile's glob import matches nothing, and the image
# ships with no auth and no maintenance page -- nothing to find and nothing to
# turn back on. Both set means every route except the widget surface a member's
# site loads cross-origin sits behind HTTP basic auth. See gate/gate.caddy for
# the path list and the reasoning, and docs/decisions.md for why this is
# enforced here rather than as a PIN screen inside the app.
#
# GATE_PASSWORD_HASH is a bcrypt hash, never a plaintext password:
#   caddy hash-password --algorithm bcrypt
# Single-quote it on the command line so the shell does not eat the `$`
# separators:
#   docker build --build-arg GATE_USER=preview \
#                --build-arg GATE_PASSWORD_HASH='$2a$14$...' .
#
# Build-arg values are recorded in image metadata and readable by anyone who
# can `docker history` the image. A cost-14 bcrypt hash is an acceptable thing
# to leak there for a temporary gate; a plaintext password would not be, which
# is the other reason this takes a hash. Use a BuildKit secret
# (RUN --mount=type=secret) if even the hash must stay out of that metadata.
ARG GATE_USER=
ARG GATE_PASSWORD_HASH=

# Reuse the group/user if the chosen id already exists in the base image,
# rather than failing on a collision — same guard GGRequestz's Dockerfile
# uses for the same reason.
RUN (getent group ${PGID} || addgroup -g ${PGID} -S indienodes) && \
	(getent passwd ${PUID} || adduser -S -u ${PUID} -G indienodes indienodes)

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build --chown=${PUID}:${PGID} /app/build /srv

# Installs the gate only when both args are set, and must run before USER
# below, which drops the ability to write /etc/caddy at all.
#
# gate/ arrives as a bind mount rather than a COPY so it exists only for the
# duration of this RUN. A COPY would bake the template into an image layer even
# in an ungated build, where `rm -rf` in a later step hides it from the final
# filesystem but leaves it recoverable from layer history -- harmless in itself
# (the template holds placeholders, not the credential) but exactly the kind of
# leftover this gate is meant not to have. Needs BuildKit, which this Dockerfile
# already requires for --platform=$BUILDPLATFORM above.
#
# Both vars are referenced as "$VAR", so the shell substitutes the ARG's value
# and does not re-expand the `$` separators inside the bcrypt hash. sed treats
# `&` and `\` specially in replacement text and `|` is the delimiter here --
# none of the three occur in bcrypt's [./A-Za-z0-9$] alphabet, so no escaping
# is needed.
#
# `caddy adapt` (not `validate`, which also provisions modules and would want
# to bind ports) runs in BOTH branches, so a malformed gate file fails the
# BUILD rather than the container on first start, and the ungated path is
# checked for the same class of mistake.
RUN --mount=type=bind,source=gate,target=/tmp/gate \
	if [ -n "${GATE_USER}" ] && [ -n "${GATE_PASSWORD_HASH}" ]; then \
		mkdir -p /etc/caddy/conf.d && \
		sed -e "s|__GATE_USER__|${GATE_USER}|" \
			-e "s|__GATE_PASSWORD_HASH__|${GATE_PASSWORD_HASH}|" \
			/tmp/gate/gate.caddy > /etc/caddy/conf.d/gate.caddy && \
		cp /tmp/gate/maintenance.html /srv/maintenance.html; \
	fi; \
	caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null

# /config/caddy and /data/caddy (Caddy's own state/storage dirs) ship
# world-writable in the base image already, so no chown is needed there for
# a non-root USER to start cleanly.
USER ${PUID}:${PGID}

# Not 80: binding a privileged port needs root or a capability this
# container deliberately does not have. See the Caddyfile.
EXPOSE 8080

# wget, not curl: curl is not in caddy:2-alpine's base image and this stays
# a one-line check rather than adding a package for it.
#
# /ring.json rather than /: under the pre-launch gate (see gate/gate.caddy) `/`
# answers 401, and BusyBox wget exits non-zero on any HTTP error status, which
# would mark every gated container permanently unhealthy and drive restart
# loops. /ring.json is on the gate's always-public list because member sites
# fetch it cross-origin, so this one probe is correct in gated and ungated
# images alike -- which is why it is a plain path change and not a conditional.
# Credentials deliberately do not appear here.
#
# -O /dev/null rather than -O- so the file's contents do not land in the
# healthcheck output on every run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -qO /dev/null http://127.0.0.1:8080/ring.json || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
