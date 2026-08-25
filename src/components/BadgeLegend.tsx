import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { Badge, BADGE_CATALOG_ORDER, BADGE_HOW_TO_EARN, BADGE_ICONS, BADGE_LABELS } from '../lib/badges';

type Props = {
  earnedBadges: Badge[];
};

// The full catalog, always all 6 entries regardless of what's actually
// been earned — an unearned badge shows greyed out rather than being
// omitted, so "what's left to earn" is visible at a glance, not just
// "what I have." Earned entries light up in color; a repeatable type
// (challenge_won, offseason_completed) shows how many times if more than
// one, since those aren't singletons the way the streak milestones are.
export default function BadgeLegend({ earnedBadges }: Props) {
  const countByType = new Map<string, number>();
  for (const b of earnedBadges) {
    countByType.set(b.type, (countByType.get(b.type) ?? 0) + 1);
  }

  return (
    <View style={styles.grid}>
      {BADGE_CATALOG_ORDER.map((type) => {
        const count = countByType.get(type) ?? 0;
        const earned = count > 0;
        return (
          <View key={type} style={[styles.card, earned ? styles.cardEarned : styles.cardUnearned]}>
            <Text style={[styles.icon, !earned && styles.iconUnearned]}>{BADGE_ICONS[type]}</Text>
            <Text style={[styles.label, earned ? styles.labelEarned : styles.labelUnearned]}>
              {BADGE_LABELS[type]}
              {count > 1 ? ` ×${count}` : ''}
            </Text>
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
  howTo: { fontSize: 11, color: colors.textMuted, lineHeight: 15, marginTop: 2 },
});
