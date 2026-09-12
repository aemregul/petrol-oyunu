import type { OpenTabs } from './lessonTypes';

/**
 * The tab each tabbed panel is showing, reported by the panels themselves.
 * A plain object rather than store state for the same reason as worldTarget:
 * the tab is the panel's own business, and only the lesson overlay, which
 * polls, needs to know it.
 */
export const openTabs: OpenTabs = { build: null, staff: null, office: null, officeLoans: false };
