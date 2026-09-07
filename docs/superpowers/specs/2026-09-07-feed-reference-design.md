# Feed Reference Design

## Goal

Restyle the existing public web client feed so its desktop layout and visual
hierarchy closely follow the supplied Yask reference while preserving the
current React routes, API contracts, accessibility, and interactive polling
behaviour.

## Scope

The implementation changes only the public web client under `apps/web`. It
does not add or alter API endpoints, authentication, database data, or the
moderation client.

The desktop feed uses a sticky top bar and a three-column shell:

- the left rail holds Feed, Explore, Notifications, and Profile navigation;
- the centre column provides the page heading, newest/popular tabs, and poll
  cards;
- the right rail provides static discovery/trend content styled as reference
  cards.

The header contains the Yask brand, a direct link to search, a prominent
create-poll control, and the authenticated account area. Anonymous visitors
continue to see login and registration controls.

## Component boundaries

`AppLayout` owns only global shell markup, navigation and session-aware
account controls. `FeedPage` owns sorting, feed queries, loading/error/empty
states, and the desktop rail content. `PollCard` remains the reusable data
driven poll interaction component; its markup gains class hooks and semantic
controls required for the card visual treatment.

The stylesheet defines the application tokens, responsive shell grid,
navigation, feed controls, cards, results, and action controls. It must not
depend on the example poll text or a particular author.

## Visual direction

Use a near-white blue-tinted page background; white, generously rounded
surfaces; deep navy text; restrained slate metadata; saturated blue for
primary actions and selected results; and gentle blue border/shadow accents.
Use system fonts already available in the application. Icons can use
accessible Unicode or CSS-free textual labels; no icon package is added.

Poll options display their current vote count and percentage with a visible
progress track after voting. Before voting, selectable options retain native
radio semantics and their explicit vote buttons. Like, comments, deletion and
cancel-vote operations keep their existing behaviours and availability.

## Responsive behaviour

At widths below the desktop breakpoint, hide both supplementary rails and
show a compact single-column feed. The header wraps or selectively hides
non-essential text without horizontal scrolling. Poll cards remain readable
from 320px wide and all interactive controls remain keyboard reachable.

## Accessibility and error handling

Keep the existing skip link, aria labels, radio fieldset and mutation states.
Every new visual control is a real link or button with an accessible label.
Selected sort tabs retain `aria-pressed`; focus rings meet the existing
visible-focus policy. Existing loading, error, empty and mutation feedback
remain visible in the central column.

## Verification

Add or update component tests for the new semantic shell/navigation and feed
rail visibility hooks, while preserving existing feed and poll interaction
tests. Run the web test suite, typecheck, lint, production build, and
`git diff --check` before handoff.
