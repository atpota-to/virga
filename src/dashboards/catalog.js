// The report library: every card a dashboard can hold, what it shows, where
// its full report is, and the sizes it can take. The components that draw
// them are in widgets/index.jsx; this list stays free of them so the layout
// code can check a stored dashboard against it without loading any charts.

import {
  Ban,
  CalendarClock,
  Clock,
  Cloud,
  Database,
  Eye,
  FileText,
  Hash,
  Heart,
  ImageIcon,
  Link2,
  MessagesSquare,
  PenLine,
  Repeat2,
  Ruler,
  Shapes,
  Shield,
  Timer,
  UserMinus,
  UserPlus,
  UsersRound,
} from 'lucide-react';

export const CATEGORIES = Object.freeze([
  { key: 'followers', label: 'Followers' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'views', label: 'Views' },
  { key: 'posts', label: 'Posts' },
  { key: 'content', label: 'Content' },
  { key: 'people', label: 'People' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'repo', label: 'Repo' },
  { key: 'posting', label: 'Posting' },
]);

const STAT = ['xs', 's'];
const CHART = ['s', 'm', 'l', 'xl'];
const LIST = ['s', 'm', 'l', 'xl'];

// What a card can be set to in Customize, besides its size (layouts.js
// `cleanOptions` checks a stored card against this). Every card can be given
// a title. `P` cards answer for a period and can keep one of their own; `K`
// cards count engagement and can be narrowed to one kind of it; `R` cards
// are lists and can be told how many rows to show.
const T = ['title'];
const P = ['title', 'period'];
const PK = ['title', 'period', 'kind'];
const PR = ['title', 'period', 'rows'];
const PKR = ['title', 'period', 'kind', 'rows'];
const TR = ['title', 'rows'];

function def(type, name, desc, category, icon, sizes, defaultSize, href, kind = 'card', options = P) {
  return { type, name, desc, category, icon, sizes, defaultSize, href, kind, options };
}

