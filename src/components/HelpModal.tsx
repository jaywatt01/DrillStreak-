import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

type QA = { q: string; a: string };
type Section = { title: string; items: QA[] };

// Real ask, 2026-09-11: "the app has a lot of layers and a lot of things
// it does... people might need help figuring things out." Content below
// describes real, shipped behavior only — nothing aspirational or
// planned. Reached from a link on Account.
//
// 2026-09-12: rebuilt from a hidden Tab.Screen into a Modal, same
// pattern as SportSwitcherModal — a real bug Jay caught on-device, not
// cosmetic: every registered route in a bottom-tab navigator gets an
// equal flex:1 slot in the bar regardless of what tabBarButton renders
// inside it (confirmed by reading @react-navigation/bottom-tabs' own
// source), so the hidden Help tab was silently eating 1/7 of the bar's
// width for nothing, visibly shifting the 6 real tabs left of center.
// A Modal never touches the tab bar's route list at all, and gives Help
// a real Back button for free instead of relying on "just tap another
// tab," which Jay also asked for explicitly.
const SECTIONS: Section[] = [
  {
    title: 'Getting Started',
    items: [
      {
        q: 'How do I switch sports?',
        a: 'Tap "Switch sport" on the Drills or Account tab, or long-press the Drills tab icon itself. Nothing is ever deleted when you switch — every sport keeps its own players, teams, and history.',
      },
      {
        q: 'How do I add a player?',
        a: 'Go to the Players tab and tap "Add a player." Add a Player and Create a Team always use whatever sport is currently active — switch sports first if you meant a different one.',
      },
      {
        q: 'How do I join a team?',
        a: "Go to the Players tab, pick the player, and enter the invite code your coach shared. You'll see a confirmation once it works.",
      },
    ],
  },
  {
    title: 'For Coaches',
    items: [
      {
        q: 'How do I create a team?',
        a: 'Go to the My Team tab and create one for whatever sport is currently active. You get a shareable invite code immediately.',
      },
      {
        q: 'How do I assign drills?',
        a: 'On My Team, tap "+ Assign," pick a category (or position), then a drill, then choose Whole Team or specific players.',
      },
      {
        q: "How do I see who's actually done their drills?",
        a: 'Roster Activity on My Team shows completions logged by anyone on the roster this week. Player-targeted assignments also show a "✓ Done" indicator once that specific player finishes.',
      },
    ],
  },
  {
    title: 'Team Chat & Calendar',
    items: [
      {
        q: "What's Team Chat?",
        a: "A team-wide feed plus private messages — with your coach if you're a parent/player, or with any family if you're the coach. Switch between the team feed and a specific conversation using the chips at the top.",
      },
      {
        q: 'Can a coach post announcements?',
        a: 'Yes — long-press any team-wide message and pin it. Pinned messages show at the top of the feed.',
      },
      {
        q: 'How do team events (games, practices) get on my calendar?',
        a: 'On Team Chat, switch to the Calendar view. Coaches can add an event with a date, time, and location; anyone on the roster can tap "Add to my calendar" on any event to save it straight to their phone\'s own calendar app.',
      },
      {
        q: 'Can I add a specific drill to my calendar too?',
        a: "Yes — tap the 📅 icon on any drill on the Drills tab to schedule it with your own time and duration. If your coach set a suggested time for an assigned drill, that pre-fills the picker for you.",
      },
    ],
  },
  {
    title: 'Logging Drills',
    items: [
      {
        q: 'How do I log a drill as done?',
        a: 'On the Drills tab, tap "Mark done" on any drill row. If a number applies (makes/attempts, or reps and time for conditioning), a small modal lets you log it.',
      },
      {
        q: "What's Quick Start?",
        a: 'A row of chips near the top of the Drills tab — tap one for a random drill from that category (or position, for sports like soccer and volleyball). A fast way to add something without browsing.',
      },
      {
        q: 'What\'s "What to work on today"?',
        a: 'Browse the full drill list by category (or position) and add specific ones to your list, instead of getting a random pick.',
      },
      {
        q: 'Can I add my own drill?',
        a: 'Yes — go to the Players tab, select a player, and use "Add a custom drill." It shows up alongside the default library and works with recording, scheduling, and everything else.',
      },
      {
        q: 'Can I record myself doing a drill?',
        a: 'Yes — tap the 🎥 icon on any drill row. Record, watch it back, then log your result. The video stays on your own phone\'s camera roll — DrillStreak never uploads or stores it.',
      },
      {
        q: 'What are streaks?',
        a: "Log at least one drill a day to keep your streak going. Missing a single day here and there is forgiven once a week (grace), so one busy day doesn't wipe out real progress.",
      },
    ],
  },
  {
    title: 'Badges & Challenges',
    items: [
      {
        q: 'What are badges?',
        a: 'Milestones you earn automatically — 7/30/60/100-day streaks, winning a Challenge a Teammate, and completing an offseason. See them on the Account tab or a player\'s profile.',
      },
      {
        q: "What's Challenge a Teammate?",
        a: 'A friendly 7-day head-to-head against someone on the same roster — most drills completed during the window wins. Both sides have to accept before it starts.',
      },
    ],
  },
  {
    title: 'Seasons & Offseason',
    items: [
      {
        q: "What's a season?",
        a: 'A named chunk of time your stats and history are grouped under. Start a new one anytime for a fresh-start feeling — nothing from before is deleted, just archived under the old season.',
      },
      {
        q: "What's offseason mode?",
        a: 'Swaps the daily streak for a weekly goal, and suggests a focus area based on your own real numbers from last season — not a generic tip.',
      },
    ],
  },
  {
    title: 'Account & Membership',
    items: [
      {
        q: "What's the difference between free and Parent membership?",
        a: 'Free: this week\'s activity, one linked player. Parent ($4.99/mo): full history and unlimited linked players — across every sport your family plays, one price, not per sport or per kid.',
      },
      {
        q: '"Your Players" shows all my kids — what can I do there?',
        a: "It lists every player linked to your account across every sport, so you don't have to switch sports just to see who plays what. Long-press a player for Edit Profile, Remove from Team, or Delete.",
      },
      {
        q: 'How do I remove my kid from a team?',
        a: 'Long-press their card in "Your Players" on Account and choose Remove from Team. This is separate from deleting their profile — they stay a player on your account, just off that roster.',
      },
      {
        q: 'How do I delete a player profile?',
        a: "Long-press their card and choose Delete. This removes their profile and all logged history — it can't be undone.",
      },
    ],
  },
];

type Props = { visible: boolean; onClose: () => void };

export default function HelpModal({ visible, onClose }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={onClose} hitSlop={8} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Help & FAQ</Text>
        <View style={styles.backButtonSpacer} />
      </View>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Answers to what DrillStreak actually does today. Tap a question to expand it.
        </Text>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.title}</Text>
            {section.items.map((item) => {
              const key = `${section.title}:${item.q}`;
              const open = openKey === key;
              return (
                <Pressable key={key} style={styles.item} onPress={() => setOpenKey(open ? null : key)}>
                  <View style={styles.questionRow}>
                    <Text style={styles.question}>{item.q}</Text>
                    <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
                  </View>
                  {open ? <Text style={styles.answer}>{item.a}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text style={styles.footer}>Still stuck? Reach out to support@drillstreak.com.</Text>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backButton: { minWidth: 64 },
  backButtonText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  backButtonSpacer: { minWidth: 64 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
  intro: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  section: { gap: 8 },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    gap: 6,
  },
  questionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  question: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 12, color: colors.textMuted },
  answer: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  footer: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
});
