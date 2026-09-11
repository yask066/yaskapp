# Figma Docs–Inspired Web Client Redesign

## Goal

Redesign the existing Yask web client with a restrained documentation-style
visual system inspired by the supplied Figma rate-limits reference. Preserve
the current product behaviour, routes, API contracts, accessibility semantics,
and the existing `yaskapp_logo.png` asset. Replace every other part of the
current visual language.

## Scope

The change is limited to `apps/web`. It covers the shared application shell,
feed, poll cards, poll details and comments, search, public and private
profiles, poll creation, authentication, and shared loading, empty, and error
states.

The redesign does not change the API service, database, moderation client,
authentication rules, polling behaviour, or product copy except where a short
label must be clarified for the new navigation or form hierarchy. Existing
branding icons are not reused. Interface icons should come from the existing
code-native `MaterialIcon` component or from CSS where no semantic icon is
needed. The logo at `apps/web/public/branding/yaskapp_logo.png` is the only
visual asset retained from the current design.

## Visual Direction

The interface uses an editorial, documentation-inspired visual language:

- a warm white page canvas and white content surfaces;
- near-black primary text, neutral gray secondary text, and hairline borders;
- one restrained blue accent for links, selected states, progress, and primary
  actions;
- compact radii and either no shadow or a very soft shadow used only where
  layers overlap;
- clear typographic hierarchy, generous whitespace, and dense but readable
  metadata;
- flat controls and cards instead of gradients, oversized pills, decorative
  illustrations, or blue-tinted panels.

The design should feel like the Figma documentation system adapted to a social
polling product, not like a literal documentation page. Poll content remains
the visual focus.

## Application Shell

Authenticated desktop pages use a three-part shell:

1. A compact sticky header contains the existing Yask logo, global search,
   create-poll action, notifications, and the current account control.
2. A sticky left rail contains the primary navigation, a quiet secondary
   information group, and a compact footer.
3. The main content column uses a readable maximum width. The feed may add a
   narrow contextual right rail for trends and suggested accounts, styled as
   border-separated sections rather than floating promotional cards.

Anonymous desktop pages keep the same header language with login and register
actions. Authentication pages use a focused single-card composition with the
logo and no authenticated navigation.

Below the desktop breakpoint the left rail collapses into a compact horizontal
navigation row. The header search becomes a full-width secondary row when
necessary. All pages remain usable without horizontal scrolling at 320px.

## Page and Component Design

### Feed and poll cards

The feed begins with a plain page title and a segmented text-tab row for sort
modes. The quick composer becomes a concise bordered row. Polls are separated
by white space and thin rules; each card uses a subtle border and compact
radius. Author metadata, question, optional media, options, and actions form a
clear top-to-bottom reading order.

Poll options use bordered rows. Before voting, native radio semantics remain
visible and each option retains its explicit vote action. After voting, the
same rows display percentages with a quiet blue progress fill. Like, comment,
cancel-vote, and delete controls retain their current availability and event
handling.

### Search

Search uses one prominent input followed by a restrained result-type switch.
Poll and user results share the new border, spacing, typography, and state
styles. Query-string behaviour and data fetching remain unchanged.

### Profiles

Public and private profiles use a structured header with avatar, name,
username, biography, country, counts, and follow controls. Authored polls or
profile editing appear below as separate rule-delimited sections. Avatar
upload and deletion keep their current validation and mutation behaviour.

### Poll creation

Poll creation becomes a focused form with a clear question section, numbered
option rows, secondary add/remove controls, compact settings, image upload,
validation feedback, and one primary submit action. Existing option limits and
validation rules are preserved.

### Poll details and comments

The poll detail page reuses the redesigned poll card. The comments area is a
separate section with a clear heading, compact composer, nested comment rhythm,
and consistent destructive and secondary actions. Existing comment mutations
and authentication gates remain unchanged.

### Authentication and system states

Login and registration share a centered, narrow form with the retained logo,
plain inputs, one primary button, and a text link to the alternate mode.
Loading, empty, error, and mutation states use the same neutral panels and
visible status language across all pages.

## Component Boundaries

`AppLayout` continues to own only the global shell, session-aware navigation,
and account actions. Feature pages keep ownership of their current queries,
mutations, and page-specific state. `PollCard`, `Avatar`, `MaterialIcon`, and
`AsyncState` remain shared components.

The redesign may add small presentational components when markup is repeated,
but it must not move network logic into layout or visual components. The global
stylesheet defines tokens and shared primitives; feature-specific class hooks
remain close to the current component structure.

## Interaction, Accessibility, and Error Handling

Existing semantic links, buttons, fieldsets, labels, status regions, and route
guards are preserved. The skip link remains available. Keyboard focus uses a
high-contrast blue outline, active navigation is represented both visually and
semantically, controls meet a minimum comfortable touch size, and muted text
maintains readable contrast.

Loading, error, empty, disabled, and pending states stay visible. The redesign
must not hide disabled explanations already exposed by poll interactions.
Reduced-motion preferences disable nonessential transitions.

## Verification

Update component tests where the new semantic shell or page structure changes
queries. Preserve behavioural tests for authentication, navigation, polling,
search, comments, profiles, and creation. Before handoff, run the web test
suite, typecheck, lint, production build, and `git diff --check`. Visually
inspect the meaningful desktop and mobile layouts before declaring the redesign
complete.
