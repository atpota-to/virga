// The report library: every card a dashboard can hold, what it shows, where
// its full report is, and the sizes it can take. The components that draw
// them are in widgets/index.jsx; this list stays free of them so the layout
// code can check a stored dashboard against it without loading any charts.

import {
  Ban,
  Clock,
  Cloud,
  Database,
  Heart,
  PenLine,
  Repeat2,
  Shield,
  UserMinus,
  UserPlus,
  UsersRound,
} from 'lucide-react';

export const CATEGORIES = Object.freeze([
  { key: 'followers', label: 'Followers' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'posts', label: 'Posts' },
  { key: 'people', label: 'People' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'repo', label: 'Repo' },
]);

const STAT = ['xs', 's'];
const CHART = ['s', 'm', 'l', 'xl'];
const LIST = ['s', 'm', 'l', 'xl'];

function def(type, name, desc, category, icon, sizes, defaultSize, href, kind = 'card') {
  return { type, name, desc, category, icon, sizes, defaultSize, href, kind };
}

export const WIDGETS = Object.freeze(
  Object.fromEntries(
    [
      // Figures
      def('stat-followers', 'Followers', 'Everyone following you now', 'followers', UsersRound, STAT, 'xs', '/reports/followers', 'stat'),
      def('stat-new-followers', 'New followers', 'Gained in the period, against the one before', 'followers', UserPlus, STAT, 'xs', '/reports/followers', 'stat'),
      def('stat-unfollows', 'Unfollows', 'Who left since the last sync', 'followers', UserMinus, STAT, 'xs', '/tools/unfollow-tracker', 'stat'),
      def('stat-engagement', 'Engagement', 'Likes, reposts, replies and quotes received', 'engagement', Heart, STAT, 'xs', '/reports/engagement', 'stat'),
      def('stat-per-post', 'Engagement per post', 'Averaged over your posts and threads', 'engagement', Heart, STAT, 'xs', '/reports/engagement', 'stat'),
      def('stat-given', 'Engagement given', 'Likes, reposts, replies and quotes you gave', 'engagement', Repeat2, STAT, 'xs', '/reports/engagement?direction=given', 'stat'),
      def('stat-posts', 'Posts', 'Posts and replies in the period', 'posts', PenLine, STAT, 'xs', '/reports/posts', 'stat'),
      def('stat-blocks', 'Blocked by', 'Directly or through moderation lists', 'blocks', Ban, STAT, 'xs', '/reports/blocks', 'stat'),

      // Charts
      def('follower-growth', 'Follower growth', 'Followers over time, dated by each follow record', 'followers', UserPlus, CHART, 'l', '/reports/followers'),
      def('new-followers', 'New followers', 'Gains per day, week or month', 'followers', UserPlus, CHART, 'm', '/reports/followers'),
      def('engagement-over-time', 'Engagement over time', 'What each day’s or week’s posts have earned', 'engagement', Heart, CHART, 'm', '/reports/engagement'),
      def('engagement-rate', 'Engagement rate', 'Engagement per post, posts and threads only', 'engagement', Heart, CHART, 'm', '/reports/engagement'),
      def('engagement-by-type', 'Engagement by type', 'Likes, reposts, replies and quotes received', 'engagement', Heart, ['s', 'm', 'l'], 's', '/reports/engagement'),
      def('engagement-given', 'Engagement given', 'What you hand out, per day or week', 'engagement', Repeat2, CHART, 'm', '/reports/engagement?direction=given'),
      def('posting-cadence', 'Posting cadence', 'Posts per day or week, with the trend', 'posts', PenLine, CHART, 'm', '/reports/posts'),
      def('best-time', 'Best time to post', 'What a typical post earns, by weekday and hour', 'posts', Clock, ['m', 'l', 'xl'], 'm', '/tools/best-time'),
      def('blocks-over-time', 'Blocks over time', 'Block reach, direct and through lists', 'blocks', Ban, CHART, 'm', '/reports/blocks'),
      def('repo-activity', 'Repo activity', 'Records written per day or week, every app', 'repo', Cloud, CHART, 'm', '/reports/atmosphere'),

      // Lists
      def('top-posts', 'Top posts', 'Your posts, ranked by engagement', 'posts', PenLine, LIST, 'm', '/reports/engagement'),
      def('top-engagers', 'Top engagers', 'Who interacts with you the most', 'people', UsersRound, LIST, 'm', '/reports/people'),
      def('you-engage-with', 'You engage with', 'The accounts you interact with the most', 'people', Repeat2, LIST, 'm', '/reports/people'),
      def('follow-back', 'Follow-back queue', 'Followers who engage, that you don’t follow', 'people', UserPlus, LIST, 'm', '/tools/follow-back'),
      def('newest-followers', 'Newest followers', 'The latest people to follow you', 'followers', UserPlus, LIST, 'm', '/reports/followers'),
      def('unfollows', 'Unfollows between syncs', 'Who left, and when it was noticed', 'followers', UserMinus, LIST, 's', '/tools/unfollow-tracker'),
      def('lists-on', 'Lists you’re on', 'Moderation and curation lists that include you', 'blocks', Shield, LIST, 'm', '/tools/lists'),
      def('repo-collections', 'Records by collection', 'Every app that writes to your repo', 'repo', Database, LIST, 'm', '/reports/atmosphere'),
    ].map((w) => [w.type, w]),
  ),
);

export const WIDGET_LIST = Object.freeze(Object.values(WIDGETS));
