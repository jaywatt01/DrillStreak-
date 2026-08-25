import { StyleSheet, Text, View } from 'react-native';
import { Badge, BADGE_CATALOG_ORDER, BADGE_ICONS, SEASON_SCOPED_BADGE_TYPES } from '../lib/badges';

type Props = {
  currentSeasonBadges: Badge[];
  allBadges: Badge[];
};

// Compact icon-per-badge-type row — the roster-scale counterpart to
// BadgeLegend's full detail cards, same relationship WeekDotsRow has to
// StreakCalendar (added 2026-08-25, Jay-requested: the full per-player
// legend grid was too much scrolling for a multi-kid account). Meant to
// sit right under a player's name in a compact list; tap through to the
// full legend for "how to earn" text and lifetime counts.
export default function BadgeIconStrip({ currentSeasonBadges, allBadges }: Props) {
  const currentSeasonTypes = new Set(currentSeasonBadges.map((b) => b.type));
  const lifetimeTypes = new Set(
    allBadges.filter((b) => !SEASON_SCOPED_BADGE_TYPES.includes(b.type)).map((b) => b.type)
  );

  return (
    <View style={styles.row}>
      {BADGE_CATALOG_ORDER.map((type) => {
        const earned = SEASON_SCOPED_BADGE_TYPES.includes(type)
          ? currentSeasonTypes.has(type)
          : lifetimeTypes.has(type);
        return (
          <Text key={type} style={[styles.icon, !earned && styles.iconUnearned]}>
            {BADGE_ICONS[type]}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  icon: { fontSize: 18 },
  iconUnearned: { opacity: 0.25 },
});