export const WIDGETS = Object.freeze(
  Object.fromEntries(
    [
      // Figures
      def('stat-followers', 'Followers', 'Everyone following you now', 'followers', UsersRound, STAT, 'xs', '/reports/followers', 'stat'),
      def('stat-new-followers', 'New followers', 'Gained in the period, against the one before', 'followers', UserPlus, STAT, 'xs', '/reports/followers', 'stat'),
      def('stat-unfollows', 'Unfollows', 'Who left since the last sync', 'followers', UserMinus, STAT, 'xs', '/tools/unfollow-tracker', 'stat', T),
      def('stat-engagement', 'Engagement', 'Likes, reposts, replies and quotes received', 'engagement', Heart, STAT, 'xs', '/reports/engagement', 'stat', PK),
      def('stat-per-post', 'Engagement per post', 'Averaged over your posts and threads', 'engagement', Heart, STAT, 'xs', '/reports/engagement', 'stat', PK),
      def('stat-views', 'Views', 'Views on the period’s posts, from the counts Bluesky shows only you', 'views', Eye, STAT, 'xs', '/reports/views', 'stat'),
      def('stat-view-rate', 'Engagement per view', 'Likes, reposts, replies and quotes per 100 views', 'views', Eye, STAT, 'xs', '/reports/views', 'stat'),
      def('stat-given', 'Engagement given', 'Likes, reposts, replies and quotes you gave', 'engagement', Repeat2, STAT, 'xs', '/reports/engagement?direction=given', 'stat', PK),
      def('stat-posts', 'Posts', 'Posts and replies in the period', 'posts', PenLine, STAT, 'xs', '/reports/posts', 'stat'),
      def('stat-typical-post', 'A typical post', 'What the middle post of yours earns', 'content', Shapes, STAT, 'xs', '/reports/content', 'stat'),
      def('stat-alt-text', 'Media described', 'How many of your pictures and videos have alt text', 'content', ImageIcon, STAT, 'xs', '/reports/content', 'stat'),
      def('stat-blocks', 'Blocked by', 'Directly or through moderation lists', 'blocks', Ban, STAT, 'xs', '/reports/blocks', 'stat'),
      def('stat-scheduled', 'Scheduled', 'Posts waiting to go out, and when the next one does', 'posting', CalendarClock, STAT, 'xs', '/posting/scheduled', 'stat', T),
      def('stat-timers', 'Timers', 'Post timers counting down', 'posting', Timer, STAT, 'xs', '/posting/timers', 'stat', T),

      // Charts
      def('follower-growth', 'Follower growth', 'Followers over time, dated by each follow record', 'followers', UserPlus, CHART, 'l', '/reports/followers'),
      def('new-followers', 'New followers', 'Gains per day, week or month', 'followers', UserPlus, CHART, 'm', '/reports/followers'),
      def('engagement-over-time', 'Engagement over time', 'What each day’s or week’s posts have earned', 'engagement', Heart, CHART, 'm', '/reports/engagement', 'card', PK),
      def('engagement-rate', 'Engagement rate', 'Engagement per post, posts and threads only', 'engagement', Heart, CHART, 'm', '/reports/engagement', 'card', PK),
      def('engagement-by-type', 'Engagement by type', 'Likes, reposts, replies and quotes received', 'engagement', Heart, ['s', 'm', 'l'], 's', '/reports/engagement'),
      def('engagement-given', 'Engagement given', 'What you hand out, per day or week', 'engagement', Repeat2, CHART, 'm', '/reports/engagement?direction=given', 'card', PK),
      def('views-by-date', 'Views by post date', 'How often each day’s or week’s posts were seen', 'views', Eye, CHART, 'm', '/reports/views'),
      def('views-gained', 'Views gained', 'Views gained between Virga’s readings', 'views', Eye, CHART, 'm', '/reports/views'),
      def('view-rate', 'Engagement per view', 'Per 100 views, by when each post was made', 'views', Eye, CHART, 'm', '/reports/views'),
      def('views-formats', 'Views by format', 'A typical post’s views, by what it carries', 'views', Eye, ['s', 'm', 'l'], 'm', '/reports/views'),
      def('posting-cadence', 'Posting cadence', 'Posts per day or week, with the trend', 'posts', PenLine, CHART, 'm', '/reports/posts'),
      def('best-time', 'Best time to post', 'What a typical post earns, by weekday and hour', 'posts', Clock, ['m', 'l', 'xl'], 'm', '/tools/best-time'),
      def('content-formats', 'Formats', 'What a typical post earns, by what it carries', 'content', Shapes, ['s', 'm', 'l'], 'm', '/reports/content'),
      def('content-length', 'Post length', 'What a typical post earns, by how long it is', 'content', Ruler, ['s', 'm', 'l'], 's', '/reports/content'),
      def('blocks-over-time', 'Blocks over time', 'Block reach, direct and through lists', 'blocks', Ban, CHART, 'm', '/reports/blocks'),
      def('repo-activity', 'Repo activity', 'Records written per day or week, every app', 'repo', Cloud, CHART, 'm', '/reports/atmosphere'),

      // Lists
      def('top-posts', 'Top posts', 'Your posts, ranked by engagement', 'posts', PenLine, LIST, 'm', '/reports/engagement', 'card', PKR),
      def('most-seen', 'Most seen', 'Your posts with the most views', 'views', Eye, LIST, 'm', '/reports/views', 'card', PR),
      def('top-tags', 'Tags', 'The tags you use, and what posts with them earn', 'content', Hash, LIST, 'm', '/reports/content', 'card', PR),
      def('top-links', 'Sites you link to', 'Where your links go, and what those posts earn', 'content', Link2, LIST, 'm', '/reports/content', 'card', PR),
      def('top-engagers', 'Top engagers', 'Who interacts with you the most', 'people', MessagesSquare, LIST, 'm', '/reports/people', 'card', PKR),
      def('you-engage-with', 'You engage with', 'The accounts you interact with the most', 'people', Repeat2, LIST, 'm', '/reports/people', 'card', PKR),
      def('follow-back', 'Follow-back queue', 'Followers who engage, that you don’t follow', 'people', UserPlus, LIST, 'm', '/tools/follow-back', 'card', PR),
      def('newest-followers', 'Newest followers', 'The latest people to follow you', 'followers', UserPlus, LIST, 'm', '/reports/followers', 'card', PR),
      def('unfollows', 'Unfollows between syncs', 'Who left, and when it was noticed', 'followers', UserMinus, LIST, 's', '/tools/unfollow-tracker', 'card', TR),
      def('lists-on', 'Lists you’re on', 'Moderation and curation lists that include you', 'blocks', Shield, LIST, 'm', '/tools/lists', 'card', TR),
      def('repo-collections', 'Records by collection', 'Every app that writes to your repo', 'repo', Database, LIST, 'm', '/reports/atmosphere', 'card', PR),
      def('posting-next', 'Going out next', 'Your scheduled and queued posts, soonest first', 'posting', CalendarClock, LIST, 'm', '/posting/scheduled', 'card', TR),
      def('posting-drafts', 'Latest drafts', 'Drafts waiting on your Bluesky account', 'posting', FileText, LIST, 'm', '/posting/drafts', 'card', TR),
    ].map((w) => [w.type, w]),
  ),
);

export const WIDGET_LIST = Object.freeze(Object.values(WIDGETS));
