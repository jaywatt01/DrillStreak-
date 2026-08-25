import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import {
  Badge,
  BADGE_CATALOG_ORDER,
  BADGE_HOW_TO_EARN,
  BADGE_ICONS,
  BADGE_LABELS,
  SEASON_SCOPED_BADGE_TYPES,
} from '../lib/badges';

type Props = {
  // The 4 streak badges (7/30/60/100-day) reset every season — earned/
  // unearned here reflects THIS season only, already filtered by the
  // caller (see filterCurrentBadges in lib/badges.ts). challenge_won and
  // offseason_completed are lifetime badges, so their entries in this list
  // don't matter — allBadges below is what those two actually read from.
  currentSeasonBadges: Badge[];
  // Unfiltered, every badge this player has ever earned — used only for
  // the two lifetime types, to show a real "earned N times" count instead
  // of a plain earned/unearned toggle.
  allBadges: Badge[];
};

// The full catalog, always all 6 entries regardless of what's actually
// been earned — an unearned badge shows greyed out rather than being
// omitted, so "what's left to earn" is visible at a glance, not just
// "what I have." Streak badges (2026-08-25: now season-scoped) light up
// based on this season alone; challenge_won/offseason_completed stay
// lifetime and show a real count once earned more than once.
export default function BadgeLegend({ currentSeasonBadges, allBadges }: Props) {
  const currentSeasonTypes = new Set(currentSeasonBadges.map((b) => b.type));
  const lifetimeCountByType = new Map<string, number>();
  for (const b of allBadges) {
    if (SEASON_SCOPED_BADGE_TYPES.includes(b.type)) continue;
    lifetimeCountByType.set(b.type, (lifetimeCountByType.get(b.type) ?? 0) + 1);
  }

  return (
    <View style={styles.grid}>
      {BADGE_CATALOG_ORDER.map((type) => {
        const isSeasonScoped = SEASON_SCOPED_BADGE_TYPES.includes(type);
        const lifetimeCount = lifetimeCountByType.get(type) ?? 0;
        const earned = isSeasonScoped ? currentSeasonTypes.has(type) : lifetimeCount > 0;
        return (
          <View key={type} style={[styles.card, earned ? styles.cardEarned : styles.cardUnearned]}>
            <Text style={[styles.icon, !earned && styles.iconUnearned]}>{BADGE_ICONS[type]}</Text>
            <Text style={[styles.label, earned ? styles.labelEarned : styles.labelUnearned]}>
              {BADGE_LABELS[type]}
            </Text>
            {!isSeasonScoped && lifetimeCount > 0 ? (
              <Text style={styles.countText}>
                Earned {lifetimeCount} {lifetimeCount === 1 ? 'time' : 'times'}
              </Text>
            ) : null}
            <Text style={styles.scopeTag}>{isSeasonScoped ? 'Resets each season' : 'Lifetime'}</Text>
            <Text style={styles.howTo}>{BADGE_HOW_TO_EARN[type]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    width: '48%',
    borderRadius: 12,
    padding: 12,
    gap: 2,
    borderWidth: 1,
  },
  cardEarned: {
    backgroundColor: '#FFF8EA',
    borderColor: colors.accent,
  },
  cardUnearned: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  icon: { fontSize: 28 },
  iconUnearned: { opacity: 0.3 },
  label: { fontSize: 13, fontWeight: '700' },
  labelEarned: { color: colors.accentDark },
  labelUnearned: { color: colors.textMuted },
  countText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  scopeTag: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: 2 },
  howTo: { fontSize: 11, color: colors.textMuted, lineHeight: 15, marginTop: 2 },
});
